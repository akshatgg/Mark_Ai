# Visual Scheduling Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full page where an operator picks a screen, drops an ad onto a canvas that *is* that screen, stretches it to fit, and schedules it — with an AI rebuild escape hatch when the stretch distorts too far.

**Architecture:** The canvas produces four percentages (`x, y, w, h`) — the same shape `bookings.layout.zones[]` already stores. On save the backend renders the placement at the panel's native resolution and books THAT as the creative, so the player's existing `FIT_CENTER` fills it exactly and **no APK release is needed**. Images render instantly with Pillow; video is a queued ffmpeg job.

**Tech Stack:** FastAPI + Pillow (backend), ffmpeg (video, ported from branch `video/resize`), Next.js 15 + React + Tailwind + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-27-visual-scheduling-canvas-design.md`

## Global Constraints

- **Backend tests: DO NOT run pytest.** Verify with a standalone script under the scratchpad, run via `PYTHONPATH=. poetry run python <script>`. The user runs the test suite.
- `poetry run ruff check app/` must pass before every backend commit.
- Frontend: `npm run typecheck` and `npm test` must pass before every frontend commit.
- Commit as `akshatgg <akshatg9636@gmail.com>` using `git -c user.name=... -c user.email=...`. **Never add Claude co-author trailers.**
- Coordinates are **percentages of the panel, 0–100**, never pixels, and never outside 0–100.
- The output render is **exactly the panel's reported resolution**. Never a guessed default.
- The original `MediaAsset` is never modified. Placement always produces a new asset.
- No changes to the player APK.
- **The AI rebuild is IMAGE-ONLY.** Video gets stretch and nothing else — Creative Fit
  re-lays-out still artwork and has no equivalent for a finished film. The button must be
  absent for video, not merely disabled.

---

### Task 1: Placement geometry (pure, no I/O)

The maths the canvas and the renderer must agree on. Isolated first so both sides share one definition of "stretched 1.8×".

**Files:**
- Create: `markai-signage-api/app/content/placement.py`
- Verify: `<scratchpad>/verify_placement.py`

**Interfaces:**
- Produces: `Box(x: float, y: float, w: float, h: float)` dataclass; `to_pixels(box, panel_w, panel_h) -> tuple[int,int,int,int]`; `distortion(src_w, src_h, box, panel_w, panel_h) -> float`; `clamp(box) -> Box`; `PlacementError`

- [ ] **Step 1: Write the module**

```python
"""Where a creative sits on a panel, and how far it was pushed to get there.

The canvas in the CMS and the renderer on the server must agree exactly about two
things: which pixels a box maps to, and how distorted the result is. Two copies of
that arithmetic would drift the first time either was touched, so it lives here and
both sides import it.

Coordinates are PERCENTAGES of the panel (0-100), never pixels. The panel is the only
thing that knows its own pixel size, and a creative placed in pixels would be wrong
the moment it was shown on a different screen.
"""

from __future__ import annotations

from dataclasses import dataclass


class PlacementError(ValueError):
    """A box that cannot be rendered — off-panel, inverted, or zero-sized."""


@dataclass(frozen=True)
class Box:
    """A rectangle on the panel, as percentages. (x, y) is the top-left corner."""

    x: float
    y: float
    w: float
    h: float


def clamp(box: Box) -> Box:
    """Pull a box back inside the panel.

    The canvas already stops at the edge, but a box also arrives over HTTP where
    nothing stopped it. Clamping rather than rejecting is deliberate: a box one pixel
    over the edge is a rounding artifact of a drag, not an operator error worth a 422.
    """
    w = min(max(box.w, 0.0), 100.0)
    h = min(max(box.h, 0.0), 100.0)
    x = min(max(box.x, 0.0), 100.0 - w)
    y = min(max(box.y, 0.0), 100.0 - h)
    return Box(x=x, y=y, w=w, h=h)


def to_pixels(box: Box, panel_w: int, panel_h: int) -> tuple[int, int, int, int]:
    """(x, y, w, h) in real pixels on this panel.

    Rounded, then re-checked: a box that rounds to zero width would raise deep inside
    Pillow with a message about tuples, so it is refused here in words instead.
    """
    if panel_w <= 0 or panel_h <= 0:
        raise PlacementError("The screen has no usable resolution.")
    box = clamp(box)
    w = round(panel_w * box.w / 100.0)
    h = round(panel_h * box.h / 100.0)
    x = round(panel_w * box.x / 100.0)
    y = round(panel_h * box.y / 100.0)
    if w <= 0 or h <= 0:
        raise PlacementError("That placement is too small to render.")
    # Rounding can push the far edge one pixel past the panel; pull it back rather
    # than rendering a canvas that is 1px wider than the screen.
    x = min(x, panel_w - w)
    y = min(y, panel_h - h)
    return x, y, w, h


def distortion(src_w: int, src_h: int, box: Box, panel_w: int, panel_h: int) -> float:
    """How much more one axis was stretched than the other. 1.0 is undistorted.

    This is the number the operator is shown before they book. It is a RATIO of
    scale factors, not of aspect ratios, because a creative scaled 3x on both axes is
    not distorted at all — it is just bigger.
    """
    if src_w <= 0 or src_h <= 0:
        raise PlacementError("The creative has no usable dimensions.")
    _x, _y, w, h = to_pixels(box, panel_w, panel_h)
    sx = w / src_w
    sy = h / src_h
    if sx <= 0 or sy <= 0:
        raise PlacementError("That placement is too small to render.")
    return max(sx, sy) / min(sx, sy)


def fill_box() -> Box:
    """The whole panel — what the ✥ button produces."""
    return Box(x=0.0, y=0.0, w=100.0, h=100.0)
