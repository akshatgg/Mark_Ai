# Proof of play — campaign filter and multi-ad selection: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator filter Proof of play by a whole campaign (picking up every creative it rotates) and/or by several hand-picked ads, and download the result as one time-ordered Excel sheet.

**Architecture:** The backend already attributes plays to a campaign by the `booking_id` tag the player writes (`attribution.owns_play_clause`), and `query_proof_report` already accepts a `booking=` argument — this work exposes that through the CMS API and adds a parallel `media_ids` list filter beside the existing single `media_id`. The frontend gains one new presentational component (`AsyncMultiSelect`) plus a pure selection-logic module that carries the unit tests, matching how this codebase already tests behaviour (`use-review-keys.ts` + `use-review-keys.test.ts`).

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + openpyxl (backend); Next.js 15 App Router + React 19 + Tailwind v4 + vitest (frontend).

## Global Constraints

- **Scope is CMS web only.** Do not touch `app/reports/` (the AI/WhatsApp report-job path), the co-pilot tool schemas, or `report_jobs.params`. They keep their single `media_id`.
- **Do NOT run pytest.** Standing rule for the Mark AI backends: verify backend changes with import and lint checks (`python -c "import app.main"`, `poetry run ruff check app/`). Write the test files as specified — Akshat runs the suite himself.
- **Ruff is the backend gate, not black.** `main` is not black-clean; do not reformat files you touch.
- **Frontend tests are vitest, logic-only.** There is no jsdom and no @testing-library in this project. Never plan a component-render test — extract the decision logic into `src/lib/*.ts` and test that.
- `MAX_FILTER_ADS = 25` — the cap on selected ads, defined once in `app/cms/proof_export.py` and mirrored in the UI.
- Backward compatibility is mandatory: the singular `media_id` query param keeps working everywhere it works today.
- Do not commit or push unless Akshat asks (root `CLAUDE.md`). Steps below stage nothing automatically.
- Excel output stays **one sheet, ordered `played_at DESC, id`**. No per-ad tabs, sections, or breakdown tables.

---

### Task 1: Backend — `query_proof_report` accepts a list of creatives

