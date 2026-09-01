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
| Container sizing | **1 CPU / 1 Gi** | User's call. Achievable only with the streaming rewrite below — the current code cannot do it at any input size. |
| Input caps | **10 MB image, 100 MB video** | User's call. 100 MB keeps real 1080p ads in scope; 10 MB would have excluded most of them. |
| Stopping a job | Must work while it is *running*, not just queued | User's call. Today a running video encode ignores a cancel — see *Stopping a running job*. |
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
| CPU / memory | **1 CPU / 1 Gi** | Deliberate. The OOM is fixed by not holding media in memory, not by buying headroom — see *Running in 1 GiB*. |
| min-instances | 0 | Public traffic is bursty and nothing here is long-lived. |
| max-instances | 3 | Pool of 30 connections per instance against a small Cloud SQL tier. |
| CPU throttling | off | The worker pool runs between requests. |
| Ingress | `--no-invoker-iam-check` | Org policy blocks `allUsers`; same workaround as every other service. |
| Secrets | `DATABASE_URL`, `GEMINI_API_KEY`, `STUDIO_EXT_API_SECRET`, `STUDIO_UNLIMITED_EMAILS` | |

Once cut over, `cms-back` keeps its 1 GiB — the load that would have justified
raising it has left the container.

`--execution-environment=gen2` is required: gen1 has a smaller `/tmp` and a
different network stack, and the ffmpeg-over-HTTPS input below depends on
range requests working properly.

## Running in 1 GiB

The container is 1 CPU / 1 Gi and the input caps are 10 MB for an image and
100 MB for a video. Those numbers are only compatible because the media never
sits in memory. Today it sits there four times.

### The fact that governs everything here

**On Cloud Run, `/tmp` is a tmpfs — it is RAM.** A temp file is not scratch
space, it is memory that counts against the 1 Gi allocation. Every design
choice below follows from that one sentence, and it is the reason the current
code cannot be made to fit by tuning alone.

### What the current path costs

`_execute_video_job` holds a 100 MB source four times over:

```python
data = await _download(url)          # 100 MB  → bytes in RAM
src.write_bytes(source_bytes)        # 100 MB  → /tmp, which is also RAM
... ffmpeg ...                       #          + working set
return out.read_bytes(), variant     # output  → back into RAM
await _upload(data, ...)             #          still in RAM
```

Peak is comfortably over 500 MB before ffmpeg allocates a single frame buffer.
Two concurrent jobs is the observed 1034 MiB kill.

### The rewrite

Four changes, and none of them is a tuning knob:

1. **The source never lands locally.** ffmpeg is given a short-lived signed GCS
   URL as its input (`ffmpeg -i "https://..."`) and reads it over HTTPS range
   requests. `_download()` disappears from the video path entirely — the
   100 MB is never a `bytes` and never a temp file. (An MP4 with its `moov`
   atom at the end costs extra round trips as ffmpeg seeks; that is latency,
   not memory.)
2. **The result streams straight out.** ffmpeg writes to `/tmp`, and the file
   is handed to `blob.upload_from_file()` and unlinked immediately. No
   `read_bytes()`. The output is the only media that is ever local, and it is
   local for one upload.
3. **`_download`/`_upload` become streaming for images too.**
   `download_to_temp(url) -> Path` and `upload_from_path(path)` replace the
   `bytes`-returning pair. The image path can afford `bytes` at 10 MB; the
   helpers are shared, so they stop returning them anyway.
4. **Concurrency is bounded by a semaphore, not by hope.** Video is
   `asyncio.Semaphore(1)` — one ffmpeg at a time on one CPU is not a
   limitation, it is the correct number. Images run 2.

### Memory budget at 1 Gi

| | |
|---|---|
| Python + FastAPI + SQLAlchemy + Pillow baseline | ~200 MB |
| One ffmpeg, 1080p, `-threads 1` | ~150–250 MB |
| Output in `/tmp` before upload | up to ~150 MB |
| Headroom | ~250 MB |

That fits 1080p at up to 60s. **It does not fit 4K at CRF 17**, where a 60s
output alone can exceed 400 MB of tmpfs. Stated plainly rather than discovered
in production: the honest envelope at 1 Gi is *1080p up to 60s, or 4K up to
roughly 20s*. If a 4K/60s job has to work, the fix is one flag —
`--memory=2Gi` — and nothing else in this design changes.

