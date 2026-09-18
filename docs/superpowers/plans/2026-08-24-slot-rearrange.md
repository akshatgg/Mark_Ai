# Slot rearrange — move an ad to a different slot from the screen page

**Date:** 2026-08-24
**Repos:** `markai-signage-api` (move endpoint + service), `markai-Web-cms` (SlotGrid UI).
**No APK change, no migration** — the player replays the slot list by index and
re-fetches on `schedule_updated_at`, so a rearrangement reaches the glass on the
next heartbeat like any other schedule edit.

## What the user asked for

Ad C sits in slot 5; the operator wants it in slot 2 — rearranged directly in the
slot panel on the screen detail page, for both campaigns and owner loop content.

## Model facts that shape the design (verified in code)

- Content binds INTO a slot: `bookings.slot_position` and `loop_items.position`
  share the grid-index namespace. Moving an ad = rewriting that one integer.
- **The slot owns the seconds, the ad only occupies it.** Moving C from a 10s
  slot to a 15s slot means C now plays 15s. That is the established product rule
  (owner controls timing, never the client) — the UI must say it, not hide it.
- `claim_free_position` serializes slot claims with `SELECT … FOR UPDATE` on the
  screen row; a move must take the same lock or a concurrent booking can land on
  the position mid-swap.
- `occupied_positions` counts **paused** campaigns as occupants (they resume);
  `build_grid_view` shows active ones. A move must treat "live claimant" the way
  `occupied_positions` does, or a swap onto a paused campaign's slot silently
  double-books it.
- Milestone screenshots and attribution key off time windows, not positions —
  no re-arming needed.

## Design

### Backend — `POST /api/cms/screens/{screen_id}/slots/move`

Body `{from_position: int, to_position: int}` → returns the fresh
`ScreenSlotListResponse` (same shape the grid already renders, so the UI applies
it directly). Mounted in the existing `slots_router` with the same
`assert_can_manage_screen` gate (superadmin any screen, screenowner their own).

Service `slots.move_occupant(db, screen, from_pos, to_pos)`:

1. `SELECT … FOR UPDATE` on the screen row — same serialization as
   `claim_free_position`.
2. Validate: both positions inside the grid (`0 … slot_count-1`), `from != to`.
   422 with a plain message otherwise.
3. Collect the **live claimants** at `from`: active loop items at that position,
   plus active/paused not-yet-ended bookings with that `slot_position`. Empty →
   422 "slot N is empty — nothing to move". (Plural claimants — a legacy
   double-booked position — move together; a move must never split them apart
   silently.)
4. Collect live claimants at `to`:
   - none → plain move (`from` becomes open),
   - some → **swap**: they take `from`, the moved ad takes `to`. Swap is atomic
     within the transaction; the deferred unique constraint isn't involved
     (these are content rows, not `screen_slots` rows).
5. Bump `schedule_updated_at` **in the same transaction** (the invariant every
   schedule mutation obeys) and commit. The screen reorders within one heartbeat.

Swap (not shift-insert) on an occupied target: slots are sold positions with
their own durations, so shifting every ad between 2 and 5 across different-length
slots would silently change the play length of ads nobody touched. A swap changes
exactly the two ads the operator can see; anything fancier stays operator-driven,
one visible move at a time.

### CMS — `SlotGrid.tsx`

Two affordances, one API call:

1. **Drag & drop** — each occupied slot row gets a grip handle (native HTML5
   drag, no new dependency; rows are already list items). Dropping on another
   row calls `api.moveSlot(screenId, from, to)` and applies the returned grid.
   Drop targets highlight; dropping on an occupied row is labelled as a swap
   ("Swap with JR") in the drag-over state.
2. **"Move to…" fallback** — a small per-row menu listing every slot
   (`Slot 2 — open · 15s`, `Slot 5 — swap with JR · 10s`) for operators on
   touch devices and for accessibility. Same endpoint.

Behavioral details:

- Moves apply **immediately** (like add/remove slot do today) with a toast
  ("Moved hh to slot 2 — plays 15s there. The screen picks it up on its next
  check-in."), including the new duration when it changed — that is the one
  side effect an operator might not expect.
- The staged duration drafts are per-position and survive a move untouched
  (they belong to the slot, which does not move).
- While a move is in flight the grid disables drag (one mutation at a time,
  same as the existing `busyPosition` pattern).

### Out of scope

- Reordering by shifting/inserting (see swap rationale).
- Moving content across screens.
- Any APK change.

## Execution order & verification

1. `slots.move_occupant` + router + schemas; ruff + import check (no pytest per
   project convention).
2. CMS: `api.moveSlot` + types; SlotGrid drag handle + move menu.
3. `npx tsc --noEmit` + `npm test`.
4. Live check on localhost: move an ad between slots, confirm the grid re-renders
   from the response, `schedule_updated_at` bumps (screen reloads within a
   heartbeat), and a swap visibly exchanges the two ads.
