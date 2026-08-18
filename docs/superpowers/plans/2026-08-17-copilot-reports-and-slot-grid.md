# Co-pilot: report downloads + slot grid tools

**Date:** 2026-08-17
**Scope:** `markai-signage-api` (`app/ai`, `app/whatsapp`, `app/screens`, new `app/reports`) + `markai-Web-cms` chat UI
**Why:** the co-pilot covers ~5 of the CMS's ~18 operator jobs. These are the two biggest gaps.

One agent serves both doors (`app/ai/agent.run_turn`, called from `app/ai/router.py:305` and
`app/whatsapp/inbound.py:359`), so everything here ships to the CMS chat and WhatsApp at once.

---

## Decisions taken

| Question | Decision |
|---|---|
| Build reports inline or in background? | **Background.** The agent replies *"give me a minute"*, a worker builds the file, the file is pushed back into the conversation when ready. No size cap needed. |
| How does the file reach WhatsApp? | **A real document message.** New outbound `document` branch in `app/whatsapp/client.py` using the signed GCS URL as Meta's `link`. |
| `update_screen`'s slot params | **Dropped from the AI tool signature.** All grid work goes through the new per-slot tools. The REST endpoint keeps them for back-compat. |
| Slot edits | **Per-slot and non-destructive.** Stretching slot 3 from 10s→15s leaves every other slot at 10s and grows the loop 90s→95s. The agent must *say* that in its reply. |
| A creative longer than its slot | **Auto-fit.** The agent proposes stretching that one slot to fit, and states the new loop length. No warning ceremony. |
| The existing booking tools | **Re-declare them first.** They were written before the slot grid and are now factually wrong in several places — see Part 0. |

---

## Part 0 — Re-declare the booking tools (do this first)

### 0.1 The AI layer has been frozen since 2026-07-28

`git log` on `app/ai/` gives a hard date. The last commit that taught the agent anything about
bookings is **`844dd2f` (2026-07-28)**. Since then only two commits touched `app/ai/`, and neither
added knowledge:

- `120112e` (08-11, Gmail) — moved one constant out of `executors.py`. 8 lines.
- `59c3428` (08-17, WhatsApp) — extracted `confirm_service.py`. Pure refactor.

`tools.py` and `prompts.py` are unchanged since that date. `draft.py` is unchanged since
`eeaa0db` (07-06) — the booking notepad's field list is **six weeks older than the booking model**.

Meanwhile the booking/scheduling side kept shipping. What landed after the freeze, with no AI
change in the same commit or since:

| Date | Commit | Shipped | AI taught? |
|---|---|---|---|
| 08-03 | `202176b` | On-demand capture retention | no |
| 08-05 | `fb5bd6d` | Creative Fit (`0037`) | no |
| 08-06 | `5f18d50` | Campaign PDF, milestone downloads, PoP Excel | no |
| 08-07 | `ca007bc` | Every list endpoint paginated + searched server-side | no |
| 08-11 | `120112e` | Gmail → bookings (`0040`/`0041`), `bookings/hours.py` | plumbing only |
| **08-13** | **`701a196`** | **Slot grid, per-slot airtime (`0042`), `bookings.slot_position`** | **no — zero `app/ai/` files** |

Earlier misses still outstanding from before the freeze: booking-schedule immutability (`5fdfce2`,
07-10), ext-API attribution (`926dcac`, 07-16), on-demand capture (`ac4dfc8`, 07-23).

**Nothing would have caught this.** There are 11 `test_ai_*.py` files, all infrastructure (confirm,
draft, history, locks, guardrails). **None asserts that the tool surface matches
`CreateBookingRequest`.** `test_screen_slots.py` (added by `701a196`) never touches `app/ai/`.
The repo's own `CLAUDE.md` documents the grid correctly — the *agent* is the stale artifact.

### 0.2 Wrong answers the agent gives today — ranked

