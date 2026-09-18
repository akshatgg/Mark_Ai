# Milestone download returns the wrong creative — Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the milestone download hand back the frame of the creative whose tile was clicked, instead of an arbitrary one.

**Architecture:** One omission propagated through four layers — the creative's `media_id` is never carried on the download path, even though the database is keyed by it. The fix threads `media_id` from the clicked tile through the API client, the route and the service into the record lookup, adds a deterministic `ORDER BY` so the query can never be a coin-flip, and puts the creative in the download filename so two creatives' frames stop colliding in the operator's Downloads folder.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async (backend); Next.js 15 + React 19 (CMS).

## The bug, established

`screenshot_records` is uniquely keyed on **three** columns:

```
uq_screenshot_records_booking_milestone UNIQUE
  (booking_id, shot_type, media_id)  WHERE shot_type NOT IN ('loop','ondemand')
```

A rotating campaign therefore holds one `milestone_start` row **per creative**. Confirmed in the
dev database: three bookings each hold 2 rows for `milestone_start` across 2 distinct creatives.

`app/screenshots/service.py:1179` looks the record up on **two** of those three columns:

```python
record = await _existing_milestone_record(db, booking.id, f"milestone_{milestone}")
```

`_existing_milestone_record` accepts `media_id` and its own docstring says keying by creative is
required, but this caller passes `None`. The query then ends in `.limit(1)` with **no `ORDER BY`**,
so Postgres returns an arbitrary matching row — in practice the earliest inserted. Every creative's
"Start" tile downloads that same frame.

The preview is correct because it renders `m.url` straight off the per-creative milestone row.

## Global Constraints

- **Do NOT run pytest.** Standing rule for the Mark AI backends: verify with `poetry run python -c "import app.main"` and `poetry run ruff check app/`. Write the test files as specified — Akshat runs the suite.
- **Ruff is the backend gate, not black.** Do not reformat files you touch.
- **Frontend tests are vitest, logic-only** — no jsdom, no @testing-library in this project. Never plan a component-render test.
- `media_id` must stay **OPTIONAL** at every layer — but note WHY. `screenshot_records.media_id` is `nullable=False`, so every stored row does carry a creative; the optionality is about the **caller** not supplying one (an old bookmarked URL, or the upload-path callers that pass it positionally). Absent `media_id` must keep exactly today's behaviour, only now deterministic instead of arbitrary.
- Do not commit or push unless Akshat asks (root `CLAUDE.md`).
- **Branching:** the backend files here (`app/screenshots/*`) do not overlap the already-pushed `feat/proof-of-play-campaign-and-multi-ad-filter`, so the backend fix can branch off `main` cleanly. The CMS fix touches `src/app/(dashboard)/bookings/[id]/page.tsx`, which **that branch already modifies** — branch the CMS fix off the feature branch and expect it to stack behind CMS-Web#55. Confirm with Akshat before pushing.

---

### Task 1: The download resolves the clicked creative's record

