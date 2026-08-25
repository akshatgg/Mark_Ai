# Creative rotation — one slot, many creatives, a different one each loop pass

**Date:** 2026-08-24
**Status:** PLAN ONLY — nothing implemented.
**Repos:** `markai-signage-api` (model + contract + attribution), `markai-player-apk`
(rotation engine — **this feature genuinely requires an APK release**, the first one
that does), `markai-Web-cms` (booking form + displays).

## What the client is asking for, restated

A client has N creatives (say 5) but buys **one slot**. The slot always shows that
client's campaign, but a **different creative on each pass of the loop**:

```
loop pass 1:  [other ads…]  [client: ad A]  [other ads…]
loop pass 2:  [other ads…]  [client: ad B]  [other ads…]
…
loop pass 5:  [other ads…]  [client: ad E]  [other ads…]
loop pass 6:  [other ads…]  [client: ad A]  ← wraps around
```

Today `bookings.media_id` is a single column — one booking, one creative — so 5
creatives cost 5 slots and all play every pass. The feature is **N creatives inside
one booking, rotated one-per-pass**, keeping every existing rule: the slot owns the
seconds, the booking owns the schedule window, billing counts plays for the booking.

## The one decision everything else follows from

**Rotation must happen ON THE PLAYER.** Only the player knows when a loop pass
happens. The backend hears from the screen every 60s while a loop is ~90s and
drifting (video lengths, window gating) — it can never say "this pass, show B."
Any server-side rotation degrades into time-slicing ("B for the next 5 minutes"),
which is NOT what was asked. So: the backend describes the creative SET; the player
walks it. This is why an APK release is unavoidable here, unlike our recent features.

## Verified architecture facts the design leans on

1. **Proof-of-play rows already carry `booking_id`** (seen live on the ohm box;
   `ProofOfPlayDto.bookingId`, attribution's `booking_id_col` path). Billing a
   booking does NOT depend on which creative played — the media-match is only the
   LEGACY fallback for old rows (`attribution.py:269`). Rotation is billing-safe
   by construction for every current player.
2. **`ScheduleItem` has a precedent for optional, backward-compatible fields**:
   `layout` ships as null-default — "old APK versions receiving null behave
   identically". `creatives` follows the same pattern.
3. The player caches media by id and **prunes anything not in the schedule's
   keep-set** (`cache.prune(keep)`, `Downloader.enqueueForSchedule`). Both walk
   `item.mediaId` + layout zones today — if they don't learn about rotation
   creatives, creatives B–E get **evicted while on rotation**. This is the #1
   lurking bug; it's called out in the scenario matrix.
4. Milestone/on-demand screenshot ingest **rejects a frame whose `media_id`
   differs from `booking.media_id` (409 "stale creative")**
   (`screenshots/service.py:1532`). With rotation, a frame of creative B is a
   VALID proof — the check must widen to "any of the booking's creatives".
5. The AI co-pilot, Gmail importer, and partner `/api/ext` all create bookings
   with a single `media_id` — they must keep working unchanged (a one-creative
   booking is just N=1).

## Data model

New table `booking_creatives` (migration):

```
booking_creatives
  id            uuid pk
  booking_id    fk bookings.id  ON DELETE CASCADE
  position      int             -- rotation order, 0-based
  media_id      fk media_assets.id
  UNIQUE (booking_id, position)
```

`bookings.media_id` **stays and stays meaningful**: it is creative #0 (the
primary), which keeps every legacy read, the old-APK degraded mode, and all
existing attribution/screenshot code paths anchored. Invariant enforced in the
service layer: a booking's `media_id` always equals its `booking_creatives`
row at position 0; a single-creative booking simply has one row (or none —
treated as `[media_id]`).

## Contract change (additive, null-safe)

`ScheduleItem` gains:

```json
"creatives": [
  {"media_id": "...", "media_url": "...", "media_type": "image"},
  ...
]
```

- Sent only when the booking has >1 creative; **omitted otherwise** (old players
  and single-creative bookings see byte-identical payloads).
- `media_id`/`media_url`/`media_type` on the item remain creative #0 — an old APK
  plays the primary creative every pass. Degraded but correct: the client's ad
  airs every pass; rotation arrives with the fleet update.
- Signed URLs, like the main media.

## Player (APK v1.2.0)

- **Rotation state**: a per-`scheduleId` counter in prefs
  (`rotation:{scheduleId} -> k`). When the playlist reaches an item with
  `creatives`, it plays `creatives[k % creatives.size]` then increments the
  persisted counter. Keying by scheduleId (= booking id) and persisting means:
  - a schedule reload (heartbeat `reload_needed`, 3-min refresh) does NOT reset
    rotation — without persistence, edit-heavy periods would starve creatives
    B–E forever;
  - a reboot resumes where it left off;
  - the counter only advances on an ACTUAL play, so passes where the booking is
    window-gated don't skip creatives.
  - `% size` at read time makes adding/removing creatives self-healing.
- **Cache + downloader**: `enqueueForSchedule` and the prune keep-set include
  every rotation creative (fact 3). Prefetch ALL creatives up front — a rotation
  must never stall on a cold download mid-pass; an uncached creative is skipped
  for this pass (play the next cached one) rather than showing black.
- **Proof of play**: unchanged — it already logs the ACTUAL `media_id` played
  plus `booking_id`, so per-creative counts fall out for free.