```

- [ ] **Step 2: Write the verification script**

```python
# <scratchpad>/verify_placement.py
from app.content.placement import Box, PlacementError, clamp, distortion, fill_box, to_pixels

ok = fail = 0
def check(label, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  PASS  {label}")
    else: fail += 1; print(f"  FAIL  {label} {detail}")

# to_pixels
check("full panel maps to the whole panel", to_pixels(fill_box(), 1920, 1080) == (0, 0, 1920, 1080))
check("half width", to_pixels(Box(0, 0, 50, 100), 1920, 1080) == (0, 0, 960, 1080))
check("offset box", to_pixels(Box(25, 25, 50, 50), 1000, 800) == (250, 200, 500, 400))

# clamping
check("overflow is pulled back", to_pixels(Box(80, 0, 50, 100), 1000, 1000)[0] == 500)
check("negative x clamps to 0", clamp(Box(-10, 0, 50, 50)).x == 0.0)
check("w over 100 clamps", clamp(Box(0, 0, 150, 50)).w == 100.0)

# refusals
try:
    to_pixels(Box(0, 0, 0.001, 50), 100, 100); check("zero-size refused", False)
except PlacementError: check("zero-size refused", True)
try:
    to_pixels(fill_box(), 0, 0); check("no resolution refused", False)
except PlacementError: check("no resolution refused", True)

# distortion
check("undistorted fill of a matching panel", abs(distortion(1920, 1080, fill_box(), 1920, 1080) - 1.0) < 0.001)
check("uniform scale is NOT distortion", abs(distortion(960, 540, fill_box(), 1920, 1080) - 1.0) < 0.001)
d = distortion(1080, 1080, fill_box(), 1920, 1080)
check("square onto 16:9 is ~1.78x", abs(d - 1.7777) < 0.01, f"got {d}")
check("distortion is never below 1", distortion(1920, 1080, Box(0, 0, 50, 100), 1920, 1080) >= 1.0)

print(f"\n{ok} passed, {fail} failed")
```

- [ ] **Step 3: Run it and confirm every line passes**

Run: `cd markai-signage-api && PYTHONPATH=. poetry run python <scratchpad>/verify_placement.py`
Expected: `12 passed, 0 failed`

- [ ] **Step 4: Lint**

Run: `poetry run ruff check app/content/placement.py`
Expected: `All checks passed!`

- [ ] **Step 5: Commit**

```bash
git add app/content/placement.py
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" \
  commit -m "feat(content): the geometry behind placing a creative on a panel"
```

---

### Task 2: Render a placed image

**Files:**
- Create: `markai-signage-api/app/content/place_render.py`
- Verify: `<scratchpad>/verify_place_render.py`

**Interfaces:**
- Consumes: Task 1's `Box`, `to_pixels`
- Produces: `render_image_placement(data: bytes, panel_w: int, panel_h: int, box: Box) -> tuple[bytes, str, str]` returning `(bytes, mime_type, extension)`

- [ ] **Step 1: Write the module**

```python
"""Paint a creative onto a panel-sized canvas at the box the operator dragged.

`creative_fit.resizer.fit` already stretches to an exact size, but it always fills the
whole frame. This adds the one thing it cannot do: put the result SOMEWHERE on a larger
canvas, with the rest left black — which is what the operator sees when they stretch an
ad to only part of the panel.

The canvas is exactly the panel's resolution. That is the whole trick behind this
feature: the player's FIT_CENTER has nothing left to letterbox, so it fills, and no APK
release is needed.
"""

from __future__ import annotations

from PIL import Image

from app.content.placement import Box, to_pixels
from app.creative_fit.resizer import RESAMPLE, ResizeError, _open, encode


def render_image_placement(
    data: bytes, panel_w: int, panel_h: int, box: Box
) -> tuple[bytes, str, str]:
    """Return (bytes, mime_type, extension) for the placed creative.

    The output is ALWAYS panel_w x panel_h. A player that is handed an off-size file
    scales it itself, which puts a bad resample on the glass and undoes the point of
    rendering here at all.
    """
    x, y, w, h = to_pixels(box, panel_w, panel_h)

    img = _open(data)
    source_format = img.format
    icc_profile = img.info.get("icc_profile")

    # EXIF-rotated phone photos report their pre-rotation size, so the placement would
    # be computed against the wrong axes. Bake the rotation in first.
    try:
        from PIL import ImageOps

        img = ImageOps.exif_transpose(img) or img
    except Exception:  # pragma: no cover - EXIF is optional
        pass

    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")

    if max(panel_w, panel_h) > 8192:
        raise ResizeError("Screen resolution is capped at 8192px on the long edge.")

    stretched = img.resize((w, h), RESAMPLE)
    canvas = Image.new("RGB", (panel_w, panel_h), (0, 0, 0))
    # An alpha creative is composited onto the black canvas rather than pasted flat,
    # or its transparent regions arrive as opaque black rectangles.
    canvas.paste(stretched, (x, y), stretched if stretched.mode == "RGBA" else None)

    return encode(canvas, source_format=source_format, icc_profile=icc_profile)
```

- [ ] **Step 2: Write the verification script**

```python
# <scratchpad>/verify_place_render.py
import io
from PIL import Image
from app.content.placement import Box, fill_box
from app.content.place_render import render_image_placement

def png(w, h, colour=(255, 0, 0)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), colour).save(buf, format="PNG")
    return buf.getvalue()