**Files:**
- Modify: `markai-signage-api/app/screenshots/service.py:1153-1208` (`get_milestone_file`) and `:1453-1474` (`_existing_milestone_record`)
- Modify: `markai-signage-api/app/screenshots/router.py:203-224` (`download_milestone`)
- Test: `markai-signage-api/tests/test_milestone_download_creative.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `get_milestone_file(db, booking_id, milestone, actor_role, actor_id=None, media_id=None) -> tuple[bytes, str, str]`. Route gains `media_id: Optional[str] = Query(default=None)`.

- [ ] **Step 1: Write the failing test**

Create `markai-signage-api/tests/test_milestone_download_creative.py`:

```python
"""Downloading a milestone frame must return the creative that was clicked.

A rotating campaign holds one `milestone_start` per creative — the unique index is
(booking_id, shot_type, media_id). The download used to match on the first two and
take `.limit(1)` with no ORDER BY, so every creative's Start tile handed back the
same arbitrary frame while the preview beside it showed the right one.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.bookings.models import Booking
from app.content.models import MediaAsset
from app.screens.models import Screen
from app.screenshots.models import ScreenshotRecord
from app.screenshots import service

pytestmark = pytest.mark.asyncio

UTC = timezone.utc
SCREEN = "9c1f0b31-2a44-4d7e-9f01-77c2b6a4e001"
BOOKING = "5b2d4e77-1c88-4a10-bb33-2f9e7d10c002"
AD_A = "aaaa1111-0000-4000-8000-000000000001"
AD_B = "bbbb2222-0000-4000-8000-000000000002"
AT = datetime(2026, 8, 12, 9, 0, tzinfo=UTC)


async def _seed(session):
    """One campaign rotating two creatives, each with its own captured start."""
    session.add(Screen(id=SCREEN, device_uid="dev-shot-1", name="Sanjivani Lobby"))
    for mid, nm in ((AD_A, "Template A"), (AD_B, "Template B")):
        session.add(
            MediaAsset(
                id=mid, name=nm, type="image",
                file_url=f"http://x/{mid}.png", duration_seconds=10,
            )
        )
    session.add(
        Booking(
            id=BOOKING, name="Sanjivani August", screen_id=SCREEN, media_id=AD_A,
            schedule_type="continuous", status="active",
            start_at=AT - timedelta(days=1), end_at=AT + timedelta(days=1),
        )
    )
    await session.flush()
    # Inserted A first, so an unordered LIMIT 1 reliably returns A's frame.
    session.add(
        ScreenshotRecord(
            id="rec-a", booking_id=BOOKING, screen_id=SCREEN, media_id=AD_A,
            shot_type="milestone_start", cloudinary_url="http://img/a.jpg",
            cloudinary_public_id="pub-a", captured_at=AT,
        )
    )
    session.add(
        ScreenshotRecord(
            id="rec-b", booking_id=BOOKING, screen_id=SCREEN, media_id=AD_B,
            shot_type="milestone_start", cloudinary_url="http://img/b.jpg",
            cloudinary_public_id="pub-b", captured_at=AT + timedelta(minutes=1),
        )
    )
    await session.commit()


async def test_lookup_returns_the_named_creative(db_session):
    await _seed(db_session)
    rec = await service._existing_milestone_record(
        db_session, BOOKING, "milestone_start", media_id=AD_B
    )
    assert rec is not None
    assert rec.id == "rec-b"
    assert rec.cloudinary_url == "http://img/b.jpg"


async def test_lookup_does_not_hand_back_the_other_creative(db_session):
    """THE bug: asking for B's start used to return A's, because the query
    matched only (booking_id, shot_type)."""
    await _seed(db_session)
    a = await service._existing_milestone_record(
        db_session, BOOKING, "milestone_start", media_id=AD_A
    )
    b = await service._existing_milestone_record(
        db_session, BOOKING, "milestone_start", media_id=AD_B
    )
    assert a.id != b.id


async def test_without_a_creative_the_pick_is_deterministic(db_session):
    """A legacy caller that names no creative must not get a coin-flip. Oldest
    capture wins, and it is the same row every time."""
    await _seed(db_session)
    first = await service._existing_milestone_record(
        db_session, BOOKING, "milestone_start"
    )
    second = await service._existing_milestone_record(
        db_session, BOOKING, "milestone_start"
    )
    assert first.id == second.id == "rec-a"


async def test_unknown_creative_is_a_miss_not_a_wrong_frame(db_session):
    """Better a 404 than silently handing over some other advertiser's ad."""
    await _seed(db_session)
    rec = await service._existing_milestone_record(
        db_session, BOOKING, "milestone_start", media_id="cccc3333-0000-4000-8000-000000000003"
    )
    assert rec is None
```

- [ ] **Step 2: Confirm the test cannot pass yet**

Do **not** run pytest (see Global Constraints). Confirm by reading
`app/screenshots/service.py:1470-1474`: the query is
`select(ScreenshotRecord).where(and_(*clauses)).limit(1)` with no `order_by`, so
`test_without_a_creative_the_pick_is_deterministic` rests on undefined ordering.

- [ ] **Step 3: Make the lookup deterministic**

In `markai-signage-api/app/screenshots/service.py`, replace the body of
`_existing_milestone_record`'s query:

```python
    return (
        await db.execute(
            select(ScreenshotRecord).where(and_(*clauses)).limit(1)
        )
    ).scalars().first()
```

with:

```python
    return (
        await db.execute(
            select(ScreenshotRecord)
            .where(and_(*clauses))
            # LIMIT 1 with no ORDER BY is a coin-flip the moment more than one
            # row matches, which is exactly what a rotating campaign produces
            # when the caller names no creative. Oldest capture wins, so the
            # same call always returns the same frame.
            .order_by(ScreenshotRecord.captured_at.asc(), ScreenshotRecord.id.asc())
            .limit(1)
        )
    ).scalars().first()
