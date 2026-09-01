# Separating the Studio backend out of `cms-back`

**Date:** 2026-09-01
**Scope:** Lift Mark AI Studio's server side out of `markai-signage-api` into its
own FastAPI service, `markai-studio-api`, with its own Postgres, its own job
table and its own worker pool. Remove every trace of Studio from the CMS backend.
**Out of scope:** Any change to the player contract, to CMS Creative Fit's
behaviour for operators, or to the Studio UI's own screens.

## The problem

Studio was deliberately built without a backend of its own. The design of
2026-08-31 recorded the reason plainly: *"No new Python service — a Next.js BFF
over `/api/ext/*`; `markai-signage-api` stays the single source of truth."* That
was the right call for shipping a front door onto an engine that already existed.

It has since cost us three things.

**1. Studio's video jobs kill the CMS.** `cms-back` runs at 1 CPU / 1 GiB with
the Creative Fit worker pool inside the same container as the API. A video job
holds the whole source in memory as `bytes`, writes a temp file, runs ffmpeg,
and reads the result back as `bytes`. Two concurrent video jobs cross 1024 MiB
and Cloud Run kills the instance — observed at 1034 MiB and 1030 MiB on
2026-08-31. Because the process is *killed*, no exception is raised, `mark_failed`
never runs, and the row sits at `status='running'` until `reclaim_stale` notices
20 minutes later. Public traffic can therefore take down the operator CMS, and
the failure is invisible for a third of an hour.

**2. One queue serves two products with opposite priorities.** `worker.py`
orders with `ORDER BY (owner_kind = 'studio'), created_at` — one line of SQL
holding back the entire public internet so an operator does not wait. It works,
but it is a single pool of three workers shared between a revenue-critical
internal tool and an unauthenticated public product.

**3. One schema serves two products.** `creative_fit_jobs` carries `owner_kind`,
`studio_user_id`, `cms_user_id`, `api_key_id` and a CHECK constraint whose only
job is to stop the two products leaking into each other. Every read must
remember an `owner_kind` filter; `service.py` has three separate comments
warning about what happens when one is forgotten.

## What we are building

A second backend, built the way the first one was.

```
BEFORE                                AFTER

cms-back  (1 CPU / 1 GiB)             cms-back  (1 CPU / 1 GiB)
├─ /api/cms/creative-fit/*            ├─ /api/cms/creative-fit/*
├─ /api/ext/creative-fit/*  ← Studio  ├─ creative_fit_jobs (cms_user_id NOT NULL)
├─ creative_fit_jobs (owner_kind)     └─ worker pool  ← CMS jobs only
├─ studio_users
└─ worker pool ← BOTH products        studio-back (2 CPU / 4 GiB)
                                      ├─ /api/ext/creative-fit/*
                                      ├─ studio_users + studio_fit_jobs
                                      └─ worker pool  ← Studio jobs only
```

Two engines, two queues, two databases, two containers. Nothing shared at
runtime.

## Decisions taken, and why

| Decision | Choice | Why |
|---|---|---|
| Shape of the split | A whole new FastAPI service, same conventions as `markai-signage-api` | The user's instruction was "separate it with the same code as we do". Poetry, `app.core.*`, per-domain `router/schemas/service/models`. |
| Studio's database | Its own Postgres, its own alembic chain | A shared database is a half-separation: the two services stay welded to one schema and one Cloud SQL instance, and the CHECK constraint stays. |
| Studio's worker | Its own pool, its own tunables | The point of the exercise. Studio's video semaphore, stale windows and worker count are now Studio's business alone. |
| The AI agent | Ported verbatim | Explicit instruction: same agent, same tools as the CMS. `agent.py`, `prompts.py`, `gemini_image.py`, `analysis.py`, `resizer.py` copy across unchanged. |
| Studio user data | A real `studio_users` table in the new DB | Confirmed by the user: "if you are making a table, you can also store user data, just like you are putting things in a CMS." Budgets and `is_blocked` therefore keep working. |
| Browser-local history | Not built | Considered and dropped once Studio kept a database. `GET /jobs` already answers it, and IndexedDB would be a second copy of the truth. |
| Public API path | Unchanged: `/api/ext/creative-fit/*` | The BFF builds its target as `${BACKEND}/api/ext/creative-fit/${path}`. Keep the path and the frontend change is one environment variable. |
| Which agent | The Creative Fit analyst, **not** the chat co-pilot | "The same agent as the CMS" is ambiguous — see below. |
| Engine code | Copied, not extracted into a shared package | A shared library would re-couple the two services at the version level — the thing we are removing. The duplication is ~1,400 lines of pure functions with no CMS imports, and the two copies are free to diverge (Studio already runs a higher video ceiling). |

