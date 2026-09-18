# WhatsApp → CMS Co-Pilot — Design

**Date:** 2026-08-12
**Status:** Design drafted; awaiting user review before an implementation plan is written.
**Scope:** new `markai-signage-api/app/whatsapp/`, one extraction from `app/ai/router.py`,
one Alembic migration (`0042`), one CMS profile panel.

---

## 1. Why

Operators run campaigns from their phone as often as from a desk. The CMS co-pilot
(`app/ai/`) already knows how to book a campaign, search screens, answer campaign
questions and analyse proof-of-play — but it is only reachable through a browser tab.

This puts a second door on the *same* co-pilot: an operator messages a WhatsApp Business
number and talks to the agent they already use.

**This is a transport adapter, not a new agent.** `agent.run_turn` and everything under it —
`tools.py`, `draft.py`, `history.py`, `guardrails/`, `locks.py`, `executors.py` — is reused
unchanged. The new code only translates WhatsApp ↔ turn. That is the whole design constraint:
there must be no second copy of the permission model, the booking rules, or the confirm guard.

---

## 2. Scope

**In:**

- An operator links their own WhatsApp number from their CMS profile.
- Inbound text and media from a linked number run a normal co-pilot turn.
- The reply is pushed back to WhatsApp, with native reply buttons for write confirmations.
- Media sent on WhatsApp reaches the co-pilot the same way a CMS chat upload does.

**Explicitly out (v1):**

| Out | Why |
|---|---|
| Public/advertiser access | Locked decision — internal operators only |
| Proactive bot-initiated messages ("screen offline") | Needs a paid utility template + its own approval flow |
| Group chats | Authority is per-person; a group has no single authenticated identity |
| Voice notes / audio transcription | Separate capability, separate model, own decision |
| Sending creatives *out* to the operator | Read-side only in v1 |
| WhatsApp as a creative-upload path for 4K video | Meta's caps make this dishonest — see §11 |

---

## 3. Locked decisions

Decided by the user during brainstorming. The design works within these.

1. **Audience:** internal operators / screenowners only.
2. **Linking:** operator self-links from their CMS profile — CMS mints a one-time token,
   renders a `wa.me` deep link with it prefilled, the operator sends it, the webhook binds.
3. **Confirm:** native interactive reply buttons carrying an opaque action id. Not typed "yes".
4. **Channel:** Meta WhatsApp Cloud API **direct** (no BSP). Every message this feature sends
   is a free-form service message inside the 24-hour window, so the running cost is zero.
5. **Sessions:** one long-lived `ai_chat_session` per operator, auto-rolled after ~12h idle.
6. **`run_turn` is reused unchanged.** New code lives in `app/whatsapp/`.

---

## 4. Architecture

```
Operator's WhatsApp
      │
      ▼ Meta Cloud API
POST /api/whatsapp/webhook            ← PUBLIC, unauthenticated by nature.
      │                                 NOT under /api/cms/* (Meta calls it directly;
      │                                 the CMS BFF proxy is not involved).
      ├─ 1. verify X-Hub-Signature-256 over the RAW body      → 403 on mismatch
      ├─ 2. parse → 0..N inbound messages
      ├─ 3. INSERT whatsapp_messages(wamid UNIQUE, status='queued')
      │        IntegrityError → already seen → skip (this IS the dedup guard)
      └─ 4. return 200  ─────────────────────────────────────── fast, always
                │
                │  (no background task; the row is durable work)
                ▼
app/whatsapp/worker.py — N in-process asyncio workers, Postgres IS the queue
      │  claim: UPDATE ... WHERE id = (SELECT ... WHERE status='queued'
      │                                FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING
      ▼
  resolve phone_e164 → whatsapp_links → CmsUser
      │  no link / revoked / user inactive → one generic line, mark 'ignored'
      ▼
  is it a link-token message?  ──yes──→ link_service.bind() → welcome message
      │ no
      ▼
  is it a button tap?  ──yes──→ ai.confirm_service.execute_actions(...)
      │                          (the SAME function POST /confirm calls)
      │ no
      ▼
  media? → fetch bytes within 5 min → ai_chat_media (same rows a CMS upload writes)
      │
  session: reuse whatsapp_links.session_id if last_message_at < 12h, else create fresh
      │
  create_turn(...)  →  await run_turn(user_id, session_id, turn_id)   ← EXISTING, untouched
      │
  read the finished turn row → render → send text + up to 3 reply buttons
      │
  mark 'done'
```

