# Mark AI Co-Pilot — capability analysis (26 Aug 2026)

What the co-pilot actually does today, what it deliberately refuses, and where the CMS
has grown features the co-pilot was never taught. Read from the code, not the plan docs
(`AI_CMS_CO_PILOT_MASTER_PLAN.md` is the June vision and is now partly stale).

Source of truth: `markai-signage-api/app/ai/` (30 tools, ~15.6k lines) and
`markai-Web-cms/src/app/(ai)/assistant`.

---

## 1. What it is, architecturally

One agent, two front doors, four model calls per turn at most.

| Piece | Where | Model |
|---|---|---|
| Main agent (persona + 29 tools) | `app/ai/tools.py:130` `get_agent()` | `google:gemini-2.5-flash` (`AI_MODEL`) |
| Scope guardrail (in/out of scope classifier, runs *before* the agent) | `app/ai/guardrails/scope.py` | `gemini-3.5-flash-lite` (`AI_GUARDRAIL_MODEL`) |
| Draft slot extractor (backstop so stated facts always land in the draft) | `app/ai/extract.py` | `AI_DRAFT_EXTRACT_MODEL` → `AI_MODEL` |
| Brand read off the creative (names the campaign) | `app/ai/brand.py` | `AI_BRAND_MODEL` → `AI_MODEL`, cached per media row |

- **Transports:** the CMS chat (`/api/cms/ai/*`, SSE stream, `app/ai/router.py`) and
  **WhatsApp** (`app/whatsapp/` — a transport adapter, *not* a second agent; it calls the
  same `run_turn`, `app/whatsapp/inbound.py:365`). Same tools, same permissions, same session.
- **Gmail ingestion is a different agent** (`app/gmail/extract.py`) — the co-pilot has no
  tools that can see or act on Gmail drafts.
- **Determinism where the model can't be trusted:** turn lock (`locks.py`), prelock of
  stated facts (`prelock.py`), numbered-screen picker (`picker.py`), booking draft notepad
  + archive (`draft.py`), rolling summary for long chats (`history.py`), single confirm
  path shared by web + WhatsApp (`confirm_service.py`), async push of screenshots/reports
  into a chat the operator has left (`delivery.py`).
- **Writes are never executed by the model.** Every mutation is *proposed* onto a confirm
  card and executed by `app/ai/executors.py` after the user presses Confirm (or replies
  "yes" on WhatsApp).
- **Permissions are enforced per tool**, not by prompt: `assert_can_manage_screen` /
  `assert_media_visible` on every screen- or media-scoped call, so a screenowner's
  co-pilot sees exactly their assigned screens.

---

## 2. What the co-pilot CAN do

### Booking (the main flow)
- Take a creative dropped in chat (image or video, ≤200 MB, ≤10 files/msg) and treat it as
  a booking request; checksum-match it against the library and reuse instead of duplicating.
- Resolve a place phrase, typo-tolerant + geocoded, and rank screens by distance with
  `near / offer / far / unknown` bands (`search_screens`, capped at 8 of N shown).
- Resolve "1 and 3", "the HSR one", "all of them" against the list actually shown
  (`pick_screens`, deterministic).
- Auto-name the campaign and booking from the brand read off the artwork (`Zomato`,
  `Zomato_Café MG Road`) — no name is ever asked for.
- Create one booking per screen in one confirm card (`create_booking`), with warnings for
  offline screen, pixel misfit, and video longer than its slot.
- Pause / resume / cancel (`set_booking_status`), delete (`delete_booking`), toggle
  per-play "premium" screenshots (`toggle_premium_screenshots`).
- Keep a **booking draft** across turns and across topic changes, archive it on an explicit
  cancel, and recall it later (`update_booking_draft`, `recall_booking_draft`).

### Screens & loop
- `get_screen`, `get_screen_schedule` (resolved loop the screen is really playing),
  `list_screen_campaigns` (by campaign, numbered), `get_proof_of_play` (last 50 rows).
- Status literacy: `online / off_hours / offline / display_off` — including "which screens
  have problems" = offline + display_off, with `last_seen_at`.
- `update_screen` — name, location, **operating hours** (both bounds required; a
  half-specified window is blocked at propose time).
- Owner playlist: `get_screen_loop`, `add_loop_item` (with daily window + days of week),
  `remove_loop_item`.

### Proof, QA and reports
- `get_campaign_plays` — **what a campaign actually delivered**: total plays, airtime,
  day-by-day (weekly bars past 60 days), and the per-creative split for a rotating
  campaign. Whole run by default, `owns_play_clause` attribution, and it ends by offering
  the Excel — a "yes" builds the same-numbered sheet. (Added 26 Aug.)
- `analyze_campaign_playback` — schedule ∩ operating hours vs. real plays: delivery %,
  missing days, intraday gaps, strict healthy/not verdict.
- `find_campaign` (fuzzy, ambiguity-aware), `list_campaigns_in_range` (max 20).
- `request_campaign_screenshot` — on-demand capture, delivered back into the chat
  minutes later by `delivery.py` (no APK release needed).