### "The same agent as the CMS" — which one

The CMS contains two things called an agent, and only one crosses over.

**Ported, verbatim:** `creative_fit/agent.py` (`read_creative`, the Gemini
analyst that reads the artwork and returns a verdict), `creative_fit/prompts.py`,
`creative_fit/gemini_image.py` (`rebuild_image`), `creative_fit/analysis.py` and
`creative_fit/resizer.py`. Same prompts, same model, same thresholds, same
output — a Studio rebuild must be indistinguishable from a CMS one. This was the
explicit instruction and it is the whole point of copying rather than rewriting.

**Not ported:** `app/ai/` — the 10,461-line CMS chat co-pilot (router, tools,
draft, guardrails, executors, SSE bus, chat history). Its tool surface is
bookings, screens, proof-of-play and operating hours; Studio has none of those,
so porting it would mean building an entirely new Studio-only tool set. It also
reaches into Creative Fit rather than the reverse — `app/ai/tools.py` calls
`creative_fit_service.queue_chat_fit` — so nothing the analyst does depends on
it. Confirmed out of scope on 2026-09-01.

Consequence worth noting: `queue_chat_fit` exists **only** for the co-pilot and
therefore stays behind in `markai-signage-api`. It must keep working after
migration `0062`.

### The premise that separation invalidates

`studio/service.py::_is_cms_superadmin` grants an uncapped daily budget to a CMS
superadmin who signs in to Studio, and its docstring names the reason it is
affordable: *"Studio and the CMS share one database, so this is a single indexed
lookup rather than a call to another service."* After the split there is no
`cms_users` table to look at.

**Replacement:** a `STUDIO_UNLIMITED_EMAILS` setting — a comma-separated
allowlist read from Secret Manager, matched case-insensitively, and still gated
on Google having verified the address.

**The regression this accepts, stated plainly:** revocation stops being
automatic. Today, deactivating an operator in the CMS instantly takes their
uncapped Studio budget away, and the code comments make clear that was
deliberate. With an allowlist, a demoted superadmin keeps an uncapped Gemini
budget until a human edits the secret. The blast radius is small — superadmins
are few, named, and trusted — but it is a real loss and it must be written into
the runbook: *removing a superadmin includes removing them from
`STUDIO_UNLIMITED_EMAILS`.*

The alternative, kept on the shelf: a `GET /api/ext/operators/is-superadmin`
endpoint on `cms-back` with a 5-minute TTL cache in `studio-api`. It restores
automatic revocation at the cost of a cross-service dependency on the sign-in
path — the exact coupling this project exists to remove. Revisit only if the
allowlist proves unmanageable.

### The second premise: API-key validation

`require_creative_fit_key` resolves `X-Api-Key-Id` / `X-Api-Secret` against the
`api_keys` table and checks `can_use_creative_fit`. That table stays in the CMS.

**Replacement:** the pair becomes a shared secret held in `studio-api`'s own
Secret Manager entries (`STUDIO_EXT_API_KEY_ID`, `STUDIO_EXT_API_SECRET`),
compared with `secrets.compare_digest`. The security property is unchanged and
is in fact simpler to reason about: the credential proves the caller is the
Studio BFF and never the browser. `X-Studio-User` continues to name the end user
and continues to be unspoofable, because the BFF fills it from the server-side
session and strips any client-supplied copy.

