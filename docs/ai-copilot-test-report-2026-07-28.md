# Mark AI Co-Pilot — Live Agent Test Report (28 Jul 2026)

> **UPDATE (same day): the four headline bugs below are FIXED and re-verified live.**
> See "Fixes shipped + re-verified" at the end of this document.

## How this was tested (no test files, no pytest)
An **actor agent** role-played a screenowner ("Rohit", `rohit@chaipoint.in`) and held **7 real chat
sessions** against the running local `markai-signage-api` AI co-pilot (gemini-2.5-flash), exactly like a
human typing in the CMS — create session → send message → wait for the reply → press Confirm on cards.
A separate **verifier agent** then re-judged *every* AI reply against Postgres and the CMS API, adversarially
(several actor claims were overturned). Sample data was seeded first: 3 screens (2 online, 1 offline since
Sun 26 Jul 14:00 IST), 3 media assets, 3 campaigns, and 1,044 proof-of-play rows **with a deliberate
missing day** (zero plays on 26 Jul for "Independence Day Combo").

Full transcripts: `/private/tmp/claude-501/-Users-akshat-projects-MarkAi/c141c40c-891d-472f-b669-ab7647fe18a2/scratchpad/transcripts/scenario-{1..7}.md`

## Scorecard

| # | Scenario | Result |
|---|----------|--------|
| 1 | Full booking data in ONE message | ✅ **PASS** — zero re-asks, straight to a correct confirm card, booking landed exactly right |
| 2 | Data drip-fed across turns | ⚠️ zero re-asks (the main goal) **but the booking landed in 2024** — dead on arrival |
| 3 | Fleet & status questions | ⚠️ static facts right; live status wrong (called online screens offline); 1 question **crashed twice** |
| 4 | Proof-of-play analysis | ❌ **TOTAL FAILURE** — every question hung forever; repeated attempts froze the whole backend |
| 5 | Out-of-hours booking | ✅ guard worked, zero re-asks — but exposed a "success" that silently did nothing |
| 6 | Mid-flow corrections + interruption | ✅ **PASS** — both corrections + topic-switch handled perfectly; but never warned the target screen is offline |
| 7 | Guardrail + edge cases | ⚠️ off-topic refusal, pause/rename, permission edge all pass; loop request handled dishonestly; "Resume **it**" lost context |

**Bottom line:** the booking *conversation* engine (draft notepad + zero-redundancy + extract backstop) is
genuinely good — every booking flow had **0 redundant re-asks** across all sessions. What's broken is
everything around *awareness*: dates beyond turn 1, live screen truth, and the entire proof-of-play
analysis path.

---

## Critical bugs (fix these first)

### 1. Proof-of-play chat is 100% dead — and it takes the server down ❌ blocker
Any "is my campaign running properly / any proof-of-play gaps?" question crashes internally and the turn
hangs at `streaming` **forever** (the user sees an eternal spinner). After ~5 attempts the uvicorn event
loop froze completely — every endpoint dead until manual restart.
- **Root cause A (the SQL):** `local_date_col()` (`app/core/timezone.py:50`) passes the timezone string as a
  **bind parameter**. `analyze_campaign` (`app/bookings/playback_health.py:216` + `:225`) calls it twice —
  SELECT renders `timezone($1,…)` but GROUP BY renders `timezone($2,…)` → Postgres `GroupingError` on every
  live campaign. Tests never caught it because they run on sqlite.
  **Fix:** render the tz as an inline literal (`sa.literal_column("'Asia/Kolkata'")` or
  `literal(..., literal_execute=True)`), or build the expression **once** and reuse the same object in both
  SELECT and GROUP BY.
- **Root cause B (the hang):** the tool crashes on the turn's shared DB session → transaction poisoned → the
  `except` handler's attempt to persist `status="failed"` **also** fails and is swallowed → turn stuck at
  `streaming` forever. **Fix:** on error, `rollback()` (or use a fresh session) before writing the failed
  status; add a per-turn timeout that force-fails a turn.

### 2. The system prompt disappears after turn 1 ❌ blocker (explains the 2024 bug)
`build_model_history` (`app/ai/service.py:273`) rebuilds history with only user/assistant parts — no system
part. pydantic-ai only injects `system_prompt` when history is **empty** (verified in the installed lib):
so **every turn after the first runs with NO persona, NO zero-redundancy rule, NO scope rule, and NO date
anchor**. That is why turn-1-only Scenario 1 got 2026 right, while Scenario 2 (dates given on turn 3)
resolved "Aug 3–20" to **2024** — the exact bug `today_context_line` was written to prevent
(`app/ai/tools.py:69`). The booking survived only because the draft/router block is injected into the *user*
prompt each turn.
**Fix:** switch the agent to pydantic-ai **`instructions=`** (sent on every request regardless of history)
and move the dynamic date line to `@agent.instructions`. One small change, restores all rules on every turn.

