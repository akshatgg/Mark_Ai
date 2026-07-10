# Screen Operating Hours — per-screen ON window (default 09:00–17:00)

Status: **approved, not yet implemented**
Scope: `markai-signage-api` (source of truth) · `markai-Web-cms` (edit + booking UI) · `markai-player-apk` (playback gate + heartbeat schedule)

## Problem

A signage screen sits in a café that is open, say, 09:00–17:00. Today Mark AI has no
concept of that: the backend will let an advertiser book an ad at 03:00, the APK will
play it to an empty dark room, and the screen heartbeats every 60s all night long for no
reason. We need each screen to carry its real operating window so that (a) ads only ever
play while the venue is open, (b) advertisers can only book inside that window, and (c)
the screen goes quiet outside it.

## Goal (decided with the user)

- Every screen has a declared daily **ON window**, default **09:00–17:00**, interpreted in
  the platform timezone (IST, `APP_TIMEZONE`). The screen owner sets it because they know
  the venue's hours; a superadmin can edit any screen, a screenowner only their assigned
  screens.
- A one-click **"All day / 24 hours"** option means the screen is always on.
- Inside the window ads play normally. **Outside the window the screen shows black and
  plays nothing** — even if the panel is still physically lit because nobody switched it
  off. We do **not** power the panel off; the venue/hardware does that a few minutes later.
- Advertisers can **only book inside** a screen's window; an out-of-hours booking is
  rejected with a clear message.
- The APK **only heartbeats around the window's edges** — from 15 minutes before open to
  15 minutes after close — and is silent overnight.

## Non-goals (deliberately out of scope)

- **Physically powering the display off.** That is the venue's / hardware's responsibility.
  Our app only stops showing content. (This would otherwise be net-new device-admin / kiosk
  work with hardware unknowns on ScreenOx boxes.)
- **Per-day-of-week screen hours** ("closed on Sundays"). The minute-of-day column pattern
  makes this easy to add later, but it is not built now.
- **Per-screen timezones.** The whole platform is single-timezone (IST). Operating hours
  are interpreted in `APP_TIMEZONE`, exactly like existing booking/loop daily windows.

## Accepted tradeoff

A same-day hours change made *after* the screen has already closed will not reach the
screen until the next morning's pre-open sync (the screen is asleep in between, and nothing
is playing anyway). Same-day changes made while the screen is still open reach it normally.

---

## Data model (`markai-signage-api`)

Add two columns to `screens`, matching the exact convention already used by `Booking`
(`app/bookings/models.py`) and `LoopItem` (`app/loops/models.py`) — **minute-of-day
integers, not SQL `Time`**:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `on_start_minute` | `Integer` nullable | `540` (09:00) | Daily ON-window start, minute-of-day 0–1439, IST |
| `on_end_minute` | `Integer` nullable | `1020` (17:00) | Daily ON-window end, minute-of-day 0–1439, IST |

- **Both `NULL` = 24/7** (the "All day" option). Any other state has both set.
- The window may **wrap past midnight** (e.g. a bar open 18:00–02:00 → start 1080, end 120);
  the existing `_minute_in_window` helper (`app/screens/service.py:470`) already handles wrap.
- New Alembic migration after `0026`, following the `0006`/`0008` template
  (`op.add_column("screens", sa.Column(..., server_default=...))`). Existing rows backfill
  to 540/1020 via `server_default` so every screen gets the 09:00–17:00 default.
- New module constants `DEFAULT_ON_START_MINUTE = 540`, `DEFAULT_ON_END_MINUTE = 1020` next
  to the existing loop defaults in `app/screens/models.py`.

A single canonical helper decides "is this screen on at instant `now`":
`screen_on_now(screen, now) -> bool` — both null → `True`; else evaluate `on_start_minute`/
`on_end_minute` against IST minute-of-day via `_minute_in_window`. This helper is the one
place the rule lives; playback, attribution, and status all call it.

---

## Backend changes

### 1. Editing the window
- `ScreenUpdateRequest` (`app/screens/schemas.py:79`): add `on_start_minute` / `on_end_minute`
  (`Optional[int]`, `ge=0, le=1439`) **and** accept a friendly pair `on_start` / `on_end` as
  `"HH:MM"` strings converted with the existing `_parse_hhmm` pattern, plus an `all_day: bool`
  convenience that maps to both-null. Validation: both-or-neither (or `all_day`), mirroring
  `_resolve_daily_window` in loops.