Rotation becomes a Secret Manager edit in two places (the BFF and the API)
rather than a CMS screen. Acceptable: there is exactly one key.

## The new service: `markai-studio-api`

### Layout

```
markai-studio-api/
├─ app/
│  ├─ main.py                 lifespan: start/stop the worker pool
│  ├─ core/                   config, database, gcs_service, logging_config,
│  │                          security (upload tokens), timezone
│  ├─ engine/                 the ported Creative Fit engine
│  │   ├─ agent.py            read_creative — the Gemini analyst   [verbatim]
│  │   ├─ prompts.py          analyst / rebuild / refine prompts   [verbatim]
│  │   ├─ gemini_image.py     rebuild_image                        [verbatim]
│  │   ├─ analysis.py         FitAnalysis, geometry                [verbatim]
│  │   └─ resizer.py          Pillow resize/crop/pad               [verbatim]
│  ├─ video/                  ffmpeg, probe, render, encode, schemas [verbatim]
│  ├─ jobs/                   models.py, schemas.py, service.py, worker.py
│  └─ studio/                 router.py, models.py, schemas.py, service.py
├─ alembic/                   its own chain, starting at 0001
├─ dev_start.sh               uvicorn :8097
├─ docker-compose.dev.yml     Postgres :5435, fake-gcs :4482
├─ Dockerfile / cloudbuild.yaml
└─ CLAUDE.md
```

Ports follow the house convention — `signage-api` is 8095/5433/4480 and
`backend-new` is 8096/5434/4481, so Studio takes **8097 / 5435 / 4482**.

### What ports verbatim, and why it is safe

These files were checked for cross-module imports and have none worth the name:

| File | app-level imports |
|---|---|
| `creative_fit/analysis.py` | *none* |
| `creative_fit/resizer.py` | *none* |
| `creative_fit/prompts.py` | *none* |
| `creative_fit/gemini_image.py` | `app.core.config` |
| `creative_fit/agent.py` | `app.core.config`, its own siblings |
| `video/*.py` | `app.core.config`, its own siblings |

That is the whole AI agent and the whole media engine — roughly 1,400 lines that
move with a path rewrite and nothing else. The CMS entanglement lives entirely
in `creative_fit/service.py`, `worker.py`, `models.py` and `delivery.py`, and
none of those cross over intact.

### What does not port

- `creative_fit/delivery.py` — delivers a finished fit to a screen or the
  Content library. Studio has neither.
- `creative_fit/models.py` — replaced by `jobs/models.py` (below).
- `creative_fit/service.py` — its job-lifecycle half is rewritten against the new
  table; its CMS half (`resolve_source` against `MediaAsset`, `resolve_target`
  against `Screen`, `list_screen_targets`, `_register_media`, `queue_chat_fit`
  for the co-pilot) is dropped outright. Studio never called any of it.
- Everything CMS: `cms_users`, `api_keys`, `content`, `ai`, `whatsapp`,
  `screens`, `bookings`, `reports`, `screenshots`, `apk`, `health`.

## Data model

Two tables, one chain, starting fresh at `0001`.

### `studio_users`

Carried over unchanged from migration `0060` — same columns, same unique index
on `google_sub`, same reasoning. It was always a Studio table living in a CMS
database; it is simply moving to where it belongs.

The `unlimited` class attribute stays a derived, non-persisted flag. Its original
justification survives the move intact: stored on the row it would outlive the
demotion meant to revoke it.

### `studio_fit_jobs`

`creative_fit_jobs` minus everything the CMS put there:

```
studio_fit_jobs
  id                String(36) PK
  studio_user_id    FK studio_users NOT NULL      -- one owner, no discriminator
  media_kind        String(8) NOT NULL 'image'|'video'
  source_url        String(2048) NOT NULL
  source_name       String(255)
  source_width      Integer NOT NULL
  source_height     Integer NOT NULL
  target_width      Integer NOT NULL
  target_height     Integer NOT NULL
  mode              String(16) NOT NULL 'resize'|'rebuild'
  fit_mode          String(16)
  anchor            String(16)
  pad_fill          String(16)
  pad_color         String(16)
  user_note         Text
  parent_job_id     FK studio_fit_jobs            -- refine chain
  status            String(16) NOT NULL 'queued'|'running'|'done'|'failed'|'cancelled'
  attempts          Integer NOT NULL default 0
  claimed_at        timestamptz
  finished_at       timestamptz
  error             Text
  analysis          JSON
  rebuild_prompt    Text
  result_url        String(2048)
  result_width      Integer
  result_height     Integer
  result_bytes      Integer
  created_at        timestamptz NOT NULL
```

**Dropped, and why each one goes:**

- `owner_kind` and the `ck_creative_fit_jobs_one_owner` CHECK — with one owner
  kind there is nothing to discriminate. Every "did you remember the
  `owner_kind` filter?" hazard in `service.py` disappears with it, which is the
  single biggest correctness win in this project.
- `cms_user_id` — no CMS users here.
- `api_key_id` — attribution to a table that no longer exists. There is exactly
  one caller and it is the BFF.
- `source_media_id`, `result_media_id`, `deliver`, `target_screen_id` — the
  Content library and screens are CMS concepts.

**Kept deliberately:** `analysis` stays JSON. Studio writes
`{"auto_save": false, "origin": "studio"}` today and the analyst's measured
verdict rides in the same column; flattening it into typed columns is a separate
change and not this one.

### Migration `0062` in `markai-signage-api`

The reverse of `0060` + `0061`, executed only after Studio's data has moved:

1. `DELETE FROM creative_fit_jobs WHERE owner_kind = 'studio'` — copied to the
   new database in step 0, verified by count, then removed.
2. Drop the CHECK, then `owner_kind`, `studio_user_id`, `api_key_id`.
3. `cms_user_id` back to `NOT NULL`.
4. Drop `studio_users`.

`media_kind` **stays** — CMS video fit is a shipped feature and has nothing to do
with Studio.

Code changes that ride with it: delete `app/studio/`, drop the
`studio_ext_router` include and the `assert_retention_outlasts_budget_window()`
startup assertion from `main.py`, drop the `StudioUser` import from `models.py`,
strip `OWNER_CMS`/`OWNER_STUDIO` from `creative_fit/service.py`, and simplify the
worker's claim to `ORDER BY created_at`.

## Data migration

Live rows exist, so this is not a greenfield cutover.

- **Volume is small.** Studio launched 2026-08-31; the retention sweep already
  deletes results after `CREATIVE_FIT_RETENTION_HOURS` (48h).
- **GCS objects do not move.** Both services use the `markai-storage` bucket and
  Studio's blobs already sit under a `studio-<user_id>/` prefix. `result_url` and
  `source_url` stay valid across the copy. `studio-api`'s runtime service account
  needs read/write on that prefix.
- **Order:** copy `studio_users` (preserving `id`, so `studio_user_id` FKs stay
  intact), copy Studio job rows, verify counts match, cut the frontend over,
  watch, then run `0062`.
- **In-flight jobs:** put Studio into a brief maintenance window rather than
  migrating `status='running'` rows. A queued job that is missed is a spinner
  that never resolves.

## The frontend: almost untouched

The BFF composes its target as
`${BACKEND}/api/ext/creative-fit/${path.join("/")}`. Keeping that path prefix on
the new service reduces `markai-studio-web` to:

- `SIGNAGE_API_URL` → `STUDIO_API_URL` in `route.ts`, `.env.example` and
  `cloudbuild.yaml` (the substitution `_SIGNAGE_API_URL` becomes
  `_STUDIO_API_URL`, pointing at `https://studio-api.mark-ai.tech`).
- The 502 message that currently says *"Check that markai-signage-api is
  running"* must name `markai-studio-api` instead — it exists to stop a reader
  looking in the wrong repo, so a stale name is worse than no message.

