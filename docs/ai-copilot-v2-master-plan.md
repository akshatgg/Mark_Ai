# Mark AI Co-Pilot v2 — Master Implementation Plan

**Date:** 2026-08-26
**Status:** PLAN. Nothing here is implemented yet.
**Purpose:** This file is the implementation contract. Hand it to a Claude session and it
should be able to write the code without re-deriving any decision.

---

## 0. How to use this file

- **§1–§4** are the *why* and the *shape*. Read once.
- **§5** is the **tool catalog** — 27 declarations, each with args, returns, boundary,
  examples, and the exact backend service it wraps. This is what you code against.
- **§6** is the **playbooks** (workflow prose + golden transcripts).
- **§7–§9** are the deterministic layers: pre-flight, router, gates.
- **§10** is the **phase plan** with acceptance criteria. Build in this order.
- **§11** is the eval harness. It is Phase 0 for a reason.

**Rules that apply to every phase:**
1. Nothing ships without its golden transcripts added to the harness (§11).
2. No behaviour rule lives only in prose — if it must never be broken, it is a gate (§9).
3. `ruff check app/` must pass. Do not run pytest (user runs tests).
4. Do not commit or push unless asked.

---

## 1. Where we are today (verified, 2026-08-26)

Measured from the code, not estimated:

```
30 tools, split by what they actually do:

  PURE READ    17   search/find/get/analyze/list — no side effects
  ACT-NOW       4   fit_creative · get_report · request_campaign_screenshot
                    · get_campaign_milestone_photos   → starts a job, NO card
  STATE         2   update_booking_draft · recall_booking_draft
  PROPOSE       7   create_booking · set_booking_status · delete_booking
                    · update_screen · toggle_premium_screenshots
                    · add_loop_item · remove_loop_item  → ALWAYS a confirm card

Fixed context cost, EVERY turn:
  system prompt   3,805 tokens
  tool schemas    6,480 tokens
  ─────────────────────────────
  total          10,285 tokens   ← 100% loaded regardless of what was asked
```

### The three root problems

**P1 — A whole domain is invisible.** `app/screens/slots.py` is complete and tested
(`build_grid_view`, `set_slot_duration`, `move_occupant`, `add_slot`, `remove_slot`,
`occupied_positions`, `loop_seconds`). The CMS uses all of it. **The agent has zero slot
tools**, and `update_screen` explicitly refuses slot timing. So "how many slots are free",
"increase slot 2 to 15s", "move my ad to slot 1" are all unanswerable today.

**P2 — No entity resolver.** A name can be a campaign, a booking, or a creative.
`_match_campaigns` searches booking names only; `list_media` searches media names only;
`get_report` hand-rolls "try campaign then creative" *in a docstring*. Every tool guesses
differently.

**P3 — No reverse lookup.** "Which screens play this ad?" has no query. The joins exist
(`Booking.media_id`, `BookingCreative.media_id`, `LoopItem.media_id`); nothing assembles them.

**Meta-cause:** tools were added per shipped feature, so the agent's world model is 30
disconnected verbs. The product's world model is five nouns in one chain:

```
SCREEN ──has──► GRID of SLOTS ──each holds──► OCCUPANT ──shows──► CREATIVE ──produces──► PLAYS
                (position, seconds)       (booking | loop item)      (the ad)       (proof of play)
```

Every operator question is a traversal of that chain.

### Secondary problems

- **Tool descriptions carry workflow.** `create_booking` is 602 tokens explaining how a
  booking *conversation* should go. That belongs in a playbook. This is why schemas are
  huge and why neighbouring tools contradict each other.
- **Known collisions:** `get_screen_schedule` vs `list_screen_campaigns`;
  `request_campaign_screenshot` vs `get_campaign_milestone_photos`; `find_campaign` vs
  `get_booking` vs `list_bookings` vs `list_campaigns_in_range`; `create_booking` vs
  `add_loop_item`.
- **Prompt claims that are false:** it tells operators a booked schedule is frozen and
  that renaming is impossible. `PATCH /cms/bookings/{id}` supports both
  (`app/bookings/schemas.py:379`), and the CMS ships `EditScheduleModal`.
- **Dead wiring:** `ToolName.CREATE_SOLUTION` (no executor, no tool),
  `ToolName.UPDATE_BOOKING_LAYOUT` (executor, no tool), a comment referencing a
  `get_screen_slots` tool that was never built (`app/ai/tools.py:181`).
- **`get_dashboard_stats`** returns four numbers with no `display_off`/`off_hours`
  breakdown, though the CMS overview computes exactly that. So "which screens have
  problems?" is owned by no tool.

### What is already good and must NOT be rewritten

The deterministic pipeline is the reason this system works at all. Keep every piece:

| Piece | File | What it guarantees |
|---|---|---|
| Session turn lock | `app/ai/locks.py` | one turn at a time; no state clobber |
| Consent gate | `app/ai/agent.py:337` | bare "yes"/"no" on a pending card is code, never model judgment |
| Scope guardrail | `app/ai/guardrails/` | off-topic never reaches the agent (fail-open) |
| Prelock | `app/ai/prelock.py` | file/date/seconds/single-match screen locked before the model reads |
| Draft extractor | `app/ai/extract.py` | stated facts reach the draft even if the model doesn't call the tool |
| Picker | `app/ai/picker.py` | "1 and 3" resolves against the list actually shown |
| Draft + archive | `app/ai/draft.py` | anti-re-ask memory across turns |
| Rolling summary | `app/ai/history.py` | long chats without a huge window |
| Confirm service | `app/ai/confirm_service.py` | one implementation shared by web + WhatsApp buttons |
| Delivery | `app/ai/delivery.py` | async results pushed into the right conversation |
| WhatsApp transport | `app/whatsapp/` | a transport adapter, not a second agent |

---

## 2. Design principles (decided, do not relitigate)

1. **Closed domain, not open.** Fixed schema, ~60 known operations. Invest in
   pre-computation, resolution and gates — NOT in discovery. **Never give the agent raw
   SQL or a shell.** A wrong query here is a billing incident.
2. **No RAG / embeddings.** The data is small, relational and permissioned. Retrieval
   would still need the same `WHERE screen_id IN (assigned)` filter afterwards. Revisit
   only if a real text corpus appears (contracts, ops handbook, months of transcripts).
   For fuzzy names at scale, use Postgres `pg_trgm`, not vectors.
3. **Two voices, many models.** Multi-agent underneath; one assistant to the operator.
   The user must never see a handoff or repeat themselves.
4. **Gates in code, not prose.** Any rule that must never be broken is enforced at the
   tool boundary and returns a `BLOCKED:` string the model relays.
5. **Contract in tools, workflow in playbooks.** Tool descriptions ≤120 tokens.
6. **WhatsApp sets the floor.** Never rely on anything only the CMS has (this is why
   page-context injection was rejected). Anything added must work in a bare chat.
7. **Fewer questions.** One question per turn, maximum. One confirmation, at the end.

---

## 3. Target architecture

```
════════════════════════════════════════════════════════════════════════════════════════
  MARK AI CO-PILOT v2 — MASTER TURN FLOW
════════════════════════════════════════════════════════════════════════════════════════

   CMS chat (SSE)                                          WhatsApp (webhook)
         │                                                        │
         │                                              ┌─────────┴──────────┐
         │                                              │  button tap?       │
         │                                              └────┬───────────┬───┘
         │                                                YES│           │NO
         │                                                   ▼           │
         │                                        ╔══════════════════╗   │
         │                                        ║ confirm_service  ║   │
         │                                        ║  NO MODEL RUNS   ║───╫──▶ ⑤ EXECUTE
         │                                        ╚══════════════════╝   │
         └───────────────────────┬───────────────────────────────────────┘
                                 ▼
                    turn row created (pending) ──▶ background run_turn
                                 │
╔════════════════════════════════▼═════════════════════════════════════════════════════╗
║  L1   DETERMINISTIC PRE-FLIGHT           (pure code — no model may override these)   ║
╠══════════════════════════════════════════════════════════════════════════════════════╣
║   ①  SESSION LOCK ─ one turn at a time per session                                   ║
║   ②  CONSENT GATE ─ bare "yes"/"no" AND a card pending?                              ║
║                     ├── YES ──▶ execute / dismiss ──▶ reply ──▶ ■ END                ║
║                     └── NO ───▶ continue                                             ║
║   ③  SCOPE GUARD ── on-platform? (skipped if draft active or file attached)           ║
║                     ├── OFF-TOPIC ──▶ fixed refusal ──▶ ■ END                        ║
║                     └── IN SCOPE ──▶ continue                                        ║
║   ④  CONTEXT BUILD ─ history window + rolling summary                                ║
║                    ─ draft extractor (tiny model, conditional)                       ║
║                    ─ PRELOCK (file · date · seconds · single-match screen)            ║
║                    ─ brand read (1 vision call per NEW creative)                     ║
║                    ─ DOSSIER ★ who you are · your screens · hours · status           ║
║                    ─ LAST TOUCHED ★ last screen · campaign · ad · slot               ║
╚════════════════════════════════╤═════════════════════════════════════════════════════╝
                                 ▼
╔══════════════════════════════════════════════════════════════════════════════════════╗
║  L2   ROUTER ★                                                                       ║
║   DETERMINISTIC RULES FIRST (code decides what code can decide):                     ║
║      attachment present ............................ ▶ ACTION                        ║
║      active draft with required fields missing ..... ▶ ACTION                        ║
║      "what / how many / when", no entity named ..... ▶ READ                          ║
║      anything else ................................. ▶ classifier (flash-lite)       ║
║                                    └── UNSURE ...... ▶ ACTION  (cheap mistake)       ║
╚═══════════════╤══════════════════════════════════════════════════╤═══════════════════╝
                ▼                                                  ▼
┌───────────────────────────────────┐  escalate ┌──────────────────────────────────────┐
│  READ AGENT — "Answers"           │  ONE HOP  │  ACTION AGENT — "Changes"            │
│  flash-lite · cheap · fast        │ ────────▶ │  strong model                        │
│  20 tools: 17 READ · 3 ACT-NOW    │ same turn │  28 tools = all 20 + 6 PROPOSE       │
│  NO tool with a writing action    │ state kept│                   + 2 STATE (draft)  │
│  ✗ CANNOT propose                 │ no re-ask │                                      │
│  playbooks: lookup · proof        │           │  playbooks: booking · modify         │
└───────────────┬───────────────────┘           └──────────────────┬───────────────────┘
                └────────────────────┬─────────────────────────────┘
                                     ▼
                    ┌────────────────────────────────────┐
                    │  RESOLVER ★  "what did they name?" │
                    │  screen│campaign│ad│slot + WHERE   │
                    │  one winner ─▶ act                 │
                    │  several ────▶ ONE numbered list   │
                    │                ─▶ pick             │
                    └────────────────┬───────────────────┘
                                     ▼
                    ┌────────────────────────────────────┐
                    │  GATES (code, not prose)           │
                    │  scope · hours · slot vs video len │
                    │  swap warning · no double-propose  │
                    └────────────────┬───────────────────┘
                                     ▼
              ┌──────────────────────┴──────────────────────┐
              ▼                                             ▼
     READ / ACT-NOW                                    PROPOSE
     runs immediately                          ┌──────────────────────┐
     (job queued, no card)                     │  ONE CONFIRM CARD    │
              │                                └──────────┬───────────┘
              └──────────────────────┬────────────────────┘
                                     ▼
                    ┌────────────────────────────────────┐
                    │  L7 VERIFIER ★ (silent, tiny)      │
                    │  numbers & refusals checked        │
                    │  against the tool output           │
                    └────────────────┬───────────────────┘
                                     ▼
                    ┌────────────────────────────────────┐
                    │  ONE REPLY, ONE VOICE              │
                    │  ANSWER │ PROBLEM │ NEXT STEP      │
                    └────────────────┬───────────────────┘
                        ┌────────────┴────────────┐
                        ▼                         ▼
                  stream to CMS            render to WhatsApp

════════════════════════════════════════════════════════════════════════════════════════
   ⑤ CONFIRM PATH — the only way state ever changes
       tap Confirm / say "yes" ─▶ consent gate or /confirm ─▶ executors.py ─▶ DB write
       ─▶ schedule_updated_at bumped ─▶ screen's next heartbeat (≤60s) ─▶ ON THE GLASS

   ⑥ ASYNC RETURN — answers that arrive minutes later
       ACT-NOW job ─▶ heartbeat hands it to the screen ─▶ parked
                   ─▶ shutter trips on the ad's NEXT REAL PLAY ─▶ upload
                   ─▶ delivery.py ─▶ new turn in the SAME chat (no model involved)
════════════════════════════════════════════════════════════════════════════════════════

SHARED SPINE — never duplicated between the two agents:
  session_state · booking draft + archive · resolver · picker · dossier
  gates · confirm card · voice contract · rolling summary · ONE reply
```

