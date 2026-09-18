# On-Demand Screenshot Capture ("Capture now")

**Date:** 2026-07-23
**Status:** Approved design
**Components:** `markai-signage-api` (primary), `markai-Web-cms` (UI). **No APK change.**

## Problem

Today a campaign is photographed only at three fixed points on its own timeline —
the start / mid / end milestones. An operator who wants to see *right now* what a
given ad looks like on the glass has no way to ask for a frame; they must wait for
the next milestone, which may be days away.

## Desired behavior

An operator opens a campaign and clicks **Capture now**. Nothing is photographed at
that instant. The request is parked and the screen takes the frame **the next time
that exact ad genuinely plays** — the same gated capture milestones already use, so
the frame is never black and never a different advertiser's ad. The frame carries
the same live location overlay as a milestone shot, and appears in the CMS directly
below the Milestones strip.

If the ad has not played within **30 minutes**, the request gives up and is shown as
**Not captured**.

## Design

### Principle

This is the milestone pipeline with a different *trigger*. A milestone job is armed
by a point on the campaign's timeline; an on-demand job is armed by an operator's
click. Everything downstream — heartbeat delivery, the APK's park-then-shoot-on-play
behaviour, `CaptureGuard`, the overlay, the upload — is reused verbatim, so the hard
guarantees (right ad, lit panel, not black, re-checked when the pixels land) are
inherited rather than rebuilt.

### Why no APK change is needed

The player derives its upload `shot_type` from the job's milestone name:
`CaptureGuard.shotTypesFor` builds `"milestone_$milestone"`. A job delivered with
`milestone = "ondemand"` therefore flows through the deployed fleet untouched:

- `PlayerService.sendHeartbeat` → `PendingMilestones.add(bookingId, "ondemand")`
- `PlaylistController.playCurrent` → owes `"milestone_ondemand"` for that slot
- shutter fires on the real render callback, behind the full `CaptureGuard`
- `CaptureGuard.milestoneOf("milestone_ondemand")` → `"ondemand"`, so requeue-on-
  failure and the unique-work naming both keep working
- upload posts `shot_type = "milestone_ondemand"`