### ffmpeg tuning, and the line it must not cross

There is a standing rule that rendered creatives stay native quality and are
never downscaled, because they play on physical premium screens. Nothing here
crosses it. What changes is *how* the encode runs, not what it produces:

- `-threads 1` — one CPU; extra threads cost memory and buy nothing.
- `-preset` drops from `slow` to `medium` for Studio only. A preset trades
  encoder time against file size at the **same** CRF. Visual quality is set by
  `-crf 17`, which does not move, and the output resolution does not move.
- `-rc-lookahead` trimmed to match the preset — lookahead buffers are frames,
  and frames at 4K are 33 MB each.

CMS Creative Fit keeps `preset slow`; the two services now tune independently,
which is a benefit of the split rather than a compromise.

### Image decode is capped by pixels, not bytes

A 10 MB byte cap bounds nothing about image memory. PNG compresses
pathologically well — a 10 MB file can decode to 20,000 × 20,000, which is
1.6 GB of RGBA and an instant kill.

`resizer.py` already sets `Image.MAX_IMAGE_PIXELS = 8192 * 8192` (67 MP), and
that guard ports across unchanged. Worth writing down because the number is
load-bearing and looks arbitrary: 67 MP is ~268 MB decoded, and Pillow holds
the source and the resized copy at once, so one image job can touch ~540 MB.
That is why the image semaphore is 2 and not `CREATIVE_FIT_WORKERS`.

### Where the caps are enforced

Three places, because any one of them alone is bypassable:

| Where | What it stops |
|---|---|
| The BFF, before proxying | An obvious oversize upload, cheaply |
| The GCS resumable session (`size_bytes`) | A client that opens a session and streams more than it declared |
| After upload, from the blob's real size | A declared size that was a lie |

The 100 MB video cap means a video still **cannot** use `POST /upload` — Cloud
Run rejects request bodies over 32 MiB at its frontend, before this app runs.
The direct-to-GCS session pair stays mandatory for video, and now has a second
reason to exist: it keeps 100 MB out of the container's memory entirely. Images
at 10 MB are under the frontend limit and keep the simple path.

New settings, replacing the inherited ones:

```
STUDIO_MAX_IMAGE_BYTES        = 10 * 1024 * 1024
STUDIO_MAX_VIDEO_BYTES        = 100 * 1024 * 1024
STUDIO_VIDEO_CONCURRENCY      = 1
STUDIO_IMAGE_CONCURRENCY      = 2
STUDIO_VIDEO_PRESET           = "medium"
```

## Stopping a running job

A Studio user must be able to stop a fit while it is happening — the analyse
step and the resize/encode alike. The button and the endpoint already exist;
one half of the server does not honour them.

### What already works

- **A queued job stops dead.** The claim statement only ever selects
  `status = 'queued'`, so from the instant the cancel commits no worker can see
  the row. Nothing is spent.
- **A running *image* job stops within seconds.** `_check_cancelled` runs at
  seven stage boundaries through the image path, on its own short-lived session
  so it never pins the worker's connection. The worker throws the result away
  at the next checkpoint.
- **The UI is already wired.** `Workspace.tsx` has the Stop control and
  `api.cancel()` posts to `/jobs/{id}/cancel`. No frontend work.

### The hole: a running video encode ignores the cancel

`_execute_video_job` checkpoints *around* the encode but not *inside* it:

```python
await _check_cancelled(db, job)          # before
out_bytes, variant = await run_in_threadpool(_stretch_to_temp, ...)   # ← minutes, uninterruptible
await _check_cancelled(db, job)          # after — far too late
```

`_stretch_to_temp` calls ffmpeg through `subprocess.run(...)`, which owns the
whole blocking call. Cancelling marks the row and returns the page instantly,
which is why this has never looked broken — but ffmpeg runs to completion in
the background regardless.

**Why this is worse at 1 CPU than it was at 2/4.** The video semaphore is 1. A
cancelled 4K encode holds the only video slot for minutes, burning the only
CPU, while the next user's job waits behind work that nobody wants any more.
At 2 CPU it was waste; at 1 CPU it is a queue stall.

