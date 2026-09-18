# Screen Resolution Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator type a screen's real resolution in the CMS, have it survive device re-registration, and have every scheduling/rendering decision use it.

**Architecture:** `screens.resolution` becomes the *effective* value (operator's if set, else the device's), so all ~11 existing readers get the correction with no edit. Two new columns carry what the device said and whether a human overrode it. On the CMS side, the booking form gains a creative-vs-panel fit warning that reuses the existing Creative Fit job to offer the fix.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic (Poetry) · Next.js 15 + React 19 + Tailwind 4 + vitest

**Spec:** `docs/superpowers/specs/2026-09-12-screen-resolution-override-design.md`

## Global Constraints

- Do NOT run pytest in the backend — verify with `python -c "import app.main"` and `ruff check app`. The user runs the suite.
- Do NOT run `next build` in the CMS — it clobbers `.next` under the running dev server. Use `npm test` and `npm run typecheck`.
- No 16:9 or any aspect assumption. Arbitrary sizes (`960x2048`, LED cabinet sizes) must pass end to end.
- Both axes are capped at 8192 px, matching `app/creative_fit/resizer.py:262` and `app/content/place_render.py:31`.
- Normalized storage form is exactly `"{w}x{h}"` — lowercase `x`, no spaces.
- A bad creative/panel fit WARNS. It never blocks a booking.
- Commit messages end with the session's attribution trailers; no `next build`, no pushing unless asked.

---

### Task 1: Data model — two columns and the migration

**Files:**
- Modify: `markai-signage-api/app/screens/models.py:86`
- Create: `markai-signage-api/alembic/versions/0069_screen_resolution_override.py`

**Interfaces:**
- Produces: `Screen.detected_resolution: Mapped[str | None]`, `Screen.resolution_is_manual: Mapped[bool]`. `Screen.resolution` keeps its name and now means "the effective resolution".

- [ ] **Step 1: Add the columns to the model**

In `app/screens/models.py`, replace the bare `resolution` line with:

```python
    # THE EFFECTIVE RESOLUTION — what every consumer should reason about, and
    # the reason this attribute keeps its old name: ~11 call sites across two
    # repos already read `screen.resolution`, and making this one attribute mean
    # "the truth" corrects all of them without touching any. Operator's value
    # when `resolution_is_manual`, otherwise whatever the device last reported.
    resolution: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # What the DEVICE said, always kept fresh even while an override is in force.
    # Kept because the device is sometimes wrong in an interesting way — a
    # Rockchip rk356x_box reports its 960x2048 framebuffer, not the panel — and
    # an operator correcting it needs to see the number they are overruling.
    detected_resolution: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # A human typed `resolution`. Registration must not overwrite it.
    resolution_is_manual: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
```

`Boolean` and `String` are already imported in this file.

- [ ] **Step 2: Write the migration**

Create `alembic/versions/0069_screen_resolution_override.py`:

```python
"""Let an operator correct a screen's resolution

The player reports its resolution at registration and is sometimes wrong: a
Rockchip rk356x_box registers 960x2048, which is its framebuffer, not the panel.
Everything downstream — the placement canvas, the placed-ad render, Creative
Fit's target — is then built on a number nobody can fix.

`screens.resolution` becomes the EFFECTIVE value so every existing reader is
corrected without being touched. `detected_resolution` keeps what the device
said, and `resolution_is_manual` tells registration to leave the override alone.

Revision ID: 0069_screen_resolution_override
Revises: 0068_installed_player_stamp
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0069_screen_resolution_override"
down_revision: Union[str, Sequence[str], None] = "0068_installed_player_stamp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "screens", sa.Column("detected_resolution", sa.String(64), nullable=True)
    )
    op.add_column(
        "screens",
        sa.Column(
            "resolution_is_manual",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    # Every existing row's resolution came from the device, by definition — there
    # was no other way to set it before this migration.
    op.execute("UPDATE screens SET detected_resolution = resolution")


def downgrade() -> None:
    op.drop_column("screens", "resolution_is_manual")
    op.drop_column("screens", "detected_resolution")
```

- [ ] **Step 3: Verify the module imports and lints**

Run: `cd markai-signage-api && poetry run python -c "import app.main" && poetry run ruff check app alembic`
Expected: no output from the import, `All checks passed!` from ruff.