```

- [ ] **Step 4: Pass the creative through the service**

In the same file, change `get_milestone_file`'s signature:

```python
async def get_milestone_file(
    db: AsyncSession,
    booking_id: str,
    milestone: str,
    actor_role: str,
    actor_id: Optional[str] = None,
    media_id: Optional[str] = None,
) -> tuple[bytes, str, str]:
```

Replace the stale paragraph in its docstring:

```
    Unlike the on-demand path this needs no batch naming: milestones are one record
    per slot, so there is nothing to collide with.
```

with:

```
    ``media_id`` names WHICH creative's frame is wanted. A rotating campaign holds
    one record per milestone PER CREATIVE — the unique index is
    (booking_id, shot_type, media_id) — so without it this returned an arbitrary
    one and every creative's Start tile downloaded the same picture. It stays
    optional because a CALLER may not have one to send (an old bookmarked URL);
    every stored row does carry a creative, since the column is NOT NULL.
```

Then pass it to the lookup:

```python
    record = await _existing_milestone_record(
        db, booking.id, f"milestone_{milestone}", media_id=media_id
    )
```

and make the miss say which creative it could not find:

```python
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "That creative has no frame for this milestone yet."
                if media_id
                else "That milestone has not been captured yet."
            ),
        )
```

- [ ] **Step 5: Accept the creative on the route**

In `markai-signage-api/app/screenshots/router.py`, add the parameter to
`download_milestone` (after `milestone`, before `actor`):

```python
    media_id: Optional[str] = Query(
        default=None,
        description="Which creative's frame. A rotating campaign holds one per creative.",
    ),
```

and forward it:

```python
    data, content_type, filename = await service.get_milestone_file(
        db,
        booking_id,
        milestone,
        actor_role=actor.role,
        actor_id=str(actor.id),
        media_id=media_id,
    )
```

Confirm `Query` and `Optional` are already imported in that file; both are used by
neighbouring routes (`download_ondemand_captures_zip` uses `Query`).

- [ ] **Step 6: Verify imports and lint**

```bash
cd markai-signage-api && poetry run python -c "import app.main; print('ok')" && poetry run ruff check app/screenshots/
```

Expected: `ok` then `All checks passed!`

- [ ] **Step 7: Stop and report** — do not commit.

---

### Task 2: The filename names the creative

**Files:**
- Modify: `markai-signage-api/app/screenshots/naming.py:98-118` (`milestone_download_name`)
- Modify: `markai-signage-api/app/screenshots/service.py` (the `milestone_download_name(...)` call inside `get_milestone_file`)
- Test: `markai-signage-api/tests/test_milestone_download_creative.py` (append)

**Interfaces:**
- Consumes: `get_milestone_file(..., media_id=...)` from Task 1.
- Produces: `milestone_download_name(screen_name, campaign_name, milestone, captured_at, url=None, creative_name=None) -> str`.

- [ ] **Step 1: Write the failing test**

Append to `markai-signage-api/tests/test_milestone_download_creative.py`:

```python
from app.screenshots.naming import milestone_download_name


def test_filename_without_a_creative_is_unchanged():
    """Old callers keep the shape they had — this is the legacy path.

    The timestamp is not hardcoded: _TIMESTAMP_FMT is an implementation detail and
    pinning it here would make this test fail for a reason that is not this bug.
    """
    name = milestone_download_name(
        "Sanjivani Lobby", "Sanjivani August", "start", AT, url="http://img/a.jpg"
    )
    assert name.startswith("sanjivani-lobby_sanjivani-august_start_")
    assert name.endswith("-IST.jpg")


def test_filename_includes_the_creative_when_given():
    name = milestone_download_name(
        "Sanjivani Lobby", "Sanjivani August", "start", AT,
        url="http://img/a.jpg", creative_name="Template B",
    )
    assert "template-b" in name
    assert name.endswith(".jpg")


def test_two_creatives_do_not_collide_in_a_downloads_folder():
    """THE point: without the creative these two were byte-identical strings, so
    the second download silently became 'file (1)'."""
    a = milestone_download_name(
        "S", "C", "start", AT, url="http://img/a.jpg", creative_name="Template A"
    )
    b = milestone_download_name(
        "S", "C", "start", AT, url="http://img/b.jpg", creative_name="Template B"
    )
    assert a != b