ok = fail = 0
def check(label, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  PASS  {label}")
    else: fail += 1; print(f"  FAIL  {label} {detail}")

# fill the whole panel
out, mime, ext = render_image_placement(png(400, 400), 1920, 1080, fill_box())
im = Image.open(io.BytesIO(out))
check("output is the panel's exact size", im.size == (1920, 1080), str(im.size))
check("mime looks right", mime.startswith("image/"), mime)
check("corner is the creative", im.convert("RGB").getpixel((5, 5)) == (255, 0, 0))
check("centre is the creative", im.convert("RGB").getpixel((960, 540)) == (255, 0, 0))

# partial placement leaves black
out, _, _ = render_image_placement(png(100, 100), 1000, 1000, Box(0, 0, 50, 50))
im = Image.open(io.BytesIO(out)).convert("RGB")
check("placed area is the creative", im.getpixel((250, 250)) == (255, 0, 0))
check("uncovered area is black", im.getpixel((750, 750)) == (0, 0, 0))
check("still the panel's size", im.size == (1000, 1000))

# a portrait tower
out, _, _ = render_image_placement(png(1920, 1080), 1080, 2400, fill_box())
check("portrait panel honoured", Image.open(io.BytesIO(out)).size == (1080, 2400))

# alpha does not become a black box
buf = io.BytesIO(); Image.new("RGBA", (50, 50), (0, 255, 0, 255)).save(buf, format="PNG")
out, _, _ = render_image_placement(buf.getvalue(), 200, 200, Box(25, 25, 50, 50))
im = Image.open(io.BytesIO(out)).convert("RGB")
check("alpha creative renders its colour", im.getpixel((100, 100)) == (0, 255, 0))

print(f"\n{ok} passed, {fail} failed")
```

- [ ] **Step 3: Run it**

Run: `cd markai-signage-api && PYTHONPATH=. poetry run python <scratchpad>/verify_place_render.py`
Expected: `9 passed, 0 failed`

- [ ] **Step 4: Lint**

Run: `poetry run ruff check app/content/place_render.py`
Expected: `All checks passed!`

- [ ] **Step 5: Commit**

```bash
git add app/content/place_render.py
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" \
  commit -m "feat(content): render a creative placed on a panel-sized canvas"
```

---

### Task 3: The place endpoint

**Files:**
- Modify: `markai-signage-api/app/content/service.py` (add `place_media`)
- Modify: `markai-signage-api/app/content/schemas.py` (add `PlaceMediaRequest`)
- Modify: `markai-signage-api/app/cms/content_router.py` (add the route)
- Verify: `<scratchpad>/verify_place_endpoint.py`

**Interfaces:**
- Consumes: Task 1 `Box`, Task 2 `render_image_placement`
- Produces: `POST /api/cms/content/{media_id}/place` → `MediaAssetResponse`; `content_service.place_media(db, user, media_id, screen_id, box) -> MediaAssetResponse`

- [ ] **Step 1: Add the request schema**

In `app/content/schemas.py`, after `RenameMediaRequest`:

```python
class PlaceMediaRequest(BaseModel):
    """Where a creative sits on a screen, as percentages of that screen (0-100)."""

    screen_id: str
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    w: float = Field(gt=0, le=100)
    h: float = Field(gt=0, le=100)
```

Add `Field` to the pydantic import at the top of the file if it is not already there.

- [ ] **Step 2: Add the service function**

In `app/content/service.py`, at the end of the file:

```python
async def place_media(
    db: AsyncSession,
    user,
    media_id: str,
    screen_id: str,
    box,
) -> MediaAssetResponse:
    """Render a creative as it was placed on a screen, and return it as a NEW asset.

    The original is never touched: the same poster is legitimately placed differently on
    a portrait tower and a landscape panel, so a placement that edited the source would
    break every other booking using it.

    Deduped by checksum, the same way chat uploads are: placing the same creative on the
    same screen with the same box twice must produce one library asset, not two.
    """
    import hashlib

    from app.content.place_render import render_image_placement
    from app.core.gcs_service import download_bytes_from_gcs, extract_blob_name_from_url, upload_to_gcs
    from app.screens import service as screens_service

    await assert_media_visible(db, user, media_id)
    asset = (
        await db.execute(select(MediaAsset).where(MediaAsset.id == media_id))
    ).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Media asset not found")
    if asset.type != "image":
        raise HTTPException(
            status_code=422,
            detail="Only images can be placed today — video placement is coming.",
        )

    screen = await screens_service.get_screen(db, screen_id)
    panel_w, panel_h = _parse_resolution(screen.resolution)
    if not panel_w or not panel_h:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{screen.name} has not reported its resolution yet, so an ad cannot be "
                "placed on it. It needs to check in once first."
            ),
        )

    blob = extract_blob_name_from_url(asset.file_url)
    data = download_bytes_from_gcs(blob) if blob else None
    if not data:
        raise HTTPException(status_code=404, detail="The creative's file could not be read.")

    rendered, mime, ext = render_image_placement(data, panel_w, panel_h, box)
    checksum = hashlib.sha256(rendered).hexdigest()

    existing = await find_media_by_checksum(db, checksum)
    if existing is not None:
        return to_response(existing)

    name = f"{asset.name or 'creative'} ({screen.name})"
    url = upload_to_gcs(rendered, f"placed/{checksum}.{ext}", content_type=mime)
    return await create_media(
        db,
        CreateMediaRequest(
            type="image",
            file_url=url,
            duration_seconds=asset.duration_seconds or PROMOTED_MEDIA_DURATION_SECONDS,
            name=name,
            width=panel_w,
            height=panel_h,
            checksum=checksum,
        ),
        uploaded_by=str(user.id),
    )