### 3. Booking confirmed into the past = silent success ❌ (compounds #2)
The 2024 booking persisted as `status="completed"` — it will never play — yet the confirm reply was just
"✅ Executed 1 action(s) successfully". The card *did* display `2024-08-03` (a sharp-eyed user could catch
it), but the AI's prose omitted the year entirely.
**Fix (backend, deterministic):** in `create_booking` (tool and/or executor), reject or loudly warn when
`end_at < now` / derived status is `completed` at creation. A brand-new dead booking is never what the user
meant.

### 4. Schedule question crashes the turn — `get_screen_schedule` ❌
"What's scheduled on Indiranagar this week?" failed twice with "The assistant hit an error":
`get_screen_schedule` (`app/ai/tools.py:560`) calls `assert_can_manage_screen`, which raises a raw
`HTTPException` that nothing catches → the whole turn dies. Worse: Indiranagar **is** Rohit's screen — the
model passed a wrong `screen_id` (resolution slip), and instead of a graceful "let me re-check that screen"
the turn hard-crashed.
**Fix:** catch `HTTPException` inside read tools and return a plain-text "you don't manage that screen /
screen not found" result the model can react to (pydantic-ai `ModelRetry` is ideal); never let a tool
exception kill a turn.

### 5. "Executed successfully" that changed nothing — half-specified operating hours ❌
The AI proposed `update_screen` with `on_start_minute: null, on_end_minute: 1260`. The executor path
(`app/ai/executors.py:159`) requires BOTH minutes, silently no-ops the hours change otherwise — and still
reports success. The user is told their screen now runs till 9pm; it doesn't. (The AI later noticed and
self-corrected — good — but the false success is a trust-killer. The REST API would have 422'd this; the
executor bypasses that validation.)
**Fix:** validate proposal args with the same `ScreenUpdateRequest` schema before executing; if the model
sends only one bound, have the executor fill the other from the screen's current value.

---

## Missing capabilities (the "AI-native, no manual work" gaps to build next)

### 6. Proactive delivery-risk warnings — the AI never says "this won't actually play"
This is the product promise ("the AI must tell the screenowner their ad is scheduled but won't run") and it
is entirely absent today:
- Booked "Rainy Day Deal" onto a screen that has been **offline for 2 days** — zero warning, across 6 turns
  and the confirm card.
- Portrait creative on a landscape screen: warned in one session, silent in another (non-deterministic —
  the model *chooses* whether to call `check_media_fit`).
**Build:** deterministic pre-proposal checks inside `create_booking` (mirroring the operating-hours guard
that already works well): screen offline → warn with last-seen time; orientation/resolution mismatch →
always fit-check, not model's choice. The guard pattern at `tools.py:827-850` is the template.

### 7. Live status literacy — `off_hours` vs `offline`
At 1 AM IST the AI called **all 3** screens "offline" and couldn't name the one genuinely dead screen or
when it died, and reported yesterday's play count as "Plays Today: 36" (real today-count: 0). The backend
distinguishes `online` / `off_hours` / `offline` precisely; the AI flattens them.
**Build:** have `search_screens`/`get_dashboard_stats` return explicit `off_hours` labels + `last_seen_at` +
"today so far" vs "yesterday" fields, and teach the (restored — see #2) system prompt the distinction: a
screen outside its ON window is *fine*, not a problem.

### 8. Loop management from chat — missing tools, dishonest fallback
`ToolName.ADD_LOOP_ITEM` / `REMOVE_LOOP_ITEM` exist in `app/ai/constants.py` but are **registered nowhere**
(no agent tool, no executor) — `loop_items` count stayed 0. Asked to add media to a screen's loop, the AI
silently reframed it as a **continuous ad booking** (a billing object!) without saying so, and only admitted
it can't do loops when challenged — and never pointed at the CMS Loop editor.
**Build:** `add_loop_item` / `remove_loop_item` / `list_loop` tools + executors (the loops service already
exists); until then, the prompt must require honesty: "I can't manage loops from chat yet — use the Loop
editor on the screen page."

### 9. Short-context references ("Resume it.")
Pause "Weekend Brunch Promo" → "Resume it." → the AI bound *it* to a (nonexistent) booking **draft** and
asked which campaign. The last-acted-on entity should be the obvious referent. Partly a symptom of #2 (no
rules in context); worth a line in the restored instructions ("'it' = the entity you just acted on").

### 10. Post-confirm truthfulness
The confirm endpoint's success note is canned (`router.py:500`). After executing, echo *reality*, not the
proposal: the created booking's derived status ("active, first play tomorrow 10:00"), or the updated
screen's actual stored hours. That single change would have caught both #3 and #5 in front of the user.

## Smaller polish items
- Bookings **list** DTO omits `daily_start_minute`/`daily_end_minute` (detail has them) — chat answers about
  windows from the list can't see them.
