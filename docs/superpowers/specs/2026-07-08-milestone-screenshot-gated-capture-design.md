# Milestone Screenshot — Gated Capture (fix black-screen / wrong-ad shots)

**Date:** 2026-07-08
**Status:** Approved design, ready for implementation plan
**Components:** `markai-player-apk` (primary), `markai-signage-api` (secondary), `markai-Web-cms` (optional report surface)

## Problem

Each booking is supposed to produce **3 proof-of-play screenshots** — one at the
**start**, one at the **middle**, and one at the **end** of the campaign's date
window (e.g. 11 June → 15 June → 19 June). Operators are seeing three failures:

1. **Black screen at start** — the screenshot is captured on a gap/transition, not on the ad.
2. **Wrong ad** — the screenshot shows a different advertiser's ad.
3. **Wrong ad in the middle shot** — same as above, for the mid milestone.

### Root cause

Capture is fired **by the clock / heartbeat**, not by the ad. Today:

- The backend schedules the 3 milestones and, on each 60-second heartbeat,
  hands the screen any that are "due" (`get_pending_screenshot_jobs`,
  `screenshots/service.py:376`).
- The APK captures **whatever is on the glass at that heartbeat tick**
  (`PlayerService.kt:474-480` → `PlaybackBus.requestScreenshot`), ignoring the
  job's `media_id` and never checking what is actually playing.

Because each ad is only on screen for one ~10s slot per loop, a random 60s tick
usually lands on a different ad, a transition, or an empty/paused screen → black
or wrong-ad shots. `ScreenshotCapture` only rejects a *zero-sized* window
(`ScreenshotCapture.kt:81`), never an all-black frame.

The **milestone dates** (start/mid/end of the campaign window) are essentially
what we want. The bug is purely the **capture gating**.

## Desired behavior

For each booking, take **one** screenshot per milestone (start / middle / end),
where each:

- is timed to the milestone **date** at the booking's **play time-of-day**
  (or ~12:00 noon if the booking has no daily time window), **approximately** —
  exactness is explicitly not required;
- is captured **only when that specific ad is genuinely on the screen** — never
  black, never a different ad;
- if the ad never plays within a bounded catch-up window, is recorded as
  **missed** (no fake/black shot is ever uploaded).

The up-to-~1-minute lag (schedule propagation + one loop) is acceptable.

## Design

### Principle

Move the *trigger* of the capture from the clock to the **ad's real play event**.
The clock (backend milestone `scheduled_at`) only decides **when a milestone
becomes eligible**; the APK then **holds** that as a note and fires the single
capture the next time that booking's ad actually starts playing. This makes
black/wrong-ad shots structurally impossible.

### APK changes (`markai-player-apk`) — the core fix

1. **New in-memory note store** — `PendingMilestones` (a singleton object like
   `PlaybackBus`). Keyed by `bookingId`, holds the set of owed milestones
   (`start` / `mid` / `end`). Idempotent add (dedupe), so repeated heartbeat
   re-offers don't stack.

2. **Heartbeat stops capturing immediately.** In `PlayerService.sendHeartbeat`
   (`PlayerService.kt:474-480`), replace the immediate
   `PlaybackBus.requestScreenshot(...)` with
   `PendingMilestones.add(shot.bookingId, shot.milestone)`. Nothing is captured here.

3. **Capture on matching play.** In `PlaylistController.playCurrent`
   (`PlaylistController.kt:147`, right after the existing loop-screenshot block
   at :165-169), check `PendingMilestones` for the current item's booking
   (`item.scheduleId` == booking UUID for booking items). For each owed
   milestone:
   - schedule a **token-guarded** delayed capture (~1s in, so the frame is
     rendered, not mid-switch): capture the current `playToken`; after the
     delay, if `token != playToken` **abort** (ad switched/paused → note stays,
     retried next play);
   - otherwise fire capture via the existing callback
     `onScreenshotRequested(item.scheduleId, "milestone_$milestone")` — which
     already flows to `PlayerActivity.captureAndUploadScreenshot` → upload;
   - remove the milestone from the store when the capture is fired.
   - Tie the delayed-capture job to the same lifecycle as `slotTimerJob` so
     `pause()` / `stop()` / empty playlist cancel it.