```

- [ ] **Step 2: Confirm the test cannot pass yet**

Do not run pytest. Confirm by reading `app/screenshots/naming.py:98-104`: the signature has
no `creative_name` parameter, so passing it raises `TypeError`.

- [ ] **Step 3: Add the parameter**

In `markai-signage-api/app/screenshots/naming.py`, change the signature:

```python
def milestone_download_name(
    screen_name: Optional[str],
    campaign_name: Optional[str],
    milestone: str,
    captured_at: datetime,
    url: Optional[str] = None,
    creative_name: Optional[str] = None,
) -> str:
```

Replace the stale docstring paragraph:

```
    No ``taken`` set, unlike ``capture_download_name``: a booking holds exactly one
    record per milestone and the milestone name is *in* the filename, so the three
    cannot collide with each other even if two landed in the same second. The
    milestone also has to be named — "start" and "end" of the same campaign are the
    two frames an advertiser compares, and a timestamp alone doesn't say which is
    which once the file is sitting in a folder.
```

with:

```
    The milestone is named because "start" and "end" of one campaign are the two
    frames an advertiser compares, and a timestamp alone doesn't say which is which
    once the file sits in a folder.

    ``creative_name`` is named for the same reason one step down. A rotating
    campaign holds a start PER CREATIVE, so without it two of its frames produce
    the identical filename and the second download quietly becomes "file (1)".
    Omitted for a campaign that airs one ad, whose name is already unambiguous.
```

and build the name with the creative segment when there is one:

```python
    screen = slugify(screen_name, fallback="screen")
    campaign = slugify(campaign_name, fallback="campaign")
    slot = slugify(milestone, fallback="milestone")
    ext = _extension_for(url)
    parts = [screen, campaign]
    # Guarded rather than slugified-and-tested: slugify never returns "" (it
    # falls back to "unnamed"), so an absent creative would otherwise wedge an
    # "_unnamed_" segment into every single-ad campaign's filename.
    if creative_name:
        parts.append(slugify(creative_name))
    parts.append(slot)
    return f"{'_'.join(parts)}_{_stamp(captured_at)}-IST{ext}"