- `update_screen` (`app/screens/service.py:411`): apply the fields, and **bump
  `schedule_updated_at` when they change** (today it only bumps on slot/loop change — the
  window must reach the screen, so it joins that condition). Same transaction, per the
  existing atomicity invariant.
- Single-screen route unchanged: `PATCH /api/cms/screens/{id}`, guarded by
  `require_screenowner_or_super` + `assert_can_manage_screen` (superadmin any, screenowner own).
- `ScreenSummary`/`ScreenDetail` response schemas gain the two fields so the CMS can render
  them.

**Bulk edit (new endpoint — set hours on many screens at once).**
Because a real fleet has too many screens to configure one by one, add
`PATCH /api/cms/screens/operating-hours` (bulk). Body is one window
(`on_start`/`on_end` or `all_day`) plus a **target**, one of:
- `screen_ids: [..]` — an explicit list the operator checked, **or**
- `filter: { q?, status? }` — "apply to everything matching my current search/filter",
  resolved server-side to ids.

Semantics:
- Guarded by `require_screenowner_or_super`. Every target screen is run through the same
  ownership check — a superadmin hits all; a screenowner's bulk applies **only to their
  assigned screens** (reuse `_visible_screen_conditions` for the `filter` form and
  `assert_can_manage_screen` per id for the list form). Ids the caller can't manage are
  **skipped, not errored**.
- Applies the window to each permitted screen and **bumps `schedule_updated_at` per screen**
  (each in its own change), so every affected screen reloads on its next awake heartbeat.
- Returns `{ updated: <n>, skipped: [<ids>] }` so the CMS can report "Updated 42 screens".
- The window is validated once (both-or-neither / `all_day`, 0–1439) before the fan-out.

### 2. New status: `off_hours`
- `compute_status` (`app/screens/service.py:110`) gains a `screen`/window argument. New rule:
  no recent beat **and** `screen_on_now` is `False` → **`off_hours`** (calm, expected);
  no recent beat **and** the screen *should* be on → `offline` (genuinely wrong). Inside
  hours the existing display_on / player_foreground logic is unchanged.
- `_live_status_expr` (`app/screens/service.py:290`): the SQL twin gets the same window
  branch (a `case` over the IST minute-of-day of `now` vs the two columns) so filtering and
  counting by status stays in the DB and in lock-step with `compute_status`.
- Ripple: `empty_counts` (`service.py:336`) and the status-filter whitelist (`service.py:371`)
  gain `off_hours`; `ScreenSummary.status` doc + the counts schema (`schemas.py:68`) gain it;
  the dashboard `status_counts` (`app/cms/dashboard_router.py:167`) and the "offline for
  24h" insight (`:333`) treat `off_hours` as not-a-problem.

### 3. Booking enforcement (the real gate — covers all 3 create paths)
All bookings funnel through `bookings.service.create_booking` (`app/bookings/service.py:374`),
which already fetches the target screen (`:383`). Add there, after the screen is loaded:
- **Reject** if any supplied daily window is not fully inside the screen's ON window →
  HTTP 422 with a message naming the hours, e.g. *"This screen runs 09:00–17:00. Choose a
  time inside that window."* Windows are compared as minute-of-day sets, wrap-aware.
- **Inject** the screen's ON window as the booking's daily window **when the booking supplies
  none** — otherwise "no window" means all-day (`daily_windows=None` → 00:00–23:59) and the
  ad would play outside hours. A 24/7 screen (null window) injects nothing (stays all-day).
- This automatically covers the CMS form (`POST /api/cms/bookings`), the partner API
  (`POST /api/ext/bookings`), and the AI co-pilot (`create_booking` tool via
  `/cms/ai/sessions/{id}/confirm`) — none can bypass it.
- The pure window-subset check (`window_within(inner, outer)`) lives in a small shared helper
  so it is unit-testable and reused by the CMS validator's server counterpart if needed.

### 4. The lock-step invariant (where the care goes)
The screen ON window must be intersected everywhere a booking's playable time is computed,
not only at playback — otherwise attribution and screenshots drift (this is the documented
class of bug in `screenshots/service.py` and `attribution.py`).
- `_booking_active_now` (`app/screens/service.py:478`): a booking is active now only if its
  own rule says so **and** `screen_on_now(screen, now)`.
- `attribution.play_intervals` / `attributable` / `last_playable_end`
  (`app/bookings/attribution.py:114`): intersect each play interval with the screen's ON
  window (as a daily recurring window, wrap-aware) so plays, billing rollups, and
  `derived_status` all measure the same playable time the screen actually shows.
- `_milestone_times` (`app/screenshots/service.py`): already arms on `play_intervals`, so it
  inherits the intersection for free — but verify the fallback path.