**★ = new in v2.**

### Four paths that never touch a model (verified)

| Path | Where | Why |
|---|---|---|
| WhatsApp button tap | `app/whatsapp/inbound.py:149` | consent already given by tapping |
| Bare yes/no on a pending card | `app/ai/agent.py:337` | consent is code |
| Off-topic refusal | scope guard | spends nothing |
| Async delivery | `app/ai/delivery.py` | arrives on a different request |

---

## 4. The three tool classes

Every declaration in §5 is exactly one of these. This classification decides which agent
holds the tool and whether a confirm card is produced.

| Class | Meaning | Card? | Agent |
|---|---|---|---|
| **READ** | pure query, no side effects | no | both |
| **ACT-NOW** | starts a job; no campaign/screen state changes; cheap to withdraw | no | both |
| **PROPOSE** | changes what plays or what is billed | **always** | Action only |
| **STATE** | writes the conversation notepad only | no | Action only |

**v2 catalog totals:** 17 READ · 3 ACT-NOW · 6 PROPOSE · 2 STATE = **28**.
**No hybrids.** A tool is exactly one class, because the Read agent's safety guarantee is
"it does not hold a tool that can write" — a hybrid would break that.

**A screenshot is not a write.** Neither is a report or a creative fit. They start jobs,
cost nothing, and never change what plays — which is why they have no card today and must
not get one.

---

## 5. THE TOOL CATALOG — 28 declarations

### 5.0 The description standard

Every tool description follows this shape, in this order, ≤120 tokens:

```
1  WHAT QUESTION IT ANSWERS  — in the operator's words, not ours
2  BOUNDARY                  — "NOT for X → use Y"  (only where a real neighbour exists)
3  ARGS                      — unambiguous names (screen_ids, not screens); enums as Literal
4  RETURNS                   — the fields, plainly
5  HONESTY RULE              — "quote only what this returned"
6  EXAMPLES                  — 1–2 one-line call examples. Two, never one (one anchors).
```

**Workflow prose NEVER goes in a tool description.** It goes in the playbook (§6).

Enforcement test, applied to every name below: *if a human engineer cannot say which tool
applies to a given request, the model cannot either.*

**Naming:** `noun_verb`, namespaced by domain. Actions are `Literal` enums so an invented
action is impossible (this is what stopped `schedule_type="hourly"` reaching an executor).

---

### GROUP A — RESOLVE (2 tools) ★ NEW

#### A1. `resolve` — READ — both agents
```
What did the user just name?
Resolves a phrase to typed entities across screens, campaigns, creatives and slots,
and says WHERE each one lives. Deterministic first (exact → prefix → text_score);
only ties reach the model.
NOT for picking from a list you already showed → pick.

args    phrase: str
        kinds: list[Literal["screen","campaign","creative","slot"]] | None  (None = all)
returns matches: [{kind, id, label, status, where: [{screen, slot_position}]}]
        certain: bool   (exactly one clear winner)
        candidates: [...] when ambiguous — show these NUMBERED and ask

e.g.  "sanjivani"        → 1 creative (2 screens) + 2 campaigns → certain=false
      "the xiaomi screen"→ 1 screen → certain=true
```
**Wraps:** `bookings_service.list_bookings`, `content_service` media search,
`screens_service.list_screens_for_user`, `screen_slots.build_grid_view`,
`core.matching.text_score`. Scope-filtered by `get_assigned_screen_ids` BEFORE ranking.
**Performance:** `text_score` runs in Python, so never score the whole estate. Shortlist
in the DB first (`ILIKE`/`pg_trgm` on name, capped at ~50 rows per kind), then score the
shortlist. At today's scale either works; at 500 screens and thousands of campaigns the
naive version scans everything on every turn.
**Replaces:** the ad-hoc guessing in `_match_campaigns`, `list_media`, and `get_report`'s
"try campaign then creative" prose.

#### A2. `pick` — READ — both agents
```
Turn the user's answer to a numbered list into real ids.
Pass their EXACT words. Never map numbers to entities yourself — the list is not in
your history, and a wrong guess acts on the wrong advertiser.
NOT for a fresh search → resolve / screen_search.

args    refs: list[str]        e.g. ["1","3"] | ["the HSR one"] | ["all"]
returns picked: [{kind, id, label}]   unresolved: [str]

e.g.  ["3"]                    → the 3rd item of the last list shown
      ["1 and the Blue Tokai"] → two entities
```
**Wraps:** `app/ai/picker.py` (generalise `render_shown`/`resolve` from screens to any
entity kind).
**CRITICAL:** the shown list is stored on **`session_state`**, never on `AiDeps`. Tool
results are not replayed into model history, and `AiDeps` is rebuilt per turn *per agent*
— so a list shown by the Read agent must still resolve when the next turn (or the same
turn, after an escalation) runs on the Action agent. `session_state` is the only store
both agents share.
**Replaces:** `pick_screens`.

---

### GROUP B — SCREEN (3 tools)

#### B1. `screen_search` — READ — both
```
Find screens by place or by name. Ranked, never filtered; typo-tolerant and geocoded.
Never ask the user to re-type a place.
NOT for "what's playing on it" → slot_grid.

args    phrase: str | None   (None = the operator's whole fleet)
returns query, matched_place, showing, total_matches,
        screens: [{screen_id, name, location, city, status, resolution,
                   operating_hours, last_seen_at, distance_km, band, match_reason}]
        band: near | offer | far | unknown   — obey it; never invent a distance

e.g.  "koramangala"  → nearest first with distance_km
      "xiami"        → name match (Xiaomi screen), distance_km=null
```
**Wraps:** `screens_service.list_screens_for_user` → `screens.resolve.resolve_location`.
Keep `AI_SEARCH_MAX_RESULTS` cap and the `showing < total_matches` honesty field.
**Replaces:** `search_screens` (unchanged behaviour, new name + trimmed description).

#### B2. `screen_get` — READ — both
```
One screen in full: hours, live status, resolution/orientation, slot count and loop length.
NOT for per-slot detail → slot_grid.

args    screen_id: str
returns screen_id, name, location, city, address, status, resolution, orientation,
        operating_hours, last_seen_at, total_slots, loop_duration_seconds,
        default_slot_seconds

e.g.  screen_id="…"  → "Café MG Road, 09:00–17:00 IST, online, 1080x1920, 9 slots/90s"
```
**Wraps:** `screens_service.get_screen` + `to_summary`, `playback_health.fmt_operating_hours`.
**Replaces:** `get_screen`.

#### B3. `screen_update` — PROPOSE — Action
```
PROPOSE editing screens: name, location, or the daily ON window.
Hours need BOTH bounds as IST minute-of-day (09:00=540). One bound alone is BLOCKED.
Does NOT change slot or loop timing → slot_edit.

args    screen_ids: list[str]          (several = bulk, one card)
        action: Literal["rename","location","hours"]
        name: str | None   location: str | None
        on_start_minute: int | None    on_end_minute: int | None
returns a proposal on the confirm card

e.g.  action="hours", screen_ids=["a"], on_start_minute=540, on_end_minute=1320
      action="rename", screen_ids=["a"], name="Café MG Road – Front"
```
**Wraps:** `screens_service.update_screen`; bulk via `PATCH /cms/screens/operating-hours`.
**Replaces:** `update_screen` (+ adds bulk).

---

### GROUP C — SLOT ★ NEW DOMAIN (2 tools)

> The backend is complete and tested. Nothing new is needed below the tool layer.

#### C1. `slot_grid` — READ — both
```
The screen's slot grid: every position, its length, who is in it, and what is free.
This is what a human sees on the screen page — use it for "how many slots",
"what's left", "what's in slot 2", "what's the loop", "which ad is where".
NOT for a campaign's delivery numbers → campaign_plays.

args    screen_id: str
returns screen, total_slots, loop_seconds, free_positions: [int],
        slots: [{position, seconds, occupant: {kind: booking|loop_item, label,
                 media_name, rotation_size, playing_now} | null}]

e.g.  → "9 slots, 90s total. 6 taken, 3 free. Slot 2 is 15s (Sanjivani, 2 ads)."
```
**Wraps:** `screen_slots.build_grid_view` (returns `ScreenSlotListResponse` with
`SlotOccupant`), `screen_slots.loop_seconds`, `screen_slots.occupied_positions`.
Positions are 0-based internally; **display them 1-based** (matches the CMS slot map —
see `_booking_airtime` which already does `int(position) + 1`).
**Replaces:** `get_screen_schedule`, `list_screen_campaigns`, `get_screen_loop` (read half).