def _parse_resolution(resolution) -> tuple[int | None, int | None]:
    """'1920x1080' -> (1920, 1080). (None, None) when the screen has not reported."""
    if not resolution or "x" not in str(resolution).lower():
        return None, None
    try:
        w, h = str(resolution).lower().split("x", 1)
        return int(w.strip()), int(h.strip())
    except (ValueError, AttributeError):
        return None, None
```

Add `PROMOTED_MEDIA_DURATION_SECONDS` to the imports from `app.content.constants` if absent.

- [ ] **Step 3: Add the route**

In `app/cms/content_router.py`, after the rename route:

```python
@router.post("/{media_id}/place", response_model=MediaAssetResponse)
async def place_media(
    media_id: str,
    payload: PlaceMediaRequest,
    actor: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
) -> MediaAssetResponse:
    """Render this creative as placed on a screen, and return the new asset.

    A read of the original plus a write of a new asset — deliberately not a PATCH.
    """
    from app.content.placement import Box

    await assert_can_manage_screen(db, actor, payload.screen_id)
    return await service.place_media(
        db,
        actor,
        media_id,
        payload.screen_id,
        Box(x=payload.x, y=payload.y, w=payload.w, h=payload.h),
    )
```

Add `PlaceMediaRequest` to the schema imports and `assert_can_manage_screen` from `app.cms_users.deps` if absent.

- [ ] **Step 4: Verify the app still imports and the route exists**

```python
# <scratchpad>/verify_place_endpoint.py
import app.main
from app.main import app
paths = [r.path for r in app.routes]
target = "/api/cms/content/{media_id}/place"
print("route registered:", target in paths)
assert target in paths, paths[:5]
from app.content.service import place_media, _parse_resolution
print("resolution parse:", _parse_resolution("1920x1080"), _parse_resolution(None))
assert _parse_resolution("1920x1080") == (1920, 1080)
assert _parse_resolution(None) == (None, None)
assert _parse_resolution("garbage") == (None, None)
print("OK")
```

Run: `cd markai-signage-api && GEMINI_API_KEY=dummy PYTHONPATH=. poetry run python <scratchpad>/verify_place_endpoint.py`
Expected: `route registered: True` … `OK`

- [ ] **Step 5: Lint and commit**

```bash
poetry run ruff check app/
git add app/content/ app/cms/content_router.py
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" \
  commit -m "feat(content): place a creative on a screen and save the render"
```

---

### Task 4: The canvas component

**Files:**
- Create: `markai-Web-cms/src/lib/placement.ts`
- Create: `markai-Web-cms/src/lib/placement.test.ts`
- Create: `markai-Web-cms/src/components/scheduling/PlacementCanvas.tsx`

**Interfaces:**
- Produces: `type Box = { x: number; y: number; w: number; h: number }`; `clampBox(box: Box): Box`; `distortion(srcW, srcH, box, panelW, panelH): number`; `fillBox(): Box`; `fillWidth(box): Box`; `fillHeight(box): Box`; `<PlacementCanvas panelW panelH src box onChange />`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/placement.test.ts
import { describe, expect, it } from "vitest";
import { clampBox, distortion, fillBox, fillHeight, fillWidth } from "./placement";

describe("clampBox", () => {
  it("keeps a box that is already inside", () => {
    expect(clampBox({ x: 10, y: 10, w: 50, h: 50 })).toEqual({ x: 10, y: 10, w: 50, h: 50 });
  });
  it("pulls a box back from past the right edge", () => {
    expect(clampBox({ x: 80, y: 0, w: 50, h: 50 }).x).toBe(50);
  });
  it("refuses to leave the panel on the left", () => {
    expect(clampBox({ x: -20, y: -20, w: 50, h: 50 })).toMatchObject({ x: 0, y: 0 });
  });
  it("caps a box larger than the panel", () => {
    expect(clampBox({ x: 0, y: 0, w: 200, h: 300 })).toMatchObject({ w: 100, h: 100 });
  });
});

describe("distortion", () => {
  it("is 1 when the shapes match", () => {
    expect(distortion(1920, 1080, fillBox(), 1920, 1080)).toBeCloseTo(1, 3);
  });
  it("ignores uniform scaling", () => {
    expect(distortion(960, 540, fillBox(), 1920, 1080)).toBeCloseTo(1, 3);
  });
  it("reports a square stretched onto 16:9", () => {
    expect(distortion(1080, 1080, fillBox(), 1920, 1080)).toBeCloseTo(1.778, 2);
  });
  it("is never below 1", () => {
    expect(distortion(1920, 1080, { x: 0, y: 0, w: 40, h: 100 }, 1920, 1080)).toBeGreaterThanOrEqual(1);
  });
});

describe("fill helpers", () => {
  it("fillWidth spans the panel horizontally and keeps y/h", () => {
    expect(fillWidth({ x: 20, y: 30, w: 10, h: 40 })).toEqual({ x: 0, y: 30, w: 100, h: 40 });
  });
  it("fillHeight spans vertically and keeps x/w", () => {
    expect(fillHeight({ x: 20, y: 30, w: 10, h: 40 })).toEqual({ x: 20, y: 0, w: 10, h: 100 });
  });
  it("fillBox is the whole panel", () => {
    expect(fillBox()).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd markai-Web-cms && npm test -- placement`
Expected: FAIL — `Failed to resolve import "./placement"`

- [ ] **Step 3: Write the module**