### 4.1 Why `await run_turn(...)` and not fire-and-forget

`run_turn` is a plain awaitable that returns only once the turn is finished and persisted.
The CMS fires it and forgets *because a browser is holding an SSE connection* and wants
tokens as they arrive. WhatsApp wants one finished message. So the worker simply awaits it
and then reads `turn.final_response` / `turn.card`.

This deletes an entire layer: no bus subscription, no `_terminal_replay_if_done` equivalent,
no polling for terminal state.

**Free bonus:** `bus.publish` still fires during the turn, so if the operator has that same
session open in a CMS tab, their WhatsApp conversation streams into the browser live.

### 4.2 Concurrency comes for free

`run_turn` already wraps itself in `locks.session_turn_lock(session_id)` (Redis `SET NX PX`
with a TTL self-heal, in-process `asyncio.Lock` fallback). Three messages sent in four
seconds become three queued rows, claimed by up to three workers, which then **serialize on
the session lock** — each running off the previous one's saved state. Ordering is preserved
by claiming `ORDER BY received_at` and by the lock. No new concurrency machinery.

---

## 5. Background execution — the decision, and the evidence

This looked like the biggest risk in the feature. It is already largely solved.

**Verified:** `markai-signage-api/cloudbuild.yaml:46-51` deploys `cms-back` with
`--min-instances=1 --max-instances=3 --cpu=1 --memory=1Gi --no-cpu-throttling`, and line 50
carries the comment *"background asyncio tasks need CPU between requests"*. CPU-always-allocated
is on today. (These flags live in `cloudbuild.yaml`, **not** `gcp-env/`, which carries only
env vars and Secret Manager refs. Any future change to them belongs there.)

**Options considered:**

| Option | Verdict |
|---|---|
| `asyncio.create_task` after the 200 | Works *most* of the time given `--no-cpu-throttling`. But with `max-instances=3`, a webhook can land on a scaled-out instance with no held request, which Cloud Run may reap. Losing a booking reply to a scale-down is not acceptable on a channel an operator trusts. |
| Run inline before the 200 | Meta retries any non-200 **with decreasing frequency for up to 7 days**. An agent turn takes seconds; a slow turn becomes a retry storm and a duplicate-work problem. Rejected. |
| Cloud Tasks / Pub/Sub → second endpoint | Durable and gets retry/backoff free. But it is new GCP infra, new IAM/OIDC, a second authenticated endpoint, and — decisively — **it does not run on a laptop**, forcing an emulator or a divergent local code path. |
| **Postgres-as-queue** | **Chosen.** |

**Chosen: Postgres-as-queue, mirroring `app/creative_fit/worker.py`.**

That module is already exactly this pattern and its docstring makes the argument: *"it runs
identically on a laptop and in production… there is no second thing to deploy, scale, or
forget to restart."* It provides `claim_one` (`FOR UPDATE SKIP LOCKED`), `reclaim_stale`,
a SQLite claim fallback for tests, `worker_loop`, `start_workers`/`stop_workers`, and a
`CREATIVE_FIT_WORKERS=0` kill switch. `app/whatsapp/worker.py` is that file, adapted.

Two properties this buys that no other option does as cheaply:

- **The dedup table *is* the queue.** We need `whatsapp_messages(wamid UNIQUE)` regardless,
  to survive Meta's retries. One `INSERT` is both the duplicate guard and the enqueue.
- **`reclaim_stale` is the crash story.** An instance reaped mid-turn leaves a `running` row
  with a stale `claimed_at`; it is reclaimed and retried. This is the precise failure that
  motivated the Cloud Tasks suggestion, already solved by the house pattern.