#### C2. `slot_edit` — PROPOSE — Action
```
PROPOSE changing the slot grid: a slot's length, moving an ad to another slot,
adding or removing a slot.
Moving onto a TAKEN slot SWAPS the two ads — and their play lengths swap with them.
Say that before confirm. NOT for booking an ad → campaign_create.

args    screen_id: str
        action: Literal["set_seconds","move","add","remove"]
        position: int | None      seconds: int | None
        to_position: int | None   (move)
returns a proposal on the confirm card, including the occupant's name

e.g.  action="set_seconds", position=2, seconds=15
      action="move", position=4, to_position=1     → names both ads in the swap
```
**Wraps:** `screen_slots.set_slot_duration`, `.move_occupant`, `.add_slot`, `.remove_slot`.
All of them bump `schedule_updated_at` in the same transaction — do not duplicate that.
**Gates:** see §9 G4–G6.

---

### GROUP D — CAMPAIGN (8 tools)

#### D1. `campaign_find` — READ — both
```
Look a campaign up by NAME or id, or list campaigns by filter.
Returns airtime_seconds (the length of the slot it sits in) and slot_position.
NEVER quote default_slot_seconds as an ad's airtime.
NOT for delivery numbers → campaign_plays. NOT for "is it healthy" → campaign_health.

args    name: str | None   booking_id: str | None
        screen_id: str | None
        status: Literal["active","paused","cancelled","completed"] | None
        date_from: str | None   date_to: str | None    (YYYY-MM-DD, overlap)
returns campaigns: [{name, booking_id, screen, status, start_at, end_at,
                     schedule_type, airtime_seconds, slot_position, creative_count}]
        ambiguous + candidates when a name matches several

e.g.  name="Summer Sale"                       → one campaign in full
      status="active", screen_id="…"           → what's booked on that screen
      date_from="2026-08-01", date_to="2026-08-31"
```
**Wraps:** `bookings_service.list_bookings`, `.get_booking`, `.get_booking_detail`,
`_booking_airtime`, `_match_campaigns` + `_clear_winner`.
**Replaces:** `find_campaign`, `get_booking`, `list_bookings`, `list_campaigns_in_range`.

#### D2. `campaign_create` — PROPOSE — Action
```
PROPOSE booking an ad. One call covers every shape:
  1 ad × 1 screen · N ads × 1 screen (they alternate, one per loop pass)
  1 ad × N screens · N ads × N screens
Produces ONE proposal per screen, all on ONE card.
The SLOT owns the seconds — a booking cannot ask for its own duration.
Do NOT pass a name; it is derived from the creative.

args    screen_ids: list[str]        media_ids: list[str]       (first = primary)
        end_date: str               (YYYY-MM-DD — REQUIRED)
        start_date: str | None      (default: today)
        schedule_type: Literal["continuous","specific_time","times_per_day","custom"]
                                    (default "continuous")
        daily_start/daily_end: "HH:MM" | None   days_of_week: list[int] | None
        target_plays_per_day: int | None        screenshot_enabled: bool = False
returns one proposal per screen + warnings (offline, fit, video>slot, hours)

e.g.  screen_ids=["a"], media_ids=["m1"], end_date="2026-09-30"
      screen_ids=["a","b","c"], media_ids=["m1","m2"], end_date="2026-09-30"
```
**Wraps:** `bookings_service.create_booking`; extra creatives applied inside the same
executor via `add_booking_creatives` (see §8 E1).
**Replaces:** `create_booking` (one call per screen → one call with lists).
**Why lists:** a model that forgets one of three `create_booking` calls silently
under-books a client. A list argument cannot be forgotten.

#### D3. `campaign_update` — PROPOSE — Action
```
PROPOSE changing an existing campaign: rename, reschedule, pause, resume, cancel, delete.
Rescheduling IS allowed on a live campaign (the merged schedule is re-validated exactly
like a create). Refused once cancelled/completed/rolled-up — say so plainly.
Screen and creative are NOT editable → campaign_creatives_edit (ads) or a new booking (screen).

args    booking_id: str
        action: Literal["rename","reschedule","pause","resume","cancel","delete"]
        name: str | None
        start_date/end_date: str | None   schedule_type: … | None
        daily_start/daily_end: str | None days_of_week: list[int] | None
        target_plays_per_day: int | None
returns a proposal on the confirm card

e.g.  action="reschedule", booking_id="…", end_date="2026-10-15"
      action="rename", booking_id="…", name="Zomato Diwali"
```
**Wraps:** `bookings_service.update_booking` (`UpdateBookingRequest`,
`app/bookings/schemas.py:379`), `.update_booking_status`, `.cancel_booking`.
**Replaces:** `set_booking_status`, `delete_booking`. **Fixes:** the false "schedule is
frozen / no rename" claims in today's prompt.

#### D4a. `campaign_creatives_list` — READ — both
```
The ads inside one campaign, in play order, with each one's plays.
Use it before photographing or changing a rotating campaign — the operator picks by
NUMBER from what you show.
NOT for changing them → campaign_creatives_edit.

args    booking_id: str
returns rotating: bool, count: int,
        creatives: [{position, media_id, name, plays, first_play_at, last_play_at}]

e.g.  booking_id="b7"   → rotating=true, 5 ads: Diwali_A, Diwali_B, Offer_15s, …
      booking_id="b9"   → rotating=false, 1 ad  (never ask which — just act)
```

#### D4b. `campaign_creatives_edit` — PROPOSE — **Action only**
```
PROPOSE changing which ads a campaign runs.
Several ads in one slot TAKE TURNS, one per loop pass — so each ad's share of plays
falls as you add more. Say that before confirm.
Requires a screen whose player supports rotation; otherwise BLOCKED.

args    booking_id: str
        action: Literal["add","replace","remove","reorder"]
        media_ids: list[str] | None      (add / reorder = the WHOLE new order)
        replace_media_id: str | None
returns a proposal on the confirm card

e.g.  action="add", booking_id="b7", media_ids=["m2"]   → "2 ads will take turns"
      action="reorder", media_ids=["m2","m1"]           → the whole new order
```

> **Why two tools and not one with a `list` action:** the entire safety claim of the
> split is *"the Read agent physically cannot propose, because the write tools are not in
> its list."* A single hybrid tool with an `action` enum hands the Read agent a write path
> — it need only pass `action="add"`. A hybrid tool would quietly reduce a hard guarantee
> to a prompt instruction. **No tool given to the Read agent may have a writing action.**
**Wraps:** `bookings_service.add_booking_creatives`, `.change_booking_creative`,
`.remove_booking_creative`, `.reorder_booking_creatives`, `_active_creatives`,
`_fill_creative_plays`, `_assert_screen_supports_rotation`.
**New capability** — no equivalent tool exists today.

#### D5. `campaign_plays` — READ — both
```
What a campaign actually delivered: plays, airtime, day by day, ad by ad.
Covers the whole run unless dates are given. Counts by CAMPAIGN — all of a rotating
campaign's ads, none of anyone else's.
NOT the health verdict → campaign_health. NOT the file → campaign_report.

args    booking_id | name: str    date_from/date_to: str | None
returns campaign, screen, covers_from/covers_to, dates_defaulted,
        total_plays, total_seconds, total_minutes, days_with_plays,
        by_creative: [{name, plays, seconds, first_play_at, last_play_at}],
        by_day: [{date, plays}], bucket: "day"|"week", no_plays

e.g.  name="Sanjivani"                                → whole run
      name="Sanjivani", date_from="2026-08-18", date_to="2026-08-24"
```
**Wraps:** `bookings_service.campaign_play_rows` + `attribution.owns_play_clause`.
**Status: ALREADY BUILT (26 Aug).** Rename only. Numbers match the Excel exactly —
bounded by the campaign's IST calendar days. Do not change that bound.

#### D6. `campaign_health` — READ — both
```
Is this campaign actually playing? Compares where it should have played
(schedule ∩ the screen's operating hours) against real proof of play.
Say "running properly" ONLY when healthy=true.
NOT the raw numbers → campaign_plays.

args    booking_id | name: str
returns healthy, delivery_pct, screen_online_now, missing_days, intraday_gaps, verdict

e.g.  name="Zomato"  → healthy=false, missing_days=["2026-08-19"], delivery_pct=71.4
```
**Wraps:** `playback_health.analyze_campaign`. **Replaces:** `analyze_campaign_playback`.

#### D7. `campaign_report` — ACT-NOW — both
```
Build the file: proof-of-play EXCEL, or the campaign PDF (finished campaigns only).
Two-phase: call once to resolve and repeat back what it understood; call again with
confirmed=true only after the user agrees. A date range is ALWAYS applied — say when
it was defaulted. A screen or a campaign is required.
NOT the in-chat numbers → campaign_plays.

args    what: Literal["proof_of_play","campaign_report"]
        campaign_name | creative_name | screen_id : str | None
        date_from/date_to: str | None      confirmed: bool = False
returns needs_confirmation + what it understood, or queued + job_id

e.g.  what="proof_of_play", campaign_name="Sanjivani"                (phase 1)
      what="proof_of_play", campaign_name="Sanjivani", confirmed=true (phase 2)
```
**Wraps:** `reports_service.queue`. **Replaces:** `get_report` (behaviour unchanged).

---

### GROUP E — CREATIVE (4 tools)

#### E1. `media_search` — READ — both
```
Search the creative library. Brand-aware: "swiggy" finds the ad even when the file is
IMG_4412.jpg. Scoped to what this operator may see.
NOT for "where does it play" → media_where_playing.

args    query: str | None    type: Literal["image","video"] | None
returns [{media_id, name, brand_name, type, resolution, orientation, duration_seconds}]

e.g.  query="zomato"     → the Zomato creatives
      type="video"       → every video in reach
```
**Wraps:** `list_media_impl` → `content_service` + `assert_media_visible`.
**Replaces:** `list_media`.

#### E2. `media_where_playing` — READ — both ★ NEW
```
Where does this ad actually play? Screens, slot positions and campaigns.
Use it when the operator names an AD rather than a campaign.
NOT for a campaign's delivery → campaign_plays.

args    media_id: str
returns placements: [{screen, screen_id, slot_position, kind: booking|loop_item,
                      campaign_name, booking_id, status, end_at}]

e.g.  media_id="…"  → "runs on 2 screens: Café MG Road (slot 2), Blue Tokai (slot 5)"
```
**Wraps:** new query joining `Booking.media_id`, `BookingCreative.media_id`,
`LoopItem.media_id`, `Schedule` — the same joins `content_service.delete_media` already
counts for its 409 check. Scope-filtered.
**New capability** — no equivalent exists today.

