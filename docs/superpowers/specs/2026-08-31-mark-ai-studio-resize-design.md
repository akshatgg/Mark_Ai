# Mark AI Studio — a public resizer, and video fit in the CMS

**Date:** 2026-08-31
**Scope:** A new public product (`studio.mark-ai.tech`) plus the backend and CMS
changes it forces. Two deliverables that share one engine.
**Out of scope:** AI rebuild for video, screens, bookings, the Content library
for public users, and any change to the player contract.

## The problem

Creative Fit lives inside the CMS. It only Mark AI operators can reach it, it
handles images only, and it is bound to a screen's resolution. Two gaps follow:

1. There is no product an outside advertiser can use to resize their own ad. The
   engine exists; the front door does not.
2. Neither the CMS nor anything else can refit a **video** ad. `app/video/` in
   `markai-signage-api` is a stub — its own docstring advertises six modules and
   only `ffmpeg.py` was ported.

## What we are building

**A. Mark AI Studio** — `studio.mark-ai.tech`, a public self-serve tool. Sign in
with Google, drop a file, type a width and height (or pick a ratio), download the
result. Images get the full Creative Fit treatment including AI rebuild. Videos
get exactly one operation: stretch to the requested size.

**B. Video fit in the CMS** — the existing Creative Fit page accepts video. Pick a
screen or type a resolution, and the video is stretched to it. Images are
unchanged: analyse, then resize or rebuild as today.

**C. Creative Fit becomes superadmin-only in the CMS.**

There is one engine, one job table and one worker pool behind all three.

## Decisions taken, and why

| Decision | Choice | Why |
|---|---|---|
| Who may sign in to Studio | Anyone with a Google account | Public self-serve product |
| AI rebuild in Studio | Included, daily quota per account | Gemini spend must be bounded |
| Where Studio's backend lives | No new Python service — a Next.js BFF over `/api/ext/*` | One new deployable, no second database; `markai-signage-api` stays the single source of truth per the root `CLAUDE.md` |
| Video operations | Stretch only | Explicit product decision; no crop, anchor, padding or AI for video |
| Output quality options | **None** | No 240p/360p/720p tiers anywhere. Output is always the best the source allows |
| Video limits | 60s, 500 MB, 4K in | Matches the existing `VIDEO_PLACEMENT_MAX_SOURCE_SECONDS = 60` |
| CMS Creative Fit access | Superadmin only | Explicit product decision (see *Reversal* below) |
| Job ownership | Explicit `owner_kind` + two real FKs | A polymorphic nullable owner would leak across products — see below |
| Queue ordering | CMS jobs claimed before Studio jobs | One line of SQL; operators must never wait behind public traffic |

### Reversal: screenowners lose Creative Fit

`app/creative_fit/router.py` is gated by `get_current_cms_user`, and its module
docstring documents screenowner access as intentional — "the same *scoped
superadmin* shape the rest of the CMS uses". This work reverses that: the gate
becomes `require_superadmin` and the docstring is rewritten to say so. Recording
it here because the existing comment is otherwise a trap for the next reader.

## Data model

### `studio_users` — new

A public Studio user is a real entity: it is referenced, it persists, and it is
edited in place. It earns a table.

```
studio_users
  id                      String(36) PK, uuid
  google_sub              String(255) UNIQUE NOT NULL, indexed
  email                   String(255)
  name                    String(255)
  is_blocked              Boolean NOT NULL default false
  daily_rebuild_override  Integer NULL      -- null = use the global setting
  daily_video_override    Integer NULL
  created_at              timestamptz NOT NULL
  last_seen_at            timestamptz NULL
```

Rows are created on first sign-in (upsert on `google_sub`) and `last_seen_at` is
touched on each call. `is_blocked` lets a superadmin stop one abuser without
switching the API key off for everybody; the overrides let a client be granted
unlimited rebuilds without a deploy.

### `creative_fit_jobs` — altered

The table is currently welded to CMS users: `cms_user_id` is `NOT NULL` with an
FK to `cms_users`. That is the one hard blocker to any external caller.

```
  cms_user_id     → becomes nullable, FK cms_users     (meaning unchanged)
+ studio_user_id  → FK studio_users, nullable
+ owner_kind      → String(8) NOT NULL, 'cms' | 'studio'
+ api_key_id      → FK api_keys ON DELETE SET NULL, attribution only
+ media_kind      → String(8) NOT NULL default 'image', 'image' | 'video'

CHECK (
  (owner_kind = 'cms'    AND cms_user_id    IS NOT NULL AND studio_user_id IS NULL)
  OR
  (owner_kind = 'studio' AND studio_user_id IS NOT NULL AND cms_user_id    IS NULL)
)
```