### The fix: the watchdog already exists, it watches the wrong thing

`video/ffmpeg.py` already runs a background thread that kills a `Popen` when a
condition fires — `_watch_timeout`, used for hung children. Generalise it to
take a predicate rather than only a deadline:

```python
def _watch(process, *, deadline, should_stop, finished, timed_out, stopped):
    """Kill `process` when the deadline passes OR should_stop() returns True."""
```

Then the video path passes `should_stop=lambda: job_is_cancelled(job.id)` — a
poll of the one indexed `status` column every ~2 seconds on its own short-lived
session, exactly as `_check_cancelled` already does it. On cancel the watcher
calls `terminate()`, then `kill()` after a short grace period, and
`_stretch_to_temp` raises `JobCancelled` instead of returning bytes.

This is deliberately not a new mechanism. One watchdog with two reasons to fire
is far less likely to rot than a second thread doing the same job alongside it.

### Stopping the analyse step

Two different things get called "analysing", and they stop differently:

**Inside a job** (`mode=auto`, where the analyst runs before the worker decides
resize vs rebuild): add a `_check_cancelled` immediately before and immediately
after `read_creative`, and give the Gemini call an explicit timeout so a hung
response cannot pin a worker past the point of caring. The in-flight HTTP call
itself is not aborted — that generation is already paid for — but nothing
downstream of it starts.

**The standalone `POST /analyze`** is not a job at all: it is synchronous,
creates no row, spends no budget, and there is nothing to cancel by id. Stopping
it is the client aborting the request. The server honours that by checking
`await request.is_disconnected()` before it spends the Gemini call, so a user
who changes their mind during the upload does not pay for a verdict nobody will
read.

### Releasing the slot

The concurrency semaphores are acquired and released in a `finally`, so a
cancelled job hands its slot back the moment the worker unwinds rather than at
the end of the encode that no longer matters. This is the change that makes
cancel useful rather than cosmetic at 1 CPU.

### Budget on cancel is unchanged

A cancel after a worker has started still costs half a rebuild credit, a
failure costs nothing, and a plain resize is free — the budget is a weighted SUM
over the rows themselves, so this needs no refund code and gets none.

## Testing

Per house rule, no pytest is run here; verification is by import and syntax
check, and by exercising the running service. The plan will include:

- `python -c "import app.main"` on the new service, and `ruff` (the actual gate;
  `black`-cleanliness is not).
- `alembic upgrade head` on an empty database, then `alembic check`.
- A local end-to-end pass on :8097 — sign in through the BFF, upload, analyze,
  resize, rebuild, refine, cancel; then a video stretch, watching container
  memory to confirm the peak stays inside 1 Gi with a 100 MB source.
- A stop pass, which is the one most likely to regress silently: cancel a
  queued job (no worker ever sees it), cancel a running image job (stops at the
  next checkpoint), cancel a running **video** job and confirm with `ps` that
  the ffmpeg child is actually gone and the slot is free for the next job,
  and abort a `POST /analyze` mid-flight and confirm no Gemini call is made.
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
| 4K/60s video will not fit in 1 Gi | Envelope stated up front; `--memory=2Gi` is a one-flag change that invalidates nothing else. |
| A 1-CPU 4K encode is slow (minutes) | The contract is already async 202+poll. Studio's stale-reclaim window is tuned to its own encodes, independently of the CMS's. |
| A cancelled encode leaves an orphan ffmpeg | The watchdog escalates `terminate()` to `kill()`; the stop test asserts on `ps`, not on the API response. |
| Second Cloud SQL instance costs money | Smallest tier; two tables with a 48-hour retention sweep. |

## Phases

1. **Scaffold** `markai-studio-api` — repo, Poetry, `core/`, Dockerfile,
   compose, `dev_start.sh`, `CLAUDE.md`. Boots and answers `/health`.
2. **Port the engine** — `engine/` and `video/` copied with rewritten imports.
   Import-clean, ruff-clean, no database yet.
2b. **The streaming rewrite** — signed-URL input into ffmpeg, streamed upload
   out, `bytes`-free media helpers, semaphores, ffmpeg tuning and the caps.
   This is the work that makes 1 Gi possible and is the riskiest step; do it
   here, before any of it is load-bearing.
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