- `get_campaign_milestone_photos` — the already-captured start/mid/end frames.
- `get_report` — proof-of-play **Excel** and campaign **PDF**, two-phase (resolve, repeat
  back, then build only on the user's yes), always with an explicit date range.
- `get_dashboard_stats` — screens total/online, active bookings, plays today (IST day).

### Creative
- `check_media_fit` — pixel verdict **plus** `airtime_warning` (a video that fits the panel
  but overruns its slot).
- `fit_creative` — queues a Creative-Fit job for **images**, drops the fitted version back
  into the chat, and it becomes the creative in hand for the next booking sentence.
- `list_media` — search the library, brand-aware (finds "swiggy" even when the file is
  `IMG_4412.jpg`).

---

## 3. What it will NOT do (by design)

| Refusal | Where it's enforced |
|---|---|
| Anything off-platform (trivia, code, news, medical/legal/financial) | classifier before the agent + hard SCOPE rule in the prompt; fail-open on classifier error |
| Execute any change on its own | `WRITE_TOOL_NAMES` / confirm card / `executors.py` |
| Let a client choose how long an ad plays | the **slot** owns the seconds; `min_display_seconds` is stripped from tool output |
| Change slot or loop timing | `update_screen` explicitly refuses — the legacy fields flatten a mixed grid |
| Fit a **video** | `fit_creative` returns "video fit is coming" |
| Promise an instant screenshot | it fires on the ad's next genuine play; blocked reasons are relayed, never retried |
| Build a fleet-wide, all-campaigns report | a screen or a campaign is required; a date range is always applied |
| Touch a screen the operator isn't assigned | `assert_can_manage_screen` on every path |
| Book outside a screen's operating hours | 422 from the booking service; the agent must offer trim-or-extend |
| Invent a distance, a play count, or a report link | tool contracts say "use only returned fields" |

---

## 4. CMS features the co-pilot was never given

Ordered by how often an operator would actually hit them.

### Sharp edges — the CMS can do it, the co-pilot says it can't
1. **Reschedule a live campaign.** `PATCH /cms/bookings/{id}` accepts `schedule_type`,
   `start_at`, `end_at`, `duration_days`, `daily_windows`, `days_of_week`,
   `target_plays_per_day` (`app/bookings/schemas.py:379`), and the CMS ships
   `EditScheduleModal`. The co-pilot has **no tool**, and its prompt still states the
   schedule is *frozen* and "extend it" means cancel + rebook. That is now wrong advice.
2. **Rename a campaign/booking.** Same PATCH accepts `name`; the prompt says "there is no
   rename tool — renaming happens on the booking's CMS page."
3. **Creative rotation on a live campaign** — `POST /bookings/{id}/creatives`,
   `PATCH .../creatives/{media_id}`, `PUT .../creatives/order`, `POST .../replace-ad`
   (`CreativeRotationList.tsx`). Zero co-pilot coverage: it can only book one creative.

### Whole CMS areas with no tools at all
4. **Per-slot grid editing** — add / move / resize / delete slots
   (`/cms/screens/{id}/slots`, `SlotGrid.tsx`, `SlotRotation.tsx`). The co-pilot can *read*
   airtime but cannot change it; a tool comment even references a `get_screen_slots` tool
   that does not exist (`tools.py:181`).
5. **Screen lifecycle** — delete (+ deletion preview), archive export, rescan location,
   bulk operating-hours edit, enrollment policy.
6. **APK updates** — per-screen and bulk push, update-job status (`/cms/screens/update-apk`),
   and the Player-app page. Entirely invisible to chat.
7. **Media library management** — upload standalone (chat upload only becomes a library
   asset when a booking is confirmed), rename/edit metadata, delete, resumable
   upload sessions.
8. **Multi-zone layouts / Solutions** — the `/solution` page and `/cms/solutions` exist;
   `ToolName.CREATE_SOLUTION` and `UPDATE_BOOKING_LAYOUT` are declared but **no tool
   proposes them** (and `CREATE_SOLUTION` has no executor either — dead wiring).
9. **Users & access** — create/edit/delete operators, screen assignments, password reset,
   WhatsApp number linking. Correct per the permission model, but worth stating.
10. **API keys** — create/list/revoke. Deliberately out of scope for screenowners.
11. **Creative Fit, the full product** — targets, analyze, job list/cancel, save-to-library,
    and the whole **video** path. The co-pilot exposes a thin image-only slice.
12. **Gmail ingestion** — drafts, screen suggestions, confirm-to-book. A second agent runs
    it; the co-pilot can't see it.
13. **Reports depth** — *partly closed 26 Aug*: `get_campaign_plays` now gives per-day and
    per-creative delivery for one campaign in chat. Still CMS-only: the fleet-wide 14-day
    trend, the multi-ad union filter (several creatives across campaigns), and the
    per-booking hourly timeline. `get_dashboard_stats` still returns four numbers with no
    `display_off`/`off_hours` breakdown even though the CMS overview computes it.
14. **AI conversation review** — the review feed, flags and per-user session inspection
    (`app/review/`) are a CMS-side tool for watching the co-pilot; not self-accessible.

---

## 5. Dead or drifting wiring worth cleaning

- `ToolName.CREATE_SOLUTION` — in `WRITE_TOOL_NAMES`, no executor, no tool. Unreachable.
- `ToolName.UPDATE_BOOKING_LAYOUT` — executor exists, no tool proposes it. Unreachable.
- `tools.py:181` comment points at `get_screen_slots`, which was never built.
- Prompt claims that contradict shipped CMS behaviour: schedule frozen, no rename
  (see §4.1–4.2).
- `get_proof_of_play(screen_id)` is now the raw-rows-for-one-screen tool only; campaign
  questions route to `get_campaign_plays`. Its docstring says so, but the tool itself is
  still the unfiltered legacy endpoint (no dates, no ad names) and is a candidate for
  retirement once nothing asks it for a campaign.

---

## 6. One-line verdict

The co-pilot is a complete **booking + proof** operator — it can take an ad from a
WhatsApp message to a confirmed, monitored, reported campaign without anyone opening the
CMS. It is **not** yet a *management* operator: everything that came after the booking
flow was built — slot grids, creative rotation, rescheduling, APK fleet updates, video
fit, library management — landed in the CMS only, and in two places the prompt now tells
operators those things are impossible.