- **Re-arm on hours change:** `update_screen`, when the window changes, calls the existing
  `rearm_milestone_jobs` for that screen's uncaptured milestones (today only booking
  `start_at`/`end_at` edits re-arm). Narrowing hours thus moves the milestone timeline
  correctly instead of stranding a shot outside the new window.

### 5. Delivering the window to the APK
- `ScheduleResponse` (`app/screens/schemas.py:127`) gains screen-level `on_start_minute` /
  `on_end_minute` (nullable). This is **screen-level**, not per-item — it is the whole
  screen's gate, distinct from each item's own `daily_windows`.
- `get_schedule_items` / the schedule route (`app/screens/router.py:48`) populate them from
  the screen. Because any window change bumps `schedule_updated_at`, the screen re-fetches
  and re-caches within one heartbeat while it is awake.

---

## CMS changes (`markai-Web-cms`)

- **Types:** `Screen` (`src/lib/types.ts:84`) and `UpdateScreenPayload` (`:452`) gain
  `on_start_minute` / `on_end_minute` (and an `all_day` convenience on the payload).
- **Edit-screen modal** (`src/app/(dashboard)/screens/[id]/page.tsx:427`): add two native
  `<input type="time">` fields (From / To) + an **"Open 24 hours"** checkbox that disables
  them and sends the all-day state. Wire through the existing `saveEdit` (`:110`) and
  `api.updateScreen` (`src/lib/api.ts:212`). Manual validation in `saveEdit`, matching the
  hand-rolled style already there (no zod in this repo).
- **Booking forms:** extract a pure validator into `src/lib/` (the only tested layer) —
  `isBookingWithinScreenHours(windows, screenHours)` with a matching `*.test.ts`. Call it in
  **both** duplicated forms: `buildPayload` in `bookings/new/page.tsx:124` and the
  `ScheduleModal` in `bookings/page.tsx`. On violation, surface the same error string the
  forms already render. Also show the screen's hours as context near the time picker
  ("This screen runs 09:00–17:00") and default a new booking's window to the screen's hours.
  The frontend check is UX only; the backend (§3) is authoritative.
- **Status badge:** render `off_hours` as a distinct, calm state (e.g. muted "Off hours"),
  not red "offline", wherever `StatusBadge` and the fleet filter tabs consume status.
- **Bulk hours edit on the fleet list** (`src/app/(dashboard)/screens/page.tsx`): the fleet
  grid is already paginated with a server-side search (`q`) + status filter. Add:
  - a **checkbox per screen row/card** and a header **"Select all on this page"**, plus a
    **"Select all N matching"** affordance that switches the target from an explicit id list
    to the current `{ q, status }` filter (so a 500-screen selection isn't 500 ids in the
    body).
  - reuse the existing `SearchInput` / status tabs as the "search section" — no new search UI.
  - a **bulk action bar** that appears when ≥1 screen is selected → "Set operating hours"
    opens a modal (From / To + "Open 24 hours") → calls the new bulk endpoint →
    toast "Updated N screens" (and, if any were skipped for ownership, "M not editable by you").
  - A screenowner only ever sees/selects their assigned screens (the list is already
    server-scoped), so their bulk is naturally limited to those.
  - Types: `BulkOperatingHoursPayload { on_start_minute?, on_end_minute?, all_day?,
    screen_ids? , filter? }` in `src/lib/types.ts`; `api.bulkSetOperatingHours(...)` in
    `src/lib/api.ts`.

---

## APK changes (`markai-player-apk`)

- **Cache the window:** `store/Prefs.kt` gains `on_start_minute` / `on_end_minute` keys,
  written whenever a schedule is fetched (from the new `ScheduleResponse` fields). Cached so
  the window survives restarts and is known at boot before any network call. `ScheduleResponse`
  DTO (`net/dto/ScheduleDto.kt:50`) gains the two nullable fields.
- **Screen-level playback gate:** add a screen-window check **on top of** the existing
  per-item `ScheduleGating`. In `PlaybackBus.regate()` (`ui/PlaybackBus.kt:56`), if the screen
  is outside its ON window the derived playlist is empty → `PlaylistController.setPlaylist([])`
  → `stop()` → black screen (already the correct, tested behavior). Reuse the same
  `java.time` + minute-of-day + wrap logic `ScheduleGating` already uses (desugared, minSdk 24).
  The local 15s re-gate loop keeps running so the screen goes black exactly at close and
  resumes exactly at open, with no server round-trip. Null window → always on.