#### E3. `media_check_fit` — READ — both
```
Will this creative fit that screen? Returns BOTH verdicts and you must report both:
pixels/orientation, AND airtime — a video longer than its slot is CUT OFF even when the
pixels are perfect.
NOT the resize itself → media_fit.

args    media_id: str   screen_id: str
returns fits, screen_resolution, media_resolution, orientation_match,
        airtime_warning, slot_seconds, media_duration_seconds

e.g.  → "fits the panel, but it's 15s in a 10s slot — the last 5s never plays"
```
**Wraps:** existing `check_media_fit` internals (`_media_fit_warning`,
`_media_airtime_warning`, `_prospective_slot`). **Replaces:** `check_media_fit`.

#### E4. `media_fit` — ACT-NOW — both
```
Resize / rebuild a creative for a screen or an exact size. ONLY on an explicit ask
("resize this for HSR", "make it 1080x1920"). A bare creative is a BOOKING, not a resize.
Images only today — for a video say video fit is coming and do not call.
It runs in the background: say the fitted version will arrive here by itself, then STOP.

args    action: Literal["start","status"]
        media_id: str | None   target_screen_id: str | None
        target_width/target_height: int | None      job_id: str | None (status)
returns start: queued + job_id     status: state, result_media_id | error

e.g.  action="start", target_screen_id="…"
      action="status", job_id="…"      → "still scanning" | "done, it's in this chat"
```
**Wraps:** `creative_fit.service.queue_chat_fit`, `.get_job`, `.list_jobs`, `.save_result`.
**Replaces:** `fit_creative` (+ adds `status`, which operators ask for today and cannot get).

---

### GROUP F — PHOTO (1 tool)

#### F1. `campaign_photo` — ACT-NOW — both
```
Photograph a campaign's ad on the screen.
when="now" shoots on the ad's NEXT REAL PLAY (a minute or two — never instant, never
"here it is"). "start"|"mid"|"end" send a frame already captured.
On a campaign running several ads, media_ids picks which — omit it on a rotating
campaign and you must ask which one first (list them NUMBERED).
NOT for "what's on the screen right now" → slot_grid.
A blocked answer (offline, closed, not in rotation, request already open) is a FACT —
relay it, never retry.

args    booking_id | name: str
        when: Literal["now","start","mid","end"] = "now"
        media_ids: list[str] | None
returns requested + expires_at, or blocked + reason, or the photo delivered later

e.g.  name="Zomato", when="now"
      name="Sanjivani", when="now", media_ids=["m3"]     ← one ad out of five
      name="Zomato", when="start"                        ← already-captured frame
```
**Wraps:** `screenshots_service.request_ondemand_screenshot(..., media_ids=…)` — the
`media_ids` argument **already exists** (`app/screenshots/service.py:792`) and validates
against `_active_creatives`; and `.get_booking_screenshots` / `.resolve_milestones` for
milestones. Delivery via `app/ai/delivery.py`, unchanged.
**Replaces:** `request_campaign_screenshot`, `get_campaign_milestone_photos`.

---

### GROUP G — LOOP (2 tools)

#### G1. `loop_get` — READ — both
```
The owner's own playlist for a screen (their content, not advertiser campaigns).
NOT the advertiser campaigns → campaign_find. NOT the grid → slot_grid.

args    screen_id: str
returns items: [{item_id, position, media_name, seconds, daily_start, daily_end,
                 days_of_week, active_now}]

e.g.  → "3 of your own clips, one plays only 18:00–22:00 on weekends"
```
**Wraps:** `loops_service.list_loop`, `.loop_item_active_now`. **Replaces:** `get_screen_loop`.

#### G2. `loop_edit` — PROPOSE — Action
```
PROPOSE changing the owner playlist: add, update a window, or remove.
Use this — NEVER campaign_create — for "add this to my loop / playlist / rotation".
A LOOP ITEM is the owner's own content; a BOOKING is a paying advertiser campaign.

args    screen_id: str
        action: Literal["add","update","remove"]
        media_id: str | None   item_id: str | None
        daily_start/daily_end: "HH:MM" | None   days_of_week: list[int] | None
        position: int | None
returns a proposal on the confirm card

e.g.  action="add", media_id="…", daily_start="18:00", daily_end="22:00"
      action="remove", item_id="…"
```
**Wraps:** `loops_service.create_loop_item`, `.update_loop_item`, `.delete_loop_item`.
**Replaces:** `add_loop_item`, `remove_loop_item` (+ adds `update`).

---

### GROUP H — FLEET & CONTEXT (3 tools)

#### H1. `fleet_health` — READ — both ★ NEW
```
The fleet at a glance and what needs attention.
Four states, never interchangeable: online · off_hours (normal, NOT a problem)
· offline (not checking in — say since when) · display_off (reachable but the PANEL IS
DARK — a real fault, an advertiser is paying for plays nobody sees).
"Which screens have problems?" = offline AND display_off, saying which is which.

args    (none — scoped to the operator)
returns totals: {online, offline, display_off, off_hours}, screens_total,
        bookings_active, plays_today,
        needs_attention: [{screen, status, since, campaigns_affected}]

e.g.  → "39 of 47 online. 2 problems: Blue Tokai offline since Sun 18:40,
          Toit showing a dark panel."
```
**Wraps:** `screens_service.compute_status` + the `/cms/dashboard/overview` aggregation.
**Replaces:** `get_dashboard_stats`.

#### H2. `operator_scope` — READ — both ★ NEW
```
Who manages which screens. A screenowner sees only themselves; a superadmin sees anyone.
READ ONLY — creating operators or changing assignments stays in the CMS.

args    operator: str | None   (name or email; None = the caller)
        screen_id: str | None  (who owns THIS screen)
returns operator: {name, email, role}, screens: [{screen_id, name, location}]
        or owners: [{name, email}] when screen_id is given

e.g.  operator=None            → "you manage 3 screens"
      operator="rohit"         → Rohit's screens (superadmin only)
      screen_id="…"            → who owns that screen
```
**Wraps:** `cms_users.service.get_assigned_screen_ids`, `.public_with_assignments`.
**New capability.**

#### H3. `apk_status` — READ — both ★ NEW
```
Which player version each screen runs, and whether an update is in flight.
READ ONLY — pushing updates stays in the CMS.

args    screen_id: str | None   (None = the operator's fleet)
returns [{screen, apk_version, latest_version, up_to_date, job: {state, started_at}|null}]

e.g.  → "11 of 12 on 1.2.0; Blue Tokai still on 1.1.4, update queued"
```
**Wraps:** `apk.service.get_latest_release`, `apk.update_service` (`ApkUpdateJob`).
**New capability.**

---

### GROUP I — STATE & TIME (3 tools)

#### I1. `draft_update` — STATE — Action only
```
Save a resolved booking fact to the notepad so it is never re-asked.
A new value overwrites — that is how a correction works ("actually make it HSR").
NOT for remembering what you just looked at → that is written by code (LAST TOUCHED).
reset=true sets the draft ASIDE (kept, recallable) — ONLY on the user's explicit cancel,
never on a topic change.

args    screen_id: str | None      media_ids: list[str] | None
        end_date: str | None       start_date: str | None
        schedule_type: … | None    reset: bool = False
returns the merged draft + missing_required: [str]

e.g.  screen_id="s1", end_date="2026-09-30"   → missing_required: []
      reset=True                              → draft set aside, still recallable
```
**Wraps:** `app/ai/draft.py`. **Replaces:** `update_booking_draft`.
**Note:** the Read agent does not get this. Prelock and the extractor fill the draft
deterministically before either agent runs, which is why it can be Action-only.

#### I2. `draft_recall` — STATE — Action only
```
Bring back a booking that was set aside, by advertiser or screen.
Offer it ONCE when the user returns to the topic; never nag.
NOT for the active booking → it is already in the draft block you were given.

args    which: str | None    (advertiser or screen; None = the most recent)
returns the restored draft + missing_required: [str], or the list of set-aside drafts

e.g.  which="Zomato"   → "picking the Zomato booking back up — still need an end date"
      which=None       → the most recently set-aside one
```
**Wraps:** `app/ai/draft.py`. **Replaces:** `recall_booking_draft`.

#### I3. `now` — READ — both
```
The real current date and time in IST — the platform timezone. Every booking runs on IST.
Resolve EVERY relative or bare date against this ("tomorrow", "next Monday", "8 July").
Use the current year unless the user states one. NEVER assume a different year.
NOT needed for the date alone — it is already in your instructions every turn; call this
when you need the exact time of day.

args    (none)
returns date, time, weekday, iso, timezone

e.g.  → "Wednesday, 26 August 2026, 14:05 IST"
      "book it till next Friday"  → resolve against this, then say the real date back
```
**Wraps:** `core.timezone.local_now`. **Replaces:** `get_current_datetime`.
**Why it still exists** alongside the per-turn date line: the injected line gives the date;
a model that needs the *time of day* (an off-hours check, "is it open now") should read it
from a tool rather than infer it.

---

### 5.99 Retirement list

Delete these when the catalog lands:

| Retired | Replaced by |
|---|---|
| `get_proof_of_play` | `campaign_plays` (+ `slot_grid` for "what's on this screen") |
| `get_screen_schedule`, `list_screen_campaigns` | `slot_grid` |
| `get_booking`, `list_bookings`, `list_campaigns_in_range` | `campaign_find` |
| `request_campaign_screenshot`, `get_campaign_milestone_photos` | `campaign_photo` |
| `get_dashboard_stats` | `fleet_health` |
| `pick_screens` | `pick` |
| `ToolName.CREATE_SOLUTION` (dead), `ToolName.UPDATE_BOOKING_LAYOUT` (dead) | delete both |

**Count: 30 → 28 declarations, covering ~60 CMS operations** (up from ~30).
**Schema budget: ~6,480 → ~2,700 tokens**, and each agent sees only its subset.

---

### 5.100 Explicitly OUT of the agent

| Capability | Why |
|---|---|
| Create/edit/delete operators, screen assignments, password reset | writes to access control; CMS only |
| API keys | CMS only |
| Gmail ingestion (OAuth, drafts, confirm) | separate agent, separate surface |
| WhatsApp link management | it is the transport |
| Screen delete / archive export | destructive and irreversible |
| APK push (per-screen and bulk) | fleet-wide risk; `apk_status` is read-only |
| Multi-zone Solutions | deferred — genuinely rare; revisit after v2 lands |
| Media delete | deferred — 409-guarded but destructive |

---