`--no-cpu-throttling` stays as-is. It is no longer load-bearing for this path, but the worker
loop does want CPU between requests, so it keeps earning its place.

---

## 6. Data model — migration `0042_whatsapp_copilot`

`down_revision = "0041_gmail_booking_drafts"`.

### `whatsapp_links` — the phone ↔ operator binding

| Column | Type | Notes |
|---|---|---|
| `id` | String(36) PK | |
| `cms_user_id` | String(36) **UNIQUE** FK `cms_users.id` CASCADE | one operator, one number |
| `phone_e164` | String(20) **UNIQUE** | one number, one operator |
| `wa_profile_name` | String(128) null | what WhatsApp reports; display only |
| `session_id` | String(36) null | current `ai_chat_sessions.id` |
| `last_message_at` | DateTime(tz) null | drives the 12h idle roll |
| `linked_at` | DateTime(tz) | |
| `created_at` / `updated_at` | DateTime(tz) | |

Both uniques matter. Without unique `phone_e164`, one handset could resolve to two operators
and the authority of a message becomes ambiguous. Unlink is a **hard delete** — a soft-delete
would collide with the unique constraint on re-link, and the audit trail lives in
`whatsapp_messages` anyway.

### `whatsapp_link_tokens` — one-time linking tokens

Modelled directly on `CmsPasswordResetToken` (`app/cms_users/models.py:105`) and its service
(`app/cms_users/password_reset.py`), which already gets every detail right.

| Column | Type |
|---|---|
| `id` | String(36) PK |
| `cms_user_id` | String(36) FK `cms_users.id` CASCADE, indexed |
| `token_hash` | String(64) indexed — sha256 of the raw token |
| `expires_at` | DateTime(tz) |
| `used_at` | DateTime(tz) null |
| `created_at` | DateTime(tz) |

### `whatsapp_messages` — dedup guard, work queue, and audit log

| Column | Type | Notes |
|---|---|---|
| `id` | String(36) PK | |
| `wamid` | String(128) **UNIQUE** NOT NULL | Meta's own message id. **The dedup guard.** |
| `direction` | String(8) | `in` \| `out` |
| `phone_e164` | String(20) indexed | |
| `cms_user_id` | String(36) null FK `cms_users.id` SET NULL | null until resolved |
| `session_id` / `turn_id` | String(36) null | provenance for debugging |
| `kind` | String(16) | `text`\|`image`\|`video`\|`document`\|`audio`\|`button`\|`unsupported` |
| `body` | Text null | inbound text, or the button payload |
| `media_ref` | JSONB null | `{media_id, mime_type, sha256, filename, caption}` |
| `status` | String(16) | `queued`\|`running`\|`done`\|`failed`\|`ignored` |
| `attempts` | Integer default 0 | |
| `claimed_at` | DateTime(tz) null | drives `reclaim_stale` |
| `error` | Text null | |
| `received_at` | DateTime(tz) | Meta's timestamp, not ours |
| `created_at` / `updated_at` | DateTime(tz) | |

Indexes: `uq` on `wamid`; `(status, received_at)` for the claim; `(phone_e164)`.
Outbound rows are inserted with `status='done'`; the claim filters `direction='in'`.

**JSONB rule.** `media_ref` is JSONB and this codebase has **no** SQLAlchemy mutation
tracking. Never mutate in place — always reassign the whole object. See
`app/gmail/draft_state.py` for the house pattern.

---

## 7. Linking flow

