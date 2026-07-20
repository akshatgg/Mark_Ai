# Milestone Screenshot — Gated Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each booking's 3 milestone screenshots (start/mid/end of the campaign window) capture only while that specific ad is genuinely on screen — never black, never a different ad — and mark a milestone "missed" if the ad never plays in time.

**Architecture:** Move the capture *trigger* from the 60s heartbeat clock to the ad's real play event on-device. The backend still schedules the 3 milestones (now at the milestone-date @ the booking's play time-of-day, or noon) and hands them to the screen via the existing heartbeat `pending_screenshots`. The APK *holds* each as a note in a new `PendingMilestones` store and fires one token-guarded capture the next time that booking's ad starts playing. A 24h catch-up window bounds retries; un-captured milestones are marked missed.

**Tech Stack:** Backend — Python 3.12, FastAPI, async SQLAlchemy 2.0, Alembic, pytest (aiosqlite). APK — Kotlin, Media3/ExoPlayer, Coil, JUnit4 unit tests.

## Global Constraints

- **Do NOT change the APK↔backend REST contract shapes.** `PendingScreenshot{booking_id, media_id, milestone}` and `POST /api/playback/screenshot` (form: `booking_id`, `shot_type`, `captured_at`, `image`) stay identical. Only *behavior* changes.
- **Owner-fixed slot durations are untouched** — the fix reads `item.durationSeconds` / `scheduleId`, it does not set them.
- **shot_type strings are load-bearing** — uploads MUST use exactly `milestone_start` | `milestone_mid` | `milestone_end` (the backend maps `milestone_<x>` → job milestone `<x>` in `ingest_screenshot`).
- **Milestone values** are exactly `start` | `mid` | `end`.
- **Repo convention:** commits are made when the operator asks. Commit steps below are the standard TDD rhythm; the executor performs them as part of each task, but do not push.
- **Backend module-constant style** — new tunables live as module constants in `app/screenshots/service.py` (matching existing `_JOB_REDELIVER_GRACE_MINUTES`), not in `config.py`.

---

## File Structure

**Backend (`markai-signage-api`):**
- Modify `app/screenshots/service.py` — milestone time math, catch-up window, missed marking.
- Modify `app/screenshots/models.py` — add `ScreenshotJob.missed` column.
- Create `alembic/versions/0023_screenshot_job_missed.py` — migration for the column.
- Create `tests/test_screenshots.py` — unit tests for the above.

**APK (`markai-player-apk`):**
- Create `app/src/main/java/tech/markai/player/ui/PendingMilestones.kt` — the note store.
- Create `app/src/main/java/tech/markai/player/ui/BlackFrameDetector.kt` — pure black-frame check.
- Modify `app/src/main/java/tech/markai/player/ui/ScreenshotCapture.kt` — skip black frames.
- Modify `app/src/main/java/tech/markai/player/ui/PlayerActivity.kt` — stamp `captured_at` at capture completion.
- Modify `app/src/main/java/tech/markai/player/service/PlayerService.kt` — heartbeat holds notes.
- Modify `app/src/main/java/tech/markai/player/ui/PlaylistController.kt` — gated capture on play.
- Modify `app/src/main/java/tech/markai/player/util/Constants.kt` — capture delay constant.
- Create `app/src/test/java/tech/markai/player/ui/PendingMilestonesTest.kt` — store unit test.
- Create `app/src/test/java/tech/markai/player/ui/BlackFrameDetectorTest.kt` — detector unit test.

---

## Task 1: Backend — milestone time = milestone-date @ play-time / noon

**Files:**
- Modify: `markai-signage-api/app/screenshots/service.py:127-149` (`_milestone_times`)
- Test: `markai-signage-api/tests/test_screenshots.py`

**Interfaces:**
- Produces: `_milestone_times(booking: Booking) -> dict` returning `{"start": datetime, "mid": datetime, "end": datetime}`, each at the booking's play minute-of-day (UTC), clamped to `>= now`. Helper `_booking_play_minute(booking: Booking) -> int` (minutes 0..1439, default 720).

- [ ] **Step 1: Write the failing test**

Create `markai-signage-api/tests/test_screenshots.py`:

```python
from datetime import datetime, timezone

from app.bookings.models import Booking
from app.screenshots.service import _booking_play_minute, _milestone_times


def _booking(**kw) -> Booking:
    base = dict(
        id="b1", name="Camp", screen_id="s1", media_id="m1", schedule_type="continuous",
        start_at=datetime(2030, 6, 11, 0, 0, tzinfo=timezone.utc),
        end_at=datetime(2030, 6, 19, 0, 0, tzinfo=timezone.utc),
        daily_start_minute=None, daily_windows=None,
    )
    base.update(kw)
    return Booking(**base)


def test_play_minute_defaults_to_noon():
    assert _booking_play_minute(_booking()) == 720


def test_play_minute_uses_daily_start_minute():
    assert _booking_play_minute(_booking(daily_start_minute=600)) == 600


def test_play_minute_falls_back_to_daily_windows():
    b = _booking(daily_windows=[{"start": 1020, "end": 1080}])
    assert _booking_play_minute(b) == 1020


def test_milestone_times_snap_to_dates_at_noon():
    t = _milestone_times(_booking())
    assert t["start"].date() == datetime(2030, 6, 11).date()
    assert (t["start"].hour, t["start"].minute) == (12, 0)
    assert t["mid"].date() == datetime(2030, 6, 15).date()
    assert (t["mid"].hour, t["mid"].minute) == (12, 0)
    assert t["end"].date() == datetime(2030, 6, 19).date()
    assert (t["end"].hour, t["end"].minute) == (12, 0)


def test_milestone_times_use_play_time():
    t = _milestone_times(_booking(daily_start_minute=600))  # 10:00
    assert (t["mid"].hour, t["mid"].minute) == (10, 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_screenshots.py -q`
Expected: FAIL with `ImportError: cannot import name '_booking_play_minute'`.

- [ ] **Step 3: Write minimal implementation**

In `app/screenshots/service.py`, add near the other module constants (after line 41):

```python
# Milestone screenshots fire at this minute-of-day when the booking has no daily
# time window (12:00 noon). When it has one, its start minute is used instead.
_DEFAULT_PLAY_MINUTE = 12 * 60  # 720
```

Replace `_milestone_times` (lines 127-149) with:

```python
def _booking_play_minute(booking: Booking) -> int:
    """Minute-of-day (0..1439) at which this booking is meant to play — used to
    time its milestone screenshots. Prefers ``daily_start_minute``, then the
    first ``daily_windows`` entry, else noon."""
    if booking.daily_start_minute is not None:
        return int(booking.daily_start_minute)
    if booking.daily_windows:
        first = booking.daily_windows[0]
        if isinstance(first, dict) and first.get("start") is not None:
            return int(first["start"])
    return _DEFAULT_PLAY_MINUTE


def _milestone_times(booking: Booking) -> dict:
    """Compute the 3 milestone datetimes for a booking.

    - start: campaign start date, at the booking's play time-of-day (or noon)
    - mid:   midpoint date of [start_at, end_at], at the play time-of-day
    - end:   campaign end date, at the play time-of-day
    All clamped to >= now so a retro-created/toggled booking is picked up on the
    next heartbeat.
    """
    now = datetime.now(timezone.utc)

    def _tz(dt: datetime) -> datetime:
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    def _at_play(dt: datetime, minute: int) -> datetime:
        h, m = divmod(minute, 60)
        return dt.replace(hour=h, minute=m, second=0, microsecond=0)

    start = _tz(booking.start_at)
    end = _tz(booking.end_at)
    minute = _booking_play_minute(booking)

    start_dt = _at_play(start, minute)
    mid_dt = _at_play(start + (end - start) / 2, minute)
    end_dt = _at_play(end, minute)

    return {
        "start": max(start_dt, now),
        "mid": max(mid_dt, now + timedelta(seconds=5)),
        "end": max(end_dt, now + timedelta(seconds=10)),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd markai-signage-api && poetry run pytest tests/test_screenshots.py -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add markai-signage-api/app/screenshots/service.py markai-signage-api/tests/test_screenshots.py
git commit -m "feat(screenshots): time milestones at play time-of-day / noon"
```

---

## Task 2: Backend — add `ScreenshotJob.missed` column + migration

**Files:**
- Modify: `markai-signage-api/app/screenshots/models.py:68-76` (add column after `sent_at`)
- Create: `markai-signage-api/alembic/versions/0023_screenshot_job_missed.py`
- Test: `markai-signage-api/tests/test_screenshots.py`

**Interfaces:**
- Produces: `ScreenshotJob.missed: bool` (default False, non-null) — true when a milestone aged out un-captured.

- [ ] **Step 1: Write the failing test**

Append to `markai-signage-api/tests/test_screenshots.py`:

```python
import pytest
from app.screenshots.models import ScreenshotJob


def test_screenshot_job_missed_defaults_false():
    job = ScreenshotJob(booking_id="b1", screen_id="s1", media_id="m1",
                        milestone="start",
                        scheduled_at=datetime(2030, 1, 1, tzinfo=timezone.utc))
    # Column default applies on flush; unset attribute is None pre-flush, so
    # assert the mapped default is wired by checking the column default value.
    assert ScreenshotJob.__table__.c.missed.default.arg is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_screenshots.py::test_screenshot_job_missed_defaults_false -q`
Expected: FAIL with `AttributeError: ... has no attribute 'missed'` / `KeyError: 'missed'`.

- [ ] **Step 3: Write minimal implementation**

In `app/screenshots/models.py`, add after `sent_at` (line 71):

```python
    # True when the milestone aged out of its catch-up window without the ad
    # ever playing (no screenshot captured). Distinguishes a "missed" milestone
    # from a captured one (both have sent=True) for CMS reporting.
    missed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=func.false(), nullable=False
    )
```

Create `alembic/versions/0023_screenshot_job_missed.py`:

```python
"""screenshot_jobs.missed — milestone aged out without a capture

Revision ID: 0023_screenshot_job_missed
Revises: 0022_ai_chat_turns_media
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023_screenshot_job_missed"
down_revision: Union[str, Sequence[str], None] = "0022_ai_chat_turns_media"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "screenshot_jobs",
        sa.Column(
            "missed", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("screenshot_jobs", "missed")
```

> Verify `down_revision` matches the current head. Run `cd markai-signage-api && poetry run alembic heads`; if it is not `0022_ai_chat_turns_media`, set `down_revision` to the reported head.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd markai-signage-api && poetry run pytest tests/test_screenshots.py::test_screenshot_job_missed_defaults_false -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add markai-signage-api/app/screenshots/models.py markai-signage-api/alembic/versions/0023_screenshot_job_missed.py markai-signage-api/tests/test_screenshots.py
git commit -m "feat(screenshots): add ScreenshotJob.missed column + migration"
```

---

## Task 3: Backend — 24h catch-up window: stop offering + mark missed

**Files:**
- Modify: `markai-signage-api/app/screenshots/service.py` (constants; `get_pending_screenshot_jobs` at :376; `process_screenshot_jobs` at :424)
- Test: `markai-signage-api/tests/test_screenshots.py`

**Interfaces:**
- Consumes: `ScreenshotJob.missed` (Task 2), `_MILESTONE_CATCHUP_HOURS` constant.
- Produces: `get_pending_screenshot_jobs(db, screen_id)` only offers jobs with `now - CATCHUP <= scheduled_at <= now`. `process_screenshot_jobs(db)` sets `missed=True, sent=True` on jobs older than the catch-up window; returned dict keeps keys `processed, delivered, skipped_offline, expired` (`expired` = count marked missed).

- [ ] **Step 1: Write the failing test**

Append to `markai-signage-api/tests/test_screenshots.py`:

```python
from datetime import timedelta

from app.screenshots.service import (
    get_pending_screenshot_jobs,
    process_screenshot_jobs,
)


@pytest.mark.asyncio
async def test_fresh_job_is_offered(db_sessionmaker):
    now = datetime.now(timezone.utc)
    async with db_sessionmaker() as db:
        db.add(ScreenshotJob(booking_id="b1", screen_id="s1", media_id="m1",
                            milestone="start", scheduled_at=now - timedelta(hours=1)))
        await db.commit()
        out = await get_pending_screenshot_jobs(db, "s1")
    assert len(out) == 1
    assert out[0]["milestone"] == "start"


@pytest.mark.asyncio
async def test_stale_job_not_offered(db_sessionmaker):
    now = datetime.now(timezone.utc)
    async with db_sessionmaker() as db:
        db.add(ScreenshotJob(booking_id="b1", screen_id="s1", media_id="m1",
                            milestone="start", scheduled_at=now - timedelta(hours=25)))
        await db.commit()
        out = await get_pending_screenshot_jobs(db, "s1")
    assert out == []


@pytest.mark.asyncio
async def test_process_marks_stale_job_missed(db_sessionmaker):
    now = datetime.now(timezone.utc)
    async with db_sessionmaker() as db:
        db.add(ScreenshotJob(booking_id="b1", screen_id="s1", media_id="m1",
                            milestone="mid", scheduled_at=now - timedelta(hours=25)))
        await db.commit()
        result = await process_screenshot_jobs(db)
        job = (await db.execute(
            __import__("sqlalchemy").select(ScreenshotJob)
        )).scalars().one()
    assert result["expired"] == 1
    assert job.missed is True
    assert job.sent is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_screenshots.py -k "offered or missed" -q`
Expected: FAIL — `test_stale_job_not_offered` returns 1 job (no upper bound yet) and `test_process_marks_stale_job_missed` finds `job.missed is False` (7-day expiry, not 24h).

- [ ] **Step 3: Write minimal implementation**

In `app/screenshots/service.py`, replace the constant `_JOB_EXPIRY_HOURS = 168  # 7 days` (line 35) with:

```python
# A milestone is retried (offered on each heartbeat) for this long after its
# scheduled time. If the ad never plays within the window the milestone is
# marked missed — we never upload a black/stand-in frame.
_MILESTONE_CATCHUP_HOURS = 24
```

In `get_pending_screenshot_jobs` (around line 391), add the lower bound. Change:

```python
    now = datetime.now(timezone.utc)
    redeliver_cutoff = now - timedelta(minutes=_JOB_REDELIVER_GRACE_MINUTES)

    stmt = select(ScreenshotJob).where(
        and_(
            ScreenshotJob.screen_id == screen_id,
            ScreenshotJob.scheduled_at <= now,
            ScreenshotJob.sent.is_(False),
            or_(
                ScreenshotJob.delivered_at.is_(None),
                ScreenshotJob.delivered_at < redeliver_cutoff,
            ),
        )
    )
```

to:

```python
    now = datetime.now(timezone.utc)
    redeliver_cutoff = now - timedelta(minutes=_JOB_REDELIVER_GRACE_MINUTES)
    catchup_floor = now - timedelta(hours=_MILESTONE_CATCHUP_HOURS)

    stmt = select(ScreenshotJob).where(
        and_(
            ScreenshotJob.screen_id == screen_id,
            ScreenshotJob.scheduled_at <= now,
            ScreenshotJob.scheduled_at >= catchup_floor,  # stop retrying stale milestones
            ScreenshotJob.sent.is_(False),
            or_(
                ScreenshotJob.delivered_at.is_(None),
                ScreenshotJob.delivered_at < redeliver_cutoff,
            ),
        )
    )
```

In `process_screenshot_jobs` (lines 435-449), replace the expiry block:

```python
    now = datetime.now(timezone.utc)
    expiry_cutoff = now - timedelta(hours=_JOB_EXPIRY_HOURS)

    stmt = select(ScreenshotJob).where(
        and_(ScreenshotJob.scheduled_at <= now, ScreenshotJob.sent.is_(False))
    )
    jobs = (await db.execute(stmt)).scalars().all()

    expired = 0
    for job in jobs:
        job_sched = job.scheduled_at if job.scheduled_at.tzinfo else job.scheduled_at.replace(tzinfo=timezone.utc)
        if job_sched < expiry_cutoff:
            job.sent = True
            job.sent_at = now
            expired += 1
            logger.debug(
                "Screenshot job %s expired (booking=%s milestone=%s)",
                job.id,
                job.booking_id,
                job.milestone,
            )
```

with:

```python
    now = datetime.now(timezone.utc)
    catchup_cutoff = now - timedelta(hours=_MILESTONE_CATCHUP_HOURS)

    stmt = select(ScreenshotJob).where(
        and_(ScreenshotJob.scheduled_at <= now, ScreenshotJob.sent.is_(False))
    )
    jobs = (await db.execute(stmt)).scalars().all()

    expired = 0
    for job in jobs:
        job_sched = job.scheduled_at if job.scheduled_at.tzinfo else job.scheduled_at.replace(tzinfo=timezone.utc)
        if job_sched < catchup_cutoff:
            job.sent = True
            job.sent_at = now
            job.missed = True
            expired += 1
            logger.info(
                "Screenshot milestone missed (booking=%s milestone=%s) — ad never played in catch-up window",
                job.booking_id,
                job.milestone,
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd markai-signage-api && poetry run pytest tests/test_screenshots.py -q`
Expected: PASS (all tests). Then confirm nothing else broke: `poetry run pytest -q`.

- [ ] **Step 5: Commit**

```bash
git add markai-signage-api/app/screenshots/service.py markai-signage-api/tests/test_screenshots.py
git commit -m "feat(screenshots): 24h milestone catch-up window, mark missed instead of silent expiry"
```

---

## Task 4: APK — `PendingMilestones` note store

**Files:**
- Create: `markai-player-apk/app/src/main/java/tech/markai/player/ui/PendingMilestones.kt`
- Test: `markai-player-apk/app/src/test/java/tech/markai/player/ui/PendingMilestonesTest.kt`