- "Xiaomi screen" (another owner's) → "I can't find that screen" is safe, but consider "that screen isn't
  in your fleet" phrasing.
- Stray "Shall we continue your booking?" trailer appears on unrelated turns even after the booking is done.
- Jul 26 2026 is a **Sunday** (weekend seed data was correct; one actor note mislabeled it Saturday).

## What's already genuinely good (keep it)
- **Zero-redundancy held in every scenario** — 0 re-asks across ~35 turns, including drip-fed, corrections,
  interruption + resume. The draft notepad + `extract.py` backstop works.
- Out-of-hours booking guard: caught, explained in plain IST, offered exactly trim-vs-extend, chained the
  hours change + booking, and even *noticed* the failed hours write and refused to book until fixed.
- Name→entity resolution ("the monsoon chai video" → `monsoon_chai_promo.mp4`; "Indiranagar" → the screen).
- Off-topic guardrail: byte-exact refusal, no leakage; ownership boundary held (no cross-owner writes).
- IST↔UTC handling on every persisted booking was exact (minute-of-day windows included).

## Suggested fix order
1. #1 GroupingError + failed-turn rollback/timeout (unbreaks proof-of-play AND the server).
2. #2 `instructions=` migration (one change; fixes dates, restores all rules every turn).
3. #4 + #5 tool/executor hardening (no raw HTTPException, validate executor args, honest results).
4. #3 + #10 dead-booking guard + truthful post-confirm.
5. #6 + #7 proactive warnings + status literacy (the AI-native differentiator).
6. #8 loop tools, #9 pronoun rule, polish items.

## Fixes shipped + re-verified (28 Jul 2026, same session)

All four headline issues were fixed and then **re-tested with fresh live actor-agent chat sessions**
(transcripts: `scratchpad/transcripts/retest-{proof,dates,loop}.md`):

| Fix | What changed | Live re-test result |
|-----|--------------|---------------------|
| **Proof-of-play dead + server freeze** | `local_date_col` renders the tz as an inline literal (`core/timezone.py`); `analyze_campaign` builds the day expression once (`playback_health.py`); turn failure now rolls back the poisoned session, falls back to a fresh session, and every turn has a hard `AI_TURN_TIMEOUT_SECONDS` (150s) ceiling (`agent.py`, `config.py`) | ✅ All proof questions answered in 6–38s, **Jul 26 gap named**, offline screen explained, server healthy throughout |
| **System prompt lost after turn 1** | Agent migrated from `system_prompt=` to pydantic-ai **`instructions=`** (+ `@agent.instructions` for the dynamic IST date) so persona/rules/date ride EVERY request (`tools.py`); plus a deterministic dead-date guard in `create_booking` that blocks past-dated proposals | ✅ Un-yeared dates on turn 3 landed as **2026** in the DB; past "March 1–10" was refused with no confirm card |
| **No "won't actually play" warnings** | Deterministic checks at propose time in `create_booking`: offline target screen (with last-seen time) + orientation/aspect mismatch — appended to the card summary AND the model's reply instructions; `_screen_dict` now carries `last_seen_at`; dashboard `plays_today` uses the IST day; prompt rules 13–14 teach online/off_hours/offline | ✅ Offline-screen booking warned in reply AND card before confirm; portrait-on-landscape warned 2/2 times; only the truly-dead screen called "offline", off-hours screens called healthy |
| **Loop requests silently became bookings + schedule crash** | New agent tools `get_screen_loop` / `add_loop_item` / `remove_loop_item` + executors (loops service, confirm-gated); every tool now catches `HTTPException` and returns a recoverable error instead of killing the turn; prompt rule 12 forbids silent object substitution | ✅ "Add to loop" produced a real `add_loop_item` card → `loop_items` row (540–660), listed, then removed cleanly; schedule question answered instead of crashing |

**Residual follow-ups spotted by the re-test** (none destructive, all logged in the retest transcripts):
- "Last weekend" play-count arithmetic can still be off (counted 24, truth 48) — needs a per-day
  breakdown tool answer rather than model math.
- `get_screen_schedule` answers "what plays RIGHT NOW", so "what's scheduled this week?" misses a
  weekend-only campaign → add a schedule-range/week-view tool.
- The booking-draft block can leak stale draft chatter ("Shall we continue…") into unrelated
  read-only answers, and one spurious (unexecuted) `remove_loop_item` card appeared on a status
  question — draft/tool discipline polish.
- One booking turn errored transiently and needed a retry; create_booking cards occasionally render
  text-only (card=null) — worth a look at the card-emit path.

## Test environment notes
- Local test data added (kept for re-runs): CMS users `ai-tester-admin@mark-ai.tech` / `Admin@123`
  (superadmin) and `rohit@chaipoint.in` / `Owner@123` (screenowner); screens `seed-uid-*`; media
  `11111111/22222222/33333333-…`; the 7 scenarios' bookings + AI chat sessions. Wipe by deleting those rows
  (screens cascade heartbeats/proofs) if you want a clean slate.
- ⚠️ `poetry` itself is broken on this machine (Homebrew Python 3.12 was upgraded out from under Poetry's
  launcher venv → `dyld: Library not loaded`). The API is currently running via the project venv's uvicorn
  directly: `~/Library/Caches/pypoetry/virtualenvs/markai-signage-api-_FuBdvt1-py3.12/bin/uvicorn`.
  `poetry self` needs a reinstall before `./dev_start.sh` works again.