```
CMS profile page
   └─ [Link WhatsApp]  → POST /api/cms/whatsapp/link-token
                          mints raw = secrets.token_urlsafe(24)
                          stores sha256(raw), expires_at = now + 15 min
                          invalidates every earlier unused token for this user
                          returns { deep_link, expires_at }

   deep_link = https://wa.me/<BUSINESS_NUMBER>?text=<urlencoded>
               "Link my Mark AI account: <raw>"

   operator taps → WhatsApp opens with the text prefilled → they send it
        │
   webhook → worker → text matches the link prefix?
        │      → look up sha256(token) in whatsapp_link_tokens
        │      → unused + unexpired + user is_active?
        │      → bind: upsert whatsapp_links(cms_user_id, phone_e164)
        │      → mark token used_at
        └─ reply: "✅ Linked to <email>. You can ask me anything you'd ask
                   the CMS co-pilot — try 'what's playing on my screens right now?'"
```

**Security argument.** Only someone authenticated in the CMS can mint a token; only the real
handset can send it. Both halves are required. The token is single-use, 15-minute TTL, and
stored only as sha256 — a database dump yields nothing spendable, exactly as with password
reset. Minting a new token strands every earlier unused one.

**Residual risk, stated honestly:** the raw token sits in the operator's own WhatsApp chat
history in plaintext. Single-use + 15-minute TTL bounds this to near-zero, and the message is
in a chat between the operator and our own business number. Accepted.

