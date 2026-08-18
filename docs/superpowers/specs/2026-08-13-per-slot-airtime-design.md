# Per-slot airtime — an editable slot grid per screen

**Date:** 2026-08-13
**Scope:** `markai-signage-api` + `markai-Web-cms` only. `markai-frontend-new` is
deliberately untouched and must keep working unchanged. **No APK release.**

## The problem

A screen's loop was one length for everybody. `screens.slot_duration_seconds`
forced *every* ad — booking, owner loop item, legacy schedule, image or video —
to play for exactly that long, and `screens.loop_duration_seconds` declared when
the loop restarted. Capacity was the division of the two.

A screenowner cannot run two ads of different lengths on one screen. That is the
whole request.

## What was built

A screen now owns a **grid of slots**. Each slot has its own airtime. The loop
is their **sum**, so lengthening one slot lengthens the loop and nothing else has
to be kept in step.

```
NEW SCREEN                       AFTER EDITING SLOT 2 -> 15s
  1  — open —     10s              1  Chai Point    10s
  2  — open —     10s              2  Nike Air      15s
  …  (9 slots)                     …
  ───────────────────              ───────────────────
  LOOP  1:30                       LOOP  1:35
```

A new screen is seeded with **9 slots x 10s = a 90-second loop**.

### Data model

`screen_slots(id, screen_id, position, duration_seconds, created_at)` with
`UNIQUE(screen_id, position)`. Positions are contiguous and 0-based; removing a
slot re-packs so the grid never develops holes.

Content **binds into** a slot rather than defining one:

- `loop_items.position` — already existed, now means the grid index.
- `bookings.slot_position` — new, nullable.

Both draw their airtime from the slot at that position. That indirection is what
preserves the standing product rule that **a client can never set its own play
duration**: the operator owns the slot, the advertiser merely occupies it.

### The two mirrored columns

`screens.loop_duration_seconds` and the new `screens.slot_count` are
**write-through mirrors** of the grid, rewritten by
`app.screens.slots.sync_screen_loop_fields` in the same transaction as any grid
change. Nothing outside that module may write them.

| Field | Was | Is |
|---|---|---|
| `slot_duration_seconds` | forced every ad's length | default for a *new* slot; fallback for off-grid content |
| `loop_duration_seconds` | a declared number | `SUM(screen_slots.duration_seconds)` |
| `total_slots` | `loop // slot` | `slot_count` = `COUNT(screen_slots)` |

They are mirrored rather than joined because three hot paths read them per-screen
and must stay one query for a whole fleet: `screens.service.to_summary` (every
listing), the partner `free_now` arithmetic in `api_keys.ext_router`, and
`bookings.playback_health`'s expected-plays divisor.

This is the decision that keeps `free_now` meaningful. Had the loop simply
*become* the sum with `total_slots` still derived as `loop // slot`, then
`total_slots` would equal the item count would equal `occupied`, and every screen
would read "sold out" to partners forever.

## Decisions and why

**Loop grows freely, no cap.** No hard ceiling on the loop length. A slot is
bounded (2s–3600s) and the grid is bounded (1–120 slots), which bounds the loop
implicitly, but the operator is not blocked mid-edit. The floor of 2s exists
because below roughly that, ExoPlayer often has not rendered a first frame, which
aborts screenshot capture.

**Every slot is editable, including booked ones.** Both screenowner and
superadmin, via the same gate every other screen route uses
(`assert_can_manage_screen`).

**An oversold screen grows its grid; it never rejects a booking.**
`claim_free_position` seats a new campaign in the lowest unoccupied slot, and
appends one if every slot is taken. Booking creation is reached by four callers —
the CMS, the AI co-pilot, the Gmail importer, and the partner `/api/ext` API —
and three of them are unattended and have never had to handle a "screen full"
failure. Today an oversold screen already just makes the loop longer; growing the
grid makes that visible on the slot map instead of hiding it, without failing
anyone's booking.

**Empty slots hold their time in inventory, but are not sent to the player.** The
APK's `ScheduleDto` requires non-null `media_url`/`media_id`/`media_type`, so an
empty slot cannot be transmitted without an APK release — and not needing one is
a hard constraint. The consequence: the displayed loop (the full grid sum) is the
screen's *capacity*, while the real cycle is the filled slots. This does not
false-alarm playback health, because `playback_health` caps actual at expected —
a shorter real cycle reads as 100% delivery, not as an anomaly.

**Legacy writes are translated, not rejected.** `PATCH /cms/screens/{id}` still
accepts the two old fields, so the AI co-pilot, the partner API and any older CMS
build keep working:

- `slot_duration_seconds` → set **every** slot to that length.
- `loop_duration_seconds` → resize the grid to `loop // slot` slots.

One visible consequence: a declared loop that is not a whole number of slots now
snaps to what actually plays. Setting 25s slots with a 190s loop yields 7 slots =
**175s**, where the old code echoed back 190 while the screen still only ever
played 175s of content. The new number is the honest one.

## Why no APK release is needed

The deployed player reads `item.durationSeconds` fresh at the start of every slot
(`PlaylistController.kt:254/356/408`) and advances by list index — it never
computes a loop length, and a grep for `slot_duration|loop_duration|totalSlots`
across the Kotlin sources returns nothing. A mixed `[10,10,10,10,10,10,10,10,15]`
playlist plays correctly today; video is capped at its own slot by the existing
token-guarded timer.

Billing also needs no change: advertisers are billed per **play count**, and the
`duration_seconds` on a proof row is echoed from the schedule, signed into the
hash chain, and stored verbatim — the backend never compares it to
`slot_duration_seconds`.

## Migration `0042_screen_slots`

Backfill is **behaviour-preserving, not default-imposing**. Each existing screen
is seeded with exactly `loop_duration_seconds // slot_duration_seconds` slots of
`slot_duration_seconds` each, so a screen on the old 180/10 default gets 18 slots
of 10s and plays precisely what it played yesterday. Only screens registered
after this deploy get the new 9 x 10s default.

Live campaigns are then seated into the grid in start order, so an operator
opening the new slot map sees their real lineup rather than an empty grid.

`ensure_slots` is the lazy second half: any screen that reaches the API without a
grid is seeded on read, *without* bumping `schedule_updated_at` — the grid it
writes is behaviour-identical, and a fleet-wide reload for a no-op change would be
a self-inflicted thundering herd.

## API

```
GET    /api/cms/screens/{id}/slots            -> the whole grid + occupancy
PATCH  /api/cms/screens/{id}/slots            -> bulk: [{position, duration_seconds}]
PATCH  /api/cms/screens/{id}/slots/{position} -> one slot
POST   /api/cms/screens/{id}/slots            -> append a slot
DELETE /api/cms/screens/{id}/slots/{position} -> remove + re-pack
```

Every mutation returns the **whole grid**, because a slot edit changes the loop
total, the free/occupied counts and the proportional map — returning one row
would force the client to re-derive numbers the backend already computed.

## CMS UI

`src/components/screens/SlotGrid.tsx` replaces the old "Loop settings (fixed for
all ads)" modal fields.

- A **proportional slot map**: bar widths are `flexGrow: seconds`, so a 15s slot
  visibly occupies more of the loop than a 10s one. Equal-width pills would give
  the operator no feedback that an edit did anything.
- A row per slot: number, occupant (campaign / own content / open), and an inline
  seconds box.
- Edits are **staged and saved together**. Every save bumps the screen's
  `schedule_updated_at`, which makes the panel re-fetch its whole schedule;
  committing nine rows one keystroke at a time would be nine reloads for one
  intent. The header shows the pending loop total and the unsaved delta.

The bulk "set all slots to N" lever survives in the edit modal but now says out
loud that it overwrites per-slot lengths, and is only sent when actually changed —
otherwise saving the screen's *name* would silently flatten a tuned loop.

## What adversarial verification caught

Three review agents were run against the finished implementation, one of them
tasked with breaking it. Everything below was found after the code was written
and is fixed.

