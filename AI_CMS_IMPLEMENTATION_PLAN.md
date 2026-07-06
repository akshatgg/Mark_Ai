# Mark AI — AI-Native Conversational CMS: Implementation Plan

> Status: PLAN ONLY (no code written yet). Consolidates the ClickUp "AI-Native Co-Pilot"
> spec + `AI_CMS_CO_PILOT_MASTER_PLAN.md` + all follow-up decisions into the **actual**
> `markai-signage-api` (FastAPI/Postgres) + `markai-Web-cms` (Next.js 15) codebase.

---

## 1. Context — what we're building and why

The CMS today is a **manual** operator dashboard: a human clicks through `/screens`,
`/content`, `/solution`, `/bookings`, `/reports`, `/users`, `/api-keys` to run the
business. The goal is to make the CMS **AI-native**: when an operator opens the CMS they
land in a **ChatGPT-style console** and simply *say* what they want
("find screens near Bellandur, Bangalore", "book summer_sale.mp4 on CP Screen 1 next Monday
1–2pm", "show me proof-of-play for last week"). An **LLM agent calls tools** that map to the
existing backend services and actually performs the work — the operator confirms, the AI
executes. Manual clicking still exists, but as a fallback the user opts into via a
**"Manual mode" toggle**.

Three hard requirements from the user:
1. **GPT-like interface** is the default landing; sidebar shows **recent chats (history)**.
2. **One toggle** switches the whole interface between **AI mode** and the **full manual
   CMS** (the existing dashboard pages, unchanged).
3. **Conversation memory**: persist sessions per user, keep **at least the last 5 chat
   "context windows" per user id**, and **show them** in the history sidebar so the user can
   reopen and continue any past chat with full context.

LLM: **Google Gemini** (user's explicit choice).

---

## 2. Final tech-stack decisions (and what we ruled out)

| Layer | Choice | Why (and the trigger that would change it) |
|-------|--------|---------------------------------------------|
| **Agent framework** | **Pydantic AI** | Built by the Pydantic team — "FastAPI-style DX for GenAI." Matches our exact stack (FastAPI + Pydantic v2 + a typed service layer). Typed tools map 1:1 to our service functions; **dependency injection** passes the `db` session + authenticated `CmsUser` into every tool (free per-user authorization); **human-in-the-loop / deferred tools** = our confirm-before-write mandate; **model-agnostic** so we can swap Gemini→Claude in one line later. |
| **LLM** | **Gemini** (`gemini-3.5-flash`, env-configurable) | User's choice. Pinned in one env var; flip to `gemini-2.5-flash` if the API rejects the id. |
| **Streaming / event bus** | **Redis Pub/Sub** → SSE to browser | Decouples the agent from the HTTP request, enables horizontal scale, multi-tab sync, reconnect-resume, and background progress cards. **Browser side only — never to the player.** |
| **Memory** | **Postgres** (`ai_chat_sessions` + `ai_chat_messages`) + a compact `session_state` JSONB draft buffer | Survives devices; ≥5 sessions retained per user; structured carry-over across turns. |
| **Geo / discovery** | **PostGIS** (already in the stack) | "Screens near X" is an exact geo-query, not semantic. |
| ~~Orchestration graph~~ | **No LangGraph** | Our flow is a simple message→tool→confirm→execute loop, which Pydantic AI handles natively. LangGraph's durable-checkpoint graphs would duplicate our Postgres memory. *Trigger to revisit:* a genuinely long-running, branching autonomous job (e.g. nightly allocation across 100k screens) — and even then we'd weigh Google ADK too. |
| ~~Vector DB / embeddings~~ | **No vector store for the agent** | CMS data is structured; tool-calling over Postgres/PostGIS is exact, cheap, auditable. *Embeddings live only inside the brand-exclusion vision model (a separate ML pillar behind a tool), and would only enter the chat if we later add semantic search over unstructured help docs.* |

**Player contract is untouched.** The ClickUp doc's Redis `player_channel:{screen_id}`
WebSocket hot-swap **contradicts** `CLAUDE.md` ("heartbeat is the single live channel, no
WebSocket"). We keep heartbeat: AI writes bump `screens.schedule_updated_at`, the screen
re-fetches on its next heartbeat (≤60s). Redis is used **only** for the chat/UI event stream.

---

## 3. Architecture at a glance

```
 markai-Web-cms (Next.js)                 markai-signage-api (FastAPI)
 ┌──────────────────────────┐  POST /api/cms/ai/sessions/{id}/message
 │  AI SHELL (default "/")   │ ──────────────────────────────────────►  app/ai/router.py
 │  3-pane ChatGPT layout    │                                             │ spawns async
 │   • history sidebar       │                                             ▼
 │   • chat thread + cards   │                                       app/ai/agent.py
 │   • telemetry/preview     │                                  (Pydantic AI agent + Gemini)
 │  [ Switch to Manual ▢ ]   │                                             │ calls tools
 └──────────┬───────────────┘                                             ▼
            │ GET .../stream (SSE)                                   app/ai/tools.py
            │                                          thin typed wrappers over EXISTING services:
            ▼                                          bookings · solutions · loops · content ·
   ┌─────────────────┐   subscribe        publish      screens · reports · users · api_keys
   │  SSE endpoint   │◄──────────────┐  ┌──────────────────────┐
   │ (router.py)     │               └──│  REDIS PUB/SUB        │◄── agent publishes
   └─────────────────┘                  │ chat_channel:{u}:{s}  │    token/tool/card events
                                        └──────────────────────┘
                                                  │ tool writes bump schedule_updated_at
                                                  ▼
                                   (screen picks up change on next HEARTBEAT — no WebSocket)

 ┌──────────────────────────┐
 │  MANUAL SHELL (existing   │   the current dashboard, completely unchanged
 │  dashboard) [Switch to AI]│
 └──────────────────────────┘
```

---

## 4. Decisions log (confirm if any are wrong)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **AI chat is the default landing (`/`)**; the current dashboard becomes the manual shell behind the toggle. Existing manual routes/pages **left untouched**. | "When the user opens the CMS, the chat is open." |
| D2 | **Agent layer = Pydantic AI**; **model = `gemini-3.5-flash`** via `GEMINI_MODEL`. | See §2. One dependency, typed tools, DI, model-agnostic. |
| D3 | **Streaming = Redis Pub/Sub → SSE**, browser side only. | Decoupled, scalable, multi-tab; player stays on heartbeat. |
| D4 | **Memory = Postgres tables**, scoped per `cms_user.id`, **≥5 retained per user**, shown in sidebar. | The user's "5 context windows per ID + show them." |
| D5 | **Read tools auto-run; write tools require explicit user confirmation** (action-card → Confirm → execute). | "Operator Confirmation Mandate" while still AI-driven. |
| D6 | **Reuse existing service functions** as tool bodies; never duplicate booking/solution/loop logic. | `app/bookings/service.py` etc. already enforce the rules. |
| D7 | **No LangGraph, no vector DB** for the agent. | See §2 ruled-out rows. |
| D8 | **Zero-redundancy asking (HARD RULE).** The AI **never re-asks** a detail the user already gave. It auto-locks every provided/resolved parameter and **asks only the single missing or ambiguous one**. When everything is present, it goes straight to **one consolidated final confirm** for the whole action — **never** a separate "confirm the screen?", "confirm the media?", "confirm the time?" per field. | The user was emphatic: re-asking the same things again and again is the worst failure here; frictionless zero-redundancy is the entire point of AI mode. |

> The two that most change the build: **D1** (replace landing) and **D5** (confirm-before-write).
> Flag either if wrong before coding. **D8 is non-negotiable** — it shapes the system prompt
> and the entire flow.

---

## 5. Backend plan — new `app/ai/` module

Mirror the existing per-domain structure (`router.py` / `service.py` / `schemas.py` /
`models.py`), mounted under the CMS JWT layer like the other `cms_*` routers in
`app/api/routers/routers.py`.

### 5.1 Files

```
app/ai/
  __init__.py
  models.py     # AiChatSession, AiChatMessage (SQLAlchemy)
  schemas.py    # Pydantic: session list/detail, message in/out, tool-event, action-card
  tools.py      # Tool catalog — Pydantic AI @agent.tool wrappers over existing services (§7)
  agent.py      # Pydantic AI Agent (deps = db + CmsUser) + Gemini model + run loop
  bus.py        # Redis Pub/Sub publish/subscribe helpers (chat_channel:{user}:{session})
  service.py    # session/message persistence, history trimming, retention (≥5), session_state
  router.py     # CMS-JWT endpoints (§5.4) incl. the SSE subscriber
```

### 5.2 Data model (Alembic migration, next sequential number)

```
ai_chat_sessions
  id            (uuid/str pk)
  cms_user_id   (fk -> cms_users.id, indexed)
  title         (str, auto-summarized from first message)
  session_state (JSONB)   # screen_id, media_ids[], layout_data, draft_schedule, audit flags
  created_at, last_active_at  (indexed for "recent" ordering)

ai_chat_messages
  id            (uuid/str pk)
  session_id    (fk -> ai_chat_sessions.id, cascade, indexed)
  role          ('user' | 'assistant' | 'tool')
  content       (text)
  tool_calls    (JSONB, nullable)   # function name + args proposed/executed
  card          (JSONB, nullable)   # interactive card payload (screen grid, preview, etc.)
  created_at
```

### 5.3 The Pydantic AI agent (`agent.py`)

```python
@dataclass
class AiDeps:
    db: AsyncSession
    user: CmsUser          # injected so tools can only do what THIS user can

agent = Agent("google-gla:gemini-3.5-flash", deps_type=AiDeps,
              system_prompt=AI_OPERATOR_SYSTEM_PROMPT)   # persona + 4-step pipeline + confirm rules

@agent.tool
async def search_screens(ctx: RunContext[AiDeps], location: str) -> list[ScreenCard]:
    """Find screens near a location (PostGIS)."""
    return await screens_service.search(ctx.deps.db, location)
# ... one thin @agent.tool per row in §7
```

- **Read tools** run automatically; their result is fed back to the model and emitted as a
  `tool_event`/`card`.
- **Write tools** are **deferred** (Pydantic AI human-in-the-loop): instead of mutating, they
  surface a typed **proposal** → the agent emits an `action_card` and pauses. The mutation
  runs only after `POST .../confirm` (§8).

### 5.4 Endpoints (all under `/api/cms/ai`, `Depends(get_current_cms_user)`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sessions` | List the user's recent sessions for the history sidebar. |
| POST | `/sessions` | Create a new chat (`+ New Chat`). |
| GET | `/sessions/{id}` | Full message history to rehydrate a reopened chat. |
| PATCH | `/sessions/{id}` | Rename. |
| DELETE | `/sessions/{id}` | Delete (retention floor keeps ≥5). |
| POST | `/sessions/{id}/message` | Persist the user message, spawn the agent task (publishes to Redis), return instantly. |
| GET | `/sessions/{id}/stream` | **SSE** — subscribes to `chat_channel:{user}:{session}` and flushes token/tool/card events. |
| POST | `/sessions/{id}/confirm` | Execute a previously-proposed **write** action (the action-card Confirm button). |

### 5.5 Request flow (Redis-decoupled)

1. `POST /message` → persist user msg, `spawn` the agent as an async task, return
   `{message_id, status:"queued"}` immediately.
2. The agent task runs the Pydantic AI loop; every token / tool-event / card is **published**
   to `chat_channel:{user}:{session}` via `bus.py`.
3. The browser's open `GET /stream` SSE connection is **subscribed** to that channel and
   flushes each event to the UI.
4. On completion the agent persists the assistant message, updates `session_state` +
   `last_active_at`, and auto-titles the session.

### 5.6 Config additions (`app/core/config.py` + `.env.example`)

```
GEMINI_API_KEY=                       # required to enable AI mode
GEMINI_MODEL=google-gla:gemini-3.5-flash
REDIS_URL=redis://localhost:6379/0
AI_HISTORY_MAX_MESSAGES=20
AI_SESSION_RETENTION_FLOOR=5
```

`pyproject.toml`: add `pydantic-ai` (with the Google provider) and `redis`.
`docker-compose.dev.yml`: add a `redis` service.

---

## 6. Context-window & memory model

"Context window" means **two different things** — both are handled:

**(a) The live model context (per turn).** Gemini's token budget is finite, so we never
replay the whole transcript. Each turn we send: the system prompt + a **compact structured
summary of facts gathered so far** (`session_state`) + the last `AI_HISTORY_MAX_MESSAGES`
messages. `session_state` is the booking "draft notepad":

```
session_state = {
  screen_id: null,  location_query: null,  media_ids: [],
  layout: null,     draft_schedule: null,  audit_tier: null
}
```

Every resolved fact is written here, so the AI **never re-asks** something already answered
— even across turns where info arrives out of order (e.g. a schedule stated before a screen
is chosen is stored and auto-applied when the screen is later locked).

**(b) The saved sessions (the user's "5 context windows per ID").** Full transcripts in
Postgres, shown in the history sidebar. **Retention floor = 5**: we never prune a user below
their 5 most recent sessions (we surface ~10, retain all). Reopening a session rehydrates the
messages **and** its `session_state`, so the user resumes exactly where they left off — even
days later on another device.

> This is **retrieval, not training.** Nothing fine-tunes Gemini. (Separately, the ML
> *recommender* learns from real foot-traffic over time, but that's a tool the agent calls —
> not the chat learning.)

---

## 7. How a natural-language request flows — the script

Worked example of an intentionally vague request. Watch the notepad fill in:

**Turn 1 — user:** *"Book a screen near Bellandur, Bangalore."*
- AI calls **read tool** `search_screens("Bellandur, Bangalore")` → PostGIS finds nearby
  screens → returns a **selection card** (name, resolution, orientation, distance).
- `session_state.location_query = "Bellandur, Bangalore"`.
- AI asks **only for the gaps** (zero-redundancy): *"Found 3 screens near Bellandur — which
  one, what dates/times, and which creative?"*

**Turn 2 — user:** *"The Cafe Coffee Day one, next Monday 1–2pm."*
- `screen_id = ①` (locks resolution 1080×1920 portrait), `draft_schedule = next Mon 13:00–14:00`.
- Still missing media → AI asks only that.

**Turn 3 — user:** *"summer_sale.mp4"*
- AI calls `get_media(...)`, **fit-checks** aspect ratio vs the locked portrait screen
  (warns if it would letterbox). `media_ids = [summer_sale]`.

**Notepad complete → propose, don't execute.** Because `create_booking` is a **write tool**,
the agent emits an **action_card**: *"Book summer_sale.mp4 → CCD Bellandur, Mon 13:00–14:00,
full-screen, standard POP — ₹X. [Confirm] [Edit] [Cancel]."*

**Confirm →** `POST /confirm` runs the real `bookings.service.create_booking` → row created,
`schedule_updated_at` bumped → success card → **screen picks it up on its next heartbeat.**

**Open product decision:** when several screens match, should the AI **always let the user
pick** (current default), or **auto-recommend the best** via the traffic model and only ask
to confirm? (Both are easy; control-vs-convenience.)

---

## 8. Tool catalog (the "multiple agent tools")

Each tool is a **thin typed `@agent.tool`** over an existing service function. Read tools
auto-run; **write** tools are deferred and gated by `/confirm`.

| Tool | Type | Backs onto (reuse) |
|------|------|--------------------|
| `search_screens(location?, query?)` | read | `app/cms/screens_router.py` + screens service (grid card w/ resolution, orientation, PostGIS distance) |
| `get_screen(screen_id)` | read | screens service — resolution/aspect/orientation to **lock** Step 1 |
| `list_media()` / `get_media(id)` | read | `app/content/service.py` |
| `upload_media_reference(...)` | write | `app/content` create — plus aspect-ratio **fit check** vs locked screen |
| `create_solution(layout)` | write | `app/solutions/service.py` `create_solution` |
| `create_booking(payload)` | write | `app/bookings/service.py` `create_booking` |
| `update_booking_layout(id, layout)` | write | `bookings.service` `update_booking_layout` |
| `list_bookings()` / `get_booking_detail(id)` | read | `bookings.service` `list_bookings` / `get_booking_detail` |
| `set_booking_status(id, status)` | write | `bookings.service` `update_booking_status` |
| `toggle_premium_screenshots(booking_id, on)` | write | `app/screenshots` cms toggle |
| `list_loop_items` / `add_loop_item` / `update_loop_item` / `remove_loop_item` | read/write | `app/loops/service.py` |
| `get_dashboard_stats()` | read | `app/cms/dashboard_router.py` service |
| `get_proof_of_play(screen_id, range)` / `get_proof_report(params)` | read | `app/cms/reports_router.py` + `bookings/report.py` |
| `list_users()` / `create_user(...)` / `update_user(...)` | read/write (superadmin) | `app/cms_users/service.py` |
| `list_api_keys()` / `create_api_key(...)` / `revoke_api_key(id)` | read/write | `app/api_keys/service.py` |
| *(future)* `recommend_screens(category, budget)` | read | ML recommender pillar (Model 3) behind a tool |

**Authorization:** every tool receives the authenticated `CmsUser` via `ctx.deps.user`;
superadmin-only tools reuse the existing `require_superadmin` checks, so a screenowner's
agent can only do what that user could do manually.

---

## 9. Frontend plan — `markai-Web-cms`

### 9.1 Mode switch (AI ⇄ Manual)
- **AI shell** renders at `/` (new default). The current dashboard pages stay where they are
  and become the **Manual shell**.
- Persistent **toggle** (`Switch to Manual` in the AI header; `Switch to AI` in
  `Sidebar.tsx`). Persist the preference (cookie/localStorage), defaulting to **AI**.
- A small `ModeContext`; the AI shell is its own layout so `(dashboard)/layout.tsx` is
  undisturbed.

### 9.2 AI shell — 3-pane ChatGPT layout (`src/app/(ai)/page.tsx`, `src/components/ai/`)
- **Left — History sidebar:** `+ New Chat`, recent sessions (rename/delete), `Switch to
  Manual`. Backed by `GET /cms/ai/sessions`.
- **Center — Chat thread:** markdown bubbles + inline **interactive cards** (screen grid,
  media dropzone, layout/zone builder, **action-card with Confirm/Edit/Cancel**), sticky
  composer.
- **Right — Telemetry / WYSIWYG preview:** locked screen + resolution, loaded assets, live
  cost, and the **bezel preview simulator** (CSS grid honoring orientation). Driven by
  `session_state`.

### 9.3 API client + streaming (`src/lib/api.ts`)
- Add `api.ai.*` methods reusing the existing `request<T>` helper + Bearer injection.
- SSE via fetch + `ReadableStream` (so the `Authorization` header is sent; native
  `EventSource` can't). Append `token` events to the live bubble; render `tool_event` /
  `card` / `action_card` as structured UI.

### 9.4 New dependencies
- `react-markdown` (+ `remark-gfm`). Cards/dropzone/preview use existing Tailwind v4 +
  `lucide-react`; no heavy state lib.

---

## 10. Confirmation / action-card pattern (user-in-the-loop)

1. A write tool surfaces a typed **proposal**; the agent emits **one** `action_card` (summary
   of the *whole* action — exact tool + all args + cost).
2. Frontend renders **[Confirm] [Edit] [Cancel]** on that single card.
3. Confirm → `POST /cms/ai/sessions/{id}/confirm` → backend runs the real service → success
   card + (for bookings/loops) the `schedule_updated_at` bump the screen picks up next
   heartbeat.

**This is ONE consolidated gate — never per-parameter (D8).** The agent must not re-ask or
re-confirm the screen, media, or schedule individually once the user has provided them; the
only confirmation is this final whole-action card. If the user gave everything up front and
nothing is ambiguous, the very first thing they see is this single confirm card (no
step-by-step questions at all).

Delivers "the AI does it, the user doesn't do manual work" while keeping the operator in
control of every state change.

---

## 11. Phasing

- **Phase 1 (MVP):** `app/ai/` module (Pydantic AI agent, Redis Pub/Sub + SSE, sessions +
  messages tables, ≥5 retention, `session_state`). Read tools + booking/solution/loop write
  tools with confirm. Frontend AI shell (3-pane), history sidebar, mode toggle. **Outcome: an
  agent that searches screens, answers questions about the CMS, and books a full-screen
  campaign end-to-end from plain English.**
- **Phase 2:** multi-zone layout builder card + WYSIWYG bezel preview; media dropzone with
  aspect-ratio fit check; reports/proof-of-play + user/api-key tools.
- **Phase 3 (scale, optional):** move the agent task into dedicated worker processes +
  priority queues (the doc's `premium`/`standard` queues) — the Redis contract already
  supports it, so the frontend is unchanged. Add `recommend_screens` once the ML recommender
  is live.

---

## 12. Verification

- **Backend:** add `app/ai` to the existing pytest suite — unit-test each tool wrapper (mock
  the underlying service), the retention floor (≥5), and the agent loop with `pydantic-ai`'s
  **`TestModel`/`FunctionModel`** (no live Gemini in CI). Manually: `./dev_start.sh` (+ Redis),
  hit `/api/cms/ai/sessions` with a CMS JWT, send a message, watch the SSE stream.
- **End-to-end (local):** run `markai-signage-api` (:8000) + `markai-Web-cms` (:3001) + Redis,
  log in as `superadmin/Admin@123`, land in AI mode, ask *"find screens near Bellandur"*
  (read tool → grid), then *"book <media> on <screen> next Monday 1–2pm full screen"* →
  confirm the action-card → verify a booking row exists and `schedule_updated_at` bumped.
  Reopen the chat from the sidebar → full history + `session_state` rehydrate. Toggle to
  Manual → existing dashboard unchanged.
- **Gemini key:** AI mode is gated on `GEMINI_API_KEY`; without it the UI shows a clear "AI
  not configured" state and Manual mode still works.

---

## 13. Open questions (sensible defaults assumed unless you say otherwise)

1. **Landing (D1):** AI chat as default `/`, manual behind the toggle? (Default: yes.)
2. **Write autonomy (D5):** confirm every mutation — or auto-run "safe" writes (e.g. a draft
   booking) and only confirm publish/payment? (Default: confirm all writes.)
3. **Multi-screen match (§7):** always let the user pick, or auto-recommend the best via the
   traffic model + confirm? (Default: let the user pick until the recommender is live.)
4. **In-chat media upload:** real Cloudinary/GCS upload from the dropzone in Phase 1, or
   reference already-uploaded media in P1 and add upload in P2? (Default: reference in P1.)
```