```typescript
// src/lib/placement.ts
/**
 * Where a creative sits on a panel, as percentages of that panel.
 *
 * Mirrors `app/content/placement.py` on the backend deliberately: the canvas and the
 * renderer must agree exactly about which pixels a box covers and how distorted the
 * result is, or the operator approves one thing and the screen shows another.
 *
 * Percentages, never pixels — a panel is the only thing that knows its own size.
 */

export type Box = { x: number; y: number; w: number; h: number };

/** Pull a box back inside the panel. The drag stops at the edge; this enforces it. */
export function clampBox(box: Box): Box {
  const w = Math.min(Math.max(box.w, 0), 100);
  const h = Math.min(Math.max(box.h, 0), 100);
  return {
    w,
    h,
    x: Math.min(Math.max(box.x, 0), 100 - w),
    y: Math.min(Math.max(box.y, 0), 100 - h),
  };
}

/**
 * How much more one axis was stretched than the other. 1 is undistorted.
 *
 * A ratio of SCALE FACTORS, not of aspect ratios: a creative scaled 3x on both axes
 * is not distorted, it is just bigger.
 */
export function distortion(
  srcW: number,
  srcH: number,
  box: Box,
  panelW: number,
  panelH: number,
): number {
  if (srcW <= 0 || srcH <= 0 || panelW <= 0 || panelH <= 0) return 1;
  const b = clampBox(box);
  const sx = (panelW * b.w) / 100 / srcW;
  const sy = (panelH * b.h) / 100 / srcH;
  if (sx <= 0 || sy <= 0) return 1;
  return Math.max(sx, sy) / Math.min(sx, sy);
}

/** The whole panel — the ✥ button. */
export function fillBox(): Box {
  return { x: 0, y: 0, w: 100, h: 100 };
}

/** Span the panel horizontally, leaving the vertical placement alone. */
export function fillWidth(box: Box): Box {
  return clampBox({ ...box, x: 0, w: 100 });
}

/** Span the panel vertically, leaving the horizontal placement alone. */
export function fillHeight(box: Box): Box {
  return clampBox({ ...box, y: 0, h: 100 });
}

/** What the operator is told before they book. */
export function distortionLabel(factor: number): {
  tone: "ok" | "note" | "warn";
  text: string;
} {
  if (factor <= 1.15) return { tone: "ok", text: "Looks right" };
  if (factor <= 1.5)
    return { tone: "note", text: `Stretched ${factor.toFixed(1)}× — slightly squashed` };
  return { tone: "warn", text: `Stretched ${factor.toFixed(1)}× — noticeably distorted` };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- placement`
Expected: PASS, 11 tests

- [ ] **Step 5: Write the canvas component**

```tsx
// src/components/scheduling/PlacementCanvas.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type Box, clampBox } from "@/lib/placement";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/**
 * The panel, drawn at its true shape, with the creative inside it.
 *
 * The rectangle IS the screen: 1920x1080 or 1080x2400, whatever it reports, scaled to
 * fit the browser. Dragging a handle stretches the creative and the drag is clamped to
 * the panel, so nothing can be pushed off the edge and lost — what is on this canvas is
 * exactly what reaches the glass.
 */
export function PlacementCanvas({
  panelW,
  panelH,
  src,
  box,
  onChange,
}: {
  panelW: number;
  panelH: number;
  src: string;
  box: Box;
  onChange: (box: Box) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ handle: Handle; startX: number; startY: number; start: Box } | null>(null);
  const [shift, setShift] = useState(false);

  const begin = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ handle, startX: e.clientX, startY: e.clientY, start: box });
  };

  const move = useCallback(
    (e: PointerEvent) => {
      if (!drag || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      // Deltas as PERCENTAGES of the rendered canvas, so the same drag means the same
      // thing whatever size the browser happens to draw the panel at.
      const dx = ((e.clientX - drag.startX) / rect.width) * 100;
      const dy = ((e.clientY - drag.startY) / rect.height) * 100;
      const s = drag.start;
      let next: Box = { ...s };

      switch (drag.handle) {
        case "move": next = { ...s, x: s.x + dx, y: s.y + dy }; break;
        case "e": next = { ...s, w: s.w + dx }; break;
        case "w": next = { ...s, x: s.x + dx, w: s.w - dx }; break;
        case "s": next = { ...s, h: s.h + dy }; break;
        case "n": next = { ...s, y: s.y + dy, h: s.h - dy }; break;
        case "se": next = { ...s, w: s.w + dx, h: s.h + dy }; break;
        case "ne": next = { ...s, y: s.y + dy, w: s.w + dx, h: s.h - dy }; break;
        case "sw": next = { ...s, x: s.x + dx, w: s.w - dx, h: s.h + dy }; break;
        case "nw": next = { ...s, x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy }; break;
      }

      // Shift keeps the ORIGINAL shape rather than the current one, so holding it
      // undoes an accidental stretch instead of preserving it.
      if (shift && drag.handle !== "move") {
        const ratio = s.w / s.h;
        next.h = next.w / ratio;
      }

      // Nothing smaller than a nudge — a zero-width box cannot be grabbed again.
      next.w = Math.max(next.w, 2);
      next.h = Math.max(next.h, 2);
      onChange(clampBox(next));
    },
    [drag, onChange, shift],
  );

  useEffect(() => {
    if (!drag) return;
    const end = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, [drag, move]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => setShift(e.shiftKey);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", down);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", down);
    };
  }, []);

  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const pos: Record<string, string> = {
    nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
    n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
    ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
    e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
    se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
    s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
    sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
    w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  };

  return (
    <div
      ref={ref}
      className="relative mx-auto w-full max-w-full overflow-hidden border border-line bg-black"
      style={{ aspectRatio: `${panelW} / ${panelH}` }}
    >
      <div
        className="absolute"
        style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
      >
        {/* object-fill, not contain: this preview must SHOW the distortion the operator
            is about to book, not politely hide it. */}
        <img
          src={src}
          alt=""
          draggable={false}
          onPointerDown={begin("move")}
          className="h-full w-full cursor-move select-none object-fill"
        />
        <div className="pointer-events-none absolute inset-0 border-2 border-accent" />
        {handles.map((h) => (
          <button
            key={h}
            aria-label={`Resize ${h}`}
            onPointerDown={begin(h)}
            className={`absolute h-3 w-3 rounded-sm border border-white bg-accent ${pos[h]}`}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npm test -- placement
git add src/lib/placement.ts src/lib/placement.test.ts src/components/scheduling/PlacementCanvas.tsx
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" \
  commit -m "feat(scheduling): a canvas that is the screen, with drag-to-stretch"
```