- [ ] **Step 4: Apply the migration against the dev database**

Run: `cd markai-signage-api && poetry run alembic upgrade head`
Expected: `Running upgrade 0068_installed_player_stamp -> 0069_screen_resolution_override`

- [ ] **Step 5: Commit**

```bash
git add app/screens/models.py alembic/versions/0069_screen_resolution_override.py
git commit -m "feat(screens): carry a detected resolution beside the effective one"
```

---

### Task 2: Registration stops clobbering the override

**Files:**
- Modify: `markai-signage-api/app/screens/service.py:427-455` (the `register_screen` create + re-register branches)

**Interfaces:**
- Consumes: `Screen.detected_resolution`, `Screen.resolution_is_manual` from Task 1.
- Produces: nothing new. Behaviour change only.

- [ ] **Step 1: Fix the create branch**

In `register_screen`, the `if screen is None:` branch currently passes
`resolution=device_info.get("resolution")` to the `Screen(...)` constructor. A brand
new screen has no override, so both fields take the device's value:

```python
        screen = Screen(
            device_uid=device_uid,
            name=_default_name(device_info),
            device_info=device_info,
            resolution=device_info.get("resolution"),
            detected_resolution=device_info.get("resolution"),
            model=device_info.get("model"),
            manufacturer=device_info.get("manufacturer"),
            android_version=device_info.get("android_version"),
            status="offline",
        )
```

- [ ] **Step 2: Fix the re-register branch**

Replace the single line `screen.resolution = device_info.get("resolution")` with:

```python
        # The device's number is always recorded, but it only becomes the
        # effective one while no operator has overruled it. Same rule as the
        # manual location fix two lines down: a value a re-registration can
        # erase is worse than no field at all, because the APK re-registers
        # often and the erasure is silent.
        screen.detected_resolution = device_info.get("resolution")
        if not screen.resolution_is_manual:
            screen.resolution = device_info.get("resolution")
```

- [ ] **Step 3: Verify import + lint**

Run: `cd markai-signage-api && poetry run python -c "import app.main" && poetry run ruff check app`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/screens/service.py
git commit -m "fix(screens): stop re-registration overwriting a manual resolution"
```

---

### Task 3: API — accept, validate and expose the override

**Files:**
- Modify: `markai-signage-api/app/screens/schemas.py:113` (`ScreenSummary`) and `:200` (`ScreenUpdateRequest`)
- Modify: `markai-signage-api/app/screens/service.py:657` (`ScreenSummary` mapping) and `:892` (`update_screen`)
- Modify: `markai-signage-api/app/cms/screens_router.py:163`

**Interfaces:**
- Consumes: Task 1's columns, Task 2's registration rule.
- Produces: `normalize_resolution(value: str) -> str` in `app/screens/schemas.py`, raising `ValueError`. `update_screen(..., resolution: str | None = None)`. `ScreenSummary.detected_resolution: Optional[str]`, `ScreenSummary.resolution_is_manual: bool`.

- [ ] **Step 1: Add the normalizer + field to `ScreenUpdateRequest`**

At module level in `app/screens/schemas.py` (near the other helpers):

```python
#: Both axes are capped here because the render paths cap them anyway
#: (app/creative_fit/resizer.py and app/content/place_render.py both refuse
#: > 8192 on the long edge). Accepting a larger number would only defer the
#: failure from a form the operator is looking at to a job they are not.
MAX_RESOLUTION_AXIS = 8192


def normalize_resolution(value: str) -> str:
    """``"1080 × 2304"`` → ``"1080x2304"``. Raises ValueError on anything else.

    Accepts the same separators ``app.content.fit.parse_resolution`` accepts, so
    a value a human pastes from the Device info card cannot be rejected here and
    then happily parsed downstream.
    """
    text = value.strip()
    for sep in ("x", "X", "*", "×"):
        if sep in text:
            head, _, tail = text.partition(sep)
            try:
                w, h = int(head.strip()), int(tail.strip())
            except ValueError:
                break
            if w <= 0 or h <= 0:
                raise ValueError("Width and height must both be above zero.")
            if w > MAX_RESOLUTION_AXIS or h > MAX_RESOLUTION_AXIS:
                raise ValueError(
                    f"Width and height are capped at {MAX_RESOLUTION_AXIS} pixels each."
                )
            return f"{w}x{h}"
    raise ValueError('Give the resolution as width x height, e.g. "1080x2304".')