```

- [ ] **Step 4: Feed the creative's name in from the service**

In `markai-signage-api/app/screenshots/service.py`, inside `get_milestone_file`, above the
`filename = milestone_download_name(` call, resolve the creative's name from the record:

```python
    # Named from the RECORD's creative, not the request's — the caller may have
    # sent none, but the row it resolved to always has one.
    creative_name = None
    if record.media_id:
        creative_name = (
            await db.execute(
                select(MediaAsset.name).where(MediaAsset.id == record.media_id)
            )
        ).scalar_one_or_none()
```

and pass it:

```python
    filename = milestone_download_name(
        screen.name if screen is not None else None,
        booking.name,
        milestone,
        _tz(record.captured_at),
        url=record.cloudinary_url,
        creative_name=creative_name,
    )
```

Confirm `MediaAsset` is imported in `service.py`; if it is not, add
`from app.content.models import MediaAsset` to the existing import block.

- [ ] **Step 5: Verify imports and lint**

```bash
cd markai-signage-api && poetry run python -c "import app.main; print('ok')" && poetry run ruff check app/screenshots/
```

Expected: `ok` then `All checks passed!`

- [ ] **Step 6: Sanity-check the naming by hand** (no pytest)

```bash
cd markai-signage-api && poetry run python -c "
from datetime import datetime, timezone
from app.screenshots.naming import milestone_download_name as n
AT = datetime(2026, 8, 12, 9, 0, tzinfo=timezone.utc)
print('legacy :', n('Sanjivani Lobby','Sanjivani August','start',AT,url='http://x/a.jpg'))
print('ad A   :', n('Sanjivani Lobby','Sanjivani August','start',AT,url='http://x/a.jpg',creative_name='Template A'))
print('ad B   :', n('Sanjivani Lobby','Sanjivani August','start',AT,url='http://x/b.jpg',creative_name='Template B'))
"
```

Expected: the legacy line is unchanged from today's format, and the two ad lines differ.

- [ ] **Step 7: Stop and report** — do not commit.

---

### Task 3: The CMS sends the creative, and spins only the clicked tile

**Files:**
- Modify: `markai-Web-cms/src/lib/api.ts` (`milestoneFile`)
- Modify: `markai-Web-cms/src/app/(dashboard)/bookings/[id]/page.tsx` (`download`, the `downloading` state, and the button's spinner test)

**Interfaces:**
- Consumes: the route's optional `media_id` query param from Task 1.
- Produces: `api.milestoneFile(bookingId: string, milestone: string, fallback: string, mediaId?: string | null)`.

- [ ] **Step 1: Send the creative from the API client**

In `markai-Web-cms/src/lib/api.ts`, replace `milestoneFile`:

```typescript
  milestoneFile: (bookingId: string, milestone: string, fallback: string) =>
    requestBlob(
      `/cms/bookings/${encodeURIComponent(bookingId)}/milestones/${encodeURIComponent(
        milestone,
      )}/file`,
      fallback,
    ),
```

with:

```typescript
  /** One milestone frame. `mediaId` says WHICH creative's — a rotating campaign
   *  holds a start/mid/end per ad, and without it the backend can only return an
   *  arbitrary one. Optional, so a campaign airing a single ad is unaffected. */
  milestoneFile: (
    bookingId: string,
    milestone: string,
    fallback: string,
    mediaId?: string | null,
  ) =>
    requestBlob(
      `/cms/bookings/${encodeURIComponent(bookingId)}/milestones/${encodeURIComponent(
        milestone,
      )}/file${mediaId ? `?media_id=${encodeURIComponent(mediaId)}` : ""}`,
      fallback,
    ),
```

- [ ] **Step 2: Pass it from the tile, and key the spinner per frame**

In `markai-Web-cms/src/app/(dashboard)/bookings/[id]/page.tsx`, replace the `downloading`
state comment and the `download` function:

```tsx
  // Which milestone is mid-download, so a second click can't start a second
  // fetch of the same frame. One at a time is enough — there are only three.
  const [downloading, setDownloading] = useState<string | null>(null);
```

with:

```tsx
  // Which FRAME is mid-download — milestone AND creative. Keyed on the milestone
  // alone, a rotating campaign spun every ad's Start button at once, because all
  // of them matched the one value being held.
  const [downloading, setDownloading] = useState<string | null>(null);
  const frameKey = (m: Milestone) => `${m.milestone}:${m.media_id ?? ""}`;
```

and in `download`, replace `setDownloading(m.milestone);` with:

```tsx
    setDownloading(frameKey(m));
```

and the `saveBlob` call with:

```tsx
      saveBlob(
        await api.milestoneFile(
          bookingId,
          m.milestone,
          `milestone-${m.milestone}.jpg`,
          m.media_id,
        ),
      );
```

- [ ] **Step 3: Make the button test the frame, not the milestone**

Further down the same file, replace the spinner test:

```tsx
                      {downloading === m.milestone ? (
```

with:

```tsx
                      {downloading === frameKey(m) ? (
```

- [ ] **Step 4: Typecheck**

```bash
cd markai-Web-cms && npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run the frontend suite**

```bash
cd markai-Web-cms && npm test
```

Expected: all files pass (403 tests at time of writing). No new vitest file is added
here — the change is a query-string argument and a state key, both of which typecheck
covers and neither of which has extractable logic worth a module.

- [ ] **Step 6: Verify against the running stack**

With the backend on `:8095` and the CMS on `:5120`, open a campaign whose slot rotates
(one with 2+ creatives, e.g. the "12 frames in total" case). For **each** creative group:

1. Note the preview image on the "Start" tile.
2. Click its download icon.
3. Confirm the saved file matches that preview — not the first group's.
4. Confirm only the clicked tile shows a spinner.
5. Confirm the filenames of two different creatives' Start frames differ.

- [ ] **Step 7: Stop and report** — do not commit.

---

## Notes for the executor

- The DB is the source of truth here: `uq_screenshot_records_booking_milestone` is
  `(booking_id, shot_type, media_id)`. Any fix that does not put `media_id` in the WHERE
  clause is a symptom fix.
- Do not "helpfully" make `media_id` required. Old bookmarked download URLs carry none,
  and the 404 message in Task 1 Step 4 branches on it being absent.
- `_existing_milestone_record` is also called by the upload path (`_close_milestone_job`
  and the ingest guard). The `ORDER BY` added in Task 1 changes only WHICH row is returned
  when several match; every existing caller already passes `media_id` and matches at most
  one row, so their behaviour is unchanged.