| # | Question a user asks | What the agent says | Reality |
|---|---|---|---|
| 1 | "How long does my ad play?" | `screen.slot_duration_seconds` (`tools.py:138,692,753`) | Since `0042` that field means *"default length for a NEW slot"*. Real airtime is `screen_slots[booking.slot_position].duration_seconds`. **No tool can produce it.** |
| 2 | "Does this 30s video fit?" | "Fits" — `_media_fit_warning` (`tools.py:329`) and `check_media_fit` (`:606`) check **orientation and aspect ratio only** | The player truncates it at the slot length. A 30s ad in a 10s slot loses 20 seconds. |
| 3 | "Run it all day" | Proposes no daily window, reports "runs continuously" | `service.py:518-523` **injects the screen's operating hours** as the window. It runs 09:00–17:00. |
| 4 | "Is the Diwali campaign done?" | "There is no 'completed' status" — `tools.py:1038` verbatim | `completed` exists (`service.py:302`, stamped at `:213`, returned by `derived_status`, `attribution.py:319`). Every list/detail read already returns it. |
| 5 | "Book it from Monday" (no end date) | Books it | `end_at` defaults to **`start_at + 365 days`** (`schemas.py:124`). A slot held for a year. The Gmail importer explicitly guards this (`gmail/draft_state.py:83-90`); the AI path does not. |
| 6 | "Which screens have problems?" | "None" — prompt rule 13 says *"name ONLY status=offline"* (`prompts.py:180`) and claims three states (`:172`) | There are **four**. `display_off` = reachable, player up, panel dark — a real fault the agent is instructed to hide. |
| 7 | "Screenshot every play" | Silently dropped | `screenshot_enabled: bool = False` (`tools.py:938`) is not-None, so `merge_draft` (`draft.py:85`) **overwrites a locked `True`**. `prompts.py:106-107` also claims the draft "rides the create_booking proposal" — it does not; `confirm_service` executes `action["args"]` only. |
| 8 | "Book it hourly" | Invents `schedule_type="hourly"` | Not a legal value. And it fails as **HTTP 500**, not 422 — the `Literal` is enforced by pydantic *inside* the executor, outside any `HTTPException` path (`main.py:125-131`). After the user clicked Confirm. |
| 9 | Screenowner: "cancel my campaign" | May refuse — `tools.py:1048` says "superadmin only" | `executors.py:127` uses `_assert_can_manage_booking`; a screenowner can cancel on their own screens. |
| 10 | "Make ads 15 seconds" | Proposes `update_screen(slot_duration_seconds=15)` | **Overwrites every slot in the grid** (`screens/service.py:742-743`), wiping the 15s slot a premium advertiser is paying for. The tool docstring calls this "owner loop timing" (`tools.py:1080`). |

### 0.3 Tool signature corrections

- **`schedule_type`** — currently a bare `str` with default `"continuous"` on both `create_booking`
  (`tools.py:932`) and `update_booking_draft` (`:842`); **no docstring names a legal value and
  `prompts.py` never mentions schedule types at all.** Make it a `Literal["continuous",
  "specific_time", "times_per_day", "custom"]` so pydantic-ai puts the enum in the function
  declaration and the model cannot invent one. Change the default to `None` to kill the clobber.
- **`screenshot_enabled`** — default `False` → `Optional[bool] = None`, so omitting it stops
  overwriting a locked draft value.
- **`target_plays_per_day`** — add it. Without it `times_per_day` is **unusable**: 422 at confirm,
  forever, with no way for the agent to recover. The Gmail importer already passes it
  (`gmail/import_service.py:520`).
- **`end_at`** — add to `REQUIRED_FIELDS` (`draft.py:61`) or add a pre-propose guard that refuses to
  propose without one, quoting the 1-year default.
- **`daily_windows`** (multi-window) — accepted by the API (`schemas.py:52`), unrepresentable by the
  agent. Lower priority than the rest; note it and move on.
- **`delete_booking` docstring** — drop "(superadmin only)".
- **`set_booking_status` docstring** — remove "There is no 'completed'"; add that
  `_assert_status_transition` (`service.py:336-344`) **409s** any attempt to set active/paused on a
  completed campaign.
- **`update_screen`** — drop `slot_duration_seconds` / `loop_duration_seconds` (already decided).
- **Dead entries** — `ToolName.CREATE_SOLUTION` (`constants.py:55`) has no tool *and* no executor;
  `ToolName.UPDATE_BOOKING_LAYOUT` (`:53`) has an executor but no tool. Either wire or delete both.
- **`create_booking` propose path** — add `assert_can_manage_screen` at `tools.py:970`. Every other
  screen-touching tool asserts; this one echoes a foreign screen's hours back before Confirm.