**Interfaces:**
- Produces: `object PendingMilestones` with `add(bookingId, milestone)`, `take(bookingId): Set<String>` (returns + removes), `requeue(bookingId, milestone)`, `clear()`. Thread-safe.

- [ ] **Step 1: Write the failing test**

Create `markai-player-apk/app/src/test/java/tech/markai/player/ui/PendingMilestonesTest.kt`:

```kotlin
package tech.markai.player.ui

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingMilestonesTest {

    @After
    fun tearDown() = PendingMilestones.clear()

    @Test
    fun add_then_take_returnsOwedAndClears() {
        PendingMilestones.add("b1", "start")
        PendingMilestones.add("b1", "mid")
        val owed = PendingMilestones.take("b1")
        assertEquals(setOf("start", "mid"), owed)
        assertTrue("second take is empty", PendingMilestones.take("b1").isEmpty())
    }

    @Test
    fun add_isIdempotentPerMilestone() {
        PendingMilestones.add("b1", "start")
        PendingMilestones.add("b1", "start")
        assertEquals(setOf("start"), PendingMilestones.take("b1"))
    }

    @Test
    fun take_forUnknownBooking_isEmpty() {
        assertTrue(PendingMilestones.take("nope").isEmpty())
    }

    @Test
    fun requeue_reAddsMilestone() {
        PendingMilestones.add("b1", "end")
        PendingMilestones.take("b1")
        PendingMilestones.requeue("b1", "end")
        assertEquals(setOf("end"), PendingMilestones.take("b1"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-player-apk && ./gradlew testDebugUnitTest --tests "tech.markai.player.ui.PendingMilestonesTest"`
(If `./gradlew` is absent, run the test from Android Studio.)
Expected: FAIL — `PendingMilestones` unresolved.

- [ ] **Step 3: Write minimal implementation**

Create `markai-player-apk/app/src/main/java/tech/markai/player/ui/PendingMilestones.kt`:

```kotlin
package tech.markai.player.ui

import java.util.concurrent.ConcurrentHashMap

/**
 * In-memory store of owed milestone screenshots ("start" | "mid" | "end") keyed
 * by bookingId.
 *
 * The heartbeat ADDS owed milestones here instead of capturing immediately;
 * [PlaylistController] TAKES them when that booking's ad actually starts
 * playing — so a milestone screenshot is only ever captured while the correct
 * ad is genuinely on the glass (never black, never a different ad).
 *
 * Thread-safe: the heartbeat runs on the service scope while playback runs on
 * the main thread.
 */
object PendingMilestones {

    private val owed = ConcurrentHashMap<String, MutableSet<String>>()

    /** Record that [milestone] is owed for [bookingId]. Idempotent. */
    fun add(bookingId: String, milestone: String) {
        owed.compute(bookingId) { _, set ->
            (set ?: ConcurrentHashMap.newKeySet()).apply { add(milestone) }
        }
    }

    /** Return the milestones owed for [bookingId] and REMOVE them (they're about
     *  to be captured). Empty set if none owed. */
    fun take(bookingId: String): Set<String> {
        val set = owed.remove(bookingId) ?: return emptySet()
        return set.toSet()
    }

    /** Re-queue a milestone whose capture was aborted (ad switched/paused). */
    fun requeue(bookingId: String, milestone: String) = add(bookingId, milestone)

    fun clear() = owed.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd markai-player-apk && ./gradlew testDebugUnitTest --tests "tech.markai.player.ui.PendingMilestonesTest"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add markai-player-apk/app/src/main/java/tech/markai/player/ui/PendingMilestones.kt markai-player-apk/app/src/test/java/tech/markai/player/ui/PendingMilestonesTest.kt
git commit -m "feat(apk): add PendingMilestones note store for gated milestone capture"
```

---

## Task 5: APK — black-frame detector + skip on capture + honest captured_at

**Files:**
- Create: `markai-player-apk/app/src/main/java/tech/markai/player/ui/BlackFrameDetector.kt`
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/ui/ScreenshotCapture.kt` (both capture paths)
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/ui/PlayerActivity.kt:140-149`
- Test: `markai-player-apk/app/src/test/java/tech/markai/player/ui/BlackFrameDetectorTest.kt`

**Interfaces:**
- Produces: `object BlackFrameDetector { fun isMostlyBlack(pixels: IntArray, threshold: Double = 0.99, stride: Int = 17): Boolean }`. ScreenshotCapture returns `null` (skip upload) for a black frame.

- [ ] **Step 1: Write the failing test**