The backend accepts both `milestone_ondemand` (what today's fleet sends) and
`ondemand` (what a future build could send) and **stores the canonical `ondemand`**.

### Data model (`screenshot_jobs`, migration `0035`)

Three nullable columns; milestone rows leave all three null.

| Column | Purpose |
|---|---|
| `expires_at` | `now + 30 min` at click. Stops delivery and drives the give-up. |
| `requested_by_user_id` | Who asked (FK `cms_users`, `ON DELETE SET NULL`). |
| `screenshot_record_id` | The frame this request produced (FK `screenshot_records`, `ON DELETE SET NULL`). Makes the CMS read a straight join instead of pairing by timestamp. |

The partial unique index on `screenshot_records` widens from
`shot_type <> 'loop'` to `shot_type NOT IN ('loop','ondemand')`, so a booking can
hold many on-demand frames. Milestones keep their one-frame-forever guarantee.

`ScreenshotJob.milestone` gains a fourth value, `"ondemand"`. It is deliberately
*not* added to `_MILESTONES`, so nothing that iterates the three milestones — the
CMS milestone strip, `rearm_milestone_jobs`, `_create_milestone_jobs` — ever sees it.

### Request lifecycle

**Click.** `POST /api/cms/bookings/{id}/screenshot-request` inserts one job with
`milestone="ondemand"`, `scheduled_at=now`, `expires_at=now+30min`. It does **not**
bump `schedule_updated_at`: job delivery rides the heartbeat independently of the
schedule, so there is no reason to make the screen re-download its playlist.

**Gate.** The backend refuses (409) unless the ad is genuinely in rotation. The
check is server-side and authoritative; the button state is convenience only:

| Order | Condition | `blocked_reason` |
|---|---|---|
| 1 | status cancelled/completed, or `end_at` passed | `campaign_ended` |
| 2 | status paused | `campaign_paused` |
| 3 | screen status `off_hours` | `outside_play_hours` |
| 4 | screen status `display_off` | `screen_display_off` |
| 5 | screen status not `online` | `screen_offline` |
| 6 | `_booking_active_now` false (weekday / daily window) | `outside_play_hours` |
| 7 | an on-demand job is already open | `request_open` |

Steps 3–6 reuse `screens.service.compute_status`, `screen_on_now` and
`_booking_active_now` — the same helpers playback itself gates on. The rule is never
re-implemented in the CMS, which is why the frontend renders a server-supplied
`can_request` + `blocked_reason` rather than deriving them.

**One at a time.** A booking may hold at most one *open* job (`sent=False`,
`missed=False`, `expires_at > now`). Unlimited requests over the campaign's life.

**Delivery.** `get_pending_screenshot_jobs` gains one condition —
`expires_at IS NULL OR expires_at > now` — so an expired request is never offered.
Milestone jobs have a null `expires_at` and are unaffected. First offer lands within
one heartbeat (≤60 s).

**Capture + upload.** `shot_type` normalises to `ondemand`. The frame gets the live
GPS/WiFi → reverse-geocode → stamped overlay (`_annotate_milestone`, unchanged), is
forced to **Cloudinary** (`use_gcs` requires `milestone_`, which the canonical name no
longer matches), and lands under `markai/screenshots/ondemand/{booking_id}/`. On
insert the job is closed: `sent=True`, `sent_at=now`, `screenshot_record_id=<row>`.

An upload arriving with no open job — i.e. after the 30 minutes elapsed — is rejected
**409**, which the deployed `ScreenshotUploadWorker` already treats as "drop, do not
retry" and which releases its in-flight hold. So a late frame is discarded rather
than contradicting a "Not captured" the CMS has already shown.

**Cancel.** `DELETE /api/cms/bookings/{id}/screenshot-request` deletes the open job
row outright. A withdrawn request is not a missed one, and deleting it needs no extra
column and leaves no misleading history.

**Giving up.** Expiry is honoured in two places, mirroring how booking completion is
already handled: computed on read (so the CMS is never stale) and persisted by the
hourly `process-screenshot-jobs` cron, which now also retires
`milestone='ondemand' AND expires_at < now` as `sent=True, missed=True`.

### Retention

On-demand frames are an operational spot-check, not billing evidence, so they die
with the campaign's bulk data rather than living forever:

- `cleanup_expired_screenshots` (runs `CAMPAIGN_CLEANUP_AFTER_DAYS` = 15 after the
  campaign is rolled up) deletes the Cloudinary prefix
  `markai/screenshots/ondemand/{booking_id}/` alongside `loop/{booking_id}/`;
- its row delete widens from `shot_type == 'loop'` to `shot_type IN ('loop','ondemand')`;
- the on-demand **job** rows are deleted too, so the history disappears together with
  the images instead of leaving "captured" rows pointing at nothing.

The three milestone frames remain untouched and permanent.

Trade-off accepted: a Cloudinary URL is a plain public link, whereas GCS milestone
frames are served through short-lived signed URLs. On-demand frames are therefore
guessable-if-leaked in a way milestone frames are not. This is a deliberate choice —
Cloudinary is what makes the bulk delete cheap.

### API surface

```
POST   /api/cms/bookings/{id}/screenshot-request   → OnDemandRequestResponse
DELETE /api/cms/bookings/{id}/screenshot-request   → {cancelled: bool}
GET    /api/cms/bookings/{id}/screenshots          → + "ondemand" block
```

The GET response gains:

```jsonc
"ondemand": {
  "can_request": false,
  "blocked_reason": "request_open",   // null when can_request
  "ttl_minutes": 30,
  "captures": [
    { "id", "status": "captured|pending|missed",
      "requested_at", "expires_at", "captured_at",
      "url", "requested_by_email" }
  ]
}
```

`captures` is newest-first and includes the open request (as `pending`), so the CMS
renders the whole story from one read.

### CMS

On the booking detail page's existing **Screenshot verification** card:

- a **Capture now** button beside the per-play toggle, enabled only when
  `can_request` is true and labelled with the reason when it is not
  (`Screen offline`, `Campaign paused`, `Outside play hours`, `Campaign ended`);
- while a request is open: `Waiting for the ad's next play — expires in N min`, with
  a **Cancel** control, and a poll every 15 s so the frame appears by itself;
- an **On-demand captures** list directly below the Milestones strip — newest first,
  thumbnail, IST capture time, requester email; expired requests render as a
  **Not captured** row rather than vanishing.

Permissions: superadmin, or the screenowner assigned to that screen — the rule
`toggle_screenshot` already enforces.

## Edge cases

| Case | Behavior |
|---|---|
| Ad plays 5 s after the click | Frame lands on that play; card flips to captured on the next poll. |
| Screen drops offline right after the click | No play, no capture; request expires at 30 min → Not captured. |
| Upload fails repeatedly | APK requeues, retries on subsequent plays until the 30 minutes elapse. |
| Frame uploaded at minute 31 | 409; frame dropped, hold released, CMS keeps showing Not captured. |
| Operator double-clicks | Second call 409s (`request_open`); button is already disabled. |
| Campaign cancelled while a request is open | Cron retires it as missed on the next sweep; read path already shows missed. |
| Stale creative on the screen | Existing `media_id` 409 applies unchanged. |
| Campaign pruned after 15 days | On-demand images, records and job rows all removed together. |

## Non-goals

- No change to the milestone timeline, the 3-milestone guarantee, or the per-play toggle.
- No APK release. (A future build may send `shot_type = "ondemand"` directly; the
  backend already accepts it.)
- No capture from a screen page or of "whatever is playing" — a request is always tied
  to one booking's creative.
- No push channel. Delivery latency is one heartbeat, as everywhere else.

## Configurable knobs

- On-demand TTL: **30 minutes** (`_ONDEMAND_TTL_MINUTES`).
- Retention: `CAMPAIGN_CLEANUP_AFTER_DAYS` (**15**), shared with loop frames.
- Re-offer throttle: `_JOB_REDELIVER_GRACE_MINUTES` (**10**), shared with milestones.