### 0.4 Prompt rewrite

`prompts.py` needs a booking-and-slots pass, not a patch:

- Fix rule 8 (`:106-107`) — the draft does **not** ride the proposal.
- Fix rule 13 (`:172-180`) — four states, and `display_off` **is** a problem.
- Fix rule 3 (`:42`) — it lists `layout` as a write the agent can perform; no such tool exists.
- **Add:** the operating-hours injection rule (the silent one, §0.2 #3). `hours.py:10-19` calls it
  "the surprising one" and the Gmail UI surfaces it; the AI surfaces nothing.
- **Add:** a booked schedule is **immutable** — only `name` and `status` are editable
  (`service.py:882-890`, `schemas.py:301`). "Extend my campaign by a week" currently has no honest
  answer path, and there is no rename tool either.
- **Add:** the schedule-type set, spelled out. Explicitly: **there is no "hourly"**.
- **Add:** the slot/loop-item/booking three-way distinction (see 2.6 #6).

### 0.5 Teach the booking reads about slots

`_screen_dict` (`tools.py:129-149`) drops `total_slots`, which `to_summary` already returns
(`screens/service.py:477`). So the agent cannot answer *"how many ads fit on this screen"* or *"how
much inventory is free"* — while the **partner API can** (`ext_router.py:339`,
`free_now = total_slots - occupied`).

Fix: surface `total_slots`, `occupied`, `free`, and this booking's `slot_position` + that slot's
`duration_seconds` in `get_booking` / `find_campaign` / `_screen_dict`. `BookingResponse` does not
expose `slot_position` today, so this needs a schema field too.

Also: every campaign read currently hands the model `min_display_seconds: null`
(`schemas.py:229`, always null since `normalize_booking_fields` hard-nulls it at `:205`) with no
counter-fact saying airtime lives on the slot. That is hallucination fuel — drop it from the AI-facing
dicts.

### 0.6 Let the model see its own failures

`executors` raise `HTTPException`; `confirm_service.execute_actions` does not catch it and
`router.py:403` catches only `ConfirmError`. So a failed confirm becomes a **browser toast the model
never sees** — it cannot explain or correct. Only the pre-propose guards (`tools.py:960-998`) feed
anything back. Catch execution errors and publish them onto the turn so the next message has them.

### 0.7 A contract test

Add one test asserting the `create_booking` tool's argument set matches `CreateBookingRequest`'s
fields (allowing an explicit, documented exclusion list). That single test is what would have caught
this whole class of drift on 08-13.

---

## Why background, concretely

Two measured hazards against the 150s turn deadline (`AI_TURN_TIMEOUT_SECONDS`, `config.py:285`,
enforced `agent.py:323`):

1. **XLSX walk.** `reports_router.py:152-174` pages `query_proof_report` up to 50×. Each page runs
   `_map_screenshots_to_plays` (`screens/service.py:1233`), which loads **all** matching bookings and
   **all** `shot_type='loop'` screenshot records with *no date bound*, then does an O(plays × shots)
   Python loop. Repeated per page. Wide filters are seconds-to-minutes, fully buffered in RAM.
2. **Campaign PDF.** `bookings/service.py:417-433` downloads up to 4 images **sequentially** at
   `_FETCH_TIMEOUT_SECONDS = 20.0` (`screenshots/service.py:751`), and calls the blocking
   `signed_url_for` on the event loop. Worst case ≈80s before ReportLab even starts.

Both builders (`build_proof_workbook`, `render_campaign_report`) are sync and CPU-blocking, so even
the happy path must not run on the turn's event loop.

---

## Part 1 — Report downloads

### 1.1 New module `app/reports/`

Mirrors the `creative_fit` job pattern, which is already proven and already cloned once for WhatsApp
(`app/whatsapp/worker.py:1-17` says so explicitly).

```
app/reports/
  models.py    ReportJob
  service.py   create_job / get_job / list_jobs_for_user / build_and_store
  worker.py    claim loop (clone of app/creative_fit/worker.py)
  delivery.py  push the finished file back into the conversation
  naming.py    -> extend app/screenshots/naming.py instead (see 1.6)
```

**`report_jobs` table** (new alembic migration, revises current head):

| Column | Type | Notes |
|---|---|---|
| `id` | String(36) PK | |
| `kind` | String(32) | `proof_of_play` \| `campaign` |
| `format` | String(8) | `xlsx` \| `pdf` |
| `requested_by` | String(36) FK cms_users | **scope is re-resolved from this at build time, never from params** |
| `params` | JSONB | `{screen_id, media_id, booking_id, date_from, date_to}` |
| `status` | String(16) | `queued`/`running`/`succeeded`/`failed`/`cancelled` |
| `attempts`, `claimed_at` | int / timestamptz | for `FOR UPDATE SKIP LOCKED` + `reclaim_stale` |
| `blob_name`, `filename`, `row_count`, `error` | | |
| `delivery` | JSONB | `{channel: "cms"\|"whatsapp", session_id, turn_id, phone}` |
| `created_at`, `started_at`, `finished_at` | timestamptz | |

Worker: copy `app/creative_fit/worker.py` wholesale — claim SQL (`:51-67`), SQLite fallback
(`:85-100`), `reclaim_stale` (`:126`), `worker_loop` (`:209`), `start_workers`/`stop_workers`
(`:246`/`:258`). New setting `REPORT_WORKERS = 1`.

### 1.2 Generation (inside the worker, off the turn)

- **proof-of-play xlsx** — walk `query_proof_report` exactly as `reports_router.py:152-174` does,
  then `await asyncio.to_thread(build_proof_workbook, ...)`.
- **campaign pdf** — call the existing `build_campaign_report_pdf(db, booking_id)`
  (`bookings/service.py:362`), which already returns `(bytes, filename)`.

**Extract the scope helper first.** `_resolve_screen_scope` (`reports_router.py:110`) is a private
router function; move it to a service so the router and the worker share one implementation.
⚠️ It returns **`None` = every screen** and **`[]` = no screens** — opposite meanings. Collapsing
them leaks the whole fleet to an unassigned screenowner. Keep the distinction and add a test for it.

### 1.3 Delivery

Upload with the download name baked in, then sign — the pattern that already works anonymously
for APKs (`app/apk/service.py:182-199`):

```python
upload_to_gcs(data, f"reports/jobs/{job.id}/{filename}",
              content_type=CONTENT_TYPES[job.format],
              content_disposition=f'attachment; filename="{filename}"')
url = signed_url_for(public_url_for_blob(blob)) or public_url_for_blob(blob)
```

⚠️ `signed_url_for` hardcodes a **7-day** TTL with no override (`gcs_service.py:23`). A report link
is a bearer capability over that operator's data. **Add a `ttl` parameter** and use ~1 hour for
reports. This is the one change to a shared helper this plan requires.

Then push:

- **CMS** — publish a `message` event on the AI bus (`app/ai/bus.py`) carrying a `file` card, and
  persist an assistant turn so it survives a reload.
  ⚠️ The frontend currently **discards `card` on `message` events** (`assistant/page.tsx:251` reads
  only `e.id`/`e.content`). That is why today's `info` card is invisible. Must be fixed.
- **WhatsApp** — `client.send(db, phone, {"kind": "document", "link": url, "filename": ..., "body": caption})`.

### 1.4 New AI tools (read-only, no confirm gate)

| Tool | Args | Behaviour |
|---|---|---|
| `generate_proof_of_play_report` | `date_from`, `date_to`, `screen_id?`, `media_id?`, `campaign_name?`, `format='xlsx'` | Creates a job, returns `{job_id}`. Agent replies *"Building it — give me a minute."* |
| `generate_campaign_report` | `name` | Resolves the campaign by name (reuse `_match_campaigns`, `tools.py:386`), checks the completed/cancelled gate, queues a PDF job. |
| `get_report_status` | `job_id` | For *"where's my report?"* — the push makes it optional, but cheap. |

The campaign PDF is gated 409 until the campaign is completed or cancelled
(`bookings/service.py:381-389`, and `is_completed` is recurrence-based, not `end_at`). The tool must
pre-check and explain in plain language, offering the xlsx instead — not surface a 409.

### 1.5 Unlock "report for campaign X"

**The root `CLAUDE.md` is out of date.** It says a `proof_of_play` row carries no `booking_id` and
that per-booking attribution "is deliberately not solved". That column now exists, is **indexed**,
and is populated: `app/playback/models.py:65`, ingested at `app/playback/service.py:157`. The
attribution rule is ready to drop in: `owns_play_clause` (`app/bookings/attribution.py:248`) matches
tagged rows exactly and falls back to media + recurrence window for legacy rows.

So: add `booking: Booking | None = None` to `query_proof_report` (`screens/service.py:1307`); when
present, AND in `owns_play_clause(...)` plus `screen_id == booking.screen_id`. Add a `"campaign"`
entry to the `filters` dict and a matching Summary row in `_write_summary`.

Filtering by `media_id` alone would be **wrong** — two campaigns sharing one creative on one screen
merge into each other. That is precisely the bug `owns_play` exists to prevent.

Fix the doc rot in `CLAUDE.md` in the same change. This also unlocks a campaign filter for the CMS
reports page later, at no extra cost.

### 1.6 Filenames

Add `proof_report_name(screen_name, campaign_name, date_from, date_to, moment)` to
`app/screenshots/naming.py` next to `campaign_report_name` (`:128`). Today the xlsx name is
hand-assembled inline at `reports_router.py:217-224`; move it and have both callers use it.

---

## Part 2 — Slot grid

The service layer is **already complete and clean** — `app/screens/slots.py` has every primitive,
each mutation commits itself and bumps `schedule_updated_at` through one funnel
(`sync_screen_loop_fields`, `slots.py:89`). This part is almost entirely agent plumbing.

### 2.1 New tools

**Read (1)** — `get_screen_slots(screen_id)` → `slots.build_grid_view` (`slots.py:533`). Return what
the CMS "Rundown" shows: 1-based position, occupant label + kind, seconds, whether it is in rotation
now, plus `loop_seconds`, total/occupied/free and the min/max/default bounds.

**Write (4, propose → confirm)** — thin wrappers over existing service functions:

| Tool | Service call |
|---|---|
| `set_slot_length(screen_id, position, seconds)` | `slots.set_slot_duration` (`:220`) |
| `set_slot_lengths(screen_id, slots[])` | `slots.set_slot_durations` (`:248`) — atomic, one schedule bump for N rows |
| `add_slot(screen_id, seconds=None)` | `slots.add_slot` (`:279`) |
| `remove_slot(screen_id, position)` | `slots.remove_slot` (`:377`) |

Registration is three places, all required: `ToolName` in `constants.py:47-57`, the same member in
`WRITE_TOOL_NAMES` (`:61-73`), an entry in `EXECUTORS` (`executors.py:192-201`).

**Copy `add_loop_item` exactly** (`tools.py:1165`, `executors.py:172`): `assert_can_manage_screen`
inside a `try` at propose time, `HTTPException` returned as an `"ERROR: ..."` string never raised,
human labels resolved before building the summary, `_propose(...)` returned last, and the
authorization **repeated in the executor** (propose-time auth is UX; executor auth is the real gate).

Do **not** copy `update_screen` — its propose-time try block wraps only `resolve_screen_label`,
which by design never raises (`app/ai/labels.py:36-49`), so it has no propose-time authorization at
all. A screenowner can get a confirm card for someone else's screen today and only fail at Confirm.
Fix that while adding the new tools.

### 2.2 Position convention

The API is **0-based**; the CMS UI and the backend's own error strings are **1-based**
(`"This screen has no slot {position + 1}."`, `slots.py:236`). Expose **1-based** to the model and
the user, convert at the service boundary, and say so in the docstring — otherwise the agent will
contradict its own error messages.

### 2.3 Every reply states the loop change

This is the behaviour asked for. The propose summary must carry it:

```
Stretch slot 2 on Café MG Road from 10s to 15s — every other slot stays 10s, loop 90s → 95s
```

So the tool computes the new loop total *before* proposing (`slots.duration_map` / `loop_seconds`,
`:190`/`:209` — one query).

### 2.4 Auto-fit a creative to its slot

This is not only a convenience — it closes wrong-answer **#2** in §0.2. Today `check_media_fit` and
`_media_fit_warning` compare **orientation and aspect ratio only**, so the agent tells a user their
30s video "fits" a 10s slot and the player silently truncates 20 seconds of a paid ad.

When a creative is longer than the slot it is going into, the agent stretches **that one slot** and
says so. Two touch points:

- `create_booking` (`tools.py:927`) — alongside the existing `_media_fit_warning` (`:329`), compare
  `media.duration_seconds` against the target slot's length. If it doesn't fit, emit a **second**
  proposal for `set_slot_length`. Both land on the same confirm card; the card already supports
  multiple actions and a "Confirm all" (`agent.py:353-374`, `render.py:220-233`).
- `add_loop_item` (`tools.py:1165`) — same check.

Reply shape:

> This ad is 15s but slot 3 is 10s. I'll stretch slot 3 to 15s — the other slots stay at 10s and the
> loop becomes 95s.

### 2.5 `update_screen` cleanup

`slot_duration_seconds` and `loop_duration_seconds` are translated into grid rewrites at
`screens/service.py:716-746` that **flatten every slot to a uniform length** — a `[10,30,10]` grid
asked for a 60s loop becomes six 10s slots, silently, changing paying advertisers' airtime. Remove
both from the **AI tool signature** (`tools.py:1070`) and from `_exec_update_screen`'s accepted args.
Keep them on the REST endpoint for back-compat. The AI tool keeps name / location / operating hours.

### 2.6 Bugs to fix in the same pass

| # | Where | Issue |
|---|---|---|
| 1 | `slots.py:586` vs `:483` | `build_grid_view` counts only `active` bookings as occupants; `occupied_positions` counts `active` **and** `paused`. So the agent says "slot 3 is free" and then `remove_slot` 422s with "still has an ad in it". Partner `free_now` (`ext_router.py:334`) uses the second. **Make `build_grid_view` match `occupied_positions`.** |
| 2 | `slots.py:296-301` | Two concurrent `add_slot` calls both compute `position = len(rows)` and collide on the deferred unique constraint → raw **500**. Catch `IntegrityError` and retry, as `ensure_slots` already does (`:162-167`). |
| 3 | `slots_router.py:66` | Duplicate positions in a bulk payload collapse silently (dict comprehension, last wins). Reject explicitly. |
| 4 | `slots.py:383-385` | `remove_slot`'s docstring claims occupied slots keep playing; the guard at `:403` refuses them. Stale docstring. |
| 5 | `schemas.py:466` | `ScreenSlotListResponse.max_slots` defaults to `120` while `MAX_SLOT_COUNT = 500`. Only wrong if defaulted, but the CMS renders it in user-facing text. |
| 6 | `prompts.py` | Zero occurrences of "slot". Needs a numbered rule separating **slot** (grid position, owns the seconds) from **loop item** (owner content) from **booking** (advertiser campaign), plus the auto-fit behaviour and the "state the new loop length" requirement. Rule 12 already fights the same conflation for bookings — extend it. |

---

## Part 3 — The delivery rail (shared by both parts)

### 3.1 New card kind `file`

`CardType.FILE = "file"` in `app/ai/constants.py:32-41` (the file joins `media_list`,
`booking_list`, `proof_report`, `dashboard_stats` — all currently **dead constants**, never
constructed, never rendered).

```json
{"type": "file",
 "summary": "Proof of play — Jul 1–31, 6 screens, 1,842 plays",
 "files": [{"filename": "...", "url": "...", "kind": "xlsx", "size_bytes": 48210}]}
```

Today **only the `action` card is persisted** (`agent.py:376-385`); `screen_grid` is bus-only and so
can never reach WhatsApp. The `file` card must be **persisted**, or the same thing happens to it.

### 3.2 CMS rendering

- New `FileCard` in `src/components/ai/AiCards.tsx`, registered in the switch at
  `src/app/(ai)/assistant/page.tsx:784-793` and the live-card switch at `:527-533`.
- Download is a plain `<a href>` straight to the signed GCS URL — **no BFF, no Bearer token**. That
  is the whole point of signing: `src/lib/api.ts:243-249` documents why a bare `<a>` cannot hit
  `/api/cms/*`, and `player-app/page.tsx:35-41` already navigates to a signed APK URL this way.
- Fix `case "message"` (`page.tsx:251`) to retain `card`.

Note the chat renders assistant text as **raw text in a `whitespace-pre-wrap` div** (`:776`) — there
is no markdown renderer in the repo. A markdown link would display literally as `[text](url)`. The
card is the delivery mechanism, not a link in the prose.

### 3.3 WhatsApp document send

`app/whatsapp/client.py:40-71` `build_payload` currently emits **text** and **interactive/button**
only; everything else silently falls through to text. `KIND_DOCUMENT` exists
(`whatsapp/constants.py:17`) but is **inbound-only** — emitting it today would record
`kind="document"` on the row while sending a text message. That is the trap.

Add a `document` branch using Meta's `link` form (no media upload needed — the signed URL is
anonymously fetchable), handle it in `render.card_to_messages` (`render.py:176`, which returns `[]`
for every non-`action` card today), and exercise it in dry-run mode (`client.py:104-111`).