No component, hook or screen changes. Request and response shapes are identical.

## Deployment

New Cloud Run service `studio-back`, new Cloud SQL database, new runtime service
account `studio-api-runtime@`, new Cloud Build trigger.

| Setting | Value | Why |
|---|---|---|
| CPU / memory | **2 CPU / 4 Gi** | The actual OOM fix. ffmpeg no longer shares 1 GiB with an API. |
| min-instances | 0 | Public traffic is bursty and nothing here is long-lived. |
| max-instances | 3 | Pool of 30 connections per instance against a small Cloud SQL tier. |
| CPU throttling | off | The worker pool runs between requests. |
| Ingress | `--no-invoker-iam-check` | Org policy blocks `allUsers`; same workaround as every other service. |
| Secrets | `DATABASE_URL`, `GEMINI_API_KEY`, `STUDIO_EXT_API_SECRET`, `STUDIO_UNLIMITED_EMAILS` | |

Once cut over, `cms-back` should be watched for a revision or two and can then
keep its 1 GiB — the load that justified raising it has left the container.

## Testing

Per house rule, no pytest is run here; verification is by import and syntax
check, and by exercising the running service. The plan will include:

- `python -c "import app.main"` on the new service, and `ruff` (the actual gate;
  `black`-cleanliness is not).
- `alembic upgrade head` on an empty database, then `alembic check`.
- A local end-to-end pass on :8097 — sign in through the BFF, upload, analyze,
  resize, rebuild, refine, cancel; then a video stretch, watching container
  memory to confirm two concurrent video jobs no longer approach the ceiling.
- A budget pass: exhaust `STUDIO_DAILY_REBUILD_LIMIT`, confirm `mode=auto`
  degrades to a resize rather than 429-ing, confirm an allowlisted address is
  uncapped and a non-verified email is not.
- On `cms-back` after `0062`: CMS Creative Fit for images and video, plus the AI
  co-pilot's `queue_chat_fit` path, which touches `creative_fit` and must not
  have been disturbed.

## Risks

| Risk | Mitigation |
|---|---|
| Superadmin revocation is no longer automatic | Written into the runbook; the cached ext-endpoint alternative is designed and on the shelf. |
| Engine code now exists in two repos and will drift | Accepted deliberately — they already differ (Studio runs a higher video ceiling). The ported files are pure functions, the least dangerous kind of duplication. |
| A missed job row during the cutover is an unresolvable spinner | Maintenance window; migrate no `running` rows; verify counts. |
| `0062` runs before the copy is verified | It is a separate, explicitly gated step, never in the same deploy as the cutover. |
| Second Cloud SQL instance costs money | Smallest tier; two tables with a 48-hour retention sweep. |

## Phases

1. **Scaffold** `markai-studio-api` — repo, Poetry, `core/`, Dockerfile,
   compose, `dev_start.sh`, `CLAUDE.md`. Boots and answers `/health`.
2. **Port the engine** — `engine/` and `video/` copied with rewritten imports.
   Import-clean, ruff-clean, no database yet.
3. **Jobs** — `studio_users` + `studio_fit_jobs`, migration `0001`, and
   `jobs/service.py` + `jobs/worker.py` rewritten against the single-owner table.
4. **The public router** — `/api/ext/creative-fit/*` at parity, with shared-secret
   auth and the `STUDIO_UNLIMITED_EMAILS` allowlist.
5. **Cut the frontend over** — one environment variable and one error message;
   verify end-to-end locally against :8097.
6. **Deploy** — Cloud SQL, Secret Manager, service account, Cloud Build trigger,
   `studio-back` at 2 CPU / 4 Gi, DNS for `studio-api.mark-ai.tech`.
7. **Migrate and verify** — copy the live rows, verify counts, cut production
   over, watch.
8. **Remove Studio from the CMS** — delete `app/studio/`, strip `owner_kind`,
   land migration `0062`. Only after step 7 has been stable.

Steps 1–5 are reversible at any point; nothing in production changes until 6.