Create `markai-player-apk/app/src/test/java/tech/markai/player/ui/BlackFrameDetectorTest.kt`:

```kotlin
package tech.markai.player.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BlackFrameDetectorTest {

    private fun argb(r: Int, g: Int, b: Int) =
        (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    @Test
    fun allBlack_isBlack() {
        val px = IntArray(1000) { argb(0, 0, 0) }
        assertTrue(BlackFrameDetector.isMostlyBlack(px))
    }

    @Test
    fun allWhite_isNotBlack() {
        val px = IntArray(1000) { argb(255, 255, 255) }
        assertFalse(BlackFrameDetector.isMostlyBlack(px))
    }

    @Test
    fun halfBlack_isNotBlack_atDefaultThreshold() {
        val px = IntArray(1000) { i -> if (i < 500) argb(0, 0, 0) else argb(200, 200, 200) }
        assertFalse(BlackFrameDetector.isMostlyBlack(px))
    }

    @Test
    fun emptyPixels_treatedAsBlack() {
        assertTrue(BlackFrameDetector.isMostlyBlack(IntArray(0)))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-player-apk && ./gradlew testDebugUnitTest --tests "tech.markai.player.ui.BlackFrameDetectorTest"`
Expected: FAIL — `BlackFrameDetector` unresolved.

- [ ] **Step 3: Write minimal implementation**

Create `markai-player-apk/app/src/main/java/tech/markai/player/ui/BlackFrameDetector.kt`:

```kotlin
package tech.markai.player.ui

/**
 * Pure check for an "effectively all black" frame, used to skip uploading a
 * screenshot accidentally captured during a transition / blank screen. Kept
 * framework-free (operates on ARGB ints) so it is unit-testable off-device.
 */
object BlackFrameDetector {

    /**
     * True if at least [threshold] fraction of the sampled pixels are near-black.
     * Samples every [stride]-th pixel to stay cheap on large bitmaps. An empty
     * array is treated as black (nothing to prove it isn't).
     */
    fun isMostlyBlack(pixels: IntArray, threshold: Double = 0.99, stride: Int = 17): Boolean {
        if (pixels.isEmpty()) return true
        var sampled = 0
        var black = 0
        var i = 0
        while (i < pixels.size) {
            val p = pixels[i]
            val r = (p shr 16) and 0xFF
            val g = (p shr 8) and 0xFF
            val b = p and 0xFF
            if (r <= 16 && g <= 16 && b <= 16) black++
            sampled++
            i += stride
        }
        return sampled > 0 && black.toDouble() / sampled >= threshold
    }
}
```

In `ScreenshotCapture.kt`, add a private helper (after `saveBitmapToFile`, before the closing brace at line 126):

```kotlin
    /** Reads the bitmap's pixels and returns true if the frame is essentially black. */
    private fun isBlackFrame(bitmap: Bitmap): Boolean {
        val w = bitmap.width
        val h = bitmap.height
        if (w <= 0 || h <= 0) return true
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
        return BlackFrameDetector.isMostlyBlack(pixels)
    }
```

In `captureWithPixelCopy`, replace the `PixelCopy.SUCCESS` branch (lines 91-94):

```kotlin
                if (result == PixelCopy.SUCCESS) {
                    val path = saveBitmapToFile(bitmap, context, bookingId, shotType)
                    // saveBitmapToFile recycles the bitmap on success and on I/O failure.
                    callback(path)
                } else {
```

with:

```kotlin
                if (result == PixelCopy.SUCCESS) {
                    if (isBlackFrame(bitmap)) {
                        Logger.w("Screenshot skipped — black/blank frame ($shotType)")
                        bitmap.recycle()
                        callback(null)
                        return@request
                    }
                    val path = saveBitmapToFile(bitmap, context, bookingId, shotType)
                    // saveBitmapToFile recycles the bitmap on success and on I/O failure.
                    callback(path)
                } else {
```

> Note: `return@request` labels the PixelCopy callback lambda. If the compiler rejects the label, restructure the branch as an `if/else` (no early return) — capture only when `!isBlackFrame(bitmap)`, else recycle + `callback(null)`.

In `captureWithDrawingCache`, replace lines 57-60:

```kotlin
            val bitmap = Bitmap.createBitmap(src)
            decorView.isDrawingCacheEnabled = false
            val path = saveBitmapToFile(bitmap, context, bookingId, shotType)
            callback(path)
```

with:

```kotlin
            val bitmap = Bitmap.createBitmap(src)
            decorView.isDrawingCacheEnabled = false
            if (isBlackFrame(bitmap)) {
                Logger.w("Screenshot skipped — black/blank frame ($shotType)")
                bitmap.recycle()
                callback(null)
                return
            }
            val path = saveBitmapToFile(bitmap, context, bookingId, shotType)
            callback(path)
```

In `PlayerActivity.kt`, change `captureAndUploadScreenshot` (lines 140-149) so `captured_at` is stamped at capture completion, not before:

```kotlin
    private fun captureAndUploadScreenshot(bookingId: String, shotType: String) {
        ScreenshotCapture.captureToFile(window, this, bookingId, shotType) { filePath ->
            if (filePath != null) {
                val capturedAt = ProofOfPlayLogger.nowIso()  // stamp when the frame is actually captured
                ScreenshotUploadWorker.enqueue(this, filePath, bookingId, shotType, capturedAt)
            } else {
                Logger.w("Screenshot capture failed/skipped: $shotType / booking=$bookingId")
            }
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd markai-player-apk && ./gradlew testDebugUnitTest --tests "tech.markai.player.ui.BlackFrameDetectorTest"`
Expected: PASS (4 tests). Then compile-check: `./gradlew compileDebugKotlin` → BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add markai-player-apk/app/src/main/java/tech/markai/player/ui/BlackFrameDetector.kt markai-player-apk/app/src/main/java/tech/markai/player/ui/ScreenshotCapture.kt markai-player-apk/app/src/main/java/tech/markai/player/ui/PlayerActivity.kt markai-player-apk/app/src/test/java/tech/markai/player/ui/BlackFrameDetectorTest.kt
git commit -m "feat(apk): skip black-frame screenshots; stamp captured_at at capture time"
```

---

## Task 6: APK — heartbeat holds notes; capture only when the owed ad plays

**Files:**
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/util/Constants.kt` (add delay constant)
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/service/PlayerService.kt:474-480`
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/ui/PlaylistController.kt:147-169`

**Interfaces:**
- Consumes: `PendingMilestones` (Task 4), `onScreenshotRequested(bookingId, shotType)` (existing callback wired to capture in `PlayerActivity`), `MILESTONE_CAPTURE_DELAY_MS` constant.
- Produces: gated capture — a milestone screenshot fires ~1s into a confirmed play of the owed booking, token+pause guarded.

- [ ] **Step 1: Add the capture-delay constant**

In `markai-player-apk/app/src/main/java/tech/markai/player/util/Constants.kt`, add near the other timing constants (alongside `HEARTBEAT_INTERVAL_MS`):

```kotlin
    /** Delay after an ad becomes the live frame before grabbing a milestone
     *  screenshot — lets the frame render so we don't capture a mid-switch/blank. */
    const val MILESTONE_CAPTURE_DELAY_MS: Long = 1_000L
```

- [ ] **Step 2: Heartbeat holds notes instead of capturing**

In `PlayerService.kt`, add the import at the top with the other `tech.markai.player.ui` imports:

```kotlin
import tech.markai.player.ui.PendingMilestones
```

Replace the pending-screenshots loop (lines 474-480):

```kotlin
            // Milestone screenshots are delivered via the heartbeat (the WebSocket
            // take_screenshot push was removed). Hand each due one to the activity,
            // which captures + uploads it; the backend marks the job done on upload.
            for (shot in response.pendingScreenshots) {
                Logger.i("Heartbeat screenshot booking=${shot.bookingId} milestone=${shot.milestone}")
                PlaybackBus.requestScreenshot(shot.bookingId, "milestone_${shot.milestone}")
            }
```

with:

```kotlin
            // Milestone screenshots are delivered via the heartbeat but NOT captured
            // here — capturing on the beat grabs whatever is on the glass (often a
            // different ad or a black transition). Instead we record the owed
            // milestone; PlaylistController fires the capture the next time THIS
            // booking's ad actually plays, so the shot is always the right ad.
            for (shot in response.pendingScreenshots) {
                Logger.i("Heartbeat milestone owed booking=${shot.bookingId} milestone=${shot.milestone}")
                PendingMilestones.add(shot.bookingId, shot.milestone)
            }
```

- [ ] **Step 3: Gated capture in `playCurrent`**

In `PlaylistController.kt`, add the import:

```kotlin
import tech.markai.player.util.Constants
```

In `playCurrent()`, immediately after the existing loop-screenshot block (after line 169, before the multi-zone block at line 171), insert:

```kotlin
        // Milestone screenshots: capture ONLY when this booking's ad is genuinely
        // on screen. Fire ~1s in (frame rendered), guarded by playToken + paused
        // so an ad switch / screen-off before the shot cancels it and re-queues
        // the milestone for the next real play. bookingId == item.scheduleId.
        val owedMilestones = PendingMilestones.take(item.scheduleId)
        if (owedMilestones.isNotEmpty()) {
            val captureToken = playToken
            for (milestone in owedMilestones) {
                scope.launch {
                    delay(Constants.MILESTONE_CAPTURE_DELAY_MS)
                    if (captureToken != playToken || paused) {
                        // Ad switched or screen went dark before we could shoot —
                        // re-queue so the next real play of this ad captures it.
                        PendingMilestones.requeue(item.scheduleId, milestone)
                        return@launch
                    }
                    onScreenshotRequested(item.scheduleId, "milestone_$milestone")
                }
            }
        }
```

- [ ] **Step 4: Compile + unit tests**

Run: `cd markai-player-apk && ./gradlew compileDebugKotlin testDebugUnitTest`
Expected: BUILD SUCCESSFUL; all unit tests pass.

- [ ] **Step 5: Manual emulator verification (behavior — cannot be unit-tested)**

The capture path uses Android framework classes, so verify on the emulator against a local backend (see root `CLAUDE.md` for run steps):

1. Start backend + create two bookings on one screen (e.g. "Pizza" and "Burger"), with Pizza's campaign window `start_at` = today so its `start` milestone is due now.
2. Run the APK on the emulator; watch Logcat:
   - Expect `Heartbeat milestone owed booking=<pizza> milestone=start` on a heartbeat.
   - Expect NO capture while Burger is on screen.
   - When Pizza plays, expect `Screenshot saved ... milestone_start` ~1s into Pizza's slot.
3. In the CMS booking screenshots view (or DB `screenshot_records`), confirm the `milestone_start` image shows **Pizza**, not Burger, and is not black.
4. Force a black case: set the screen to an empty schedule window; confirm any owed milestone is NOT captured (no black upload) and the job later shows `missed=true` after 24h (or temporarily lower `_MILESTONE_CATCHUP_HOURS` to test).

Record the Logcat lines and the CMS image as evidence.

- [ ] **Step 6: Commit**

```bash
git add markai-player-apk/app/src/main/java/tech/markai/player/util/Constants.kt markai-player-apk/app/src/main/java/tech/markai/player/service/PlayerService.kt markai-player-apk/app/src/main/java/tech/markai/player/ui/PlaylistController.kt
git commit -m "feat(apk): capture milestone screenshots only when the owed ad is on screen"
```

---

## Task 7 (optional, follow-up): CMS — surface per-milestone status

**Files:**
- Modify: `markai-signage-api/app/screenshots/service.py` (`get_booking_screenshots`) + its schema/router
- Modify: `markai-Web-cms` booking screenshots view

**Interfaces:**
- Produces: the booking screenshots read also returns each milestone's status: `captured` (has a `ScreenshotRecord` / `sent && !missed`), `pending` (`!sent`), or `missed` (`missed`).

- [ ] **Step 1:** Extend `get_booking_screenshots` to also query `ScreenshotJob` rows for the booking and return `[{milestone, status}]` alongside the records. Add tests in `tests/test_screenshots.py` asserting a missed job surfaces as `missed` and an uploaded one as `captured`.
- [ ] **Step 2:** Add the field to the response schema + CMS view (start ✅ / mid ⚠️ missed / end ✅).
- [ ] **Step 3:** Commit.

> This task is independent of the core fix (Tasks 1–6) and can be scheduled separately. It is listed for completeness of the spec's optional CMS surface.

---

## Self-Review — spec coverage

- Milestone time = date @ play-time / noon → **Task 1** ✔
- Capture only when the owed ad plays (heartbeat holds, playCurrent fires) → **Tasks 4, 6** ✔
- Never black (token+pause guard + black-frame skip) → **Tasks 5, 6** ✔
- Never wrong ad (match on `item.scheduleId` == booking) → **Task 6** ✔
- 24h catch-up window; mark missed, never fake → **Tasks 2, 3** ✔
- Honest `captured_at` → **Task 5** ✔
- Contract shapes unchanged → enforced in Global Constraints; no DTO/endpoint changes in any task ✔
- Optional CMS per-milestone status → **Task 7** ✔
- Edge cases (schedule not propagated, restart re-offer, screen-off, short slot, end passed) → covered by the hold-and-fire-on-play design (Task 6) + backend re-offer/catch-up (Task 3); manual verification in Task 6 Step 5 ✔