- **Screenshots**: one required player change (VERIFIED, not optional):
  `CaptureGuard.mayCapture` demands `currentMediaId == owed.mediaId`
  (`CaptureGuard.kt:133`) and the pending job carries only the PRIMARY media id —
  under rotation a milestone would NEVER capture while creatives B–E are up.
  Relax the media equality to the booking match that is already checked one line
  above (`currentBookingId == owed.bookingId`); the media check's purpose —
  refusing a stale creative — is preserved because any rotation member IS the
  booking's current ad. The upload still reports the real on-glass `media_id`.
- **Video**: each creative is capped at the slot length by the existing
  token-guarded timer; images run the slot length. Mixed image/video sets work
  with zero new logic.

## Backend blast radius (each is a small, targeted change)

| Area | Change |
|---|---|
| `get_schedule_items` | join `booking_creatives`, emit `creatives[]` when >1 |
| Screenshot ingest 409 (`:1532`) | accept any of the booking's creative ids |
| Milestone job offer / `media_id` echo | VERIFIED: `PendingScreenshot` carries one `media_id` and the player requires an exact match (`CaptureGuard.kt:133`) — without the APK relax + ingest widening, rotation bookings capture NO milestones. Both fixes are in this plan (player section + ingest row above) |
| `attribution.matches_row` legacy path (`:245`, `:269`) | `media_id IN (booking's creatives)` instead of `==` — only affects pre-booking_id rows |
| Rollup / `_apply_late_plays` / dashboard counts | they ride `attributable` + booking_id — re-verify each query's media filter, widen where present |
| Booking create/update (CMS + AI + Gmail + ext) | optional `media_ids: [..]`; single `media_id` keeps working (N=1). Creative set edits bump `schedule_updated_at` |
| Booking response | include the creative list + per-creative play counts (PoP already distinguishes them) |
| Creative-Fit / content validation | each creative validated like today's single one (type, resolution) |

## CMS

- **New-booking form**: the media picker becomes multi-select with an ordered
  list (drag to set rotation order). One creative = exactly today's flow.
- **Booking detail**: creative strip (thumbnails, rotation order, per-creative
  plays); screenshots labelled with which creative was captured.
- **Slot grid**: an occupant with rotation shows "5 creatives · rotates each
  pass" under the campaign name. No structural change — still one slot.

## Scenario matrix (the "no bugs" list)

| # | Scenario | Behavior |
|---|---|---|
| 1 | 5 creatives, loop runs all day | A,B,C,D,E,A,… one per pass, counter persisted |
| 2 | Schedule reloads mid-rotation (operator edit) | counter persisted per booking → rotation continues, no reset |
| 3 | Screen reboots / player restarts | prefs survive → resumes at next creative |
| 4 | Booking window closes for the night | counter frozen (advances only on real plays); morning resumes in order |
| 5 | Creative added/removed mid-flight | `schedule_updated_at` bump → reload; `k % newN` self-heals; removed creative's cache pruned |
| 6 | One creative fails to download | that pass plays the next CACHED creative; never black; retried by the downloader |
| 7 | Old APK (v1.1.x) on a rotation booking | plays creative #0 every pass — campaign still airs; CMS "Update now" closes the gap |
| 8 | Old backend + new APK | no `creatives` field → single-creative behavior, unchanged |
| 9 | Proof of play / billing | rows carry booking_id + actual media_id → booking totals correct, per-creative breakdown free |
| 10 | Legacy PoP rows (no booking_id) | widened `IN (creatives)` match; no play lost, no cross-booking bleed beyond today's documented overlap caveat |
| 11 | Milestone screenshot fires during pass showing creative C | frame accepted (any-of check), labelled with C; still one frame per milestone |
| 12 | On-demand "Capture now" | same — shoots whichever creative next plays; 409 only for media NOT in the booking |
| 13 | Same rotation booking on 2 screens | independent counters per screen — each screen rotates through all creatives |
| 14 | Move/swap the booking's slot (new rearrange feature) | rotation unaffected — position changes, scheduleId doesn't |
| 15 | Two rotation bookings on one screen | independent counters keyed by scheduleId |
| 16 | Cache pressure (2 GiB cap) | keep-set includes all creatives of all bookings; prune can't evict a rotation member |
| 17 | Video creative longer than slot | capped at slot length (existing timer), like any video today |
| 18 | AI/Gmail/ext create single-media booking | N=1 path, byte-identical behavior |

## Rollout order (each step safe alone)

1. **Backend** — migration + creative set CRUD + schedule `creatives[]` +
   widened attribution/screenshot checks. Fully backward compatible; nothing
   rotates yet.
2. **APK v1.2.0** — rotation engine + cache keep-set + persisted counters.
   Deployed per-screen via the existing updater; un-updated screens degrade to
   creative #0.
3. **CMS** — multi-creative booking form + displays. Ships last so operators
   can only create rotation bookings once screens can honor them (or with a
   visible "requires player v1.2+" note per screen using `app_version_code`).

## Explicitly out of scope (first cut)

- Weighted rotation ("A twice as often as B") — the model (`position` order)
  extends to weights later without migration pain.
- Per-creative schedules inside one booking (different windows per creative) —
  that is N bookings, which already exists.
- Rotation for owner loop items — same mechanism would apply; do bookings first.