**No new `mode` value.** A video stretch is stored as the existing
`mode = 'resize'` with `fit_mode = 'stretch'` and `media_kind = 'video'` — which
is literally what it is. Inventing a third `video_stretch` mode would ripple
through `executed_mode_of()`, the `MODE_AUTO` resolution the co-pilot relies on,
and every history label, to express something two existing columns already say.

**Why not loose nullable columns.** Storing the Google `sub` as a bare
`external_user_id` string beside a nullable `cms_user_id` makes the owner
*polymorphic*: nothing in the database says which column holds it, nothing
prevents a row with both set or neither, and a mistyped sub is simply a job that
nobody owns. It also silently breaks code that already exists:

```python
# service.py — get_job()
stmt = select(CreativeFitJob).where(CreativeFitJob.id == job_id)
if user.role != "superadmin":
    stmt = stmt.where(CreativeFitJob.cms_user_id == user.id)
```

A superadmin gets **no owner filter at all**. Harmless while every row is a CMS
row; the moment Studio rows share the table, a superadmin can fetch any
stranger's private creative by id. `owner_kind` makes that filter mandatory and
the omission visible.

**Why not a separate `studio_jobs` table.** It would duplicate the
`FOR UPDATE SKIP LOCKED` claim, the stale-reclaim, the attempts ceiling, the
cancellation check, the retention sweep and the status machine — the most
safety-critical code in the module — and the two copies would drift. What the
products genuinely share is the queue and the pixels; only ownership differs.

**Why source/target facts stay denormalised onto the job.** `source_media_id` is
frequently null by design (`store_source_upload` deliberately does not create a
`MediaAsset`, and never will for a public user), so there is often no row to
point at. Where there is one, the FK is `ON DELETE SET NULL` and the job must
still be able to state what it did after the creative is gone. Normalise
entities; snapshot events. A job is an event.

**Repo-specific caveat.** The CHECK must be declared in the model's
`__table_args__` as well as in the migration. Tests here build tables from the
models, so a migration-only constraint goes unenforced — the same drift
`alembic check` already reports.

### Migrations

Next free numbers are `0060` and `0061` (latest is `0059_creative_fit_refine`).

- `0060_studio_users` — create the table.
- `0061_creative_fit_ownership` — alter `creative_fit_jobs` as above, backfill
  `owner_kind = 'cms'` and `media_kind = 'image'` for every existing row *before*
  applying the NOT NULL and the CHECK, then add
  `api_keys.can_use_creative_fit` (Boolean, default false, server_default false).

## Quota

Only the expensive modes are metered. A plain image resize is roughly a second of
CPU and stays unlimited — capping it would only make the product feel mean.

| Action | Rebuild budget | Video budget |
|---|---|---|
| image resize | — | — |
| AI rebuild | 1 | — |
| refine a rebuild | 1 | — |
| video stretch (`mode=resize`, `media_kind=video`) | — | 1 |

Two independent daily budgets, `STUDIO_DAILY_REBUILD_LIMIT` and
`STUDIO_DAILY_VIDEO_LIMIT`, both defaulting to 5, both overridable per user by a
non-null column on `studio_users`.

**The window** is IST midnight to IST midnight via
`app.core.timezone.local_day_start` — the same day boundary bookings and
proof-of-play already use.

**Cancellation is charged by half.** Cancelling a job that no worker has started
costs nothing; cancelling one already running costs 0.5, because the work was
really burned. Without this, a user could start a rebuild, cancel at 90% and
repeat forever at zero cost while pinning a worker each time. A failed job costs
nothing — a Gemini safety block or a dead worker is not the user's fault.

The jobs table is the ledger; there is no counter to drift.

```sql
SELECT COALESCE(SUM(
         CASE WHEN status = 'failed'                           THEN 0
              WHEN status = 'cancelled' AND claimed_at IS NULL THEN 0
              WHEN status = 'cancelled'                        THEN 0.5
              ELSE 1 END), 0)
  FROM creative_fit_jobs
 WHERE owner_kind = 'studio'
   AND studio_user_id = :studio_user_id
   AND (mode = 'rebuild' OR media_kind = 'video')
   AND created_at >= :ist_midnight
```

**The race is real and must be closed.** Count-then-insert is not atomic: two
requests fired together both read 4 and both insert. The transaction takes a
Postgres advisory lock scoped to that one user first, which needs no table and
releases at commit:

```sql
SELECT pg_advisory_xact_lock(hashtext(:google_sub));
```

**Retention is load-bearing.** The sum reaches back 24h and
`CREATIVE_FIT_RETENTION_HOURS` is 48, so the rows survive. Drop retention below
~26h and the quota silently stops enforcing. Assert this at startup rather than
leaving a comment.