---

### Task 5: The page

**Files:**
- Create: `markai-Web-cms/src/app/(dashboard)/bookings/visual/page.tsx`
- Modify: `markai-Web-cms/src/lib/api.ts` (add `content.place`)
- Modify: `markai-Web-cms/src/components/layout/Sidebar.tsx` (nav entry)

**Interfaces:**
- Consumes: Task 3's endpoint, Task 4's `PlacementCanvas`, `clampBox`, `distortion`, `distortionLabel`, `fillBox`, `fillWidth`, `fillHeight`
- Produces: route `/bookings/visual`; `api.content.place(mediaId, body)`

- [ ] **Step 1: Add the API client method**

In `src/lib/api.ts`, inside the `content` group:

```typescript
    place: (
      mediaId: string,
      body: { screen_id: string; x: number; y: number; w: number; h: number },
    ) => request<MediaAsset>(`/cms/content/${mediaId}/place`, { method: "POST", body }),
```

Match the surrounding `request(...)` call style exactly — check a neighbouring method before writing.

- [ ] **Step 2: Add the nav entry**

In `src/components/layout/Sidebar.tsx`, in the OPERATE group after the `/bookings` line:

```typescript
      { href: "/bookings/visual", label: "Simple media scheduling", icon: LayoutTemplate, visible: always },
```

Import `LayoutTemplate` from `lucide-react` alongside the existing icons.

- [ ] **Step 3: Write the page**