**Revocation.** `DELETE /api/cms/whatsapp/link` from the profile page, and — importantly —
`cms_users.is_active = false` kills the link instantly because the worker re-checks
`is_active` on **every** message, not just at bind. This mirrors the enrollment-key rule
(only an active screenowner's key resolves).

---

## 8. Inbound pipeline

**Signature verification.** `X-Hub-Signature-256` is `sha256=` + HMAC-SHA256 of the **raw
request body** under the Meta app secret. It must be computed over the exact bytes, before
any JSON parsing — so the handler takes `await request.body()` and parses manually.
Compare with `hmac.compare_digest` (already the house idiom, `app/core/passwords.py:39`).
A mismatch is a 403 and nothing is written. **There is no existing HMAC webhook verification
in this repo — this is genuinely new code.**

**GET handshake.** Meta verifies the endpoint once with
`GET /api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=…&hub.verify_token=…`.
Echo `hub.challenge` as `text/plain` when the verify token matches; 403 otherwise.

**Unknown / unlinked number.** One generic line — *"This number isn't linked to a Mark AI
account. Link it from your CMS profile."* — and the row is marked `ignored`. It must not
reveal whether an account exists, and it must be rate-limited per phone number so the endpoint
is not a free reply generator. `app/screens/enrollment_ratelimit.py` is the existing
in-memory per-key limiter to copy (with its known caveat: per-process, not fleet-wide).

**Media.** Two-step, and the URL expires in **5 minutes**, so bytes are fetched during the
turn, never lazily: `GET /{version}/{MEDIA_ID}` → `{url, mime_type, sha256, file_size}`, then
`GET url` **with the bearer token**. Webhook media ids expire after 7 days, which the queue's
staleness bound already stays well inside. Bytes then follow the CMS upload path into
`ai_chat_media` so the agent sees them exactly as it sees a browser upload.

**Staleness bound.** A queued inbound message older than `WHATSAPP_MAX_MESSAGE_AGE_MINUTES`
(default 360) is marked `failed` rather than answered. Answering a six-hour-old "book it"
is worse than not answering, and the 24-hour service window would eventually reject the send
anyway.

---

## 9. Confirm via buttons — and the one extraction

Every write the co-pilot proposes rides an action card, confirmed today by
`POST /cms/ai/sessions/{id}/confirm` (`app/ai/router.py:392`). That handler holds logic that
**must not be duplicated**: action selection by id, the `executed`/`dismissed` guards, the
per-action persistence *as soon as each succeeds* (so a mid-batch failure cannot double-run
on retry), the post-booking draft archiving, and the bus broadcast.

**Extract its body into `app/ai/confirm_service.py`** as
`execute_actions(db, user, session_id, turn_id, action_id=None, overrides=None) -> list`,
with the HTTP route becoming a thin wrapper that translates its errors into `HTTPException`.
The WhatsApp worker calls the same function.

This is the single riskiest edit in the feature — it touches a live write path — and it is
also the whole reason the design is safe. A second copy of the double-execution guard would
drift, and what it guards is booking a real screen twice.

**Button payload.** WhatsApp reply-button ids allow 256 chars; encode `cfm:{turn_id}:{action_id}`.
The webhook also delivers `context.id` — the wamid of the message the button belonged to — which
is cross-checked against `whatsapp_messages` so a payload cannot be replayed against a different
message.

**Shape:**

- 1 action → `[Confirm] [Change] [Cancel]`
- 2–3 actions → one button each, titles truncated to 20 chars
- \>3 actions → `[Confirm all N] [Review] [Cancel]`, with `Review` sending an interactive
  **list** message (≤10 rows) for per-action confirmation

**Already-executed tap** → *"That one's already booked ✅"*, not an error. Tapping a stale
button from days ago must be safe by construction, which the persisted `executed` flag already
makes true.

---

## 10. Rendering — `app/whatsapp/render.py`

WhatsApp is not markdown. It has `*bold*`, `_italic_`, `~strike~`, monospace — and **no
tables**. The co-pilot answers in markdown today.

| Source | Rendered |
|---|---|
| `**bold**` | `*bold*` |
| `_italic_` / `*italic*` | `_italic_` |
| `# Heading` | `*Heading*` |
| `- item` | `• item` |
| Table | one block per row, `*col*: value` lines |
| Code fence | preserved as ``` fence |
| Link | bare URL (WhatsApp auto-links) |

**Chunking.** Body cap is 4096 chars. Split on paragraph boundaries, never mid-word; number
the parts (`(1/2)`) so order is legible if delivery reorders.

**Cards:**

- `ACTION` → summary text + buttons (§9)
- `SCREEN_GRID` → numbered text list; if ≤10, also offer an interactive list message so the
  operator taps rather than types
- `INFO` → plain text

**The honest fallback.** Some co-pilot answers — a wide proof-of-play table — genuinely do
not belong on a phone. When rendering would exceed two chunks or lose a table's meaning, send
a short summary plus a deep link into the CMS. Silently truncating a report an operator is
about to make a decision from is worse than saying "this one's better on the big screen".

**Example copy:**

```
*Booking ready to confirm*

Nike Air — Winter push
📺 Café MG Road
📅 Mon 1 Sep → Sun 7 Sep  (7 days)
🕘 09:00–17:00 IST
🎞 nike-winter-1080x1920.mp4

Every ad on this screen plays for 15s.

[Confirm]  [Change]  [Cancel]
```

---

## 11. Media — the caps, and being honest about them

Meta's Cloud API caps, verified against the official reference:

| Sent as | Cap |
|---|---|
| Image (JPEG/PNG) | **5 MB** |
| Video (MP4/H.264) | **16 MB** |
| Document | **100 MB** |
| Audio | 16 MB |

Worse than the caps: **WhatsApp clients recompress photos and videos chosen from the gallery
before upload.** A 4K ad video sent "as a video" arrives downscaled and re-encoded. That
collides directly with the standing rule that creatives stay native and are never silently
downscaled — these play on premium physical panels.

**Therefore:**

- Sending as **Document** avoids recompression and gets the 100 MB cap. The bot says so, once,
  the first time an operator sends a gallery photo or video.
- A creative that arrives as `kind='image'`/`'video'` (i.e. gallery-compressed) is accepted for
  *discussion* but flagged in the reply: *"heads up — WhatsApp compressed this. For the real
  creative, send it as a Document (📎 → Document) or upload it in the CMS."*
- Over the cap, or a 4K master → the bot replies with a CMS upload deep link rather than
  accepting a degraded file.

**Open item flagged for verification:** Meta's documented `document` type list is
text/Office/PDF. MP4-as-document does flow in practice, but this should be **tested against the
real business number before the design leans on it**. If it does not, the document path covers
images only and video always goes through the CMS.

---

## 12. Security

The boundary holds for reasons that are structural, not prompt-shaped:

1. **Identity is a verified binding, not a claim.** Meta authenticates the sending number;
   `whatsapp_links` maps it to exactly one `CmsUser`. There is no user id in the payload.
2. **Authority is unchanged.** The worker loads the real `CmsUser` and calls `run_turn`. Every
   tool still goes through `assert_can_manage_screen`. A screenowner on WhatsApp reaches
   exactly their assigned screens — because the check lives in the tools, not the transport.
3. **A human confirms every write.** Buttons map to persisted proposals; nothing writes without
   a tap, and the `executed` flag makes a double-tap a no-op.
4. **The scope guardrail already applies.** `guardrails.classify_scope` runs inside `run_turn`,
   so off-topic messages are refused before any tool runs, for free.
5. **The webhook is HMAC-verified** over raw bytes, rate-limited per number, and reveals nothing
   about account existence.

**Residual risk to state plainly:** an unlocked, stolen phone has the operator's full co-pilot
authority — the same exposure as a logged-in laptop, but easier to lose. Mitigations available:
`is_active=false` kills it instantly, and unlink is one click. Whether superadmin-only writes
should additionally require the CMS is an open question (§19).

---

## 13. Failure modes

| # | Failure | Handling |
|---|---|---|
| 1 | Meta retries a delivery (up to 7 days) | `wamid` UNIQUE → `IntegrityError` → skip. The dedup guard. |
| 2 | Forged / unsigned webhook | 403 before any write |
| 3 | Instance reaped mid-turn | `reclaim_stale` re-queues the row |
| 4 | Turn raises | `attempts += 1`, retry to a cap, then `failed` + an apology message |
| 5 | Redis down | `locks` falls back in-process; `bus.publish` no-ops. Turn still completes. |
| 6 | 3 messages in 4 seconds | Queued in order; `session_turn_lock` serializes them |
| 7 | Media URL expired (>5 min) | Re-fetch the URL by media id; if that fails, ask them to resend |
| 8 | Media over cap | Explained, with the Document / CMS-upload alternative |
| 9 | Unknown number | One generic line, `ignored`, rate-limited |
| 10 | Operator deactivated | Re-checked per message; link stops resolving |
| 11 | Link token expired / reused | *"That link expired — generate a new one in your CMS profile."* |
| 12 | Button tapped twice | `executed` flag → *"already booked ✅"* |
| 13 | Button tapped days later | Same guard; safe by construction |
| 14 | Reply send fails (window closed) | `failed` + logged; never silently dropped |
| 15 | Message queued > 6h | `failed`, not answered — a stale "book it" is worse than silence |
| 16 | Answer exceeds 4096 chars | Chunked with `(n/m)`; wide tables → summary + CMS link |
| 17 | Access token expired | Send fails loudly; `/status` in the CMS surfaces it |
| 18 | AI disabled / no `GEMINI_API_KEY` | Reply says the co-pilot is unavailable; nothing hangs |
| 19 | Unsupported type (sticker, location, contact) | Polite "I can't read that yet" |
| 20 | Two operators try to link one number | `phone_e164` UNIQUE → second is told it's already linked |

---

## 14. Config — `app/core/config.py`

Following house conventions (`Optional[str] = None` for secrets, `*_ENABLED: bool`, a
`@property *_configured`).

| Setting | Default | Purpose |
|---|---|---|
| `WHATSAPP_ENABLED` | `True` | Feature flag |
| `WHATSAPP_PHONE_NUMBER_ID` | `None` | Meta phone number id (sending) |
| `WHATSAPP_BUSINESS_NUMBER` | `None` | E.164, for the `wa.me` deep link |
| `WHATSAPP_ACCESS_TOKEN` | `None` | **System User** token — see §15 |
| `WHATSAPP_APP_SECRET` | `None` | HMAC key for `X-Hub-Signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | `None` | GET handshake shared secret |
| `WHATSAPP_API_VERSION` | `"v21.0"` | Graph API version |
| `WHATSAPP_WORKERS` | `2` | Worker pool size; `0` disables on this instance |
| `WHATSAPP_SESSION_IDLE_HOURS` | `12` | Idle gap that rolls a new session |
| `WHATSAPP_LINK_TOKEN_TTL_MINUTES` | `15` | |
| `WHATSAPP_MAX_MESSAGE_AGE_MINUTES` | `360` | Staleness bound |
| `WHATSAPP_MAX_ATTEMPTS` | `3` | Retries before `failed` |

`@property whatsapp_configured` → all of phone number id, access token, app secret present.
Unconfigured, the webhook 503s and the CMS panel says "not configured" — the feature degrades,
never breaks the service. Secrets are backend-only; none is `NEXT_PUBLIC_*`.

---

## 15. Meta setup — the click-path

1. **Meta Business Manager** → create/verify the business (`business.facebook.com`).
2. **Meta for Developers** → create an app, type **Business** → add the **WhatsApp** product.
3. **Add a phone number.** It must **not** already be registered on the consumer WhatsApp app.
   Verify by SMS/call.
4. **⚠️ Get a permanent token.** The token the dashboard offers expires in **24 hours**.
   Business Settings → **System Users** → create one → *Add Assets* (the WhatsApp app) →
   **Generate token** with `whatsapp_business_messaging` + `whatsapp_business_management`,
   set to never expire. **This is the single most common way this integration silently dies
   overnight, looking like an auth bug.**
5. **Configure the webhook.** WhatsApp → Configuration → Callback URL
   `https://<cms-back-host>/api/whatsapp/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN`.
   Subscribe to the **`messages`** field.
6. **Copy the App Secret** (App Settings → Basic) into `WHATSAPP_APP_SECRET`.
7. Store all secrets in Secret Manager and reference them from `gcp-env/services/cms-back.yaml`,
   matching how `DATABASE_URL` / `REDIS_URL` are already handled.

---

## 16. Local development

The webhook needs a public URL, which a laptop does not have. Two paths, both cheap:

- **Tunnel:** `ngrok http 8000` (or `cloudflared`), register the tunnel URL as the callback
  on a **separate Meta test app** so production's webhook is never repointed at a laptop.
- **Simulated mode:** with `WHATSAPP_APP_SECRET` unset in a non-production `ENVIRONMENT`,
  expose `POST /api/whatsapp/simulate` that accepts `{phone, text}` and injects a row exactly
  as the webhook would — no signature, no Meta. This mirrors Gmail's `is_simulated` precedent
  and lets the whole pipeline be exercised offline.

**Gate the simulator on configuration alone, never on a magic value in the request.** The Gmail
mock inbox originally also triggered on a literal code, which meant anyone in production could
hand-post it. Do not repeat that.

---

## 17. Implementation order

Each step is verifiable on its own; nothing later depends on Meta being fully set up.

| # | Step | Verify |
|---|---|---|
| 1 | Migration `0042` + models | `alembic upgrade head`, then `downgrade -1` and back |
| 2 | `config.py` WHATSAPP_* block + `whatsapp_configured` | import check |
| 3 | `app/whatsapp/client.py` — send_text / send_buttons / send_list / fetch_media | unit test against recorded fixtures |
| 4 | `app/whatsapp/render.py` — markdown→WhatsApp, chunking, cards | pure functions; heavy unit tests |
| 5 | `app/whatsapp/webhook.py` — GET handshake, HMAC, parse, dedup insert, 200 | signature fixtures incl. a tamper case |
| 6 | Register the public router in `app/api/routers/routers.py` (**not** under `/cms`) | route list |
| 7 | `app/whatsapp/link_service.py` + `/api/cms/whatsapp/*` routes | mint → bind → revoke |
| 8 | **Extract `app/ai/confirm_service.py`** from `router.py:392`; route becomes a wrapper | existing AI confirm tests must still pass unchanged |
| 9 | `app/whatsapp/worker.py` — adapted from `creative_fit/worker.py` | claim/reclaim tests |
| 10 | `app/whatsapp/inbound.py` — routing, media, session roll, turn, reply | end-to-end via the simulator |
| 11 | CMS profile panel + `api.ts` calls | link/unlink in the browser |
| 12 | `/api/whatsapp/simulate` (non-prod only) | full loop with no Meta |
| 13 | Docs: `markai-signage-api/CLAUDE.md` + root `CLAUDE.md` | — |

Step 8 is the risky one and should land with its own review.

---

## 18. Test plan

Written, **not run in-session** — the user runs pytest. Built around pure-function seams.

| Seam | Tests |
|---|---|
| `render.to_whatsapp_markup` | bold/italic/heading/bullets/links; a table → row blocks; idempotence |
| `render.chunk` | ≤4096; never mid-word; `(n/m)` labelling; a 12k-char answer |
| `render.card_to_messages` | 1 / 3 / 7 actions; 20-char truncation; SCREEN_GRID ≤10 rows |
| `webhook.verify_signature` | valid; tampered body; wrong secret; missing header |
| `webhook.parse` | text, image, document, button reply, status callback, unknown type |
| `link_service` | mint→bind; expired; reused; new token strands old; inactive user |
| `worker.claim_one` / `reclaim_stale` | two workers never take one row; stale reclaim |
| `inbound.resolve_session` | reuse inside 12h; roll after; roll does not lose the archive |

DB-touching: `tests/test_whatsapp_webhook.py` (duplicate `wamid` inserted twice → one row;
unsigned → 403) and `tests/test_whatsapp_confirm.py` (button tap books once; second tap is a
no-op; the HTTP route and the button path share one implementation).

Note the SQLite/Postgres split the repo already handles: `creative_fit/worker.py` carries a
non-`SKIP LOCKED` claim for SQLite, and `password_reset._as_aware` normalises naive datetimes.
Both patterns must be copied or the tests fail only on CI.

---

## 19. Open decisions for the user

1. **MP4-as-Document (§11)** — needs a real test against the business number. If Meta rejects
   it, video always routes to the CMS. Recommend testing this before implementation starts.
2. **Superadmin writes from WhatsApp** — should destructive/high-value actions (cancelling a
   campaign, creating users) require the CMS instead of a phone? Recommend: allow booking and
   reads on WhatsApp; keep user/API-key management CMS-only, matching the existing co-pilot
   tool scoping.
3. **Number strategy** — one shared business number for all operators (recommended), versus
   per-owner numbers. Shared is simpler and the binding table already disambiguates.
4. **Session idle window** — 12h proposed. 24h would keep a booking conversation alive across
   a working day; 12h is safer against a stale draft. Recommend 12h.

---

## 20. Conflicts with existing invariants

1. **`app/ai/router.py:392` confirm logic must be extracted, not copied** (§9). This is the one
   edit to a live write path and the reason the whole design is safe.
2. **No HMAC webhook verification exists in this repo** — `hmac.compare_digest` is used in
   `app/core/passwords.py:39`, but signature verification over a raw request body is new.
3. **The public webhook sits outside `/api/cms/*`** — deliberately. Every CMS-facing route
   (`link-token`, `link`, `status`) must stay inside it or the browser cannot reach it.
4. **Cloud Run flags live in `cloudbuild.yaml`, not `gcp-env/`** (§5). A future change to
   `--no-cpu-throttling` or `--min-instances` belongs there.
5. **JSONB must be written by whole-object reassignment** — applies to `media_ref` (§6).

## 18. Message layout (the "slip")

Proposals and results are laid out one fact per line, never as a paragraph:
heading (`📋 *New booking*` / `✅ *Booked*`), then `*Label:* value` lines, an
`ℹ️` line per plain note, an `⚠️ *Heads-up*` block with one bullet per warning,
and a one-line footer telling the operator what the buttons do. Several
proposals share a header (count + the facts common to all) and a numbered list
of what differs, with ⚠️ tags. Rendering is `app/whatsapp/slip.py` (pure);
the data is the optional `detail` a tool attaches via `_propose(...)`. Cards
without `detail` fall back to the flat `summary`. Interactive bodies over 1024
chars go out as text + a one-line buttons message.