**Quota alone is not abuse protection.** Google accounts are free and unlimited,
so five-per-account is five per *account*, not per person. An IP-level limit ships
alongside it, built on the existing `app/cms_users/auth_ratelimit.py`.

## Video stretch

### The port

From `markai-creative-fit/app/video/` into `markai-signage-api/app/video/`:

- `probe.py` — ffprobe → `VideoProbe`, including the colour-tag fallback.
- `encode.py` — H.264 level arithmetic and the encode argument list.
- `schemas.py` — `VideoProbe`, `VideoVariant`, `FitMode` only.
- `render.py` — **stretch only**. `render_fast` restricted to `FitMode.STRETCH`.

`ffmpeg.py` is already present, and ffmpeg is already installed in the
`markai-signage-api` Dockerfile. Nothing else comes across: no `layout/`, no
`blueprint.py`, no reframe, no compose, no numpy, no tracking.

One ffmpeg pass: `scale=w:h`, explicit BT.709 conversion **and** tagging (tagging
alone produces a 601-encoded file labelled 709), CFR, audio stripped. No quality
tiers are exposed to any user.

**One thing the design missed, found while building.** The 30fps / level-5.1
ceiling is the AndBox Prime X4's *hardware* limit — the S905X4 decodes 4K30 and
not 4K60. Applying it to Studio would silently halve a user's frame rate to suit
a decoder their file will never touch, which is exactly the downscaling the
quality rule forbids. So the ceiling is a parameter, not a constant: creatives
bound for a Mark AI panel keep `VIDEO_MAX_FPS`/`VIDEO_MAX_LEVEL`, and Studio
passes `STUDIO_VIDEO_MAX_FPS`/`STUDIO_VIDEO_MAX_LEVEL` (60 / 5.2 — what H.264
High can express at 4K).

### Worker changes

`execute_job` dispatches on `media_kind`: `image` keeps the existing path,
`video` downloads to a temp file, probes, renders and uploads. `_sniff()` loses
its hardcoded 415 *"video refitting isn't supported yet"* and grows a video branch.

**A trap that must be fixed in the same change.** `CREATIVE_FIT_STALE_MINUTES` is
5 while `FFMPEG_TIMEOUT_SECONDS` is 900. A six-minute 4K encode would be declared
dead and requeued while still running, and three workers would grind the same
file until the attempts ceiling stopped them. The stale window becomes per-kind —
image 5 minutes, video 20 — which means `_RECLAIM_SQL` takes two intervals rather
than one.

### Queue ordering

`_CLAIM_SQL` is FIFO today (`ORDER BY created_at`), so public video jobs would
queue ahead of an operator fitting a creative for a screen going live tonight.
One line, in both the Postgres and the SQLite variants:

```sql
ORDER BY (owner_kind = 'studio'), created_at
```

A boolean sorts false before true in both engines, so CMS work always drains
first while Studio work still runs FIFO among itself and is deferred, never
starved.

## The external API

New routes on `markai-signage-api`, gated by a new `require_creative_fit_key`
dependency reading `api_keys.can_use_creative_fit`. API keys are already
mint-only by superadmins (`app/api_keys/router.py` uses `require_superadmin`), so
this is a second lock on an already-superadmin-only door: a screenowner can
neither mint a key nor reach the endpoint. The flag follows the existing
`can_verify_operators` precedent exactly, including being echoed back at creation.

```
GET  /api/ext/creative-fit/status              capabilities + this user's budgets
POST /api/ext/creative-fit/upload              images <= 25MB, multipart
POST /api/ext/creative-fit/upload-session      videos — direct-to-GCS
POST /api/ext/creative-fit/upload-commit       videos — confirm, probe, register
POST /api/ext/creative-fit/analyze             images only, synchronous verdict
POST /api/ext/creative-fit/jobs                resize | rebuild
GET  /api/ext/creative-fit/jobs                this account's history
GET  /api/ext/creative-fit/jobs/{id}           poll
POST /api/ext/creative-fit/jobs/{id}/refine
POST /api/ext/creative-fit/jobs/{id}/cancel
```

**Changed during implementation, deliberately:** the separate
`/download` route was dropped. `result_url` on every job response is already a
time-limited signed URL, so a second endpoint would have been a redirect to a
value the caller already held.

No `/targets` and no `/save` — Studio has no screens and no Content library.

**Identity.** The API key proves the caller is the Studio server; an
`X-Studio-User: <google sub>` header names which end user, and the route upserts
`studio_users` from it. This is the same trust split the existing `X-Actor-Id`
operator routes already use. A blocked user gets 403 before any work is queued.

**Why video bytes bypass the API.** Cloud Run caps request bodies at 32 MB; a
500 MB video cannot pass through. The direct-to-GCS session/commit pair already
built for partners is reused unchanged.