```tsx
// src/app/(dashboard)/bookings/visual/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { PlacementCanvas } from "@/components/scheduling/PlacementCanvas";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button, Card, FormField, Input } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import {
  type Box,
  distortion,
  distortionLabel,
  fillBox,
  fillHeight,
  fillWidth,
} from "@/lib/placement";

/** "1920x1080" -> [1920, 1080]; [0, 0] when the screen has not reported. */
function parseResolution(res?: string | null): [number, number] {
  if (!res || !res.toLowerCase().includes("x")) return [0, 0];
  const [w, h] = res.toLowerCase().split("x");
  return [Number(w) || 0, Number(h) || 0];
}

export default function VisualSchedulingPage() {
  const router = useRouter();
  const toast = useToast();

  const [screenId, setScreenId] = useState("");
  const [screens, setScreens] = useState<any[]>([]);
  const [media, setMedia] = useState<any | null>(null);
  const [box, setBox] = useState<Box>(fillBox());
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  const screen = useMemo(
    () => screens.find((s) => s.screen_id === screenId),
    [screens, screenId],
  );
  const [panelW, panelH] = parseResolution(screen?.resolution);
  // The gate the whole page hangs on: a creative placed before the target is known has
  // nothing to be correct against, and a guessed panel size renders an ad that looks
  // right until it reaches the glass.
  const ready = Boolean(screenId) && panelW > 0 && panelH > 0;

  const factor = media ? distortion(media.width, media.height, box, panelW, panelH) : 1;
  const verdict = distortionLabel(factor);

  const schedule = async () => {
    if (!media || !screen || !endDate) return;
    setSaving(true);
    try {
      const placed = await api.content.place(media.media_id, {
        screen_id: screenId,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
      });
      await api.bookings.create({
        screen_id: screenId,
        media_id: placed.id,
        name: `${media.name} — ${screen.name}`,
        schedule_type: "continuous",
        end_at: endDate,
      });
      toast.success("Scheduled");
      router.push("/bookings");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not schedule that");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Simple media scheduling"
        subtitle="Place an ad on the screen, then say when it runs."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="flex flex-col gap-3 p-4 sm:p-5">
          {!ready ? (
            <div className="flex min-h-[18rem] items-center justify-center text-center text-sm text-fg-muted">
              {screenId && panelW === 0
                ? `${screen?.name ?? "That screen"} hasn't reported its size yet — it needs to check in once before an ad can be placed on it.`
                : "Pick a screen to start."}
            </div>
          ) : !media ? (
            <div className="flex min-h-[18rem] items-center justify-center text-sm text-fg-muted">
              Pick a creative to place on {screen?.name}.
            </div>
          ) : (
            <>
              <p className="text-xs text-fg-subtle">
                {screen?.name} — {panelW} × {panelH}
              </p>
              <PlacementCanvas
                panelW={panelW}
                panelH={panelH}
                src={media.file_url}
                box={box}
                onChange={setBox}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setBox(fillWidth(box))}>↔ Fill width</Button>
                <Button variant="secondary" onClick={() => setBox(fillHeight(box))}>↕ Fill height</Button>
                <Button variant="secondary" onClick={() => setBox(fillBox())}>✥ Fill screen</Button>
              </div>
              <p className="text-xs text-fg-subtle">
                Drag a corner to stretch · hold Shift to keep the shape · it stops at the panel edge
              </p>
            </>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <FormField label="Screen" required>
            <select
              className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm"
              value={screenId}
              onChange={(e) => setScreenId(e.target.value)}
            >
              <option value="">Choose a screen…</option>
              {screens.map((s) => (
                <option key={s.screen_id} value={s.screen_id}>
                  {s.name} {s.resolution ? `(${s.resolution})` : "(size unknown)"}
                </option>
              ))}
            </select>
          </FormField>

          {ready && media && (
            <div className={verdict.tone === "warn" ? "text-danger" : "text-fg-muted"}>
              <p className="text-xs font-medium">{verdict.text}</p>
            </div>
          )}

          <FormField label="Until" required>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </FormField>

          <Button onClick={schedule} disabled={!ready || !media || !endDate || saving}>
            {saving ? "Scheduling…" : "Schedule it"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
```

Wire `screens` and `media` from the existing data hooks the other pages use — copy the pattern from `src/app/(dashboard)/bookings/new/page.tsx`, which already loads both.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no output

- [ ] **Step 5: Run the app and place an ad end to end**

Run: `npm run dev`, open `http://localhost:5120/bookings/visual`
Expected: canvas locked until a screen is chosen; picking a screen with a resolution unlocks it; dragging a corner stretches the image and stops at the edge; ✥ fills it; scheduling creates a booking whose creative is the panel-sized render.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
git add src/app/\(dashboard\)/bookings/visual/page.tsx src/lib/api.ts src/components/layout/Sidebar.tsx
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" \
  commit -m "feat(scheduling): place an ad on the screen and book it from one page"
```

---

### Task 6: The AI rebuild escape hatch (images only)

**Files:**
- Modify: `markai-Web-cms/src/app/(dashboard)/bookings/visual/page.tsx`

**Interfaces:**
- Consumes: Task 5's page state, `api.creativeFit.*` (already exists: `analyze`, `createJob`, `getJob`, `saveJob`)

- [ ] **Step 1: Add the rebuild handler**

Inside the page component:

```tsx
  const [rebuilding, setRebuilding] = useState(false);

  /**
   * Hand the creative to Creative Fit when the stretch has pushed it too far.
   *
   * The result comes BACK to the canvas rather than being booked directly: a rebuilt ad
   * is still an ad on a panel, and the operator may still want to nudge it before
   * committing. Offered, never forced — an operator who wants the stretch gets it.
   */
  const rebuildWithAi = async () => {
    // Images only. Creative Fit re-lays-out still artwork; there is no equivalent for a
    // finished video, and a button that cannot do what it says is worse than no button.
    if (!media || !screen || media.type !== "image") return;
    setRebuilding(true);
    try {
      const job = await api.creativeFit.createJob({
        source_media_id: media.media_id,
        target_screen_id: screenId,
      });
      // Poll rather than block: a rebuild is a Gemini call and takes about a minute.
      let done = job;
      while (done.status === "queued" || done.status === "running") {
        await new Promise((r) => setTimeout(r, 3000));
        done = await api.creativeFit.getJob(job.id);
      }
      if (done.status !== "succeeded") {
        toast.error("The rebuild didn't finish — your stretch is untouched.");
        return;
      }
      const saved = await api.creativeFit.saveJob(done.id);
      setMedia(saved);
      setBox(fillBox());
      toast.success("Rebuilt for this screen");
    } catch (e: any) {
      toast.error(e?.message ?? "The rebuild failed — your stretch is untouched.");
    } finally {
      setRebuilding(false);
    }
  };
```

Check the exact `api.creativeFit` method names and job field names in `src/lib/api.ts` and `src/lib/creative-fit.ts` before writing, and match them.

- [ ] **Step 2: Show the button when the stretch is bad**

Replace the verdict block in the side panel:

```tsx
          {ready && media && (
            <div className="space-y-2">
              <p className={`text-xs font-medium ${verdict.tone === "warn" ? "text-danger" : "text-fg-muted"}`}>
                {verdict.text}
              </p>
              {verdict.tone === "warn" && media.type === "image" && (
                <>
                  <p className="text-xs text-fg-subtle">
                    Stretching this far will look squashed on the screen. A rebuild
                    re-lays out the ad for this shape instead.
                  </p>
                  <Button variant="secondary" onClick={rebuildWithAi} disabled={rebuilding}>
                    {rebuilding ? "Rebuilding…" : "Rebuild with AI"}
                  </Button>
                </>
              )}
              {verdict.tone === "warn" && media.type === "video" && (
                <p className="text-xs text-fg-subtle">
                  Stretching this far will look squashed on the screen. Drag it back
                  towards the video's own shape to reduce it.
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no output

- [ ] **Step 4: Verify the threshold and the media gate in the app**

Run: `npm run dev`, place a square IMAGE on a 16:9 screen and press ✥.
Expected: the readout says roughly "Stretched 1.8× — noticeably distorted" and the rebuild
button appears. Fill only part of the panel so the shapes match, and the button disappears.

Then place a VIDEO and press ✥ on a mismatched screen.
Expected: the same distortion readout, and **no rebuild button at all** — just the line
telling them to drag it back toward the video's own shape.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add src/app/\(dashboard\)/bookings/visual/page.tsx
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" \
  commit -m "feat(scheduling): offer an AI rebuild when the stretch distorts too far"
```

---

### Task 7: Video placement

Do this task LAST. Everything before it ships and is useful without it.

**Files:**
- Create: `markai-signage-api/app/content/video_place.py`
- Copy from branch `video/resize`: `app/video/ffmpeg.py`, `app/video/probe.py`, `app/video/encode.py`
- Modify: `markai-signage-api/Dockerfile` (install ffmpeg)
- Modify: `markai-signage-api/app/content/service.py` (route video through the job)
- Verify: `<scratchpad>/verify_video_place.py`

**Interfaces:**
- Consumes: Task 1 `Box`, `to_pixels`
- Produces: `render_video_placement(src_path: str, dst_path: str, panel_w: int, panel_h: int, box: Box) -> None`

- [ ] **Step 1: Bring the ffmpeg boundary onto the branch**

```bash
cd markai-signage-api
git checkout video/resize -- app/video/ffmpeg.py app/video/probe.py app/video/encode.py app/video/__init__.py
```

Read `app/video/ffmpeg.py` before continuing — it owns binary discovery and build assertions, and the next step calls into it rather than shelling out separately.

- [ ] **Step 2: Install ffmpeg in the image**

In `Dockerfile`, add `ffmpeg` to the `apt-get install` line, matching the comment style already used on branch `video/resize`:

```dockerfile
# ffmpeg is the video placement subprocess boundary (app/video/ffmpeg.py).
RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential libpq-dev curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 3: Write the renderer**

```python
"""Place a video on a panel — the same geometry as an image, through ffmpeg.

Pillow cannot open a video, so the arithmetic is shared (app/content/placement.py) and
only the paint step differs: `scale` stretches the clip to the box, `pad` puts it at the
right spot on a panel-sized black canvas.

Audio is COPIED, never re-encoded. Nothing here changes the sound, and a needless audio
pass costs time and quality for no reason.
"""

from __future__ import annotations

import subprocess

from app.content.placement import Box, to_pixels
from app.video import ffmpeg as ffmpeg_boundary


def render_video_placement(
    src_path: str, dst_path: str, panel_w: int, panel_h: int, box: Box
) -> None:
    """Write a panel-sized video with the source placed at ``box``."""
    x, y, w, h = to_pixels(box, panel_w, panel_h)
    # Even dimensions: H.264 chroma subsampling cannot encode an odd width or height,
    # and a 1-pixel rounding difference is invisible on the glass.
    w -= w % 2
    h -= h % 2
    if w <= 0 or h <= 0:
        raise ValueError("That placement is too small to render.")

    vf = f"scale={w}:{h},pad={panel_w}:{panel_h}:{x}:{y}:black"
    cmd = [
        ffmpeg_boundary.binary(), "-y",
        "-i", src_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        dst_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        raise RuntimeError(f"Video placement failed: {result.stderr[-500:]}")
```

- [ ] **Step 4: Verify against a generated clip**

```python
# <scratchpad>/verify_video_place.py
import subprocess, tempfile, os, json
from app.content.placement import Box, fill_box
from app.content.video_place import render_video_placement
from app.video import ffmpeg as fb

tmp = tempfile.mkdtemp()
src = os.path.join(tmp, "src.mp4")
subprocess.run([fb.binary(), "-y", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=10:duration=2",
                "-pix_fmt", "yuv420p", src], capture_output=True, check=True)

def size(path):
    out = subprocess.run([fb.probe_binary(), "-v", "quiet", "-print_format", "json",
                          "-show_streams", path], capture_output=True, text=True, check=True)
    s = [x for x in json.loads(out.stdout)["streams"] if x["codec_type"] == "video"][0]
    return s["width"], s["height"]

dst = os.path.join(tmp, "full.mp4")
render_video_placement(src, dst, 1920, 1080, fill_box())
print("full-panel output:", size(dst))
assert size(dst) == (1920, 1080)

dst2 = os.path.join(tmp, "partial.mp4")
render_video_placement(src, dst2, 1000, 1000, Box(0, 0, 50, 50))
print("partial output:", size(dst2))
assert size(dst2) == (1000, 1000)
print("OK — output is always the panel's size")
```

Run: `cd markai-signage-api && PYTHONPATH=. poetry run python <scratchpad>/verify_video_place.py`
Expected: both sizes match the panel, then `OK`

- [ ] **Step 5: Route video through the existing job pattern**

In `place_media`, replace the `asset.type != "image"` refusal with a branch that queues a job for video, following `app/reports/service.py::queue` — the job renders, uploads, creates the asset, and creates the booking when it lands. Reuse `app/ai/delivery.py` to tell the operator it is ready. Keep the image path synchronous; only video is queued.

- [ ] **Step 6: Lint and commit**

```bash
poetry run ruff check app/
git add app/content/video_place.py app/video/ app/content/service.py Dockerfile
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" \
  commit -m "feat(content): place a video on a panel with ffmpeg"
```

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| §2 the page | 5 |
| §3 the flow, screen-first gating | 5 (`ready` gate) |
| §4 canvas, clamping, handles, ↔ ↕ ✥ | 4, 5 |
| §5 distortion readout + AI rebuild | 1 (`distortion`), 4 (`distortionLabel`), 6 |
| §5 rebuild is image-only; video stretch-only | 6 (`media.type` gate, both branches) |
| §6 render on save, dedup, native size | 2, 3 |
| §7 video, ffmpeg port | 7 |
| §8 out of scope | not built, by design |
| §9 no resolution reported | 3 (422 with the reason), 5 (locked canvas) |
| §9 alpha creative | 2 (composite, verified) |
| §9 draft kept on leave | **not covered** — deliberately deferred; `localStorage` is a small follow-up once the flow is proven |
| §10 success criteria | 5 (step 5 is the end-to-end check) |

**Type consistency:** `Box` is `{x, y, w, h}` in both `placement.py` and `placement.ts`. `to_pixels` returns `(x, y, w, h)` and every caller unpacks in that order. `distortion(srcW, srcH, box, panelW, panelH)` has the same parameter order on both sides.

**Known gap to close during execution:** Task 5 references `api.bookings.create` and the screens/media hooks generically. Read `src/app/(dashboard)/bookings/new/page.tsx` first and copy its exact call signatures — that page already does both.