---

## Sequencing

**Phase 0 — re-declare the booking tools** — ✅ **DONE 2026-08-17**
0. Signature corrections (0.3), prompt rewrite (0.4), slot-aware booking reads (0.5),
   contract test (0.7). All ten wrong answers in §0.2 are fixed. Verified by import +
   schema + ruff; the suite is the user's to run.

   **Still open from this phase:**
   - **0.6 (partial).** A `ValidationError` in `_exec_create_booking` is now a friendly
     422 instead of a 500, but a failed confirm is still an `HTTPException` that
     `confirm_service.execute_actions` does not catch — it becomes a browser toast the
     model never sees, so the agent still cannot explain or correct a failed write.
   - **Auto-fit** (2.4) needs the slot write tools, so it lands with Phase A. Until then
     the agent *warns* that a video will be truncated but cannot offer to stretch the slot.
   - `daily_windows` (multi-window bookings) remains unrepresentable — recorded as a known
     gap in `tests/test_ai_tool_contract.py`.

**Phase A — slot grid** (smallest new surface; the service layer already exists)
1. 5 tools + registration + executors, copying the `add_loop_item` shape
2. Prompt rule; 1-based convention; loop-total in every summary
3. Auto-fit in `create_booking` and `add_loop_item`
4. `update_screen` cleanup + missing propose-time authorization
5. Bugs 1–5 above; extend `tests/test_screen_slots.py` (8 tests already pin this behaviour)