**Files:**
- Modify: `markai-signage-api/app/screens/service.py:1591-1626`
- Test: `markai-signage-api/tests/test_proof_report_filters.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `query_proof_report(db, screen_ids, from_dt, to_dt, limit, offset, media_id=None, with_total=True, booking=None, media_ids=None)` — `media_ids: list[str] | None`. Returns `(rows, total)` unchanged, where each row is `(ProofOfPlay, screen_name, screenshot_status, screenshot_url)`.

- [ ] **Step 1: Write the failing test**

Create `markai-signage-api/tests/test_proof_report_filters.py`:

```python
"""The reports page filters: several creatives at once, and a whole campaign.

An advertiser rotates five templates through one slot. Reporting on that used to
mean running the single-ad filter five times, so these cover the two filters that
replace it: a `media_ids` union, and a `booking` that sweeps up every creative the
campaign rotated because the player tags each play with its booking_id.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.bookings.models import Booking
from app.content.models import MediaAsset
from app.playback.models import ProofOfPlay
from app.screens.models import Screen
from app.screens.service import query_proof_report

pytestmark = pytest.mark.asyncio

UTC = timezone.utc
SCREEN = "3f1c0a92-1d1b-4a63-8f0e-6d4b2c9a7e11"
AD_A = "aaaaaaa1-0000-4000-8000-000000000001"
AD_B = "bbbbbbb2-0000-4000-8000-000000000002"
AD_C = "ccccccc3-0000-4000-8000-000000000003"
AT = datetime(2026, 8, 12, 9, 0, tzinfo=UTC)


async def _seed(session):
    """One screen, three creatives, one campaign, one play of each creative."""
    session.add(Screen(id=SCREEN, device_uid="dev-report-1", name="Sanjivani Lobby"))
    for mid, nm in ((AD_A, "Template A"), (AD_B, "Template B"), (AD_C, "Other advertiser")):
        session.add(
            MediaAsset(
                id=mid, name=nm, type="image",
                file_url=f"http://x/{mid}.png", duration_seconds=10,
            )
        )
    session.add(
        Booking(
            id="camp-sanjivani",
            name="Sanjivani August",
            screen_id=SCREEN,
            media_id=AD_A,
            schedule_type="continuous",
            status="active",
            start_at=AT - timedelta(days=1),
            end_at=AT + timedelta(days=1),
        )
    )
    await session.flush()

    # Two plays owned by the campaign — DIFFERENT creatives, because the campaign
    # rotates. Both carry the booking tag, which is what attribution matches on.
    session.add(
        ProofOfPlay(id="p-a", screen_id=SCREEN, media_id=AD_A, booking_id="camp-sanjivani",
                    played_at=AT, duration_seconds=10, play_count=1)
    )
    session.add(
        ProofOfPlay(id="p-b", screen_id=SCREEN, media_id=AD_B, booking_id="camp-sanjivani",
                    played_at=AT + timedelta(minutes=2), duration_seconds=10, play_count=1)
    )
    # A third creative on the same screen belonging to nobody in this campaign.
    session.add(
        ProofOfPlay(id="p-c", screen_id=SCREEN, media_id=AD_C, booking_id=None,
                    played_at=AT + timedelta(minutes=4), duration_seconds=10, play_count=1)
    )
    await session.commit()


async def test_media_ids_returns_the_union_of_those_creatives(db_session):
    await _seed(db_session)
    rows, total = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, media_ids=[AD_A, AD_B]
    )
    assert total == 2
    assert {r[0].media_id for r in rows} == {AD_A, AD_B}


async def test_media_ids_of_one_matches_the_old_single_filter(db_session):
    await _seed(db_session)
    listed, _ = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, media_ids=[AD_A]
    )
    single, _ = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, media_id=AD_A
    )
    assert [r[0].id for r in listed] == [r[0].id for r in single]


async def test_media_ids_wins_when_both_are_passed(db_session):
    """`media_ids` is the new, richer filter — the singular is only a fallback."""
    await _seed(db_session)
    rows, total = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, media_id=AD_C, media_ids=[AD_A, AD_B]
    )
    assert total == 2
    assert AD_C not in {r[0].media_id for r in rows}


async def test_empty_media_ids_does_not_filter_anything_out(db_session):
    """An empty list means 'no ad filter', never 'match nothing'."""
    await _seed(db_session)
    _, total = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, media_ids=[]
    )
    assert total == 3


async def test_rows_stay_newest_first_across_several_creatives(db_session):
    """One sheet, time-ordered: the ads interleave, they do not group."""
    await _seed(db_session)
    rows, _ = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, media_ids=[AD_A, AD_B]
    )
    assert [r[0].id for r in rows] == ["p-b", "p-a"]
```

- [ ] **Step 2: Confirm the test cannot pass yet**

Do **not** run pytest (see Global Constraints). Confirm by reading `app/screens/service.py:1591-1601`: the signature has no `media_ids` parameter, so `query_proof_report(..., media_ids=[...])` raises `TypeError: unexpected keyword argument`.

- [ ] **Step 3: Add the parameter**

In `markai-signage-api/app/screens/service.py`, change the signature (currently ending at `with_total: bool = True, booking=None,`) to add one parameter:

```python
async def query_proof_report(
    db: AsyncSession,
    screen_ids,  # None = every screen; a list = restrict to those ids
    from_dt: datetime | None,
    to_dt: datetime | None,
    limit: int,
    offset: int,
    media_id: str | None = None,  # None = every ad; a value = that ad only
    with_total: bool = True,
    booking=None,  # a Booking = only THIS campaign's plays
    media_ids=None,  # a list = those ads; takes precedence over media_id
):
```

Then replace the single-media condition:

```python
    if media_ids:
        conds.append(ProofOfPlay.media_id.in_(media_ids))
    elif media_id is not None:
        conds.append(ProofOfPlay.media_id == media_id)
```

Add this paragraph to the end of the existing docstring:

```
    ``media_ids`` is the multi-creative form of ``media_id`` and takes precedence
    over it. An EMPTY list means "no ad filter" rather than "match nothing", so a
    caller can pass a cleared selection straight through. It composes with
    ``booking``: both predicates apply, which narrows a campaign to the subset of
    its creatives the operator ticked.
```

- [ ] **Step 4: Verify the module still imports and lints**

```bash
cd markai-signage-api && poetry run python -c "import app.main; print('ok')" && poetry run ruff check app/screens/service.py
```

Expected: `ok` then `All checks passed!`

- [ ] **Step 5: Stop and report**

Do not commit. Report to Akshat that Task 1 is code-complete and `tests/test_proof_report_filters.py` is ready for him to run.

---

### Task 2: Backend — campaign and multi-ad filters on the three CMS report endpoints

**Files:**
- Modify: `markai-signage-api/app/cms/reports_router.py` (all three endpoints + one new helper)
- Modify: `markai-signage-api/app/cms/proof_export.py` (add `MAX_FILTER_ADS`)
- Test: `markai-signage-api/tests/test_proof_report_filters.py` (append)

**Interfaces:**
- Consumes: `query_proof_report(..., media_ids=[...])` from Task 1.
- Produces: `_resolve_filters(db, actor, screen_id, booking_id, media_ids, media_id) -> tuple[list[str] | None, Booking | None, list[str]]`, used by all three endpoints. Query params added to `/cms/reports/proof-of-play`, `/cms/reports/proof-of-play.xlsx`, `/cms/reports/plays-aggregate`: repeatable `media_ids`, single `booking_id`.

- [ ] **Step 1: Write the failing tests**

Append to `markai-signage-api/tests/test_proof_report_filters.py`:

```python
async def test_booking_filter_sweeps_every_creative_the_campaign_rotated(db_session):
    """THE point of the campaign filter: five templates, one report.

    Attribution is by the booking tag, so a creative the campaign rotated in is
    included even though nobody named that creative in the filter.
    """
    await _seed(db_session)
    booking = await db_session.get(Booking, "camp-sanjivani")
    rows, total = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, booking=booking
    )
    assert total == 2
    assert {r[0].media_id for r in rows} == {AD_A, AD_B}


async def test_booking_filter_excludes_another_advertisers_play(db_session):
    await _seed(db_session)
    booking = await db_session.get(Booking, "camp-sanjivani")
    rows, _ = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, booking=booking
    )
    assert AD_C not in {r[0].media_id for r in rows}


async def test_campaign_and_ads_together_intersect(db_session):
    """Pick the campaign, then tick one of its five templates."""
    await _seed(db_session)
    booking = await db_session.get(Booking, "camp-sanjivani")
    rows, total = await query_proof_report(
        db_session, [SCREEN], None, None, 50, 0, booking=booking, media_ids=[AD_B]
    )
    assert total == 1
    assert rows[0][0].media_id == AD_B
```

- [ ] **Step 2: Add the cap constant**

In `markai-signage-api/app/cms/proof_export.py`, directly below the existing `MAX_EXPORT_ROWS` definition, add:

```python
# How many creatives one report filter may name. The query string and the
# generated `IN (...)` both have to stay bounded, and no real rotation set comes
# close — the largest in production is five.
MAX_FILTER_ADS = 25
```

- [ ] **Step 3: Add the shared filter resolver**

In `markai-signage-api/app/cms/reports_router.py`, add these imports to the existing import block:

```python
from sqlalchemy.orm import selectinload

from app.bookings.models import Booking
```

Then add the helper immediately after the existing `_resolve_screen_scope` function:

```python
async def _resolve_filters(
    db: AsyncSession,
    actor: CmsUser,
    screen_id: Optional[str],
    booking_id: Optional[str],
    media_ids: Optional[list],
    media_id: Optional[str],
):
    """Turn the raw query params into (screen_ids, booking, media_ids).

    Shared by all three report endpoints so the table, the trend chart and the
    spreadsheet cannot drift apart on what a filter selects — which is the same
    reason `_resolve_screen_scope` was extracted.
    """
    screen_ids = await _resolve_screen_scope(db, actor, screen_id)

    booking = None
    if booking_id:
        booking = (
            await db.execute(
                select(Booking)
                # `attribution.creative_media_ids` reads the relationship out of
                # __dict__ and never lazy-loads, so an unloaded set silently
                # degrades to the primary creative. Load it here or the campaign
                # filter quietly stops covering the rotation.
                .options(selectinload(Booking.creatives))
                .where(Booking.id == booking_id)
            )
        ).scalar_one_or_none()
        if booking is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="That campaign no longer exists",
            )
        # INTERSECT with the scope, never replace it. Replacing is how a revoked
        # assignment stops mattering: the operator's scope resolves to [] and the
        # campaign's own screen puts it straight back.
        if screen_ids is not None and booking.screen_id not in screen_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="That campaign is on a screen you are not assigned to",
            )
        screen_ids = [booking.screen_id]

    ids = list(dict.fromkeys(media_ids or []))  # de-dupe, keep order
    if not ids and media_id:
        ids = [media_id]
    if len(ids) > proof_export.MAX_FILTER_ADS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Pick at most {proof_export.MAX_FILTER_ADS} ads for one report. "
                "Filter by campaign instead to cover a whole rotation."
            ),
        )
    return screen_ids, booking, ids
```

- [ ] **Step 4: Wire the JSON table endpoint**

In `proof_report`, add two params after `media_id` and replace the scope/query lines.

Add to the signature:

```python
    media_ids: Optional[list] = Query(default=None, description="Repeatable; several ads at once"),
    booking_id: Optional[str] = Query(default=None, description="One campaign, all its creatives"),
```

Replace:

```python
    screen_ids = await _resolve_screen_scope(db, actor, screen_id)
```

with:

```python
    screen_ids, booking, ad_ids = await _resolve_filters(
        db, actor, screen_id, booking_id, media_ids, media_id
    )
```

and replace the `service.query_proof_report(...)` call with:

```python
    rows, total = await service.query_proof_report(
        db, screen_ids, from_dt, to_dt, limit, offset,
        media_ids=ad_ids, booking=booking,
    )
```

- [ ] **Step 5: Wire the xlsx endpoint**

In `proof_report_xlsx`, add the same two params to the signature, then replace:

```python
    screen_ids = await _resolve_screen_scope(db, actor, screen_id)
```

with:

```python
    screen_ids, booking, ad_ids = await _resolve_filters(
        db, actor, screen_id, booking_id, media_ids, media_id
    )
```

Inside the pagination `while` loop, replace `media_id=media_id,` with:

```python
            media_ids=ad_ids,
            booking=booking,
```

Below the loop, replace the two lines that seed the label lookup:

```python
    media_ids = {play.media_id for play, _, _, _ in collected}
    if media_id:
        media_ids.add(media_id)  # so the Summary sheet can name the filter too
```

with (note the local is renamed — `media_ids` is now a query param):

```python
    label_ids = {play.media_id for play, _, _, _ in collected}
    # The filtered ads go in even when they produced no rows, so the Summary can
    # name what was asked for rather than only what came back.
    label_ids.update(ad_ids)
```

and update the two references below it: `if media_ids:` becomes `if label_ids:`, and `MediaAsset.id.in_(media_ids)` becomes `MediaAsset.id.in_(label_ids)`.

- [ ] **Step 6: Wire the aggregate endpoint**

In `plays_aggregate`, add the same two params to the signature, then replace:

```python
    screen_ids = await _resolve_screen_scope(db, actor, screen_id)
```

with:

```python
    screen_ids, booking, ad_ids = await _resolve_filters(
        db, actor, screen_id, booking_id, media_ids, media_id
    )
```

and replace the media condition:

```python
    if media_id:
        q = q.where(ProofOfPlay.media_id == media_id)
```

with:

```python
    if ad_ids:
        q = q.where(ProofOfPlay.media_id.in_(ad_ids))
    if booking is not None:
        q = q.where(ProofOfPlay.booking_id == booking.id)
```

- [ ] **Step 7: Verify imports and lint**

```bash
cd markai-signage-api && poetry run python -c "import app.main; print('ok')" && poetry run ruff check app/cms/reports_router.py app/cms/proof_export.py
```

Expected: `ok` then `All checks passed!`

- [ ] **Step 8: Stop and report** — do not commit.

---

### Task 3: Backend — the Summary sheet names the campaign and every ad

**Files:**
- Modify: `markai-signage-api/app/cms/proof_export.py` (`_write_summary` facts list)
- Modify: `markai-signage-api/app/cms/reports_router.py` (the `filters=` dict and the filename)

**Interfaces:**
- Consumes: `_resolve_filters` and `ad_ids` from Task 2.
- Produces: `filters` dict passed to `build_proof_workbook` grows two recognised keys — `"campaign"` (str or None) and `"ad_count"` (int). `filters["media"]` becomes a comma-joined list of ad names.

- [ ] **Step 1: Teach the Summary sheet about campaigns and ad lists**

In `markai-signage-api/app/cms/proof_export.py`, inside `_write_summary`, replace this single line of the `facts` list:

```python
        ("Ad", filters.get("media") or "All ads"),
```

with:

```python
        ("Ads" if (filters.get("ad_count") or 0) > 1 else "Ad",
         filters.get("media") or "All ads"),
```

and insert a campaign row directly after the `("Screen", ...)` entry:

```python
        *(
            [("Campaign", filters["campaign"])]
            if filters.get("campaign")
            else []
        ),
```

The `Alignment(wrap_text=True)` already applied to column B means a long list of
ad names wraps inside the cell rather than running off the sheet.

- [ ] **Step 2: Pass the new facts from the router**

In `markai-signage-api/app/cms/reports_router.py`, inside `proof_report_xlsx`, replace the `filters={...}` block of the `build_proof_workbook` call with:

```python
        filters={
            "screen": screen_label,
            "campaign": booking.name if booking is not None else None,
            "media": ", ".join(
                media_names.get(mid, mid) for mid in ad_ids
            ) or None,
            "ad_count": len(ad_ids),
            "date_from": date_from,
            "date_to": date_to,
        },
```

- [ ] **Step 3: Name the file after what was filtered**

Still in `proof_report_xlsx`, replace the filename assembly:

```python
    parts = ["proof-of-play"]
    if screen_label:
        parts.append(slugify(screen_label, fallback="screen"))
```

with:

```python
    parts = ["proof-of-play"]
    if booking is not None:
        parts.append(slugify(booking.name, fallback="campaign"))
    elif screen_label:
        parts.append(slugify(screen_label, fallback="screen"))
    # One ad is already named by the campaign/screen segment; several are not, and
    # "3-ads" is the difference between two downloads in the same folder.
    if len(ad_ids) > 1:
        parts.append(f"{len(ad_ids)}-ads")
```

- [ ] **Step 4: Verify imports and lint**

```bash
cd markai-signage-api && poetry run python -c "import app.main; print('ok')" && poetry run ruff check app/cms/
```

Expected: `ok` then `All checks passed!`

- [ ] **Step 5: Stop and report** — do not commit.

---

### Task 4: Frontend — pure multi-selection logic

**Files:**
- Create: `markai-Web-cms/src/lib/multi-select.ts`
- Test: `markai-Web-cms/src/lib/multi-select.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `toggleId(ids: readonly string[], id: string, max: number): string[]`, `removeId(ids: readonly string[], id: string): string[]`, `isAtCapacity(ids: readonly string[], max: number): boolean`. All pure.

- [ ] **Step 1: Write the failing test**

Create `markai-Web-cms/src/lib/multi-select.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isAtCapacity, removeId, toggleId } from "./multi-select";

const MAX = 3;

describe("toggleId", () => {
  it("adds an id that is not selected yet", () => {
    expect(toggleId([], "a", MAX)).toEqual(["a"]);
  });

  it("removes an id that is already selected", () => {
    expect(toggleId(["a", "b"], "a", MAX)).toEqual(["b"]);
  });

  it("keeps the order ads were ticked in", () => {
    expect(toggleId(["a", "b"], "c", MAX)).toEqual(["a", "b", "c"]);
  });

  it("refuses to go past the cap", () => {
    expect(toggleId(["a", "b", "c"], "d", MAX)).toEqual(["a", "b", "c"]);
  });

  it("still allows DESELECTING at the cap", () => {
    // Otherwise a full selection becomes a trap the operator cannot edit.
    expect(toggleId(["a", "b", "c"], "b", MAX)).toEqual(["a", "c"]);
  });

  it("never duplicates an id", () => {
    expect(toggleId(["a"], "a", MAX)).toEqual([]);
  });
});

describe("removeId", () => {
  it("drops just that id", () => {
    expect(removeId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("is a no-op for an id that is not there", () => {
    expect(removeId(["a"], "z")).toEqual(["a"]);
  });
});

describe("isAtCapacity", () => {
  it("is false below the cap and true at it", () => {
    expect(isAtCapacity(["a", "b"], MAX)).toBe(false);
    expect(isAtCapacity(["a", "b", "c"], MAX)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd markai-Web-cms && npx vitest run src/lib/multi-select.test.ts
```

Expected: FAIL — `Failed to resolve import "./multi-select"`.

- [ ] **Step 3: Write the module**

Create `markai-Web-cms/src/lib/multi-select.ts`:

```typescript
/**
 * Selection arithmetic for `AsyncMultiSelect`, kept out of the component.
 *
 * This project has no jsdom and no @testing-library, so a component's behaviour
 * is only testable if the decisions live in a plain module — the same split
 * `use-review-keys.ts` uses. The component renders; this decides.
 */

/** Tick or untick one id, honouring a cap on how many may be selected. */
export function toggleId(
  ids: readonly string[],
  id: string,
  max: number,
): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  // Deselection above is deliberately checked FIRST: a full selection must stay
  // editable, or the operator has to clear everything to swap one ad.
  if (ids.length >= max) return [...ids];
  return [...ids, id];
}

/** Drop one id — what a chip's × does. */
export function removeId(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

export function isAtCapacity(ids: readonly string[], max: number): boolean {
  return ids.length >= max;
}
```

- [ ] **Step 4: Run the tests**

```bash
cd markai-Web-cms && npx vitest run src/lib/multi-select.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Stop and report** — do not commit.

---

### Task 5: Frontend — the `AsyncMultiSelect` component

**Files:**
- Create: `markai-Web-cms/src/components/patterns/AsyncMultiSelect.tsx`

**Interfaces:**
- Consumes: `toggleId`, `removeId`, `isAtCapacity` (Task 4); `AsyncOption`, `AsyncSearchResult` (types) from `./AsyncSelect`; `createRequestGuard`, `SEARCH_DEBOUNCE_MS` from `@/lib/use-server-page`.
- Produces: `<AsyncMultiSelect value={string[]} onChange={(ids: string[]) => void} search resolveSelected placeholder searchPlaceholder maxSelected ariaLabel className />`.

`AsyncSelect` is NOT modified — `bookings/new`, `bookings/[id]` and `use-server-page` all depend on its single-value shape.

- [ ] **Step 1: Create the component**

Create `markai-Web-cms/src/components/patterns/AsyncMultiSelect.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createRequestGuard, SEARCH_DEBOUNCE_MS } from "@/lib/use-server-page";
import { isAtCapacity, removeId, toggleId } from "@/lib/multi-select";
import type { AsyncOption, AsyncSearchResult } from "./AsyncSelect";

/**
 * `AsyncSelect`, but it holds SEVERAL ids.
 *
 * Why a sibling rather than a `multiple` prop on AsyncSelect: that component's
 * `value: string` / `onChange(id, option)` shape is consumed by three other
 * surfaces, and widening it into a union would put that union in front of all of
 * them to serve one filter. The two share the `AsyncSource` contract instead, so
 * every option source already written works in both.
 *
 * Selection arithmetic lives in `@/lib/multi-select` because this project has no
 * DOM test environment — see that module's note.
 */
export function AsyncMultiSelect({
  value,
  onChange,
  search,
  resolveSelected,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  maxSelected = 25,
  disabled,
  ariaLabel,
  className,
}: {
  /** Selected ids, in the order they were ticked. */
  value: string[];
  onChange: (ids: string[]) => void;
  search: (q: string) => Promise<AsyncSearchResult>;
  /** Labels an id that is selected but not in the current result page. */
  resolveSelected?: (id: string) => Promise<AsyncOption | null>;
  placeholder?: string;
  searchPlaceholder?: string;
  maxSelected?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [options, setOptions] = useState<AsyncOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** id -> label for everything selected, so a chip can be drawn for an ad that
   *  is not on the page currently showing. */
  const [labels, setLabels] = useState<Record<string, string>>({});

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const searchRef = useRef(search);
  searchRef.current = search;
  const resolveRef = useRef(resolveSelected);
  resolveRef.current = resolveSelected;
  const requested = useRef<Set<string>>(new Set());

  const guard = useMemo(() => createRequestGuard(), []);

  const key = value.join(",");

  // Label whatever is selected. Each id is fetched at most once for the
  // component's lifetime; an id that fails to resolve keeps its short form.
  useEffect(() => {
    const missing = value.filter(
      (id) => !labels[id] && !requested.current.has(id),
    );
    if (!missing.length) return;
    const fn = resolveRef.current;
    if (!fn) return;
    missing.forEach((id) => requested.current.add(id));
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        fn(id)
          .then((o) => [id, o?.label ?? id.slice(0, 8)] as const)
          .catch(() => [id, id.slice(0, 8)] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, label] of pairs) next[id] = label;
      setLabels((prev) => ({ ...prev, ...next }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Only fetch while open, so a page carrying several of these costs nothing
  // until one is actually used.
  useEffect(() => {
    if (!open) return;
    const id = guard.next();
    setLoading(true);
    setError(null);
    searchRef
      .current(debounced)
      .then((r) => {
        if (!guard.isCurrent(id)) return;
        setOptions(r.options ?? []);
        setTotal(r.total ?? 0);
        // Cache labels for anything we can see, so chips render instantly.
        setLabels((prev) => {
          const next = { ...prev };
          for (const o of r.options ?? []) next[o.id] = o.label;
          return next;
        });
      })
      .catch((e) => {
        if (!guard.isCurrent(id)) return;
        setError(e instanceof Error && e.message ? e.message : "Search failed.");
        setOptions([]);
        setTotal(0);
      })
      .finally(() => {
        if (guard.isCurrent(id)) setLoading(false);
      });
  }, [open, debounced, guard]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setDebounced("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  const full = isAtCapacity(value, maxSelected);
  const hiddenCount = Math.max(0, total - options.length);
  const labelOf = (id: string) => labels[id] || id.slice(0, 8);

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent"
            >
              <span className="truncate">{labelOf(id)}</span>
              <button
                type="button"
                onClick={() => onChange(removeId(value, id))}
                aria-label={`Remove ${labelOf(id)}`}
                className="flex-shrink-0 rounded-full hover:bg-accent/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-line bg-panel-raised px-3 py-2 text-left text-sm transition-colors duration-[var(--dur-fast)] focus:border-[var(--primary)] focus-visible:outline-none disabled:opacity-60",
          open && "border-[var(--primary)]",
        )}
      >
        <span className={cn("truncate", !value.length && "text-fg-subtle")}>
          {value.length ? `${value.length} selected` : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-fg-subtle transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-line bg-panel-raised shadow-lg">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search className="h-4 w-4 flex-shrink-0 text-fg-subtle" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none placeholder:text-fg-subtle"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-fg-subtle" />}
          </div>

          <ul id={listId} role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto py-1">
            {error && <li className="px-3 py-2 text-sm text-danger">{error}</li>}
            {!error && !loading && !options.length && (
              <li className="px-3 py-2 text-sm text-fg-subtle">Nothing matched.</li>
            )}
            {options.map((o) => {
              const checked = value.includes(o.id);
              // A full selection must stay editable — only UNticked rows lock.
              const locked = full && !checked;
              return (
                <li key={o.id} role="option" aria-selected={checked}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onChange(toggleId(value, o.id, maxSelected))}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel disabled:opacity-40",
                      checked && "bg-panel",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[var(--radius-sm)] border",
                        checked ? "border-accent bg-accent text-white" : "border-line",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{o.label}</span>
                      {o.sublabel && (
                        <span className="block truncate text-xs text-fg-subtle">
                          {o.sublabel}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {(hiddenCount > 0 || full) && (
            <div className="border-t border-line px-3 py-1.5 text-xs text-fg-subtle">
              {full
                ? `${maxSelected} is the most you can pick — filter by campaign to cover a whole rotation.`
                : `Showing ${options.length} of ${total}. Type to narrow.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd markai-Web-cms && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Stop and report** — do not commit.

---

### Task 6: Frontend — campaign option source and API params

**Files:**
- Modify: `markai-Web-cms/src/lib/async-sources.ts`
- Modify: `markai-Web-cms/src/lib/types.ts:357-364`
- Modify: `markai-Web-cms/src/lib/api.ts` (`playsAggregate`, `proofReport`, `proofReportXlsx`)
- Create: `markai-Web-cms/src/lib/report-query.ts`
- Test: `markai-Web-cms/src/lib/report-query.test.ts` (create)

**Interfaces:**
- Consumes: `AsyncSource` shape from `async-sources.ts`.
- Produces: `bookingSource: AsyncSource`; `bookingOption(b: BookingListItem): AsyncOption`; `proofFilterQuery(params: ProofReportParams): URLSearchParams`; `ProofReportParams` gains `mediaIds?: string[]` and `bookingId?: string`.

- [ ] **Step 1: Write the failing test for the query builder**

Create `markai-Web-cms/src/lib/report-query.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { proofFilterQuery } from "./report-query";

describe("proofFilterQuery", () => {
  it("is empty when nothing is filtered", () => {
    expect(proofFilterQuery({}).toString()).toBe("");
  });

  it("repeats media_ids once per ad", () => {
    const q = proofFilterQuery({ mediaIds: ["a", "b", "c"] });
    expect(q.getAll("media_ids")).toEqual(["a", "b", "c"]);
  });

  it("sends the campaign as booking_id", () => {
    expect(proofFilterQuery({ bookingId: "camp-1" }).get("booking_id")).toBe("camp-1");
  });

  it("still supports a lone mediaId for older callers", () => {
    expect(proofFilterQuery({ mediaId: "solo" }).get("media_id")).toBe("solo");
  });

  it("prefers mediaIds and drops the singular when both are given", () => {
    const q = proofFilterQuery({ mediaId: "solo", mediaIds: ["a"] });
    expect(q.getAll("media_ids")).toEqual(["a"]);
    expect(q.get("media_id")).toBeNull();
  });

  it("omits an empty ad list entirely", () => {
    expect(proofFilterQuery({ mediaIds: [] }).toString()).toBe("");
  });

  it("carries screen and dates through", () => {
    const q = proofFilterQuery({
      screenId: "s1",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-25",
    });
    expect(q.get("screen_id")).toBe("s1");
    expect(q.get("date_from")).toBe("2026-08-01");
    expect(q.get("date_to")).toBe("2026-08-25");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd markai-Web-cms && npx vitest run src/lib/report-query.test.ts
```

Expected: FAIL — `Failed to resolve import "./report-query"`.

- [ ] **Step 3: Add the params to the type**

In `markai-Web-cms/src/lib/types.ts`, replace the `ProofReportParams` interface with:

```typescript
export interface ProofReportParams {
  screenId?: string;
  /** One ad. Kept for callers that predate multi-select. */
  mediaId?: string;
  /** Several ads at once. Takes precedence over `mediaId`. */
  mediaIds?: string[];
  /** One campaign — the backend expands it to every creative it rotated. */
  bookingId?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 4: Write the query builder**

Create `markai-Web-cms/src/lib/report-query.ts`:

```typescript
import type { ProofReportParams } from "./types";

/**
 * The filter half of every proof-of-play request, in one place.
 *
 * The table, the trend chart and the spreadsheet each hit a different endpoint
 * with the SAME filters. Three hand-rolled copies of this would eventually
 * disagree, and the way they would disagree is a chart that does not match the
 * rows underneath it.
 *
 * Pagination is deliberately NOT here: the export takes no limit/offset.
 */
export function proofFilterQuery(params: ProofReportParams): URLSearchParams {
  const q = new URLSearchParams();
  if (params.screenId) q.set("screen_id", params.screenId);
  if (params.bookingId) q.set("booking_id", params.bookingId);
  if (params.mediaIds?.length) {
    // Repeated key, which is how FastAPI reads a list query param.
    for (const id of params.mediaIds) q.append("media_ids", id);
  } else if (params.mediaId) {
    q.set("media_id", params.mediaId);
  }
  if (params.dateFrom) q.set("date_from", params.dateFrom);
  if (params.dateTo) q.set("date_to", params.dateTo);
  return q;
}
```

- [ ] **Step 5: Run the tests**

```bash
cd markai-Web-cms && npx vitest run src/lib/report-query.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Use it in the API client**

In `markai-Web-cms/src/lib/api.ts`, add to the imports:

```typescript
import { proofFilterQuery } from "./report-query";
```

Replace the body of `playsAggregate` with:

```typescript
  playsAggregate: (params: ProofReportParams = {}) => {
    const q = proofFilterQuery(params);
    q.set("group_by", "day");
    return request<PlaysAggregate>(`/cms/reports/plays-aggregate?${q.toString()}`);
  },
```

Replace the body of `proofReport` with:

```typescript
  proofReport: (params: ProofReportParams = {}) => {
    const q = proofFilterQuery(params);
    q.set("limit", String(params.limit ?? 50));
    q.set("offset", String(params.offset ?? 0));
    return request<ProofReportResponse>(`/cms/reports/proof-of-play?${q.toString()}`);
  },
```

Replace the body of `proofReportXlsx` with:

```typescript
  proofReportXlsx: (
    params: ProofReportParams = {},
    fallback = "proof-of-play.xlsx",
  ) =>
    requestBlob(
      `/cms/reports/proof-of-play.xlsx?${proofFilterQuery(params).toString()}`,
      fallback,
    ),
```

`playsAggregate`'s parameter type changes from its inline object to `ProofReportParams`; it is already imported in this file.

- [ ] **Step 7: Add the campaign option source**

In `markai-Web-cms/src/lib/async-sources.ts`, add `BookingListItem` to the existing `types` import, then add next to `solutionOption` / `solutionSource`:

```typescript
export function bookingOption(b: BookingListItem): AsyncOption {
  return {
    id: b.id,
    label: b.name,
    sublabel: b.screen_name ?? undefined,
  };
}

/**
 * Campaigns the caller may see.
 *
 * The one filter that answers "everything this advertiser ran", rotation
 * included — the backend attributes plays by booking_id, so picking a campaign
 * covers every creative it swapped through without naming any of them.
 */
export const bookingSource: AsyncSource = {
  search: (q) =>
    api
      .bookings({ q, limit: ASYNC_SELECT_PAGE, offset: 0 })
      .then((r) => ({
        options: (r.bookings ?? []).map(bookingOption),
        total: r.total ?? (r.bookings ?? []).length,
      })),
  resolveSelected: (id) =>
    api
      .booking(id)
      .then((r) => bookingOption(r.booking as BookingListItem))
      .catch(() => null),
};
```

Note `api.booking(id)` returns a `BookingDetailResponse`; read its `booking` field. If typecheck rejects the cast, map the fields explicitly instead: `{ id: r.booking.id, label: r.booking.name, sublabel: r.booking.screen_name ?? undefined }`.

- [ ] **Step 8: Typecheck and run the whole suite**

```bash
cd markai-Web-cms && npm run typecheck && npm test
```

Expected: no type errors; every vitest file passes.

- [ ] **Step 9: Stop and report** — do not commit.

---

### Task 7: Frontend — wire both filters into the Proof of play page

**Files:**
- Modify: `markai-Web-cms/src/app/(dashboard)/reports/page.tsx`

**Interfaces:**
- Consumes: `AsyncMultiSelect` (Task 5); `bookingSource` (Task 6); `ProofReportParams.mediaIds` / `.bookingId` (Task 6); `MAX_FILTER_ADS` value 25 (Task 2).

- [ ] **Step 1: Swap the state**

In `markai-Web-cms/src/app/(dashboard)/reports/page.tsx`, replace:

```tsx
  const [mediaId, setMediaId] = useState("");
```

with:

```tsx
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [bookingId, setBookingId] = useState("");
```

and add below `const PAGE_SIZE = 50;`:

```tsx
/** Mirrors MAX_FILTER_ADS in app/cms/proof_export.py. The backend rejects more;
 *  this stops the operator reaching that state at all. */
const MAX_FILTER_ADS = 25;
```

- [ ] **Step 2: Update the imports**

Add `AsyncMultiSelect`:

```tsx
import { AsyncMultiSelect } from "@/components/patterns/AsyncMultiSelect";
```

and extend the existing async-sources import to `import { bookingSource, mediaSource, screenSource } from "@/lib/async-sources";`.

- [ ] **Step 3: Feed the new filters to both fetches**

In `fetchReport`, replace `mediaId: mediaId || undefined,` with:

```tsx
        mediaIds: mediaIds.length ? mediaIds : undefined,
        bookingId: bookingId || undefined,
```

and change its dependency array to `[screenId, mediaIds, bookingId, dateFrom, dateTo, offset]`.

In the trend-chart effect, make the same two replacements and change its dependency array to `[screenId, mediaIds, bookingId, dateFrom, dateTo]`.

`mediaIds` is a new array identity on every change, which is what should re-run
these — the page holds it in state and never rebuilds it during a render.

- [ ] **Step 4: Update reset and the export call**

Replace the body of `reset` with:

```tsx
  const reset = () => {
    setScreenId("");
    setMediaIds([]);
    setBookingId("");
    setDateFrom("");
    setDateTo("");
    setOffset(0);
  };
```

In `downloadXlsx`, replace the `api.proofReportXlsx({ screenId, mediaId, dateFrom, dateTo })` call with:

```tsx
        await api.proofReportXlsx({ screenId, mediaIds, bookingId, dateFrom, dateTo }),
```

- [ ] **Step 5: Fix the mobile filter badge**

Replace both occurrences of:

```tsx
[screenId, mediaId, dateFrom, dateTo].filter(Boolean).length
```

with a single count that treats each ticked ad as one active filter. Add above the `return`:

```tsx
  // Each ticked ad counts, so "3" on the mobile chip means three ads — not
  // "the ad filter is on".
  const activeFilterCount =
    [screenId, bookingId, dateFrom, dateTo].filter(Boolean).length + mediaIds.length;
```

then use `activeFilterCount` in both places.

- [ ] **Step 6: Widen the grid and add the two controls**

Change the filter grid's class from `lg:grid-cols-5` to `lg:grid-cols-6`.

Insert a Campaign field between the Screen and Ad fields:

```tsx
          <FormField label="Campaign">
            <AsyncSelect
              value={bookingId}
              onChange={(id) => onFilter(() => setBookingId(id))}
              search={bookingSource.search}
              resolveSelected={bookingSource.resolveSelected}
              emptyOptionLabel="All campaigns"
              placeholder="All campaigns"
              searchPlaceholder="Search campaigns…"
              ariaLabel="Filter by campaign"
            />
          </FormField>
```

Replace the whole existing Ad `FormField` with:

```tsx
          <FormField label="Ad">
            <AsyncMultiSelect
              value={mediaIds}
              onChange={(ids) => onFilter(() => setMediaIds(ids))}
              search={mediaSource.search}
              resolveSelected={mediaSource.resolveSelected}
              placeholder="All ads"
              searchPlaceholder="Search ads…"
              maxSelected={MAX_FILTER_ADS}
              ariaLabel="Filter by one or more ads"
            />
          </FormField>
```

- [ ] **Step 7: Update the page subtitle**

Replace the `PageHeader` subtitle string with:

```tsx
        subtitle="Every ad shown across your screens. Filter by screen, campaign, one or more ads, and date."
```

- [ ] **Step 8: Typecheck, lint, test, build**

```bash
cd markai-Web-cms && npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all four clean.

- [ ] **Step 9: Verify by hand against the running stack**

Backend on :8095 and CMS on :5120 (see root `CLAUDE.md`). Log in as `admin@mark-ai.tech` / `Admin@123`, open `/reports`, then confirm:

1. Ticking two ads shows both ads' rows interleaved by time, and the chip row shows two chips.
2. The trend chart total changes with the selection (chart and table agree).
3. Picking a campaign that rotates creatives returns rows for more than one ad.
4. **Download Excel** produces one sheet, newest-first, with the ads interleaved; the Summary sheet names the campaign and lists the ads; the filename carries the campaign slug and `<n>-ads`.
5. Reset clears both new filters.

- [ ] **Step 10: Stop and report** — do not commit. Summarise what was verified by hand and what still needs Akshat to run the backend pytest suite.

---

## Notes for the executor

- The two backend test files this plan writes (`tests/test_proof_report_filters.py`) are additions only; no existing test is modified.
- If `npm run lint` complains about the `react-hooks/exhaustive-deps` disable comment in `AsyncMultiSelect`, keep the comment — `AsyncSelect` uses the identical pattern for the same reason (resolving labels must key off the id list, not the resolver identity).
- If `api.booking(id)` turns out not to expose `screen_name`, drop the sublabel rather than adding a second request; the campaign name alone is enough to pick from.