```

Then inside `ScreenUpdateRequest`, beside `tailscale_ip`:

```python
    # The panel's REAL resolution, when the device reports a wrong one (a
    # Rockchip box reports its framebuffer). Empty string clears the override
    # and restores whatever the device last reported — same "empty clears it"
    # convention as tailscale_ip above.
    resolution: Optional[str] = Field(default=None, max_length=64)

    @field_validator("resolution")
    @classmethod
    def _validate_resolution(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if not v.strip():
            return ""
        return normalize_resolution(v)
```

- [ ] **Step 2: Add the two read fields to `ScreenSummary`**

Immediately after `resolution: Optional[str] = None` in `ScreenSummary`:

```python
    # What the DEVICE reported, whether or not it is the effective one. The CMS
    # shows it beside a manual value so the operator can see the number they
    # overruled — for the rk356x_box that is the 960x2048 giveaway.
    detected_resolution: Optional[str] = None
    resolution_is_manual: bool = False
```

- [ ] **Step 3: Map them in the service**

In `app/screens/service.py`, in the `ScreenSummary(...)` construction, after
`resolution=screen.resolution,`:

```python
        detected_resolution=screen.detected_resolution,
        resolution_is_manual=screen.resolution_is_manual,
```

- [ ] **Step 4: Handle it in `update_screen`**

Add `resolution=None` to the `update_screen` signature (after `tailscale_ip=None`), and
after the `tailscale_ip` block add:

```python
    if resolution is not None:
        if resolution:
            screen.resolution = resolution
            screen.resolution_is_manual = True
        else:
            # Clearing the override hands the screen back to the device. Falling
            # back to the LAST DETECTED value rather than to null keeps the
            # canvas working instead of locking it until the next check-in.
            screen.resolution_is_manual = False
            screen.resolution = screen.detected_resolution
```

Deliberately NOT a `schedule_changed` bump: resolution changes nothing the player
downloads. The screen plays whatever media the schedule names, at whatever size that
media already is — the resolution only shapes what the CMS *renders* before booking.
Bumping here would make every edited screen re-download its whole schedule for nothing,
the same reasoning the `tailscale_ip` block above records.

Also extend the docstring's first line to mention resolution.

- [ ] **Step 5: Pass it through the router**

In `app/cms/screens_router.py`, in the `service.update_screen(...)` call, after
`tailscale_ip=payload.tailscale_ip,`:

```python
        resolution=payload.resolution,
```

- [ ] **Step 6: Verify import + lint**

Run: `cd markai-signage-api && poetry run python -c "import app.main" && poetry run ruff check app`
Expected: clean.

- [ ] **Step 7: Sanity-check the validator directly**

Run:
```bash
cd markai-signage-api && poetry run python -c "
from app.screens.schemas import normalize_resolution as n
print(n('1080 × 2304'), n('960x2048'), n(' 3840 X 2160 '))
for bad in ['', '0x100', '9000x100', 'abc', '1080']:
    try: n(bad); print('NO RAISE', repr(bad))
    except ValueError as e: print('ok', repr(bad), e)
"
```
Expected: `1080x2304 960x2048 3840x2160` then five `ok` lines.

- [ ] **Step 8: Commit**

```bash
git add app/screens/schemas.py app/screens/service.py app/cms/screens_router.py
git commit -m "feat(screens): accept an operator-set resolution on PATCH"
```

---

### Task 4: CMS types + the Display editor

**Files:**
- Modify: `markai-Web-cms/src/lib/types.ts:138` (`Screen`), `:903` (`UpdateScreenPayload`)
- Modify: `markai-Web-cms/src/components/screens/ScreenSettings.tsx`
- Modify: `markai-Web-cms/src/app/(dashboard)/screens/[id]/page.tsx:360`

**Interfaces:**
- Consumes: `detected_resolution`, `resolution_is_manual` from Task 3.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Extend the types**

In `src/lib/types.ts`, after `resolution?: string | null;` inside `interface Screen`:

```ts
  /** What the DEVICE reported — shown beside a manual value so the operator can
   *  see the number they overruled. */
  detected_resolution?: string | null;
  /** True when `resolution` was typed by an operator, not reported by the box. */
  resolution_is_manual?: boolean;
```

And in `UpdateScreenPayload`, after `tailscale_ip?: string;`:

```ts
  /** "1080x2304". Empty string clears the override and restores the detected
   *  value. Rejected server-side unless both axes are 1–8192. */
  resolution?: string;
```

- [ ] **Step 2: Add the Display section to `ScreenSettings.tsx`**

Widen the `Section` union:

```ts
type Section = "identity" | "hours" | "slots" | "display" | null;
```

Import `parseResolution` and add `Monitor` to the lucide import:

```ts
import { Check, Clock3, Monitor, Pencil, Timer, X } from "lucide-react";
import { parseResolution } from "@/lib/creative-fit";
```

Add state beside `slotSeconds`:

```ts
  const current = parseResolution(screen.resolution);
  const [resW, setResW] = useState(current ? String(current[0]) : "");
  const [resH, setResH] = useState(current ? String(current[1]) : "");
```

Re-seed both in `open()`, alongside the other re-seeds:

```ts
    const cur = parseResolution(screen.resolution);
    setResW(cur ? String(cur[0]) : "");
    setResH(cur ? String(cur[1]) : "");
```

Add the helpers and the save handler above `actions`:

```ts
  /** "15:32" for 1080×2304 — the aspect in lowest terms. The fastest way to
   *  notice a transposed pair before it reaches a booking. */
  const aspectLabel = (w: number, h: number) => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const d = gcd(w, h) || 1;
    return `${w / d}:${h / d}`;
  };

  const typedW = Number(resW);
  const typedH = Number(resH);
  const typedValid =
    /^\d+$/.test(resW.trim()) &&
    /^\d+$/.test(resH.trim()) &&
    typedW > 0 &&
    typedH > 0 &&
    typedW <= 8192 &&
    typedH <= 8192;

  const saveDisplay = () => {
    if (!typedValid) {
      toast("Give a width and height between 1 and 8192 pixels.", "error");
      return;
    }
    commit(
      { resolution: `${typedW}x${typedH}` },
      "Ads booked from now on will be built for this size.",
    );
  };

  const revertDisplay = () =>
    commit({ resolution: "" }, "Back to whatever the screen reports.");