**Phase B — delivery rail**
6. `CardType.FILE`, persist it, `FileCard` in the CMS, fix the `message`-event card drop
7. WhatsApp `document` send + `render.card_to_messages` branch
8. `ttl` parameter on `signed_url_for`

**Phase C — reports**
9. `report_jobs` migration + `app/reports/` + worker (clone `creative_fit`)
10. Extract `_resolve_screen_scope` into a shared service (preserving `None` vs `[]`)
11. `booking` filter on `query_proof_report` via `owns_play_clause`; fix `CLAUDE.md`
12. The 3 tools + "give me a minute" prompt guidance + push delivery on both channels
13. `proof_report_name` in `naming.py`

**Phase D — bug sweep** (independent, can land any time)
- `get_proof_of_play` (`tools.py:538`) unpacks a tuple wrong — `screens/service.py:1360` returns
  `(rows, total)`, so `rows[:50]` iterates `[list, int]` and `dict(int)` raises. **The agent's only
  proof-of-play tool cannot return data today.**
- `ProofSummary.report_url` is served **unsigned** (`bookings/service.py:56`,
  `ext_router.py:468`) → private GCS → 403. Dead link in the CMS and the partner API.
- `_SCREENSHOT_LABELS` (`proof_export.py:64`) lacks `"capturing"`, so the raw token leaks into an
  advertiser-facing workbook. `_screenshot_status` never emits the `"pending"` it does map.
- `GET /cms/bookings/{id}/screenshots` authenticates but never authorizes
  (`screenshots/service.py:1122` takes no actor) — any CMS user reads any campaign's frames.
- `plays_aggregate(group_by=...)` accepts the param and ignores it (`reports_router.py:236,250,273`).
- `POP_REPORT_STORAGE` (`config.py:204`) is never read; `build_and_upload_report` hardcodes GCS-first.

---

## Testing

Per project convention: **no pytest runs from Claude** — verification is by import/syntax check, and
the user runs the suite.

New coverage to write: scope `None` vs `[]`; campaign-filtered rows match `owns_play` on both tagged
and legacy rows; job claim/reclaim under `SKIP LOCKED`; the `file` card round-trips through
`render_turn`; slot auto-fit emits two proposals on one card; a screenowner is refused at propose
time (not just at Confirm).