4. **Black-frame safety net** (`ScreenshotCapture`): after PixelCopy, sample the
   bitmap; if it is effectively all-black, **skip the upload** and leave the note
   in the store (retried next play). Belt-and-suspenders behind the token guard.

5. **Honest `captured_at`** (`PlayerActivity.kt:140`): stamp it when PixelCopy
   *completes*, not when the request starts.

> Contract shapes are unchanged — `PendingScreenshot{booking_id, media_id,
> milestone}` and the `/api/playback/screenshot` upload stay identical. Only APK
> *behavior* changes.

### Backend changes (`markai-signage-api`)

1. **Milestone time = date @ play-time / noon.** Rework `_milestone_times`
   (`screenshots/service.py:127`): keep start-date / mid-date / end-date from
   `[start_at, end_at]`, but set each one's **time-of-day** to the booking's
   play time — `daily_start_minute` (or the first `daily_windows[].start`), else
   **720** (12:00 noon). Keep the "clamp past → now" behavior so a
   retro-created/toggled booking is picked up immediately.

2. **Bounded catch-up + missed marking.** Introduce `_MILESTONE_CATCHUP_HOURS`
   (default **24**). A milestone job is only offered while
   `now <= scheduled_at + CATCHUP_HOURS` (and, for `end`, not past booking
   `end_at` + short grace). Update `get_pending_screenshot_jobs`
   (`service.py:376`) to add the upper-bound check, and
   `process_screenshot_jobs` (`service.py:424`) to mark jobs past their catch-up
   window as **missed** instead of the current flat 7-day expiry.

3. **Record missed vs captured.** Add a `ScreenshotJob.missed` boolean
   (default false) + migration, set true when a job ages out un-uploaded. A
   captured job flips `sent=true` in `ingest_screenshot` (`service.py:349`,
   unchanged). This gives the CMS a clean start ✅ / mid ⚠️ / end ✅ view.

4. Leave the heartbeat re-offer path (`_JOB_REDELIVER_GRACE_MINUTES = 10`) as-is;
   it now serves as the durability net (re-adds the note to the APK store after
   an app restart) until the 24h catch-up window closes.

### CMS (optional, follow-up phase)

Extend the booking screenshots read (`get_booking_screenshots`) to also return
each milestone's status (captured / pending / missed) so the report shows the
per-milestone outcome rather than only the stored images.

## Edge cases

| Case | Behavior |
|------|----------|
| Schedule not yet propagated | Ad not in playlist → no match → note waits; fires on first play. |
| App restart before capture | Note lost in memory, but job `sent=false` → re-offered next heartbeat (≤10 min). |
| Another ad on screen at target time | Gate matches on `booking`/`media` → other ads ignored. |
| Screen off / empty playlist | No play event → nothing captured; token guard cancels any pending delay. |
| Ad never plays in 24h | Marked **missed**; no fake/black shot uploaded. |
| Very short slot (e.g. 2s) | ~1s start delay still lands inside the play; correct ad. |
| Booking end passes | `end` job past window → missed; store note aged out. |

## Non-goals

- No change to the 60s heartbeat interval or the schedule-reload mechanism.
- Not 3 shots per loop/play — exactly one shot per milestone across the campaign window.
- No exact-timestamp guarantee — "approximately at the milestone time" is the spec.
- The existing `screenshot_enabled` per-loop "2FA" shot path is untouched.

## Configurable knobs (defaults)

- Milestone play-time fallback: **12:00 (720 min)**.
- Catch-up window before "missed": **24 hours**.
- Start-capture render delay: **~1 second**.
- Black-frame detection threshold: near-100% black pixels.