Every quota rejection is a **429** carrying the reset time, never a silent
failure or a job that queues and dies.

## CMS changes

1. **Superadmin gate.** `app/creative_fit/router.py` swaps
   `get_current_cms_user` for `require_superadmin` on every route, and the module
   docstring is rewritten. The Creative Fit nav item hides for screenowners in
   `markai-Web-cms`.
2. **Video.** The source picker accepts video. When the upload is a video the
   page hides every image control — fit mode, anchor, padding, AI rebuild — and
   offers one action: stretch to the chosen screen or typed resolution. Image
   behaviour is untouched.
3. **API keys page.** A `can_use_creative_fit` toggle beside the existing
   `can_verify_operators` one.

## The frontend — `markai-studio-web`

Next.js 15 App Router, Tailwind, dev port **5140** (5120 CMS, 5130
creative-fit-web, 3100 frontend-new are taken).

- **Auth.** Auth.js v5, Google provider, JWT session strategy — no session
  database. The Google `sub` is the identity forwarded to the backend.
- **The BFF.** Route handlers under `/app/api/*` hold `CMS_EXT_API_KEY_ID` /
  `CMS_EXT_API_SECRET` in server env and add the `X-Studio-User` header. The key
  never reaches the browser, and no `NEXT_PUBLIC_*` secret exists.
- **Layout.** One page. Signed out: a hero and *Continue with Google*. Signed in:
  drop zone on the left, target size on the right, verdict strip beneath, result
  and history below. No dashboard, no library, no navigation.
- **The size control.** Two number inputs, a chain toggle that locks the ratio,
  and ratio chips (16:9, 9:16, 1:1, 4:5, 4:3, 21:9, 3:2) that derive the missing
  side from whichever number was last touched.
- **The verdict strip** appears on keystroke with no round-trip.
  `markai-Web-cms/src/lib/creative-fit.ts` already computes ratio shift, content
  kept, band and recommendation client-side and is lifted verbatim. The server
  re-runs the same maths and remains the authority.
- **Budgets** are shown in the header ("4.5 of 5 AI fixes left today") and the
  button is disabled before the click, not after a 429.
- **Theme.** Light and dark via CSS variables, following the system by default,
  with a persisted toggle. Mark AI logo and brand type, matching the CMS.

Because `markai-3d-studio` already exists in this repo, the resizer ships as *a
tool inside* Studio rather than *as* Studio, so a second tool does not force a
redesign of the shell.

## Build order

Four phases. Each lands on its own and leaves the system working, so none of them
has to be reverted as a unit if priorities move.

**Phase 1 — Ownership and the superadmin gate.** Migrations `0060`/`0061`, the
`owner_kind` filters through `service.py` (closing the `get_job` superadmin
hole), `require_superadmin` on the Creative Fit router and the nav item hidden in
the CMS. No new features; the CMS behaves as before minus screenowner access.

**Phase 2 — Video stretch.** Port `probe.py`, `encode.py`, the three schema
types and a stretch-only `render.py`; dispatch `execute_job` on `media_kind`;
fix `_sniff`; make the stale window per-kind; add the queue ordering. Ships as
video support *in the CMS* — no external surface yet, so it can be exercised by
operators before the public sees it.

**Phase 3 — The external API.** `can_use_creative_fit`, `require_creative_fit_key`,
`studio_users` upsert, the quota with its advisory lock and retention assertion,
the eleven `/api/ext/creative-fit/*` routes, and the CMS API-keys toggle.
Verifiable with curl before any frontend exists.

**Phase 4 — `markai-studio-web`.** The Next.js app: Auth.js, the BFF route
handlers, the workspace, light/dark, and the deploy to `studio.mark-ai.tech`.

Phase 2 is the only one that can run in parallel with another (Phase 3), since
they touch different files.

## Security

- The ext key is server-only and superadmin-minted, and the new capability flag
  defaults to false.
- Studio callers can only ever read rows where
  `owner_kind = 'studio' AND studio_user_id = <them>`; CMS callers only
  `owner_kind = 'cms'`. Both filters are mandatory, and a missing one is now a
  visible omission rather than a silent widening.
- Uploads are sniffed from bytes, never from filename or declared content-type.
- Results are served as time-limited signed URLs.
- `is_blocked` and the IP-level limit are the two levers against abuse; the
  quota bounds honest use, not determined attackers.

## Verification

No pytest, per standing project instruction. The Python side is verified by
import and syntax checks plus a real run against the local stack; the new app
gets vitest for the geometry and budget arithmetic. Then a manual end-to-end
pass: image resize, image rebuild, refine, video stretch, quota exhaustion,
cancel-while-running charging 0.5, and a screenowner confirming Creative Fit is
gone from the CMS.