| # | Bug | Fix |
|---|---|---|
| 1 | `remove_slot`'s re-pack violated `uq_screen_slots_position` — reproduced failing on **every** attempt to remove slot 0 from a 9-slot grid. SQLAlchemy emits the renumbering UPDATEs in unordered fashion. | Constraint is `DEFERRABLE INITIALLY DEFERRED` |
| 2 | Migration seated campaigns at positions 0..n while loop items already held 0..k — the loop items then vanished from the grid and `free_now` over-reported inventory | Seating skips positions active loop items hold; grid sized to cover the highest one |
| 3 | Removing a slot whose successor was also occupied put **two** occupants on one position | `remove_slot` refuses an occupied slot (422) |
| 4 | Two concurrent bookings could claim the same slot; two could append the same new position | `SELECT … FOR UPDATE` on the screen row in `claim_free_position` |
| 5 | A paused campaign's slot read as free, so resuming it collided with a newly booked ad | `occupied_positions` counts `paused` as occupied |
| 6 | `resize_grid` could trim below a live campaign, leaving it airing but invisible | Never trims below the highest occupied position |
| 7 | The 120-slot clamp silently rewrote a 3600s loop to 1200s | Ceiling raised to 500 (no real screen is clamped); any clamp is logged |
| 8 | `loop < slot` (30s loop, 60s slots) divided to 0 and inflated to 9 slots = 540s | `max(1, …)`, and the 9-slot default only for a screen with no declared loop |
| 9 | `update_screen` wrote slot durations unvalidated — the AI executor passes raw ints through no model, so a `0` reached the player | Validates in `update_screen`; loop resize rebuilds a uniform grid rather than sizing a mixed one by the default |
| 10 | `create_loop_item` accepted any `position`, creating items that played but were invisible | Bounds-checked against the grid |
| 11 | `ensure_slots` could double-seed under concurrency and 500 | Savepoint + `IntegrityError` → use the winner's grid |
| 12 | CMS: typing `abc` into a slot box left the panel with **no Save and no Discard** — a dead end | `dirty` includes invalid entries; inline error text + `aria-describedby` |
| 13 | CMS: add/remove silently discarded staged edits | Both disabled while dirty, with an explaining tooltip |
| 14 | CMS: `"1e3"` saved a 1000-second slot | Digits-only validation |
| 15 | `playback_health` charged campaigns for fractional plays their window had no room for | Expected plays floored per day |
| 16 | The proof PDF printed the screen default slot, contradicting its own airtime tiles | Prints the campaign's observed per-play seconds |
| 17 | Partner `free_now` counted time-gated `loop_now`, so a 09:00–12:00 campaign's slot read free at 14:00 | Counts grid positions via `occupied_positions` |
| 18 | Gmail import told operators "this screen plays every ad for Ns" | Reworded; fix-hint points at the campaign's slot, not a screen-wide setting |

One reported finding was **rejected on inspection**: an agent claimed the health
divisor now false-alarms at 97.7%. Its example measured one hour, but
`playback_health` computes expected **per IST day** (`:190`) — over an 8-hour day
that is 303 of 303.16, or 99.95%. The real defect was the fractional expectation
(#15), which is what was fixed.

## Verified

- **Migration on real PostgreSQL** (scratch DB, dev data untouched): 180/10 → 18
  slots = 180s unchanged; 190/25 → 7 slots = 175s; loop-items-plus-campaigns →
  zero position collisions, zero unseated live bookings, zero off-grid loop
  items; oversold 3-slot screen with 5 ads → grew to 5 slots; `loop < slot` → 1
  slot, not 9; 3600/10 → 360 slots, not clamped. Mirrors match the grid on every
  screen. Downgrade drops table, columns and index cleanly; re-upgrade succeeds.
- **Slot service end-to-end against Postgres:** `remove_slot(5)` re-packs 18→17
  contiguously and drags the occupant at 7 down to 6; `remove_slot(0)` on a
  9-slot grid succeeds (the case that previously failed every time); an occupied
  slot is refused 422; a per-slot edit leaves loop, mirror and count in step;
  `resize_grid(2)` with an occupant at 6 keeps 7 slots.
- `ruff check app/` clean (the 13 remaining repo-wide errors are pre-existing in
  untouched test files). Backend imports; both slot routes register.
- CMS `tsc --noEmit` and `npm run build` pass.
- Per project convention, pytest was not run — `tests/test_screen_slots.py` is new
  and two expectations in `tests/test_cms.py` were updated for the changed
  semantics.

## Known follow-up, deliberately out of scope

`markai-frontend-new` was scoped out of this change and still tells advertisers
every ad shares one length — `app/screens/[id]/page.tsx:272-320` ("Your ad holds
one slot — {slot}s"), `components/book/BookingWizard.tsx:399-403/579-583`,
`components/screens/ScreenCard.tsx:131`. These are **pre-purchase quotes**, so an
advertiser can be told 10s and given 15s. The backend keeps serving the fields
they read, so nothing is broken — but the copy is now misleading and should be a
follow-up.

## Files

**Backend:** `app/screens/slots.py` (new), `app/cms/slots_router.py` (new),
`app/screens/models.py`, `app/screens/schemas.py`, `app/screens/service.py`,
`app/bookings/models.py`, `app/bookings/service.py`, `app/loops/service.py`,
`app/models.py`, `app/api/routers/routers.py`,
`alembic/versions/0042_screen_slots.py` (new),
`tests/test_screen_slots.py` (new), `tests/test_cms.py` (two expectations updated).

**CMS:** `src/components/screens/SlotGrid.tsx` (new), `src/lib/api.ts`,
`src/lib/types.ts`, `src/app/(dashboard)/screens/[id]/page.tsx`.