```

Then add the section as the last child of the grid, after the slots `</section>`:

```tsx
        {/* ---- Panel resolution ---- */}
        <section className="md:col-span-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
              Display
            </h3>
            {editing !== "display" && editButton("display", "Set resolution")}
          </div>

          {editing === "display" ? (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={8192}
                  value={resW}
                  onChange={(e) => setResW(e.target.value)}
                  aria-label="Panel width in pixels"
                  className="w-24"
                />
                <span className="text-xs text-fg-subtle">×</span>
                <Input
                  type="number"
                  min={1}
                  max={8192}
                  value={resH}
                  onChange={(e) => setResH(e.target.value)}
                  aria-label="Panel height in pixels"
                  className="w-24"
                />
                {typedValid && (
                  <span className="text-xs text-fg-muted">
                    {typedW === typedH
                      ? "Square"
                      : typedW > typedH
                        ? "Landscape"
                        : "Portrait"}{" "}
                    · {aspectLabel(typedW, typedH)}
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-fg-subtle">Presets:</span>
                {PRESETS.map(([w, h]) => (
                  <button
                    key={`${w}x${h}`}
                    type="button"
                    onClick={() => {
                      setResW(String(w));
                      setResH(String(h));
                    }}
                    className="rounded-[var(--radius-sm)] border border-line px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
                  >
                    {w}×{h}
                  </button>
                ))}
              </div>

              {/* Only worth saying when the two disagree — that disagreement IS
                  the feature. A box whose report is already right should not be
                  invited to doubt it. */}
              {screen.detected_resolution &&
                screen.detected_resolution !== screen.resolution && (
                  <p className="mt-2 text-xs text-fg-muted">
                    This screen reports {screen.detected_resolution}.{" "}
                    <button
                      type="button"
                      onClick={revertDisplay}
                      disabled={saving}
                      className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                      Use that instead
                    </button>
                  </p>
                )}
              {actions(saveDisplay)}
            </div>
          ) : (
            <>
              <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-fg">
                <Monitor className="h-3.5 w-3.5 text-accent" />
                {screen.resolution || "Not reported yet"}
                {screen.resolution_is_manual && (
                  <span className="text-xs font-normal text-fg-subtle">
                    · set manually
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                The panel's real pixel size. Ads are placed and rendered for
                exactly this — correct it here if the screen reports the wrong
                one.
              </p>
            </>
          )}
        </section>
```

And the preset list, at module level below the imports:

```ts
/** One-click fills, not a closed list — an LED cabinet is rarely one of these,
 *  so the W×H inputs stay the primary control and these are only a shortcut. */
const PRESETS: [number, number][] = [
  [1920, 1080],
  [1080, 1920],
  [3840, 2160],
  [2160, 3840],
];
```

- [ ] **Step 3: Tag the Overview row**

In `src/app/(dashboard)/screens/[id]/page.tsx`, replace the Resolution row with:

```tsx
            <Row
              label="Resolution"
              value={
                screen.resolution
                  ? `${screen.resolution}${screen.resolution_is_manual ? " (set manually)" : ""}`
                  : "—"
              }
            />
```

- [ ] **Step 4: Typecheck**

Run: `cd markai-Web-cms && npm run typecheck`
Expected: no errors. (Do NOT run `next build`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/components/screens/ScreenSettings.tsx "src/app/(dashboard)/screens/[id]/page.tsx"
git commit -m "feat(screens): edit a screen's panel resolution from its detail page"
```

---

### Task 5: The fit rule, ported to TypeScript, with tests

**Files:**
- Create: `markai-Web-cms/src/lib/fit.ts`
- Create: `markai-Web-cms/src/lib/fit.test.ts`

**Interfaces:**
- Produces: `export type FitNote = { tone: "error" | "warn"; text: string } | null` and
  `export function pixelFitNote(mediaW, mediaH, screenResolution): FitNote`, a twin of
  `app/content/fit.py:pixel_fit_note`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/fit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pixelFitNote } from "./fit";

describe("pixelFitNote", () => {
  it("calls an orientation mismatch an error", () => {
    const note = pixelFitNote(1080, 1920, "1920x1080");
    expect(note?.tone).toBe("error");
    expect(note?.text).toContain("portrait");
    expect(note?.text).toContain("landscape");
  });

  it("says nothing when the shapes match exactly", () => {
    expect(pixelFitNote(1080, 2304, "1080x2304")).toBeNull();
  });

  it("says nothing for a same-orientation drift under 2%", () => {
    // 1920x1080 = 1.778, 1912x1080 = 1.770 — a 0.008 drift, under the threshold.
    expect(pixelFitNote(1912, 1080, "1920x1080")).toBeNull();
  });

  it("warns on a same-orientation aspect drift of 2% or more", () => {
    // 1600x1080 = 1.481 vs 1920x1080 = 1.778 — a 0.297 drift.
    const note = pixelFitNote(1600, 1080, "1920x1080");
    expect(note?.tone).toBe("warn");
    expect(note?.text).toContain("1600x1080");
  });

  it("stays silent when a dimension is unknown", () => {
    // Absence of data is not evidence of a fit — the caller must be able to say
    // "cannot verify" rather than showing a clean bill of health.
    expect(pixelFitNote(null, 1080, "1920x1080")).toBeNull();
    expect(pixelFitNote(1920, null, "1920x1080")).toBeNull();
  });

  it("stays silent when the screen resolution is unreadable", () => {
    expect(pixelFitNote(1920, 1080, null)).toBeNull();
    expect(pixelFitNote(1920, 1080, "not-a-resolution")).toBeNull();
  });

  it("handles a square panel as its own orientation", () => {
    expect(pixelFitNote(1080, 1080, "1080x1080")).toBeNull();
    expect(pixelFitNote(1920, 1080, "1080x1080")?.tone).toBe("error");
  });

  it("accepts the odd real-world size the feature exists for", () => {
    // A corrected rk356x_box panel. Nothing may assume 16:9.
    expect(pixelFitNote(1080, 2304, "1080x2304")).toBeNull();
    expect(pixelFitNote(960, 2048, "1080x2304")?.tone).toBe("warn");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd markai-Web-cms && npx vitest run src/lib/fit.test.ts`
Expected: FAIL — `Failed to resolve import "./fit"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/fit.ts`:

```ts
/**
 * Does this creative fit this screen's panel?
 *
 * A TypeScript twin of `app/content/fit.py:pixel_fit_note` in markai-signage-api,
 * kept deliberately line-for-line comparable so the booking form and the AI
 * co-pilot cannot drift into disagreeing about the same creative. The precedent
 * is `clampBox` in ./placement, which mirrors the Python `clamp` the same way.
 *
 * The seconds half of the Python module (`airtime_note`) is NOT ported: the
 * booking form has no slot length in hand at this point.
 */

import { parseResolution } from "./creative-fit";

export type FitNote = { tone: "error" | "warn"; text: string } | null;

function orientation(w: number, h: number): "landscape" | "portrait" | "square" {
  if (w > h) return "landscape";
  if (h > w) return "portrait";
  return "square";
}

/**
 * An orientation mismatch is an ERROR — a portrait ad on a landscape panel is
 * not a judgement call. An aspect drift is a WARNING: it plays, with some
 * letterboxing, and the operator may well accept it.
 *
 * Unknown dimensions yield nothing. Absence of data is not evidence of a fit,
 * so a caller must say "cannot verify" rather than staying silent.
 */
export function pixelFitNote(
  mediaW: number | null | undefined,
  mediaH: number | null | undefined,
  screenResolution: string | null | undefined,
): FitNote {
  const panel = parseResolution(screenResolution);
  if (!mediaW || !mediaH || !panel) return null;
  const [sw, sh] = panel;

  const mo = orientation(mediaW, mediaH);
  const so = orientation(sw, sh);
  if (mo !== so) {
    return {
      tone: "error",
      text:
        `This ad is ${mo} (${mediaW}x${mediaH}) but the screen is ${so} ` +
        `(${sw}x${sh}) — it will play letterboxed or cropped.`,
    };
  }
  // Rounded to 3dp before differencing, exactly as the Python does, so the two
  // implementations agree on the values sitting right at the threshold.
  const drift = Math.abs(
    Number((mediaW / mediaH).toFixed(3)) - Number((sw / sh).toFixed(3)),
  );
  if (drift >= 0.02) {
    return {
      tone: "warn",
      text:
        `Aspect-ratio mismatch: ad ${mediaW}x${mediaH} vs screen ${sw}x${sh} ` +
        `— expect some letterboxing.`,
    };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd markai-Web-cms && npx vitest run src/lib/fit.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `cd markai-Web-cms && npm test && npm run typecheck`
Expected: all files pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fit.ts src/lib/fit.test.ts
git commit -m "feat(booking): port the creative/panel fit rule to the CMS"
```

---

### Task 6: The fit banner and the refit offer on the booking form

**Files:**
- Modify: `markai-Web-cms/src/app/(dashboard)/bookings/new/page.tsx`

**Interfaces:**
- Consumes: `pixelFitNote` from Task 5; the corrected `screen.resolution` from Tasks 1–4.
- Produces: nothing.

- [ ] **Step 1: Import the rule**

Add beside the existing `@/lib/placement` import:

```ts
import { pixelFitNote } from "@/lib/fit";
```

- [ ] **Step 2: Compute the note for the previewed creative**

After the existing `const previewMediaId = mediaIds[previewIndex] ?? "";` and the
`previewMedia` lookup it feeds, add:

```ts
  // The creative's own pixels against the panel's. Deliberately keyed to the
  // PREVIEWED creative, not to all of them: the canvas shows one at a time, and
  // a banner about a creative the operator cannot see has nothing to point at.
  const fitNote = pixelFitNote(
    previewMedia?.width,
    previewMedia?.height,
    selectedScreen?.resolution,
  );
  // Which refit this creative can actually have. `rebuild_available` is the
  // GEMINI gate — false on a deployment with no API key — so it must only gate
  // the rebuild. A resize is plain ffmpeg/Pillow and needs no model, and gating
  // it on the same flag would hide the video path entirely on a key-less box.
  const refitMode: "rebuild" | "resize" | null = !previewMedia
    ? null
    : canRebuildWithAi(previewMedia.type)
      ? fitStatus?.rebuild_available
        ? "rebuild"
        : null
      : "resize";
  const refitOffered = Boolean(fitStatus && refitMode);
```

- [ ] **Step 3: Render the banner with its fix**

Immediately above the placement canvas block (the `ready && ...` region that renders
`PlacementCanvas`), add:

```tsx
              {fitNote && (
                <div
                  className={cn(
                    "mb-3 rounded-[var(--radius-md)] border px-3 py-2",
                    fitNote.tone === "error"
                      ? "border-danger/40 bg-danger/10"
                      : "border-warn/40 bg-warn/10",
                  )}
                >
                  <p
                    className={cn(
                      "text-xs",
                      fitNote.tone === "error" ? "text-danger" : "text-warn",
                    )}
                  >
                    {fitNote.text}
                  </p>
                  {/* A complaint without a fix is just an obstacle. Images get
                      the AI re-layout; a finished video can only be resized,
                      which is why canRebuildWithAi gates the two apart. */}
                  {previewMedia && refitOffered && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="mt-2"
                      disabled={rebuilding}
                      onClick={() => refitMode && refitForPanel(refitMode)}
                    >
                      {rebuilding
                        ? "Refitting…"
                        : refitMode === "rebuild"
                          ? "Rebuild for this screen"
                          : "Resize for this screen"}
                    </Button>
                  )}
                </div>
              )}
```

- [ ] **Step 4: Generalise the existing rebuild handler to take a mode**

`rebuildWithAi` at `bookings/new/page.tsx:515` already does the whole job — create the
job, poll it, guard against the operator switching screen or row mid-flight, save and
swap the result in. Rename it to `refitForPanel` and give it the mode:

```ts
  const refitForPanel = async (mode: "rebuild" | "resize") => {
```

Then relax its first guard, which currently refuses anything `canRebuildWithAi` rejects —
that check belongs to `rebuild` only, since `resize` is exactly the operation a finished
video does support:

```ts
    if (!previewMedia || !selectedScreen) return;
    if (mode === "rebuild" && !canRebuildWithAi(previewMedia.type)) return;
```

Pass the mode through to the job:

```ts
      const created = await api.creativeFit.createJob({
        source_media_id: previewMedia.id,
        target_screen_id: screenId,
        mode,
      });
```

Update the existing call site (the stretch-distortion button around line 918) to
`onClick={() => refitForPanel("rebuild")}`, and widen the three user-facing failure
strings in the handler from "The rebuild …" to "The refit …" so a resize failure does
not report itself as a rebuild.

- [ ] **Step 5: Typecheck and run the suite**

Run: `cd markai-Web-cms && npm run typecheck && npm test`
Expected: no type errors, all tests pass. (Do NOT run `next build`.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/bookings/new/page.tsx"
git commit -m "feat(booking): warn when a creative's shape misses the panel, and offer the refit"
```

---

### Task 7: End-to-end check on the real screen

**Files:** none — verification only.

- [ ] **Step 1: Correct the rk356x_box**

With the backend on :8095 and the CMS on :5120, open the screen
`ce803e95-95c2-4de1-8a53-0c69abfb46d2`, which reports `960×2048`. Set a corrected
resolution in Screen settings → Display.

Expected: the Overview row reads the new value with `(set manually)`; the Device info
card still shows `resolution 960×2048`.

- [ ] **Step 2: Confirm the override survives a check-in**

Wait one heartbeat interval (60s in dev) or restart the player so it re-registers, then
reload the screen page.

Expected: the corrected value is still there, and `This screen reports 960×2048` appears
in the Display editor.

- [ ] **Step 3: Confirm scheduling uses it**

Go to `/bookings/new`, pick that screen, pick a creative whose shape does not match.

Expected: the placement canvas is the corrected shape, and the fit banner names both
sizes with a refit button.

- [ ] **Step 4: Confirm the revert path**

In the Display editor, click `Use that instead`.

Expected: the row reverts to `960×2048` without the `(set manually)` tag, and the canvas
reshapes accordingly.