- **Heartbeat schedule:** the beat is active only in `[open − 15min, close + 15min]`
  (IST). Implementation: keep the 60s coroutine loop alive (its local tick is free), but
  gate the actual network POST — a helper `shouldHeartbeatNow()` guards `sendHeartbeat()`.
  Apply the guard at **all three** callers, not just the loop: `startHeartbeatLoop`
  (`PlayerService.kt:464`), the `ACTION_SCREEN_ON/OFF` receiver (`:73`), and the presence
  observer (`:458`). The pre-open beat at `open − 15min` is deliberate: it lets the screen
  sync its schedule (pick up `reload_needed`) right before it has to perform. Null window →
  always beat.
- **Gate network schedule refresh too:** the ~3-min `startScheduleRefreshLoop` network GET
  (`PlayerService.kt:483`) is gated to the same beat window (it is a server call); the local
  gate loop is not. New constant for the 15-minute edge buffer in `util/Constants.kt`.
- **Keep `ScheduleGating` in parity:** its `isActiveNow` remains the line-for-line port of
  the backend's `_booking_active_now`; the screen-level gate is a separate, additional check
  so both the backend and the APK apply "booking rule ∧ screen on".

---

## Contract additions (keep shapes backward-compatible)

- `ScheduleResponse`: `+ on_start_minute?`, `+ on_end_minute?` (screen-level). Old players
  ignore unknown fields; a null pair means 24/7.
- `ScreenUpdateRequest` (CMS→backend): `+ on_start`/`on_end`/`on_start_minute`/`on_end_minute`/
  `all_day`.
- **New** `PATCH /api/cms/screens/operating-hours` (bulk): body = window + `screen_ids[]`
  **or** `filter{q?,status?}`; response `{ updated, skipped[] }`.
- Screen read schemas (`ScreenSummary`/`ScreenDetail`): `+ on_start_minute`/`on_end_minute` +
  `off_hours` as a possible `status`.
- **No change** to `RegisterRequest`/`RegisterResponse`, `HeartbeatRequest`/`HeartbeatResponse`,
  or `proof`. The window rides the schedule, which the screen already re-fetches on
  `reload_needed`.

---

## Edge cases

- **24/7 screen:** both columns null → `screen_on_now` always true; APK always plays and
  always beats; no booking restriction.
- **Wrap past midnight (18:00–02:00):** handled by the existing wrap-aware `_minute_in_window`
  on both ends; the heartbeat buffer widens the window by 15 min on each side before the check.
- **Owner narrows hours under live bookings:** allowed with no block (user decision). The
  playback + attribution gate clips those bookings; `rearm_milestone_jobs` moves their shots;
  nothing is billed for time the screen no longer shows.
- **Booking spills outside hours:** rejected 422 (user decision), in backend and pre-blocked
  in the form.
- **Screen offline vs off-hours:** distinguished by `screen_on_now`, so a healthy closed
  screen never reads "offline" and never trips the 24h-offline alert.
- **Same-day retroactive extension after close:** not delivered until next pre-open sync
  (accepted tradeoff).

---

## Testing

- **Backend (pytest, aiosqlite):** `screen_on_now` / window-subset unit tests incl. wrap;
  booking rejected outside hours across all three create paths; no-window booking inherits
  screen hours; `compute_status` / `_live_status_expr` return `off_hours` correctly;
  attribution `play_intervals` intersected with screen hours (extend
  `test_calendar_schedule.py` / `test_matching.py` / a new `test_operating_hours.py`);
  milestone re-arm on hours change; **bulk endpoint** — superadmin updates many, screenowner's
  bulk touches only assigned screens and skips the rest, `filter` form resolves the same set
  the list would show.
- **CMS (vitest):** `isBookingWithinScreenHours` pure-function tests in `src/lib/*.test.ts`
  (incl. wrap + all-day), matching the repo's only tested layer.
- **APK (JUnit):** extend `ScheduleGatingTest` with screen-level gate cases; a
  `shouldHeartbeatNow()` test for the `[open−15, close+15]` window incl. wrap and null(24/7).

## Documentation to fix along the way

- Root `CLAUDE.md` claims booking modes "continuous (N days), hourly, specific time,
  N-times-per-day, custom". The code has exactly four — `continuous`, `specific_time`,
  `times_per_day`, `custom` — and **no hourly mode**. Correct the prose while touching
  bookings.
- Add the operating-hours rule to the backend and APK `CLAUDE.md` "critical behaviors"
  sections (the new three-place lock-step: `_booking_active_now` ∧ `attributable` ∧
  `ScheduleGating` all gated by `screen_on_now`).