## 6. PLAYBOOKS — workflow + golden transcripts

A playbook is loaded **only** when the router selects its domain. It holds the workflow
prose that today bloats tool descriptions, plus 2–4 worked transcripts.

**Every transcript in this section is also an eval case (§11).** Written once, used three
ways: it teaches the model, it scores the harness, and it fails CI when behaviour drifts.
An example that goes stale breaks a test — so examples cannot lie.

### 6.0 The core persona (ALWAYS loaded, never unloaded)

Small — target ≤900 tokens. Contains only what is true in every domain:

- Identity and the hard SCOPE limit (the refusal sentence, verbatim as today).
- **Voice contract**: every reply is exactly one of
  `ANSWER` (the number/fact first, then the one qualifying detail) ·
  `PROBLEM` (what's wrong, since when, what it costs, what you can do) ·
  `NEXT STEP` (one question, or one thing to confirm — never both).
- **Never**: a UUID, a column name, or a status string.
  `display_off` → "the screen is on but showing nothing".
  `off_hours` → "closed for the day, opens at 9".
  `slot` → "the spot your ad sits in". `airtime_seconds` → "how long it shows each time".
- **Every number carries a unit and a window.** "1,204" is not an answer;
  "1,204 plays, 18–24 Aug" is.
- State assumptions instead of asking. At most ONE question per turn.
- Refer to screens by NAME + area, never an id.
- Consent is handled for you: never say "booked"/"done" while a card is pending —
  say "confirm on the card, or just reply yes".
- Quote only what a tool returned. If a tool did not return it, you do not know it.

### 6.1 PLAYBOOK: booking  (Action agent)

**The rule: two messages from the operator, end to end.** Their ask, and their answer.

```
1. A creative arriving IS a booking request. Do not interview.
2. ONE question, bundling everything still missing:
      "Which screen should this play on, and until when?"
   Skip whichever half the draft already holds. If a screen was named, that is the
   screen — never ask for a location.
3. A place answer → screen_search → show the NUMBERED list (name + area).
   Their reply → pick with their EXACT words. Never map numbers yourself.
4. campaign_create ONCE with screen_ids[] and media_ids[]. Never one call per screen.
5. Repeat any warnings the tool returned, in plain words, BEFORE they confirm.
6. They confirm. Done.

NEVER ASK about these — they already have answers:
  • the NAME      — derived from the creative. State it once, move on.
  • HOW LONG it plays — the SLOT owns the seconds. Never the client's choice.
  • LAYOUT        — full screen unless they describe zones.
  • SCREENSHOTS   — 3 milestones are automatic.
  • a SECOND AD   — never ask. The card carries the option (see below).

THE END DATE is the one genuinely required fact — fold it into the first question.
```

**Golden A — video, no date, one screen** *(the case the operator hits most)*

```
User   [sends video]
        → prelock locks the file; draft.media_id set before the model reads a word
You    Which screen should this play on, and until when?
User   Café MG Road, till 30 September
        → resolve("Café MG Road") → 1 screen, certain
        → campaign_create(screen_ids=["s1"], media_ids=["m1"], end_date="2026-09-30")
You    [CARD]  Zomato → Café MG Road, Indiranagar
               until 30 Sep · slot 4 · 10s each pass
               [ Confirm ]  [ + Another ad ]  [ Cancel ]
User   [taps Confirm]  →  booked.
```
Two user messages. No name asked. No duration asked. No second-ad question asked.

**Golden B — the alternate ad (rotation), still ONE confirmation**

```
…as Golden A, then:
User   [taps + Another ad]
You    Send me the other ad.
User   [sends 2nd video]
You    [CARD]  Zomato → Café MG Road, until 30 Sep
               2 ads taking turns, one per loop pass
                 1. zomato_diwali.mp4
                 2. zomato_offer.mp4
               [ Confirm ]  [ + Another ad ]  [ Cancel ]
User   yes  →  booked with BOTH.
```
The extra ad rides the SAME proposal — the card is re-proposed, never confirmed twice.

**Golden C — the same ad on several screens**

```
User   [sends video] run this in Koramangala till 30 Sep
        → screen_search("koramangala") → 3 screens
You    3 screens in Koramangala:
         1. Third Wave Coffee, 5th Block
         2. Blue Tokai, 80 Ft Road
         3. Toit, 6th Block
       Which — or all of them?
User   1 and 3
        → pick(["1","3"]) → 2 screens
        → campaign_create(screen_ids=["s1","s3"], media_ids=["m1"], end_date="2026-09-30")
You    [CARD]  Zomato on 2 screens until 30 Sep
               [ Third Wave ]  [ Toit ]        ← one button each; no room for "+ Another ad",
                                                 it lives in the card text
```

**Golden D — a booking that would fall outside the screen's hours**

```
User   [sends video] on Café MG Road, 8pm to 11pm, till 30 Sep
        → campaign_create → GATE G3 fires
You    Café MG Road is on 09:00–17:00, so 8–11pm can't run there.
       I can either keep it inside 09:00–17:00, or extend the screen's hours to 23:00.
       Which?
```
One question. Two concrete options. No jargon.

**EDGE cases for this playbook**
- Screen offline → book anyway, but warn BEFORE confirm, with `last_seen_at`.
- Video longer than the slot → say both facts (fits the panel, loses N seconds).
- "add this to my loop/playlist" → `loop_edit`, **never** `campaign_create`.
- No end date given and they resist → it is required; a booking would otherwise hold a
  slot for a year.

### 6.2 PLAYBOOK: modify  (Action agent)

```
Read BEFORE you propose. Every change names its occupant first:
  slot work        → slot_grid, then slot_edit
  campaign work    → campaign_find, then campaign_update / campaign_creatives_edit
A booked campaign's schedule CAN be changed (reschedule). Renaming works.
Never say "extend it" means cancel + rebook — that is no longer true.
A move onto a taken slot SWAPS both ads AND their lengths. Say so before confirm.
```

**Golden E — slot resize, naming the occupant first** *(your example, verbatim)*

```
User   I want to increase the second slot's time to 15 seconds
        → slot_grid(screen) → position 2 = 10s, occupied by "Sanjivani_Café MG Road",
          whose ad is 15s long
        → slot_edit(action="set_seconds", position=2, seconds=15)
You    [CARD]  Slot 2 is 10 seconds and Sanjivani is sitting in it — their ad is 15s,
               so it's being cut short today. Making it 15s adds 5s to the loop
               (90s → 95s).
               [ Confirm ]  [ Cancel ]
```

**Golden F — rearranging the order (move/swap)**

```
User   put my new ad first
        → slot_grid → slot 1 = Zomato; 3 free positions (6,7,8)
You    Slot 1 has Zomato right now. If I put yours there they swap into slot 3 —
       and the play lengths swap with the slots. Or slot 6 is free. Which?
User   swap it
        → slot_edit(action="move", position=6, to_position=1)
You    [CARD]  Yours → slot 1 (10s) · Zomato → slot 6 (10s)   [ Confirm ] [ Cancel ]
```

**Golden G — reschedule a live campaign**

```
User   extend Sanjivani to the 15th
        → campaign_find(name="Sanjivani") → one live campaign, ends 30 Sep
        → campaign_update(action="reschedule", end_date="2026-10-15")
You    [CARD]  Sanjivani_Café MG Road — end date 30 Sep → 15 Oct   [ Confirm ] [ Cancel ]
```

### 6.3 PLAYBOOK: lookup  (Read agent)

```
Answer with the number first. Never make the operator ask twice for the same fact.
"how many slots / what's free / what's the loop / who's in slot N" → slot_grid
"which screens have problems"                                     → fleet_health
"where does this ad play"                                         → media_where_playing
"which screens do I have / who owns X"                            → operator_scope
A screen that is off_hours is NOT a problem — say when it reopens.
```

**Golden H — the slot question**

```
User   how many slots on that screen? what's left?
        → slot_grid
You    9 slots, 90 seconds in total. 6 are taken, 3 free (positions 6, 7 and 8).
       Slot 2 runs 15 seconds — Sanjivani, with 2 ads taking turns. The rest are 10s.
```

**Golden I — an ad name, not a campaign name**

```
User   how's the Sanjivani ad doing?
        → resolve("sanjivani") → 1 creative (2 screens) + 2 campaigns → certain=false
You    Sanjivani's ad runs on two screens — Café MG Road (slot 2) and
       Blue Tokai HSR (slot 5). Which one, or both?
User   both
        → campaign_plays ×2
You    Café MG Road: 1,204 plays since 18 Aug (about 5 hours of screen time).
       Blue Tokai: 890 plays since 20 Aug.
       Want this as an Excel sheet?
```

### 6.4 PLAYBOOK: proof  (Read agent)

```
Numbers first, file second — and only if they ask.
campaign_plays  → the numbers, whole run by default. NEVER ask for a date range first.
campaign_health → the verdict. "running properly" ONLY when healthy=true.
campaign_report → the file, two-phase.
campaign_photo  → a picture. NEVER instant; NEVER "here it is".
After a plays answer, offer the Excel in ONE line. On their yes, campaign_report with
the SAME campaign and dates and confirmed=true.
```

**Golden J — screenshot on a rotating campaign** *(your flow, verbatim)*

```
User   screenshot the Sanjivani ad
        → resolve("Sanjivani") → campaign, 5 ads rotating
        → campaign_creatives_list
You    Sanjivani is running 5 ads right now — which one?
         1. Diwali_A   2. Diwali_B   3. Offer_15s
         4. Store_Front   5. Festive_Loop
       (or say "all")
User   3
        → pick(["3"]) → media_id
        → campaign_photo(when="now", media_ids=["m3"])
You    Taking a shot of Offer_15s — it'll arrive here on its next play,
       usually a minute or two.
```

**Golden K — single-ad campaign: never ask**

```
User   screenshot the Zomato ad
        → resolve → campaign, 1 ad
        → campaign_photo(when="now")            ← no question, straight to the action
You    Taking a shot now — it'll land here on the ad's next play, a minute or two.
```

**Golden L — blocked is a fact, not an error**

```
User   screenshot Blue Tokai's ad
        → campaign_photo → blocked: screen offline
You    Blue Tokai has been offline since Sunday 6:40pm, so nothing can be
       photographed there yet. Want me to check the rest of your screens?
```

**EDGE** — "the milestone photo" / "1st milestone" means an ALREADY-CAPTURED frame
(`when="start"`), never a fresh shot. Photographing afresh gives them a different
picture than the one they asked for.

---

## 7. L1 — DETERMINISTIC PRE-FLIGHT

Everything in `app/ai/agent.py:300-560` stays. Two blocks are added.

### 7.1 ★ The Dossier (new)

Built in code every turn, rendered beside the draft block. Never model-written.

**Screenowner (≤20 screens — list them):**
```
OPERATOR: Rohit Sharma <rohit@chaipoint.in> — screenowner.
YOUR SCREENS (3, all you may touch):
  1. Chai Point, Indiranagar     09:00–17:00  online
  2. Chai Point, HSR Layout      09:00–22:00  off_hours (opens 09:00)
  3. Blue Tokai, Koramangala     24/7         OFFLINE since 24 Aug 18:40
FLEET NOTE: 1 screen needs attention. No other screens exist for you.
```

**Superadmin, or >20 screens (counts only — never inline the list):**
```
OPERATOR: Akshat <admin@mark-ai.tech> — superadmin (full fleet).
FLEET: 47 screens — 39 online, 3 offline, 2 display_off, 3 off_hours.
SCREENOWNERS: 6 (Rohit 3, Priya 8, …). Use operator_scope for one owner.
Screens are NOT listed here — resolve any screen with screen_search.
```

Rules: threshold at 20, **never a silently truncated list** (that is today's bug);
it is *context*, not permission — tools keep enforcing scope; ~150–600 tokens.
**Source:** `get_assigned_screen_ids`, `screens_service.list_screens_for_user`,
`compute_status`, `fmt_operating_hours`.

### 7.2 ★ Last-touched (new) — the WhatsApp-safe replacement for page context

Today `session_state` carries `LAST BOOKED SCREEN`. Widen it to the last entity of each
kind the conversation acted on:

```
LAST TOUCHED: screen=Café MG Road [s1] · campaign=Sanjivani_Café MG Road [b7]
              ad=zomato_diwali.mp4 [m3] · slot=2
"it" / "that one" / "the second slot" resolve from here. Never ask which.
```

Written by the tools themselves (each returns what it acted on), stored on
`session_state`, rendered each turn. **Works identically on both channels** — which is
why page-context injection was rejected.

---

## 8. L2 — THE ROUTER and THE SPLIT

### 8.1 Router

Deterministic rules run first; only genuinely ambiguous text reaches the classifier.

```python
# order matters
if attachment_present:                    return ACTION   # a creative is a booking intent
if draft_active and draft_missing_fields: return ACTION   # mid-booking, continue it
if is_bare_question_no_entity(text):      return READ     # "what/how many/when"
domain = classifier(text, context)                        # flash-lite, few-shot
return domain if confident else ACTION                    # bias: the cheap mistake
```

**The classifier is the scope guard you already pay for** (`app/ai/guardrails/scope.py`).
Extend `ScopeDecision` from `{in_scope: bool}` to
`{in_scope: bool, lane: Literal["read","action"], domain: Literal["booking","modify","lookup","proof"], confident: bool}`.
Zero extra latency, zero extra cost.

#### ⚠ 8.1.1 The guard is SKIPPED on exactly the turns that matter most

`agent.py` runs the guard only `if AI_GUARDRAIL_ENABLED and not on_task`, where
`on_task = bool(draft) or bool(media)`. **So on an attachment, or mid-booking, the
classifier never runs at all.** Merge the router into it naively and those turns get no
lane.

This is survivable only because the deterministic rules cover both cases — but that must
be stated as a dependency, not left to luck:

```
attachment present            → ACTION   (rule; classifier never consulted)
draft active, fields missing  → ACTION   (rule; classifier never consulted)
draft active, fields COMPLETE → ACTION   ← the gap. The guard is skipped here too,
                                           and no rule covered it. Default ACTION.
classifier did not run for any other reason (disabled, errored, timed out)
                              → ACTION   (fail toward the capable agent, never toward
                                           the one that cannot act)
```

**Rule: a turn must never reach an agent without a lane. Absent a decision, the lane is
ACTION.** This mirrors the guardrail's own fail-open philosophy: degrade to the agent
that can still do the job, never to the one that cannot.

Few-shot examples for the classifier (~150 tokens, the cheapest accuracy in the system):
```
"how many slots are free on the MG Road screen"      → read / lookup
"screenshot the Zomato ad"                           → read / proof
"how's Sanjivani doing"                              → read / proof
"send me the excel"                                  → read / proof
"book this till 30 September"                        → action / booking
"increase slot 2 to 15 seconds"                      → action / modify
"move my ad to slot 1"                               → action / modify
"pause Zomato"                                       → action / modify
"add another ad to Sanjivani"                        → action / modify
```

### 8.2 The split

| | Read agent "Answers" | Action agent "Changes" |
|---|---|---|
| Model | `AI_READ_MODEL` (flash-lite) | `AI_ACTION_MODEL` (strong) |
| Tools | **20**: 17 READ + 3 ACT-NOW. No tool it holds has a writing action | **28**: those 20 + 6 PROPOSE + 2 STATE |
| Playbooks | lookup · proof | booking · modify |
| Can propose? | **No — the write tools are not in its list** | Yes → confirm card |

**Action's toolset is a SUPERSET of Read's — this is load-bearing.** It creates the
asymmetry that makes the router safe: a read turn misrouted to Action costs a few cents
and still answers correctly; an action turn misrouted to Read costs one hop. So the
router leans Action when unsure, and the expensive mistake is rare *by construction*.

It is also what makes "yes, send the excel" work — that turn routes to Action, which
holds `campaign_report` because it holds every read tool.

### 8.3 Escalation — one hop, inside the same turn

```
Read agent decides it needs a write
   → returns needs_action (a signal, not a message to the user)
   → run_turn re-invokes with the Action agent, SAME turn, SAME state
   → ONE reply is emitted. The user never sees a handoff, never repeats themselves.
   → HARD CAP: one hop. A second escalation attempt is a bug — log and answer.
```

#### 8.3.1 ⚠ The Read agent must NOT stream (this is a hard constraint)

`run_turn` publishes every token to the SSE bus **as the model generates it**
(`agent.py`: `async for delta in result.stream_text(delta=True) → bus.publish(TOKEN)`).
If the Read agent streams "Let me check…" and *then* escalates, the operator sees a
half-answer from one agent followed by a different reply from another. The handoff we
promised is invisible becomes the most visible thing on the screen.

**Rule:**
- **Read agent runs BUFFERED** (`agent.run`, not `run_stream`). Its answers are short and
  it is on the fast model, so the latency cost is small and the correctness gain absolute.
- **Only the Action agent streams**, because it can never escalate — it is terminal.
- WhatsApp is unaffected either way: `inbound.py` awaits `run_turn` and renders the
  finished turn, so it has never streamed.

If buffering the Read agent ever measurably hurts perceived latency, the fallback is
buffer-until-commit (hold tokens until the model emits text after its final tool call,
then flush) — more code, same guarantee. Do not stream the Read agent unguarded.

#### 8.3.2 The hop carries the Read agent's work forward

The Action agent must NOT re-run the lookups the Read agent already did — it doubles
latency and can read different data a second later (a play count moves, a screen goes
offline). Pass them in the Action prompt:

```
ALREADY LOOKED UP THIS TURN (do not call these again):
  slot_grid(Café MG Road) → 9 slots, 90s, free: 6,7,8; slot 2 = 15s (Sanjivani)
ALREADY DONE THIS TURN (do not repeat — it has already happened):
  campaign_photo(Zomato, when=now) → requested, arriving in this chat
```

The second block matters: a turn like *"screenshot it and pause the campaign"* fires an
ACT-NOW job in the Read agent and then escalates. Without it the Action agent re-requests
the screenshot and gets a `request already open` block — a confusing failure caused
entirely by our own hop.

#### 8.3.2b If the escalation itself fails

A model error, a timeout, or a missing `AI_ACTION_MODEL` must not produce a dead turn
after the Read agent already did useful work. Fall back to what we have:

```
escalation fails → emit the Read agent's buffered answer (it is complete and correct)
                 + one honest line: "I can't make that change right now — try again in a
                   moment, or do it on the campaign page."
                 → log it. Never a spinner, never a 500, never a silent drop.
```

#### 8.3.3 Which playbook the Action agent loads on escalation

The router's original `domain` was a read domain (`lookup`/`proof`), which has no Action
playbook. **Default to `modify`** — an escalation from a read is almost always "change the
thing I just looked at". Exception: an attachment is present → `booking`.

### 8.4 Shared, never duplicated

`session_state` · booking draft + archive · resolver · picker · dossier · gates ·
confirm card · voice contract · rolling summary · one reply.

**If the Action agent ever grows its own memory of "which screen", the design has failed** —
that is the wrong-screen class of bug the whole pipeline exists to prevent.

---

## 9. GATES — rules in code, never prose

Each returns a `BLOCKED: …` string the model must relay in plain words. Never a silent
no-op, never a 500 after Confirm.

| # | Gate | Where | Rule |
|---|---|---|---|
| G1 | Scope | every screen/media tool | `assert_can_manage_screen` / `assert_media_visible` — already exists |
| G2 | Half-specified hours | `screen_update` | both bounds or neither (exists today; keep) |
| G3 | Booking outside screen hours | `campaign_create` | 422 → offer trim-or-extend, one question |
| G4 | Slot shorter than its video | `slot_edit(set_seconds)` | name the ad and the seconds it would lose |
| G5 | Move onto a taken slot | `slot_edit(move)` | it is a SWAP — name both ads and both lengths before confirm |
| G6 | Slot occupied by a paying campaign | `slot_edit` | name the campaign and its advertiser before proposing |
| G7 | Rotation unsupported | `campaign_creatives_edit(add)` | `_assert_screen_supports_rotation` (player ≥1.2.0) — do not offer "+ Another ad" when it fails |
| G8 | Retired ad photographed | `campaign_photo` | `media_ids` validated against `_active_creatives` (exists) |
| G9 | Report without confirmation | `campaign_report` | a confirmation minted in the same turn is not one (exists) |
| G10 | Terminal campaign edited | `campaign_update` | cancelled/completed/rolled-up → refuse with the reason |
| G11 | Double-propose | proposal builder | the same change twice in one turn is one proposal |
| G12 | Client-set airtime | `campaign_create` | there is no duration argument. The slot owns the seconds |

---

## 10. PHASE PLAN

**Ordering constraint that must not be violated: §5's catalog (Phase 7) lands BEFORE the
split (Phase 8).** Splitting a dirty catalog bakes the collisions into two agents and
doubles the maintenance.

### Phase 0 — Eval harness *(runs alongside everything)*
Build first, extend every phase. See §11.
**Acceptance:** 40 golden transcripts run headless; three scores reported
(task success, policy adherence, turns-to-done); a red result blocks a merge.

### Phase 1 — Per-ad screenshot picker  ✅ DONE (2026-08-27)

**Shipped:** `app/ai/picker.py` generalised (screens + creatives share one deterministic
core; ads stored under `shown_creatives` on `session_state`), `request_campaign_screenshot`
made rotation-aware with an `ads` argument taking the user's own words, new
`campaign_creatives_list` read tool, `shown_creatives` loaded/persisted in `run_turn`,
prompt routing added. **No backend change was needed** — `media_ids` already existed.
**Verified against the local DB:** rotating campaign asks once with a numbered list;
"2" / "all" / an ad's name each resolve to the right `media_id` and reach the service;
a nonsense answer re-asks instead of guessing; a single-ad campaign never asks; the
delivery destination (`whatsapp`) survives the round trip.
Pass `media_ids` through the screenshot tool; list a rotating campaign's ads NUMBERED;
accept a number or "all".
**Files:** `app/ai/tools.py` (screenshot tool), `app/ai/prompts.py` (proof section).
**Backend:** none — `request_ondemand_screenshot(media_ids=…)` already exists.
**Acceptance:** Goldens J, K, L pass. A 5-ad campaign asks once and photographs the
chosen ad. A 1-ad campaign never asks.

### Phase 2 — Booking card: "+ Another ad"  ✅ DONE (2026-08-27)

**Shipped:** `app/ai/awaiting.py` (the 30-min exchange state), `app/ai/options.py` (the
shared "tap a button that runs nothing" service — the counterpart to `confirm_service`),
`create_booking` gains `extra_media_ids` + attaches the card option behind gate G7,
`_propose`/the card carry `options`, `_exec_create_booking` adds the extras inside the
SAME confirmation, WhatsApp renders the option as the third button (displacing `Change`)
under a new `opt:` prefix, `inbound.py` gets a branch that authorizes + locks + executes
nothing, `run_turn` runs the five-branch machine, and `POST /api/cms/ai/sessions/{id}/option`
gives the web UI the same path.

**Verified:** button budget stays at 3 and the option never uses a confirm prefix; arming
stores the proposal payload whole and executes nothing; an already-confirmed card refuses
politely; an expired flag is ignored; the directive carries every original fact forward;
the confirm path creates then adds in one go, dropping a duplicate of the primary rather
than 422-ing away a booking the operator just confirmed. The old card is superseded ONLY
after the replacement exists.

**Not done here:** the CMS web UI must render the option button (separate repo) — the
endpoint and card payload are ready for it.
**Files:** proposal builder in `app/ai/agent.py`, `app/whatsapp/render.py`,
`app/whatsapp/inbound.py` (new button prefix), `app/ai/executors.py`.
**Constraints (verified):** WhatsApp allows **3 buttons max**, and the single-proposal
card already uses all three — **replace `Change`**, which today only replies
"Sure — what should I change?" (`inbound.py:172`). Multi-screen cards have no spare
button (`slip.PICK_LIMIT = 3`); the option lives in the card text there.
Show the option **only** when G7 passes.
**Execution:** extras ride the SAME proposal — `_exec_create_booking` creates the booking
then calls `add_booking_creatives`. One card, one confirmation.

**The state machine (specify it — the button is not a confirm and must not act like one):**

```
card shown ──[+ Another ad]──▶ session_state.awaiting_extra_creative = {
                                   proposal_turn_id, proposal_ids[], expires_at
                               }
                               reply: "Send me the other ad."
                               NOTHING is executed. The card stays pending.

next message:
  is media?            → attach to that proposal, RE-PROPOSE the whole card
                         (now listing both ads), clear the flag
  is "cancel"/"no"     → clear the flag, leave the original card pending
  is anything else     → clear the flag, answer normally, leave the card pending
                         (never silently swallow an unrelated question)
  flag expired (30 min)→ clear it; a later media message starts a NEW booking
  original card already confirmed or dismissed
                       → clear the flag; the ad becomes an ADD to the now-live
                         campaign via campaign_creatives_edit, not a second booking
```

On WhatsApp the button lands in `inbound.py::_handle_button`, which today only
confirms/dismisses. It needs a **third branch that executes nothing** — sets the flag and
replies. Keep it out of `confirm_service`; that function's job is executing proposals and
must stay that.

**Acceptance:** Golden B passes; exactly one confirmation; both ads in rotation; and each
of the five branches above has a golden of its own.

### Phase 3 — Last-touched carry (§7.2)  ✅ DONE (2026-08-27)

**Shipped:** `app/ai/touched.py` (record/merge/render, four kinds: screen · campaign ·
creative · slot), a `touched` field on `AiDeps`, a `_touch()` recorder called at 9 points
in the tools (screen search with a single hit, pick, get_screen, campaign health, plays,
creatives list, screenshot, booking proposal), and the block rendered beside the draft in
`run_turn` then merged into `session_state`.
**Verified:** `slot_grid` on a real screen records it; the block renders with ids and
labels; an empty state renders nothing (no noise on a first turn); unknown kinds are
ignored rather than raising — bookkeeping can never fail a tool that did its work.
**Channel-neutral by construction** — it is conversation state, not page state, so
WhatsApp gets it identically.
**Acceptance:** "screenshot it" / "increase the second slot" resolve with no question,
on both channels.

### Phase 4 — `slot_grid` · `fleet_health` · `campaign_creatives_list`  ✅ DONE (2026-08-27)

**Shipped:** `slot_grid` (wraps `screen_slots.build_grid_view`; **1-based** positions the
way the operator counts them; free list, loop = SUM, `playing_now` per occupant, and
`ads_in_rotation` so a rotating campaign is visible in the grid), `fleet_health` (four
states, `needs_attention` with since/campaigns_affected, dark panels sorted first),
`campaign_creatives_list` (shipped in Phase 1), plus prompt routing for all three.
**Verified on the local fleet:** 9 slots / 90s loop / 8 free, slots numbered from 1, loop
equals the sum; 15 screens all correctly offline with campaign counts; `off_hours` never
appears in `needs_attention`; a screenowner sees 1 screen where a superadmin sees 15.
**Note:** `fleet_health` reuses `ScreenSummary.status` rather than recomputing the four
states — a second copy of that rule would be free to drift from what the CMS shows.
Reads only. All three wrap finished services.
**Acceptance:** Golden H passes. "Which screens have problems" names offline and
display_off separately and never calls off_hours a problem.

### Phase 5 — The Dossier (§7.1)
**Acceptance:** an owner with 12 screens gets all 12 (today they get 8, silently);
a screenowner with none is told so plainly; superadmin gets counts, not a list.

### Phase 6 — Router, LOGGING ONLY (one week)  ✅ BUILT (2026-08-27)
**Shipped:** `app/ai/router_lane.py` — deterministic rules first (attachment → ACTION,
draft-in-progress → ACTION, question phrasing → READ, read imperative → READ), classifier
only for what is left, ACTION when unsure. `ScopeDecision` extended with lane/domain/
confident (same call, no extra cost) + `LANE_GUIDE` few-shots. `run_turn` decides and logs
on every turn; behaviour unchanged while `AI_SPLIT_ENABLED=False`.
**Verified:** 21/21 routing cases correct with NO model call.
Extend `ScopeDecision`; log `lane`/`domain`/`confident` and what the turn actually did.
Change no behaviour.
**Acceptance:** a report of classification accuracy, the read/action ratio, and the
**mixed-turn rate** — the number that de-risks Phase 8.

### Phase 7 — ★ THE TOOL REVAMP (§5)  ✅ PARTIAL (2026-08-27)
**Done:** the six superseded read tools retired (`get_proof_of_play`,
`get_screen_schedule`, `list_screen_campaigns`, `get_dashboard_stats`, `list_bookings`,
`get_booking`), dead wiring deleted (`CREATE_SOLUTION`, `UPDATE_BOOKING_LAYOUT` + its
orphan executor), prompt routing rewritten to name only live tools.
**Deferred:** the wholesale rename to the §5 names (`screen_search`, `campaign_find`, …)
and the ≤120-token description standard. Renaming 30 tools at once is the riskiest single
change in the plan and it wants the eval harness in front of it — the behaviour is already
delivered under the existing names.
Declare all 28 to the new description standard. `campaign_create` takes lists. Retire the
nine old tools. Delete dead constants.
**Acceptance:** 28 tools registered; schema budget ≤2,800 tokens; every retired name gone;
full harness green (this is the riskiest phase — the harness exists for it).

### Phase 8 — THE SPLIT (§8.2)  ✅ BUILT, OFF BY DEFAULT (2026-08-27)
**Shipped:** `get_agent(lane)` builds per-lane agents from ONE registration pass
(`_register_tools`), then removes `READ_AGENT_EXCLUDED` from the read agent — one catalog,
so a new tool can never be added to one lane and forgotten in the other.
`app/ai/escalate.py` does the one hop: detects a stuck read from its own reply, carries
`ALREADY LOOKED UP THIS TURN` forward, falls back to the read answer + one honest line if
the hop fails. **The Read agent is BUFFERED, never streamed** (§8.3.1). Settings:
`AI_SPLIT_ENABLED` (default False), `AI_SPLIT_USER_IDS`, `AI_READ_MODEL`, `AI_ACTION_MODEL`.
**Verified:** read agent holds ZERO write tools; action ⊃ read; action == full catalog;
read keeps the ACT-NOW tools (screenshots, reports, fit); escalation fires on a stuck
reply and stays quiet on a complete one.
**Read agent: 18 tools / ~8,900 tokens a turn vs 30 / ~12,300 for the full one.**
Two agents over the clean catalog, shared state, Action-biased router, one-hop escalation.

**Rollout — this phase must be reversible in one setting:**
```
AI_SPLIT_ENABLED = False        default off
AI_SPLIT_USER_IDS = []          per-operator allowlist; internal accounts first
AI_READ_MODEL / AI_ACTION_MODEL configurable independently
```
The single-agent path stays intact and callable until the harness has been green for two
weeks with the split on. A kill switch that requires a deploy is not a kill switch.

**Acceptance:** no regression vs Phase 7 on task success; a measurable gain in tool
selection; mixed turns resolve in one hop with nothing re-asked; flipping
`AI_SPLIT_ENABLED` off restores Phase 7 behaviour exactly.

### Phase 9 — Playbooks + tools by domain (§6)  ⏸ DEFERRED
The split already delivers most of the win (18 tools instead of 30 on a read turn).
Splitting the persona into four loadable playbooks is the remaining half and it depends
on Phase 6's real classification data to know which domain each rule belongs in.
Split the persona; expose tools per domain with the always-on core and the full-catalog
fallback on low confidence.
**Acceptance:** per-turn context ≤3,000 tokens; no golden regresses.

### Phase 10 — Resolver + pick everywhere (§5 A1/A2)  ✅ DONE (2026-08-27)

**Shipped:**
* `resolve(phrase, kinds?)` — one lookup across screens, campaigns AND creatives, each
  match carrying WHERE it lives. `certain=true` acts; a tie (within 0.02) returns a
  NUMBERED mixed list, because "Sanjivani" matching both the ad and the campaign named
  after it is the normal case, not a near miss.
* `media_where_playing(media_id)` — every way an ad reaches a screen: a campaign's
  primary creative, a **rotation alternate** (invisible to a plain campaign lookup — this
  is what reported a live ad as unused), the owner's loop content, and legacy direct
  schedules. Scope-filtered.
* `pick` extended to the mixed list, with its own `session_state` key so a screen list
  and an entity list never cross-resolve. The entity branch is checked FIRST — it is the
  more recent question whenever it exists.

**Verified against real data — the exact bug you described:**
```
"how is the ad C ad doing?"
  BEFORE  _match_campaigns("ad C") -> 0 matches  ("No campaign matched" — wrong, it is live)
  AFTER   resolve("ad C") -> [creative] ad C — the ad itself, playing on 1 screen
```
Also verified: a rotation alternate is found with its campaign and slot; an unused
creative says so honestly; answering "2" against the mixed list resolves deterministically
and records what was touched; a screenowner sees fewer candidates than a superadmin; a
name matching nothing refuses to guess.
**Acceptance:** Golden I passes. An ad name never resolves silently to a campaign.

### Phase 11 — Remaining write gaps  ✅ DONE (2026-08-27)
**Shipped:** `slot_edit` (set_seconds · move · add · remove, 1-based, with gates G4/G5/G6),
`campaign_update` (rename · reschedule · pause · resume · cancel · delete, gate G10),
`campaign_creatives_edit` (add · replace · remove · reorder, gate G7), and all three
executors. The prompt's false "schedule is frozen / no rename" claims are gone.
**Verified against the live grid:** removing an occupied slot is BLOCKED naming the
campaign; a nonexistent slot number is BLOCKED; moving an empty slot is BLOCKED; a taken
target is described as a SWAP with both lengths before confirm.
`slot_edit`, `campaign_update`, `campaign_creatives_edit`, `loop_edit(update)`,
`screen_update` bulk, `media_fit(status)`.
**Acceptance:** Goldens E, F, G pass; gates G4–G7, G10 all fire with plain-language text.

### Phase 12 — Verifier + voice contract  ✅ BUILT (2026-08-27)
**Shipped:** `app/ai/verify.py` — arithmetic, not judgement: every number a tool returned
this turn is collected (recursively), the reply's numbers are read out, anything
unaccounted for is flagged. Accepts honest derivations (seconds→minutes/hours, sums,
percentages, rounding) so "about 5 hours" from 18,060s is not a false alarm. **Prose only
— it never touches a card, a proposal or a job.** Corrects buffered replies; audits
streamed ones.
**Verified:** catches a fabricated 1,850; allows 1,204 + "about 5 hours"; ignores small
counts.
**The streaming tension, stated plainly:** a token already streamed to the browser cannot
be un-said, so a verifier cannot *gate* a streamed reply. Resolution:
- **WhatsApp and Read-agent turns: a GATE.** Both are buffered (§8.3.1), so a failed
  check rewrites the reply before anything is sent.
- **Streamed Action turns: buffer only when the turn is high-stakes** — defined as any
  turn whose tool results contained numeric fields (`total_plays`, `airtime_seconds`,
  `delivery_pct`, `plays`, `seconds`) or produced a refusal. Everything else streams.
- Anything still slipping through is logged and flagged into the review feed
  (`app/review/`) as an audit, not silently dropped.

**The verifier may rewrite PROSE ONLY.** It must never touch, drop or edit a proposal, a
card, or a queued job. A reply that says "I've put this on the card" while the verifier
removes the card is worse than the error it was fixing. Its input is text plus that turn's
tool output; its output is text.

**Acceptance:** no reply contains a number absent from that turn's tool output; the
high-stakes buffer adds no more than one second to those turns.

---

## 11. THE EVAL HARNESS (Phase 0)

**Why first:** τ-bench-style agents score ~61% (retail) / ~35% (airline) on task success,
and multi-turn scores run 5–10 points below single-turn. Without measurement, "better
accuracy" is a feeling.

**Method** — score the **final database state**, not the wording:

```
for each golden transcript:
    seed a known DB          (fixed screens, campaigns, creatives, plays)
    replay the user turns    (a scripted user, no model on that side)
    compare:
      1. TASK SUCCESS      final DB state == expected state?
      2. POLICY ADHERENCE  scored SEPARATELY — did it:
                             • execute a write without a confirmation?
                             • quote a number no tool returned?
                             • touch an unassigned screen?
                             • say "booked"/"done" while a card was pending?
                             • re-ask a fact already given?
      3. TURNS-TO-DONE     how many messages the operator had to send
```

An agent that gets the right result by violating policy is a **partial fail**, not a pass.

**The 40 goldens:** the 12 in §6 (A–L), plus — off-hours booking, offline screen booking,
misspelled place, screen-name-not-place, "same screen again", topic change then resume,
explicit cancel then recall, video-longer-than-slot, ambiguous campaign name, retired ad
screenshot, report double-confirm, WhatsApp button confirm, bare "yes" with no card,
off-topic refusal, screenowner touching an unassigned screen, zero-play campaign,
rotation on an unsupported player, multi-screen partial pick, slot resize under a video,
move onto a taken slot, and the mixed turn ("how many free? … ok put mine in 6").

**The harness must be able to FORCE a lane** (`--lane read|action|auto`). Otherwise
escalation and misroute behaviour can only be tested by luck: you need to assert that a
forced-wrong lane still produces the right final state, in one hop, with nothing re-asked.
Router accuracy is scored separately from task success — a turn can be correctly answered
through the wrong lane, and that is a routing miss worth knowing about even though the
user got the right answer.

**Per the user's standing instruction: do not run pytest.** The harness is a standalone
script; the user runs it.

---

## 12. RISKS

| # | Risk | Mitigation |
|---|---|---|
| R1 | Mixed turns break under the split | Action-biased router · one-hop cap · Phase 6 measures the real rate first |
| R2 | Playbooks drift apart | one core persona file + one file per playbook; harness catches divergence |
| R3 | Cost inverts if Action over-fires | Phase 6 reports the ratio. >40% Action means the tiering saving is gone and the split is buying safety only |
| R4 | flash-lite too weak for `campaign_health` | test that tool explicitly; if it fails, force the strong model for it alone |
| R5 | Phase 7 is a big-bang rename | it is why Phase 0 exists; land it behind the full harness, not incrementally |
| R6 | Examples anchor the model | always ≥2 varied examples, obvious placeholders, never a single one |
| R7 | Router mis-classifies a creative upload | that path is a deterministic rule, not the classifier (§8.1) |
| R8 | A streamed Read reply is followed by an escalated Action reply | Read agent is BUFFERED, never streamed (§8.3.1) |
| R9 | A tool held by the Read agent has a writing action | no hybrids — one class per tool (§5, D4a/D4b) |
| R10 | The hop re-reads and gets different data | the Action prompt carries the Read agent's results (§8.3.2) |
| R11 | "+ Another ad" left dangling (expired, or the card was already confirmed) | explicit state machine with five branches + 30-min expiry (Phase 2) |
| R12 | A turn reaches an agent with no lane (guard skipped) | absent a decision the lane is ACTION (§8.1.1) |
| R13 | An ACT-NOW job fires twice across the hop | `ALREADY DONE THIS TURN` block (§8.3.2) |
| R14 | Escalation fails and strands the turn | fall back to the Read agent's buffered answer + one honest line (§8.3.2b) |
| R15 | `resolve` scans the whole estate every turn | DB-side shortlist before Python scoring (§5 A1) |
| R16 | The split can only be rolled back by a deploy | `AI_SPLIT_ENABLED` + per-operator allowlist (Phase 8) |

---

## 13. OPEN QUESTIONS (decide before the phase that needs them)

1. **Q(Phase 8):** which model for the Action agent — Gemini 2.5 Pro, or stay on 2.5 Flash
   with the split buying only focus? Decide from Phase 6 volume + Phase 0 scores.
   *Note: tell Akshat before anything makes real Gemini API calls, including tests.*
2. **Q(Phase 11):** does `campaign_update(reschedule)` need its own gate for a campaign
   mid-flight with plays already delivered, or is the backend's re-validation enough?
3. **Q(Phase 2):** on a multi-screen card, is "+ Another ad" reachable by text alone, or
   do we need a 4th message with its own buttons?
4. **Q(later):** Solutions / multi-zone — worth agent surface at all, or permanently CMS?
5. **Q(later):** media delete from chat — the 409 guard makes it safe, but is it wanted?

---

## 14. WHAT THIS PLAN DELIBERATELY DOES NOT DO

- **No RAG, no embeddings, no vector store.** (§2.2)
- **No code-execution / "code mode".** Right at 100+ tools, wrong at 27, and it blurs the
  confirm boundary that the safety model depends on.
- **No third speaking agent.** Booking vs modify is a playbook difference, not an agent
  one: same model tier, same permissions, same risk class.
- **No rewrite of `run_turn`.** The lock, consent gate, scope guard, prelock, picker,
  draft, confirm card and delivery are the reason this system works.
- **No raw SQL or shell for the agent.** Ever.
- **No page-context injection.** WhatsApp sets the floor. (§2.6)

---

## 15. ONE-PAGE SUMMARY

```
WHAT WE ARE BUILDING
  One co-pilot. Two voices (Read · Action), five models, one shared spine.
  28 tools covering ~60 CMS operations — down from 30 tools covering ~30.
  Contract in tools, workflow in playbooks, rules in gates, examples in the harness.

THE THREE FIXES
  P1  the slot grid becomes visible          → slot_grid · slot_edit
  P2  one resolver instead of per-tool guesses → resolve · pick
  P3  ad → where it plays                    → media_where_playing

THE NUMBERS TO MOVE
  per-turn context   10,285 → ~3,000 tokens
  tool schemas        6,480 → ~2,700 tokens
  operator messages per booking:  2, and never more
  policy violations:  0, measured, every phase

BUILD ORDER
  0 harness · 1 per-ad screenshot · 2 "+ Another ad" · 3 last-touched
  4 slot_grid/fleet_health · 5 dossier · 6 router logging
  7 TOOL REVAMP · 8 THE SPLIT · 9 playbooks · 10 resolver · 11 write gaps · 12 verifier
```
