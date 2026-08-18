# Video Creative Fit — Plan B: Jobs, Agent and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes. Work one task at a time, in order, and run that task's verification before moving on.

**Goal:** an operator can `POST` a video Creative Fit job with `curl`, poll it to `done`, and the refitted video lands in GCS **and** in the Content library as a **video** `MediaAsset` carrying its real duration. One Gemini agent reads the creative. No CMS frontend — that is Plan C.

**Architecture:** `creative_fit_jobs` becomes a two-lane queue. A new `media_kind` column splits it; the existing worker pool grows a second lane that claims only `media_kind='video'` and calls `video_service.execute_video_job` instead of `service.execute_job`. Every video module is a **sibling** of its image counterpart (`video_schemas.py`, `video_prompts.py`, `video_agent.py`, `video_service.py`) — nothing image-side is parameterised. The heavy work (`app/video/pipeline.fit_video`, ported by Plan A) runs inside `run_in_threadpool`, because the worker pool shares the API's event loop with fleet-wide screen heartbeats. Large sources never traverse Cloud Run: the browser PUTs straight to a GCS resumable session, and the backend measures the file with `ffprobe` over HTTP range requests instead of downloading it.

**Tech Stack:** Python 3.12, Poetry, FastAPI, async SQLAlchemy 2.0 + asyncpg, Alembic (sync psycopg2), pydantic-ai (`google-genai`), `google-cloud-storage`, ffmpeg/ffprobe subprocess. **No new Python dependency in Plan B** — Plan A already added `torch` and `numpy`.

---

## Global Constraints

### THE FREEZE — copied from `video-fit-contract.md`, and it overrides your judgement

`markai-signage-api/app/creative_fit/` image behaviour must not change. The ONLY edits permitted to existing image files, anywhere across all three plans:

| File | The one permitted edit | Why it is safe |
|---|---|---|
| `app/creative_fit/models.py` | ADD `media_kind` column + two constants | additive; server_default 'image' |
| `app/creative_fit/worker.py` | claim SQL gains `AND media_kind = :media_kind`; pool starts a second lane | existing rows are all 'image', so the image lane's behaviour is identical |
| `app/creative_fit/router.py` | ADD routes; `GET /jobs` gains `kind: str = "image"` | default preserves today's response exactly |
| `app/creative_fit/schemas.py` | ADD fields with defaults; ADD new models | additive only |
| `app/creative_fit/service.py` | ADD `list_jobs(..., media_kind=...)` param with default `"image"` | default preserves behaviour |
| `app/core/config.py` | ADD settings | additive |
| `app/main.py` | nothing (`worker.start_workers` already called) | — |

**Forbidden everywhere:** editing `service.execute_job`, `service._sniff`, `service._run_rebuild`, `service.resolve_source`, `resizer.py`, `gemini_image.py`, `agent.py`, `prompts.py`, `analysis.py`. Video gets its OWN modules. Where video needs something image has, DUPLICATE it. A previous move was reverted for this.

### Three deviations from that table, declared up front

1. **`models.py` also widens `result_bytes` to `BigInteger`.** The contract's own migration section widens the column in the database; leaving the ORM at `Integer` means the next `alembic revision --autogenerate` proposes to narrow it back. Type-only, no behaviour change.
2. **`app/core/gcs_service.py` gains two new functions** (`download_to_file`, `upload_file_to_gcs`). Purely additive; no existing function is touched. A 500 MB video cannot go through `download_bytes_from_gcs`/`upload_to_gcs`, which are both whole-object-in-RAM.
3. **`video_service.py` IMPORTS four private names from `service.py`** — `_blob_name_for`, `_check_cancelled`, `_finish_if_still_running`, `JobCancelled`, `mark_failed`. Importing is a read, not an edit; the freeze forbids editing. This is deliberate rather than duplicated: `_finish_if_still_running` is the conditional write that stops a finished job overwriting a cancel, and two divergent copies of that guard is exactly how a cancelled job starts delivering results again. Everything else is duplicated per the contract.

### Correctness notes — these came from a codebase audit; treat them as facts

- **`CREATIVE_FIT_STALE_MINUTES` is 5** (`app/core/config.py:311`). A 15-minute video job would be reclaimed while still running: two workers would race the same row and Gemini would be billed twice. This is why the video lane reads `CREATIVE_FIT_VIDEO_STALE_MINUTES` (30) instead. **Staleness is per lane, never shared.**
- **`result_bytes` is `int4` and overflows at 2.1 GB** (`models.py:127`, `0037_creative_fit_jobs.py:71`). Migration `0045` widens it to `BigInteger`.
- **`source_width` / `source_height` are NOT NULL** (`models.py:73-74`). The probe must yield both **before** the insert, so `create_video_job` probes the source (over HTTP, ~1 MB) and never trusts a client-supplied number.
- **All heavy work goes through `run_in_threadpool` or a subprocess.** The worker pool shares the API's event loop (`worker.py` module docstring). Stalling it stalls fleet-wide screen heartbeats.
- **Without the `media_kind` filter, an image worker claims a video job.** `service.execute_job` calls `service._sniff`, which is Pillow-only and raises HTTP 415 on an mp4. The job would burn all three attempts (`CREATIVE_FIT_MAX_ATTEMPTS`) and land in `failed` with "That file isn't a readable image", which is a maximally confusing error for something the operator submitted as a video. **The `AND media_kind = :media_kind` clause is the entire safety of the two-lane design.**
- **`/tmp` is RAM on Cloud Run.** `VIDEO_WORK_DIR` defaults to `/tmp/markai-video`. Every job removes its own directories in a `finally`, or a handful of fits OOMs the instance.

### Verification rules

- **NO pytest.** The user forbids it. Verify with:
  - `poetry run ruff check app/`
  - `poetry run python -c "import app.main"`
  - `poetry run alembic upgrade head` (and `poetry run alembic downgrade -1` where stated)
  - real `curl` commands with the expected JSON written out.
- Any step that would make a real Gemini API call is flagged `> **ASK THE USER FIRST**`.
- **Do NOT run git write commands.** The user works uncommitted.
- Backend runs on **:8095** (`dev_start.sh:121`). Seeded login: `admin@mark-ai.tech` / `Admin@123`.

### Names frozen by the contract — do not invent variants

`MEDIA_KIND_IMAGE`, `MEDIA_KIND_VIDEO`, `media_kind`, `ix_creative_fit_jobs_media_kind`,
`0045_creative_fit_media_kind`, `CREATIVE_FIT_VIDEO_WORKERS`, `CREATIVE_FIT_VIDEO_STALE_MINUTES`,
`CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES`, `VideoReading`, `VideoFacts`, `VideoVariantOut`,
`CREATIVE_FIT_VIDEO_ANALYST_PROMPT`, `build_video_brief`, `get_video_analyst`,
`read_video_creative`, `execute_video_job`, `analyze_video`, `extract_keyframes`,
`claim_one(db, media_kind)`, `worker_loop(index, media_kind)`, `start_workers()`,
`GET /jobs?kind=`, `POST /video/upload-session`, `POST /video/analyze`.

### Assumed done (Plan A)

`markai-signage-api/app/video/` exists and works: `app.video.probe.probe(path)`, `app.video.ffmpeg.run/run_probe`, `app.video.shots.detect`, `app.video.pipeline.fit_video(data, targets, force, slot_seconds)`, `app.video.schemas.VideoProbe/VideoVariant`. All the `VIDEO_*` and `CREATIVE_FIT_VIDEO_*` settings from the contract exist in `app/core/config.py`. `ffmpeg` ≥ 7 is on PATH.

---

## Task 1: Migration `0045_creative_fit_media_kind`

**Files:**
- CREATE `markai-signage-api/alembic/versions/0045_creative_fit_media_kind.py`

**Interfaces:**
- Consumes: alembic head `0044_apk_update_jobs` (confirmed by `poetry run alembic heads`), table `creative_fit_jobs` from `0037_creative_fit_jobs.py`, index `ix_creative_fit_jobs_claim` created at `0037_creative_fit_jobs.py:102-107`.
- Produces: column `creative_fit_jobs.media_kind`, index `ix_creative_fit_jobs_media_kind`, widened `creative_fit_jobs.result_bytes`, replaced partial index `ix_creative_fit_jobs_claim` on `(media_kind, created_at) WHERE status='queued'`.

- [ ] **Step 1: Confirm the head is still `0044_apk_update_jobs`.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run alembic heads
```

Expected output, exactly one line:

```
0044_apk_update_jobs (head)
```

If it prints anything else, STOP and set `down_revision` to whatever it prints instead.

- [ ] **Step 2: Write the migration.**

Create `markai-signage-api/alembic/versions/0045_creative_fit_media_kind.py`:

```python
"""Creative Fit gains a media_kind lane — image and video share one table.

Three changes, each load-bearing:

1. `media_kind` — the column the worker pool claims on. Without it an image
   worker takes a video job, hands the mp4 to `service._sniff` (Pillow), and
   fails it three times with "That file isn't a readable image". Existing rows
   are all images, so the server_default is 'image' and today's behaviour is
   bit-identical.
2. `result_bytes` Integer -> BigInteger. int4 tops out at 2,147,483,647; a
   refitted 4K master can exceed 2.1 GB, and the insert would raise
   NumericValueOutOfRange at the very end of a fifteen-minute render.
3. `ix_creative_fit_jobs_claim` is rebuilt on (media_kind, created_at). The old
   index led on created_at only, so the video lane's claim would scan every
   queued image row (and vice versa) before finding its own oldest job.

Revision ID: 0045_creative_fit_media_kind
Revises: 0044_apk_update_jobs
Create Date: 2026-08-14

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0045_creative_fit_media_kind"
down_revision: Union[str, Sequence[str], None] = "0044_apk_update_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "creative_fit_jobs",
        sa.Column(
            "media_kind",
            sa.String(length=16),
            nullable=False,
            server_default="image",
        ),
    )
    op.create_index(
        "ix_creative_fit_jobs_media_kind",
        "creative_fit_jobs",
        ["media_kind"],
    )

    op.alter_column(
        "creative_fit_jobs",
        "result_bytes",
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=True,
    )

    # Rebuild the workers' partial claim index so it leads on the lane.
    op.drop_index("ix_creative_fit_jobs_claim", table_name="creative_fit_jobs")
    op.create_index(
        "ix_creative_fit_jobs_claim",
        "creative_fit_jobs",
        ["media_kind", "created_at"],
        postgresql_where=sa.text("status = 'queued'"),
        sqlite_where=sa.text("status = 'queued'"),
    )


def downgrade() -> None:
    op.drop_index("ix_creative_fit_jobs_claim", table_name="creative_fit_jobs")
    op.create_index(
        "ix_creative_fit_jobs_claim",
        "creative_fit_jobs",
        ["created_at"],
        postgresql_where=sa.text("status = 'queued'"),
    )

    # A result that only fits in int8 cannot survive the narrowing. Null it
    # rather than let ALTER TABLE abort: result_bytes is display metadata (the
    # size shown beside a finished fit), the blob itself is untouched, and a
    # failed downgrade in the middle of a rollback is far worse than a blank
    # size on a handful of rows.
    op.execute(
        "UPDATE creative_fit_jobs SET result_bytes = NULL "
        "WHERE result_bytes > 2147483647"
    )
    op.alter_column(
        "creative_fit_jobs",
        "result_bytes",
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=True,
    )

    # Video rows have no meaning once the lane column is gone — the image
    # worker would claim them on the next boot and fail them. Remove them
    # before dropping the column that identifies them.
    op.execute("DELETE FROM creative_fit_jobs WHERE media_kind = 'video'")
    op.drop_index("ix_creative_fit_jobs_media_kind", table_name="creative_fit_jobs")
    op.drop_column("creative_fit_jobs", "media_kind")
```

- [ ] **Step 3: Apply it, then prove the downgrade round-trips.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run alembic upgrade head
poetry run alembic current
```

Expected: `0045_creative_fit_media_kind (head)`.

```bash
poetry run alembic downgrade -1 && poetry run alembic current
poetry run alembic upgrade head && poetry run alembic current
```

Expected: `0044_apk_update_jobs (head)`, then `0045_creative_fit_media_kind (head)`. Neither direction may print a traceback.

- [ ] **Step 4: Confirm the column and both indexes landed.**

```bash
docker exec -i markai-postgres psql -U markai -d markai_signage -c "\d creative_fit_jobs" | grep -E "media_kind|result_bytes|_claim"
```

Expected to include `media_kind | character varying(16) | not null | 'image'::character varying`, `result_bytes | bigint`, and an `ix_creative_fit_jobs_claim` btree on `(media_kind, created_at) WHERE status = 'queued'`. (If the container is named differently, read it out of `docker-compose.dev.yml`.)

---

## Task 2: `models.py` — the column and the two constants

**Files:**
- MODIFY `markai-signage-api/app/creative_fit/models.py` — add constants after line 43 (`MODE_REBUILD = "rebuild"`); add the column after line 85 (`mode: Mapped[str] = ...`); change line 127 (`result_bytes`).

**Interfaces:**
- Consumes: `sqlalchemy.BigInteger`.
- Produces: `MEDIA_KIND_IMAGE`, `MEDIA_KIND_VIDEO`, `CreativeFitJob.media_kind`.

- [ ] **Step 1: Add `BigInteger` to the SQLAlchemy import block.**

In `models.py`, replace lines 16-24:

```python
from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
```

with:

```python
from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
```

- [ ] **Step 2: Add the two constants.**

Immediately after line 43 (`MODE_REBUILD = "rebuild"`), add:

```python

# Which pipeline a job belongs to, and which worker lane may claim it. One
# table, two lanes: an image worker must never take a video job (it would hand
# an mp4 to Pillow) and a video worker must never take an image one (it would
# spin up ffmpeg for a jpeg). Rows written before migration 0045 are all
# images, which is why 'image' is the server default.
MEDIA_KIND_IMAGE = "image"
MEDIA_KIND_VIDEO = "video"
```

- [ ] **Step 3: Add the column.**

Immediately after line 85 (`mode: Mapped[str] = mapped_column(String(16), nullable=False)  # resize | rebuild`), add:

```python
    # image | video. Indexed because it is the leading predicate of both the
    # claim statement and the history list.
    media_kind: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=MEDIA_KIND_IMAGE, index=True
    )
```

- [ ] **Step 4: Widen `result_bytes` in the ORM to match the database.**

Replace line 127:

```python
    result_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

with:

```python
    # BigInteger, not Integer: int4 overflows at 2,147,483,647 and a refitted
    # 4K video result can exceed 2.1 GB. Widened by migration 0045 — the ORM
    # has to agree or the next autogenerate proposes narrowing it back.
    result_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
```

- [ ] **Step 5: Verify.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
poetry run python -c "
from app.creative_fit.models import CreativeFitJob, MEDIA_KIND_IMAGE, MEDIA_KIND_VIDEO
c = CreativeFitJob.__table__.c
print(MEDIA_KIND_IMAGE, MEDIA_KIND_VIDEO)
print('media_kind:', c.media_kind.type, 'nullable=', c.media_kind.nullable, 'default=', c.media_kind.server_default.arg)
print('result_bytes:', c.result_bytes.type)
"
```

Expected:

```
image video
media_kind: VARCHAR(16) nullable= False default= image
result_bytes: BIGINT
```

---

## Task 3: `worker.py` — two lanes

**Files:**
- MODIFY `markai-signage-api/app/creative_fit/worker.py` — module docstring (lines 1-28), imports (lines 35-44), `_CLAIM_SQL` (51-67), `_RECLAIM_SQL` (72-81), `_CLAIM_SQL_FALLBACK` (85-100), `claim_one` (103-123), `reclaim_stale` (126-144), `_run_one` (147-185), `worker_loop` (209-243), `start_workers` (246-255).

**Interfaces:**
- Consumes: `settings.CREATIVE_FIT_WORKERS`, `settings.CREATIVE_FIT_VIDEO_WORKERS`, `settings.CREATIVE_FIT_STALE_MINUTES`, `settings.CREATIVE_FIT_VIDEO_STALE_MINUTES`, `MEDIA_KIND_IMAGE`, `MEDIA_KIND_VIDEO`, `service.execute_job`, `video_service.execute_video_job` (Task 8).
- Produces: `claim_one(db, media_kind: str) -> CreativeFitJob | None`, `reclaim_stale(db, media_kind: str) -> int`, `worker_loop(index: int, media_kind: str) -> None`, `start_workers() -> list[asyncio.Task]`.

> **This is the delicate task.** Without `AND media_kind = :media_kind` in the claim statement, an image worker claims a video job, `service.execute_job` hands the mp4 to `service._sniff`, Pillow raises, the worker retries, and after `CREATIVE_FIT_MAX_ATTEMPTS` (3) the job is marked `failed` with "That file isn't a readable image. Creative Fit handles images only". Do not omit the clause from any of the three statements.

- [ ] **Step 1: Extend the module docstring.**

Replace lines 1-28 of `worker.py` with:

```python
"""The Creative Fit worker pool — two lanes, no broker.

Postgres IS the queue. Each worker claims a row with::

    UPDATE creative_fit_jobs SET status='running', ...
    WHERE id = (SELECT id FROM creative_fit_jobs
                WHERE status='queued' AND media_kind=:media_kind
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id;

``FOR UPDATE SKIP LOCKED`` is what makes concurrent workers safe: the row one
worker is claiming is invisible to the others for the duration of the
statement, so two workers can never take the same job. This stays correct when
Cloud Run runs several instances, because the guarantee lives in the database
rather than in the process.

``AND media_kind = :media_kind`` is what makes the two lanes safe, and it is
not optional. An image worker that claimed a video job would hand the mp4 to
``service._sniff`` (Pillow), fail, retry, and after CREATIVE_FIT_MAX_ATTEMPTS
mark the job failed with "That file isn't a readable image" — for a file the
operator submitted, correctly, as a video.

The two lanes differ in more than which function they call:

* **Staleness.** An image rebuild is 20-60s, so CREATIVE_FIT_STALE_MINUTES is
  5. A video fit is minutes to a quarter of an hour, so reclaiming it at 5
  minutes would hand a still-running job to a second worker — two ffmpeg
  pipelines on one row, and Gemini billed twice. The video lane reads
  CREATIVE_FIT_VIDEO_STALE_MINUTES (30) instead.
* **Cost.** An image rebuild is network wait; a video fit is CPU and RAM. Hence
  CREATIVE_FIT_VIDEO_WORKERS defaults to 1 while CREATIVE_FIT_WORKERS is 3.

Because both counts are env vars, the SAME image can run as two Cloud Run
services: ``cms-back`` with ``CREATIVE_FIT_VIDEO_WORKERS=0``, and a bigger
``cms-back-video`` with ``CREATIVE_FIT_WORKERS=0``. One repo, one table, one
image. Set both to 0 to disable the pool on an instance entirely.
"""
```

- [ ] **Step 2: Extend the imports.**

Replace lines 39-44:

```python
from app.creative_fit import service
from app.creative_fit.models import (
    STATUS_QUEUED,
    STATUS_RUNNING,
    CreativeFitJob,
)
```

with:

```python
from app.creative_fit import service, video_service
from app.creative_fit.models import (
    MEDIA_KIND_IMAGE,
    MEDIA_KIND_VIDEO,
    STATUS_QUEUED,
    STATUS_RUNNING,
    CreativeFitJob,
)
```

- [ ] **Step 3: Replace all three SQL statements.**

Replace lines 50-100 (from the `# One statement, so the claim is atomic ...` comment through the end of `_CLAIM_SQL_FALLBACK`) with:

```python
# One statement, so the claim is atomic without an explicit transaction dance.
# The media_kind predicate is what keeps the two lanes apart — see the module
# docstring for what happens without it.
_CLAIM_SQL = text(
    """
    UPDATE creative_fit_jobs
       SET status = :running,
           claimed_at = now(),
           attempts = attempts + 1
     WHERE id = (
           SELECT id FROM creative_fit_jobs
            WHERE status = :queued
              AND media_kind = :media_kind
              AND attempts < :max_attempts
            ORDER BY created_at
              FOR UPDATE SKIP LOCKED
            LIMIT 1
     )
     RETURNING id
    """
)

# Return a job whose worker died with its instance (crash, redeploy mid-render)
# to the queue. Bounded by attempts, so a creative that reliably crashes the
# pipeline can't cycle forever across the pool. Scoped to one lane because the
# staleness window is per lane: 5 minutes for an image, 30 for a video.
_RECLAIM_SQL = text(
    """
    UPDATE creative_fit_jobs
       SET status = :queued
     WHERE status = :running
       AND media_kind = :media_kind
       AND claimed_at < now() - make_interval(mins => :stale_minutes)
       AND attempts < :max_attempts
     RETURNING id
    """
)

# Same claim for SQLite (any non-Postgres dev setup). No SKIP LOCKED there, but
# nothing is concurrent in that context either.
_CLAIM_SQL_FALLBACK = text(
    """
    UPDATE creative_fit_jobs
       SET status = :running,
           claimed_at = CURRENT_TIMESTAMP,
           attempts = attempts + 1
     WHERE id = (
           SELECT id FROM creative_fit_jobs
            WHERE status = :queued
              AND media_kind = :media_kind
              AND attempts < :max_attempts
            ORDER BY created_at
            LIMIT 1
     )
     RETURNING id
    """
)

#: Which executor and which staleness window each lane uses. A lane is data,
#: not a branch scattered through the loop.
_LANES = {
    MEDIA_KIND_IMAGE: ("CREATIVE_FIT_STALE_MINUTES", service.execute_job),
    MEDIA_KIND_VIDEO: ("CREATIVE_FIT_VIDEO_STALE_MINUTES", video_service.execute_video_job),
}
```

- [ ] **Step 4: Replace `claim_one` and `reclaim_stale`.**

Replace lines 103-144 with:

```python
async def claim_one(db, media_kind: str) -> CreativeFitJob | None:
    """Atomically take the oldest queued job IN THIS LANE, or None if there isn't one."""
    is_postgres = db.bind.dialect.name == "postgresql"
    sql = _CLAIM_SQL if is_postgres else _CLAIM_SQL_FALLBACK
    row = (
        await db.execute(
            sql,
            {
                "running": STATUS_RUNNING,
                "queued": STATUS_QUEUED,
                "media_kind": media_kind,
                "max_attempts": settings.CREATIVE_FIT_MAX_ATTEMPTS,
            },
        )
    ).first()
    if row is None:
        await db.rollback()
        return None
    await db.commit()
    return (
        await db.execute(select(CreativeFitJob).where(CreativeFitJob.id == row[0]))
    ).scalar_one_or_none()


async def reclaim_stale(db, media_kind: str) -> int:
    """Requeue jobs abandoned by a dead worker. Postgres only; a no-op elsewhere.

    The window is read per lane. Sharing the image lane's 5 minutes with video
    would requeue a job that is still rendering, so two workers would run the
    same fit and Gemini would be billed twice for one creative.
    """
    if db.bind.dialect.name != "postgresql":
        return 0
    setting_name, _executor = _LANES[media_kind]
    rows = (
        await db.execute(
            _RECLAIM_SQL,
            {
                "queued": STATUS_QUEUED,
                "running": STATUS_RUNNING,
                "media_kind": media_kind,
                "stale_minutes": getattr(settings, setting_name),
                "max_attempts": settings.CREATIVE_FIT_MAX_ATTEMPTS,
            },
        )
    ).all()
    await db.commit()
    if rows:
        logger.warning(
            "[creative-fit] requeued %d stale %s job(s)", len(rows), media_kind
        )
    return len(rows)
```

- [ ] **Step 5: Replace `_run_one`.**

Replace lines 147-185 with:

```python
async def _run_one(index: int, media_kind: str) -> bool:
    """Claim and run at most one job in this lane. Returns True if it did work."""
    _setting_name, executor = _LANES[media_kind]
    async with AsyncSessionLocal() as db:
        job = await claim_one(db, media_kind)
        if job is None:
            return False

        logger.info(
            "[creative-fit] %s worker %d claimed %s (%s -> %dx%d, attempt %d)",
            media_kind, index, job.id, job.mode,
            job.target_width, job.target_height, job.attempts,
        )
        try:
            await executor(db, job)
            logger.info(
                "[creative-fit] %s worker %d finished %s", media_kind, index, job.id
            )
        except service.JobCancelled:
            # A clean stop, not a failure. The row is already "cancelled" (the
            # endpoint wrote it), so there is nothing to record — and crucially
            # nothing to retry: the staleness sweep only requeues "running".
            await db.rollback()
            logger.info(
                "[creative-fit] %s worker %d stopped %s on request",
                media_kind, index, job.id,
            )
        except Exception as exc:  # noqa: BLE001 - a bad creative must not kill the pool
            logger.exception(
                "[creative-fit] %s worker %d failed on %s", media_kind, index, job.id
            )
            await db.rollback()
            # Out of attempts: tell the operator. Otherwise leave it "running" so
            # the staleness sweep requeues it for another worker to retry.
            if job.attempts >= settings.CREATIVE_FIT_MAX_ATTEMPTS:
                try:
                    fresh = (
                        await db.execute(
                            select(CreativeFitJob).where(CreativeFitJob.id == job.id)
                        )
                    ).scalar_one_or_none()
                    if fresh is not None:
                        await service.mark_failed(db, fresh, str(exc))
                except Exception:  # pragma: no cover - defensive
                    logger.exception(
                        "[creative-fit] could not record failure for %s", job.id
                    )
        return True
```

- [ ] **Step 6: Replace `worker_loop` and `start_workers`.**

Replace lines 209-255 with:

```python
async def worker_loop(index: int, media_kind: str) -> None:
    """One worker in one lane: drain the queue, then idle-poll. Never exits."""
    logger.info("[creative-fit] %s worker %d started", media_kind, index)
    # Stagger startup so several workers don't hammer the same claim statement
    # on the same tick forever — they'd all succeed (SKIP LOCKED), but spreading
    # them keeps the idle poll cheap.
    await asyncio.sleep(settings.CREATIVE_FIT_POLL_SECONDS * index / 3)

    # Worker 0 of each lane sweeps its OWN lane's stale jobs (the windows
    # differ). The retention sweep is lane-agnostic and must run exactly once,
    # so it belongs to the image lane — unless there is no image lane on this
    # instance, which is the `CREATIVE_FIT_WORKERS=0` video-only deployment.
    owns_retention = index == 0 and (
        media_kind == MEDIA_KIND_IMAGE or int(settings.CREATIVE_FIT_WORKERS) == 0
    )
    cleanup_state: dict = {}

    while True:
        try:
            did_work = await _run_one(index, media_kind)
        except asyncio.CancelledError:
            logger.info("[creative-fit] %s worker %d stopping", media_kind, index)
            raise
        except Exception:  # noqa: BLE001 - e.g. the DB blipped
            logger.exception(
                "[creative-fit] %s worker %d loop error", media_kind, index
            )
            did_work = False
            await asyncio.sleep(5)

        if not did_work:
            if index == 0:
                try:
                    async with AsyncSessionLocal() as db:
                        await reclaim_stale(db, media_kind)
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "[creative-fit] %s stale sweep failed", media_kind
                    )
                if owns_retention:
                    await _maybe_cleanup(cleanup_state)
            await asyncio.sleep(settings.CREATIVE_FIT_POLL_SECONDS)


def start_workers() -> list[asyncio.Task]:
    """Spawn both lanes. Called once from the app lifespan."""
    global _tasks
    image_count = max(0, int(settings.CREATIVE_FIT_WORKERS))
    video_count = max(0, int(settings.CREATIVE_FIT_VIDEO_WORKERS))
    if image_count == 0 and video_count == 0:
        logger.info(
            "[creative-fit] worker pool disabled "
            "(CREATIVE_FIT_WORKERS=0, CREATIVE_FIT_VIDEO_WORKERS=0)"
        )
        return []
    _tasks = [
        asyncio.create_task(worker_loop(i, MEDIA_KIND_IMAGE))
        for i in range(image_count)
    ]
    _tasks += [
        asyncio.create_task(worker_loop(i, MEDIA_KIND_VIDEO))
        for i in range(video_count)
    ]
    logger.info(
        "[creative-fit] worker pool started: %d image, %d video",
        image_count, video_count,
    )
    return _tasks
```

- [ ] **Step 7: Verify the shapes (do this after Task 8 exists — `video_service` is imported at module load).**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
poetry run python -c "
import inspect
from app.creative_fit import worker
print(inspect.signature(worker.claim_one))
print(inspect.signature(worker.reclaim_stale))
print(inspect.signature(worker.worker_loop))
for name in ('_CLAIM_SQL', '_CLAIM_SQL_FALLBACK', '_RECLAIM_SQL'):
    assert 'media_kind = :media_kind' in str(getattr(worker, name)), name
print('all three statements filter on media_kind: OK')
print(sorted(worker._LANES))
"
```

Expected:

```
(db, media_kind: str) -> app.creative_fit.models.CreativeFitJob | None
(db, media_kind: str) -> int
(index: int, media_kind: str) -> None
all three statements filter on media_kind: OK
['image', 'video']
```

---

## Task 4: `video_schemas.py`

**Files:**
- CREATE `markai-signage-api/app/creative_fit/video_schemas.py`

**Interfaces:**
- Consumes: nothing from `app/creative_fit/schemas.py` — see the import-direction note below.
- Produces: `VideoReading`, `VideoFacts`, `VideoVariantOut`, `VideoAnalyzeRequest`, `VideoAnalyzeResponse`, `VideoUploadSessionRequest`, `VideoUploadSessionResponse`.

> The contract names `VideoAnalyzeResponse` in `video_service.analyze_video`'s signature and describes `POST /video/upload-session`'s body as `{upload_url, source_url, source_name}`, but never defines those models. They are defined here with exactly those field names.

> **Import direction is one-way and must stay that way.** `schemas.py` imports `VideoVariantOut` from this module (Task 9) so `JobResponse.variants` can be typed. Therefore this module must import **nothing** from `schemas.py`, or the two deadlock: importing `video_schemas` first would run `schemas`, whose bottom-of-file import finds a half-initialised `video_schemas` with no `VideoVariantOut` yet, and raises `ImportError`. The one-of source/target validator is therefore **duplicated** here rather than reused from `_SourceTargetBase` — which is also what the contract's "duplicate, never share" rule asks for.

- [ ] **Step 1: Write the file.**

Create `markai-signage-api/app/creative_fit/video_schemas.py`:

```python
"""Request/response shapes for the VIDEO half of /api/cms/creative-fit/*.

A sibling of schemas.py, not an extension of it. The image shapes are frozen;
where video needs the same idea it gets its own model.

**This module imports nothing from schemas.py, on purpose.** The dependency runs
the other way: `schemas.JobResponse.variants` is typed `list[VideoVariantOut]`,
so schemas.py imports THIS module. Importing back would make the pair
un-importable in one of the two orders — `video_schemas` first would run
`schemas`, whose bottom import would find a half-built `video_schemas` with no
`VideoVariantOut` on it yet. Hence `_VideoSourceTargetBase` below duplicates
`schemas._SourceTargetBase`'s validator rather than subclassing it, which is
also the contract's "duplicate, never share" rule.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, model_validator


class VideoReading(BaseModel):
    """The analyst's structured verdict on one video creative against one screen."""

    recommendation: str = Field(
        description=(
            "Exactly 'resize' or 'rebuild'. 'resize' when a straight rescale or "
            "an edge trim costs nothing important; 'rebuild' when the frame has "
            "to be laid out again for the new shape."
        )
    )
    reason: str = Field(
        description=(
            "Two or three sentences for the advertiser, in plain language, naming "
            "what will actually go wrong on the screen. No technical jargon."
        )
    )
    confidence: float = Field(
        default=0.8, description="0.0-1.0 confidence in the recommendation."
    )
    text_content: Optional[list[str]] = Field(
        default=None,
        description=(
            "EVERY word that appears on screen at any point, character for "
            "character, in the order it appears. Null when recommending 'resize'."
        ),
    )
    brand_colors: Optional[list[str]] = Field(
        default=None,
        description="2-5 defining hex colours, most dominant first. Null on 'resize'.",
    )
    logo_present: bool = Field(
        default=False,
        description="True when a brand mark or wordmark appears in any frame.",
    )
    motion_note: Optional[str] = Field(
        default=None,
        description=(
            "What actually moves — camera, subject, or animated overlays — and "
            "roughly when. One or two sentences."
        ),
    )
    layout_plan: Optional[str] = Field(
        default=None,
        description=(
            "How to re-stack the elements for the new shape — concrete vertical "
            "order and rough positions. Null when recommending 'resize'."
        ),
    )


class VideoFacts(BaseModel):
    """What the probe measured. Handed to the model as fact, never re-derived."""

    width: int
    height: int
    duration_seconds: float
    fps: float
    #: 0 means "not segmented yet". /video/analyze reports 0 deliberately —
    #: counting shots is a full decode pass and it is the worker, holding the
    #: file on local disk, that pays for it.
    shot_count: int
    has_audio: bool
    color_inferred: bool


class VideoVariantOut(BaseModel):
    """One rendered target, as the CMS sees it."""

    width: int
    height: int
    mode: str  # stretch | crop | reframe | compose
    url: str
    duration_seconds: float
    warnings: list[str] = []


class _VideoSourceTargetBase(BaseModel):
    """Shared source/target resolution, with the one-of rules enforced once.

    A byte-for-byte duplicate of `schemas._SourceTargetBase` (schemas.py:56-87).
    Duplicated rather than subclassed to keep the import one-way — see the
    module docstring. If the image version's rules change, change these too.
    """

    source_media_id: Optional[str] = None
    source_url: Optional[str] = None
    source_name: Optional[str] = None
    source_width: Optional[int] = None
    source_height: Optional[int] = None

    target_screen_id: Optional[str] = None
    target_width: Optional[int] = None
    target_height: Optional[int] = None

    @model_validator(mode="after")
    def _check_one_of(self):
        if not self.source_media_id and not self.source_url:
            raise ValueError(
                "Pick a video from the library or upload one "
                "(source_media_id or source_url)."
            )
        if not self.target_screen_id and not (self.target_width and self.target_height):
            raise ValueError(
                "Choose a screen or enter a custom resolution "
                "(target_screen_id or target_width + target_height)."
            )
        for label, value in (
            ("target_width", self.target_width),
            ("target_height", self.target_height),
        ):
            if value is not None and not (16 <= value <= 8192):
                raise ValueError(f"{label} must be between 16 and 8192 pixels.")
        return self


class VideoAnalyzeRequest(_VideoSourceTargetBase):
    """Ask what this video needs. Synchronous — no job is created.

    Reads the container header over HTTP range requests and six stills; it
    never downloads the file, so a 500 MB master costs a few megabytes here.
    """

    user_note: Optional[str] = Field(default=None, max_length=2000)


class VideoAnalyzeResponse(BaseModel):
    """FLAT, mirroring the image path's `AnalyzeResponse` (schemas.py:121-134).

    The reading is spread across the top level rather than nested under a
    `reading` object because the CMS verdict card is the image card's twin —
    "same UI and same flow as the image path" is the user's own requirement, and
    the image response flattens `confidence`/`text_content`/`brand_colors`/
    `layout_plan` exactly like this.

    There is deliberately NO top-level `reason`. The analyst's sentence
    overwrites `analysis["reason"]`, which is where the image path puts it too
    (`service._apply_reading`), so the card reads one field whichever verdict it
    got and an AI-off deployment needs no special case.
    """

    #: The measured geometry — analysis.FitAnalysis.to_dict(), the same payload
    #: the image path's AnalysisPayload carries, kept as a plain dict here so a
    #: future field in analysis.py needs no change on this side. Carries
    #: `recommendation` and `reason`.
    analysis: dict
    facts: VideoFacts
    #: True when the verdict came from the analyst reading the frames; False
    #: when it is the deterministic geometry verdict (AI off, or the call
    #: failed). The UI badges this so an operator knows what they're reading.
    ai_reviewed: bool
    confidence: Optional[float] = None
    text_content: Optional[list[str]] = None
    brand_colors: Optional[list[str]] = None
    logo_present: bool = False
    motion_note: Optional[str] = None
    layout_plan: Optional[str] = None
    #: How many seconds this ad will actually be on the glass, from the target
    #: screen's slot. Null for a typed W×H target — there is no screen to ask.
    slot_seconds: Optional[float] = None
    #: False when GEMINI_API_KEY is unset — the UI disables the Rebuild button,
    #: exactly as `AnalyzeResponse.rebuild_available` does on the image side.
    rebuild_available: bool = True
    #: False when the bucket isn't configured; the UI disables the Refit button.
    fit_available: bool = True


class VideoUploadSessionRequest(BaseModel):
    """Ask for somewhere to PUT a video. `size_bytes` is the browser's
    `File.size`; it is bound into the GCS session, so a body of any other
    length is refused by GCS itself rather than by a courtesy check here."""

    filename: str
    content_type: str
    size_bytes: int = Field(gt=0)


class VideoUploadSessionResponse(BaseModel):
    #: The GCS resumable session URI. The browser PUTs the file straight here;
    #: the bytes never traverse Cloud Run, which hard-caps request bodies at
    #: 32 MiB.
    upload_url: str
    #: The canonical stored URL of the blob the session writes. This is what
    #: goes back to /video/analyze and /jobs as `source_url`.
    source_url: str
    source_name: str
```

- [ ] **Step 2: Verify.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
poetry run python -c "
from app.creative_fit.video_schemas import (
    VideoReading, VideoFacts, VideoVariantOut,
    VideoAnalyzeRequest, VideoAnalyzeResponse,
    VideoUploadSessionRequest, VideoUploadSessionResponse,
)
print(sorted(VideoReading.model_fields))
print(sorted(VideoFacts.model_fields))
print(sorted(VideoVariantOut.model_fields))
print(sorted(VideoAnalyzeResponse.model_fields))
assert 'reading' not in VideoAnalyzeResponse.model_fields, 'the response is FLAT'
assert 'reason' not in VideoAnalyzeResponse.model_fields, 'reason lives inside analysis'
r = VideoReading(recommendation='resize', reason='ok')
print(r.confidence, r.logo_present, r.text_content)
try:
    VideoAnalyzeRequest(target_width=1080, target_height=1920)
except Exception as exc:
    print('one-of enforced:', 'source_media_id or source_url' in str(exc))
"
# The import must run one-way. This is the order that would deadlock a cycle:
poetry run python -c "import app.creative_fit.video_schemas, app.creative_fit.schemas; print('video_schemas first: OK')"
poetry run python -c "import app.creative_fit.schemas, app.creative_fit.video_schemas; print('schemas first: OK')"
grep -n "from app.creative_fit.schemas" app/creative_fit/video_schemas.py && echo "FAIL: video_schemas must not import schemas" || echo "import direction OK"
```

Expected:

```
['brand_colors', 'confidence', 'layout_plan', 'logo_present', 'motion_note', 'reason', 'recommendation', 'text_content']
['color_inferred', 'duration_seconds', 'fps', 'has_audio', 'height', 'shot_count', 'width']
['duration_seconds', 'height', 'mode', 'url', 'warnings', 'width']
['ai_reviewed', 'analysis', 'brand_colors', 'confidence', 'facts', 'fit_available', 'layout_plan', 'logo_present', 'motion_note', 'rebuild_available', 'slot_seconds', 'text_content']
0.8 False None
one-of enforced: True
video_schemas first: OK
schemas first: OK
import direction OK
```

(The two import-order lines will only both pass once Task 9 has added the bottom import to `schemas.py`; before that they pass trivially. Re-run them at the end of Task 9.)

---

## Task 5: `video_prompts.py`

**Files:**
- CREATE `markai-signage-api/app/creative_fit/video_prompts.py`

**Interfaces:**
- Consumes: `VideoFacts`.
- Produces: `CREATIVE_FIT_VIDEO_ANALYST_PROMPT: str`, `build_video_brief(analysis: dict, facts: VideoFacts, slot_seconds: float | None) -> str`.

- [ ] **Step 1: Write the file — the full prompt text, verbatim.**

Create `markai-signage-api/app/creative_fit/video_prompts.py`:

```python
"""The system prompt for the Creative Fit VIDEO analyst.

A sibling of prompts.py, not an edit to it. One prompt, one job: look at a
handful of stills from a finished ad film and say whether it can be rescaled
onto a differently-shaped panel or has to be laid out again — and, when it has
to be laid out again, hand the renderer a faithful transcription of what is on
screen.

There is no generation prompt here. The video path never asks a model to draw a
frame; `app/video/` re-composes the operator's own pixels with ffmpeg. That is
the whole reason the rules below are stated as hard prohibitions rather than
style guidance: nothing downstream can repaint a mistake away.
"""

from app.creative_fit.video_schemas import VideoFacts

CREATIVE_FIT_VIDEO_ANALYST_PROMPT = """\
You are the Creative Fit Video Analyst for Mark AI, a DOOH (Digital Out-Of-Home)
advertising platform. Physical Android screens in cafés and venues play ad films
fullscreen, on a loop, all day. Every screen has a fixed resolution and
orientation that cannot be changed — the film has to fit the glass, not the
other way round.

Your job: look at a handful of stills taken evenly across ONE finished ad film,
plus the measurements you are given, and report what has to happen for that film
to look professional on ONE target screen.

WHO YOU ARE WRITING FOR
The person reading your `reason` is the advertiser or the venue owner. They are
not a designer and not an engineer. They sent a film that looked fine on their
laptop and they do not understand why the system is asking questions about it.
Explain it the way you would to a smart friend who does not work in tech: name
what will actually go wrong on the screen (words cut off, logo sliced, the
product pushed out of frame, the picture soft), not the arithmetic. Two or three
sentences. No jargon — never say "aspect ratio", "letterbox", "pillarbox",
"downsample" or "keyframe". Say "shape", "black bars", "cropped", "blurry".

THE MEASUREMENTS ARE ALREADY DONE FOR YOU
The message carries the film's real width, height, frame rate, length and shot
count, both orientations, how far apart the two shapes are, and exactly what
percentage of the frame a crop would keep. TRUST THOSE NUMBERS — never recompute
or contradict them, and never guess at a number that is not there. Your value is
judging what those numbers mean FOR THIS PARTICULAR FILM, which is something
measurement alone cannot know.

The stills are samples, not the film. You are seeing roughly six moments out of
hundreds of frames. Say what you can see; do not narrate what you assume happens
between them.

HOW TO DECIDE `recommendation`
Start from the supplied measurement, then adjust for what you can see:

- "resize" — the shapes are close enough that a straight rescale, or trimming an
  edge, costs nothing important. Choose this whenever it is honest: it is fast,
  it is one clean pass, and it loses no quality.
- "rebuild" — a crop would destroy the frame, so the film has to be laid out
  again for the new shape.

Override the measurement toward "rebuild" when the film is fragile:
  * on-screen text, a logo, a price or a call to action sits close to an edge
    that would be cut
  * the composition is wide and horizontal (a long line of type beside a
    product) and the target is tall — that framing cannot survive a crop at any
    percentage
  * the subject moves across the frame, so a fixed centre crop would cut through
    it for part of the film
  * different shots put the important thing in different places, so no single
    crop works for the whole film
Override toward "resize" when the film is forgiving:
  * the important content stays in a safe central area with generous empty
    margin in every sampled still
  * the edges are plain background, sky, texture or gradient with nothing in them

If you recommend "rebuild", say WHICH element gets destroyed. "The price runs
along the bottom edge and would be cut off" beats "significant content loss".

ABSOLUTE RULES — these bind everything you report, and breaking one makes the
output unusable:

1. NEVER LETTERBOX, PILLARBOX, OR ADD BARS. Do not propose black bars, white
   bars, blurred bars, a border, a frame, or the original film placed inside a
   larger canvas. A DOOH panel plays edge to edge, full bleed. A bar is a defect,
   not a fallback. If the only way you can imagine filling the shape is a bar,
   the answer is "rebuild", not a bar.
2. NEVER INVENT CONTENT. Do not propose a new tagline, a new shot, a new
   background, a new colour, a new product, an added logo, an added price, a
   watermark, a caption or a slogan. Everything in the finished ad must already
   exist somewhere in the film you were shown. This film is a commercial and
   legal artefact: the offer, the price, the validity date and the terms line
   are the client's, not yours.
3. NEVER REDRAW THE LOGO. The brand mark is cut from the original footage and
   reused exactly as it is. Do not propose recreating it, restyling it,
   recolouring it, substituting a similar mark, or "cleaning it up". Set
   `logo_present` true when you can see one; describe where it sits and when it
   appears. Do not describe what it should look like instead.
4. PRESERVE ANIMATION TIMING. The film's rhythm is part of the ad. Do not
   propose speeding it up, slowing it down, dropping frames, reordering shots,
   holding on a still, looping a section, or re-timing a transition to make
   something fit. If the film is longer than its slot, say so plainly in
   `reason` and let the renderer trim at a shot boundary — never invent a new
   pace for it.
5. TRANSCRIBE EVERY ON-SCREEN WORD EXACTLY. See below.

TRANSCRIBING (only when you recommend "rebuild")
Whatever you return in `text_content` is the ONLY record of the film's words the
renderer gets. A line you miss is a line that can be erased from the finished ad,
and a client publishes an ad with a missing price on a public screen.

- `text_content`: EVERY piece of text visible in ANY of the stills, transcribed
  character for character, in the order it appears through the film. Exact
  casing, exact punctuation, exact numbers, exact currency symbols. Include the
  small print, the validity date, the terms line, the website, the phone number,
  the app-store badges' words. Do not translate, correct spelling, expand
  abbreviations, deduplicate a line that recurs in a different form, or tidy
  anything up. If a string is genuinely unreadable in the stills you were given,
  omit it rather than guessing.
- `brand_colors`: the 2-5 defining colours as hex, most dominant first.
- `motion_note`: what actually moves — the camera, the subject, or overlays that
  animate in and out — and roughly when. This is what tells the renderer whether
  a fixed crop can work at all.
- `layout_plan`: how to re-stack what is already in the film for the NEW shape.
  Be concrete about vertical order and rough position. For a landscape film going
  portrait, that usually means: brand mark at the top, the footage filling the
  middle band, the headline and offer in the upper or lower third, the call to
  action and small print at the bottom. Say what goes where, and which parts of
  the frame can safely be left out.

When you recommend "resize", leave `text_content`, `brand_colors` and
`layout_plan` null — nothing is being re-laid-out, so nothing needs describing.
Still fill `logo_present` and `motion_note`; both are cheap and both are useful
in the history strip.

TONE
Calm and factual. You are not selling the rebuild — a rebuild costs minutes of
render time and re-composes a client's finished film, so recommend it only when
a rescale genuinely would not do. Never hedge with "it depends" and never ask
the user a question; you get one look at these stills and must commit to an
answer.
"""


def build_video_brief(
    analysis: dict, facts: VideoFacts, slot_seconds: float | None
) -> str:
    """The measured facts, handed to the model so it never re-derives them.

    Mirrors `agent._measurement_brief`: numbers as a labelled block, then one
    closing instruction that points at the attached stills. A dict rather than a
    `FitAnalysis` because the worker already has `measured.to_dict()` in hand and
    round-tripping it through the dataclass buys nothing.
    """
    shot_note = (
        f"{facts.shot_count} shot(s)"
        if facts.shot_count > 0
        else "shot count not measured yet"
    )
    lines = [
        "MEASURED ANALYSIS (these numbers are exact — trust them):",
        f"  Source film     : {facts.width}x{facts.height} "
        f"({analysis.get('source_orientation', 'unknown')})",
        f"  Target screen   : {analysis.get('target_width')}x"
        f"{analysis.get('target_height')} "
        f"({analysis.get('target_orientation', 'unknown')})",
        f"  Length          : {facts.duration_seconds:.2f}s at {facts.fps:.3g} fps, "
        f"{shot_note}",
        f"  Audio           : {'present' if facts.has_audio else 'none'} "
        f"(the panels play silent either way)",
        f"  Shape difference: {float(analysis.get('ratio_shift', 1.0)):.2f}x",
        f"  A crop to fit would KEEP "
        f"{float(analysis.get('content_kept_pct', 100.0)):.0f}% of the frame "
        f"and CUT {float(analysis.get('content_lost_pct', 0.0)):.0f}%.",
        f"  Orientation flips: "
        f"{'YES' if analysis.get('orientation_flipped') else 'no'}",
        f"  Scale change    : "
        f"{float(analysis.get('upscale_factor', 1.0)):.2f}x",
        f"  Geometry alone suggests: {analysis.get('recommendation', 'resize')}",
    ]
    if facts.color_inferred:
        lines.append(
            "  Note: the film declared no colour tags, so they were inferred. "
            "Colours in the stills may be slightly off; do not read a colour "
            "cast as a design choice."
        )
    if analysis.get("warnings"):
        lines.append("  Notes: " + " ".join(analysis["warnings"]))
    if slot_seconds:
        lines.append(
            f"  Airtime on this screen: {slot_seconds:.0f}s per loop. The film is "
            f"{facts.duration_seconds:.1f}s, so it "
            + (
                "fits."
                if facts.duration_seconds <= slot_seconds + 0.01
                else "will be trimmed at a shot boundary — never re-timed."
            )
        )
    lines.append(
        "\nThe attached images are stills sampled evenly across the film, in "
        "order. Look at them and decide whether that suggestion is right for "
        "THIS film."
    )
    return "\n".join(lines)
```

- [ ] **Step 2: Verify the brief renders, with and without a slot.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
poetry run python -c "
from app.creative_fit import analysis as geometry
from app.creative_fit.video_prompts import CREATIVE_FIT_VIDEO_ANALYST_PROMPT, build_video_brief
from app.creative_fit.video_schemas import VideoFacts

for rule in ('NEVER LETTERBOX', 'NEVER INVENT CONTENT', 'NEVER REDRAW THE LOGO',
             'PRESERVE ANIMATION TIMING', 'TRANSCRIBE EVERY ON-SCREEN WORD EXACTLY'):
    assert rule in CREATIVE_FIT_VIDEO_ANALYST_PROMPT, rule
print('all five hard rules present')

facts = VideoFacts(width=1920, height=1080, duration_seconds=15.0, fps=30.0,
                   shot_count=4, has_audio=True, color_inferred=True)
measured = geometry.analyze(1920, 1080, 1080, 1920, size_cap='4K')
print(build_video_brief(measured.to_dict(), facts, 10.0))
print('---')
facts2 = facts.model_copy(update={'shot_count': 0, 'color_inferred': False})
print(build_video_brief(measured.to_dict(), facts2, None))
"
```

Expected: `all five hard rules present`, then a brief naming `1920x1080 (landscape)`, `1080x1920 (portrait)`, `15.00s at 30 fps, 4 shot(s)`, the inferred-colour note, and a line saying the film `will be trimmed at a shot boundary`. The second brief must say `shot count not measured yet` and carry no airtime line.

---

## Task 6: `video_agent.py` — THE ONE AGENT

**Files:**
- CREATE `markai-signage-api/app/creative_fit/video_agent.py`

**Interfaces:**
- Consumes: `settings.ai_enabled`, `settings.CREATIVE_FIT_ANALYST_MODEL`, `settings.AI_MODEL`, `settings.GEMINI_API_KEY`, `CREATIVE_FIT_VIDEO_ANALYST_PROMPT`, `build_video_brief`, `VideoFacts`, `VideoReading`.
- Produces: `get_video_analyst() -> Agent`, `read_video_creative(*, keyframes, analysis, facts, slot_seconds, user_note) -> VideoReading | None`.

> Exactly one model call exists in the whole video path, and it is here. `app/video/blueprint.py` (Plan A) has its own per-shot reads used by the compose tier; this agent is the one the *job layer* makes, and it is the only one Plan B adds.

> **⚠ The model id has TWO different correct forms. Do not "fix" one to match the other.**
> `settings.AI_MODEL` in signage-api is `"google:gemini-2.5-flash"` — a **pydantic-ai** identifier, `provider:model`.
> - **This file uses it verbatim, prefix and all.** `Agent(...)` is pydantic-ai and needs the `google:` prefix to select a provider.
> - **`app/video/blueprint.py` must STRIP the prefix** (Plan A, Task 6 Step 3), because it passes the id to the raw `google-genai` SDK, which knows nothing about `provider:` prefixes and returns 404 for a model called `google:gemini-2.5-flash`.
>
> Both are right in their own file. An implementer who notices the "inconsistency" and unifies them will break whichever one they change. If you touch either, re-read this box.

- [ ] **Step 1: Write the file.**

Create `markai-signage-api/app/creative_fit/video_agent.py`:

```python
"""The Creative Fit VIDEO analyst — the one LLM call the job layer makes.

Structurally identical to agent.py, and deliberately so: a pydantic-ai Agent
with a structured `output_type`, built once and cached, best-effort, and dormant
when GEMINI_API_KEY is absent. What differs is the payload — six JPEG stills
instead of one image — and the output shape, which carries the two things only a
moving picture has: what moves, and whether a brand mark ever appears.

It is a SIBLING of agent.py, not a generalisation of it. The image agent is
frozen; parameterising it to take a list of images is exactly the kind of edit
the freeze exists to prevent.

Best-effort by design: any failure returns None and the deterministic geometry
verdict from analysis.py ships instead. The fast render tiers (stretch/crop)
never need this call at all, so an outage degrades advice, never delivery.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from pydantic_ai import Agent, BinaryContent

from app.core.config import settings
from app.creative_fit.video_prompts import (
    CREATIVE_FIT_VIDEO_ANALYST_PROMPT,
    build_video_brief,
)
from app.creative_fit.video_schemas import VideoFacts, VideoReading

logger = logging.getLogger(__name__)

#: Hard ceiling on stills per call. Six is what `extract_keyframes` produces and
#: what the prompt promises the model; more costs tokens without telling it
#: anything a fifteen-second ad hasn't already said.
MAX_KEYFRAMES = 6

_video_analyst: Optional[Agent] = None


def get_video_analyst() -> Agent:
    """Build (once) the video analyst agent. Requires GEMINI_API_KEY."""
    global _video_analyst
    if _video_analyst is not None:
        return _video_analyst
    if not settings.ai_enabled:
        raise RuntimeError("AI is not configured (GEMINI_API_KEY missing).")
    # Mirror app/ai/tools.py and agent.py: the google provider reads the key
    # from the env, so a key set only in settings/.env still works.
    os.environ.setdefault("GEMINI_API_KEY", settings.GEMINI_API_KEY or "")
    _video_analyst = Agent(
        settings.CREATIVE_FIT_ANALYST_MODEL or settings.AI_MODEL,
        output_type=VideoReading,
        system_prompt=CREATIVE_FIT_VIDEO_ANALYST_PROMPT,
    )
    return _video_analyst


async def read_video_creative(
    *,
    keyframes: list[bytes],
    analysis: dict,
    facts: VideoFacts,
    slot_seconds: float | None,
    user_note: str | None,
) -> VideoReading | None:
    """Run the analyst over one film's stills. None if AI is off or it failed.

    Never raises. A failed call degrades to the deterministic verdict from
    analysis.py rather than blocking the operator, exactly like the image path.
    """
    if not settings.ai_enabled:
        return None
    if not keyframes:
        logger.warning("No keyframes extracted; skipping the video analyst call.")
        return None

    prompt = build_video_brief(analysis, facts, slot_seconds)
    if user_note and user_note.strip():
        prompt += f"\n\nThe operator also said: {user_note.strip()}"

    content: list = [prompt]
    for frame in keyframes[:MAX_KEYFRAMES]:
        content.append(BinaryContent(data=frame, media_type="image/jpeg"))

    try:
        result = await get_video_analyst().run(content)
    except Exception:  # noqa: BLE001 - advice is best-effort by design
        logger.exception(
            "Creative Fit video analyst call failed; using measured verdict."
        )
        return None

    reading = result.output
    # The model is told to answer with one of two words; anything else means it
    # drifted, and geometry is a safer fallback than a guess.
    if reading.recommendation not in ("resize", "rebuild"):
        measured = str(analysis.get("recommendation") or "resize")
        logger.warning(
            "Video analyst returned unknown recommendation %r; falling back to %r.",
            reading.recommendation,
            measured,
        )
        reading.recommendation = "rebuild" if measured == "rebuild" else "resize"
    return reading
```

- [ ] **Step 2: Verify the dormant path — no key, no call, no crash.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
GEMINI_API_KEY= poetry run python -c "
import asyncio, inspect
from app.creative_fit.video_agent import read_video_creative, get_video_analyst
from app.creative_fit.video_schemas import VideoFacts
print(inspect.signature(read_video_creative))
facts = VideoFacts(width=1920, height=1080, duration_seconds=15.0, fps=30.0,
                   shot_count=4, has_audio=False, color_inferred=False)
out = asyncio.run(read_video_creative(
    keyframes=[b'notreallyajpeg'], analysis={'recommendation': 'rebuild'},
    facts=facts, slot_seconds=10.0, user_note=None,
))
print('ai off ->', out)
try:
    get_video_analyst()
except RuntimeError as exc:
    print('get_video_analyst ->', exc)
"
```

Expected:

```
(*, keyframes: list[bytes], analysis: dict, facts: app.creative_fit.video_schemas.VideoFacts, slot_seconds: float | None, user_note: str | None) -> app.creative_fit.video_schemas.VideoReading | None
ai off -> None
get_video_analyst -> AI is not configured (GEMINI_API_KEY missing).
```

- [ ] **Step 3: Live smoke test of the agent.**

> **ASK THE USER FIRST** — this step makes a real Gemini API call.

Once approved, with `GEMINI_API_KEY` set and a real ad film at `/tmp/ad.mp4`:

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run python -c "
import asyncio
from pathlib import Path
from app.creative_fit import analysis as geometry
from app.creative_fit.video_agent import read_video_creative
from app.creative_fit.video_schemas import VideoFacts
from app.creative_fit.video_service import extract_keyframes
from app.video.probe import probe

p = probe(Path('/tmp/ad.mp4'))
frames = extract_keyframes(Path('/tmp/ad.mp4'), 6)
print('frames:', [len(f) for f in frames])
facts = VideoFacts(width=p.width, height=p.height, duration_seconds=p.duration_seconds,
                   fps=p.fps, shot_count=0, has_audio=p.has_audio,
                   color_inferred=p.color_inferred)
measured = geometry.analyze(p.width, p.height, 1080, 1920, size_cap='4K')
r = asyncio.run(read_video_creative(keyframes=frames, analysis=measured.to_dict(),
                                    facts=facts, slot_seconds=10.0, user_note=None))
print(r.model_dump_json(indent=2))
"
```

Expected: six frame sizes in the low tens of kilobytes, then a `VideoReading` whose `recommendation` is `resize` or `rebuild`, whose `reason` contains no jargon, and whose `text_content` (on a rebuild) lists the film's on-screen strings.

---

## Task 7: Streaming GCS helpers and the upload-session flow

**Files:**
- MODIFY `markai-signage-api/app/core/gcs_service.py` — append two functions after `download_bytes_from_gcs` (ends line 328).
- CREATE (started here, finished in Task 8) `markai-signage-api/app/creative_fit/video_service.py`.

**Interfaces:**
- Consumes: `get_gcs_client`, `_ensure_bucket`, `settings.GCP_BUCKET_NAME`, `create_resumable_session` (already exists at `gcs_service.py:272`), `public_url_for_blob`, `settings.allowed_origins`, `settings.CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES`.
- Produces: `download_to_file(blob_name: str, dest: Path) -> bool`, `upload_file_to_gcs(source_path: Path, blob_name: str, content_type: str = "video/mp4") -> str`, `video_service.create_video_upload_session(user_id, payload) -> VideoUploadSessionResponse`.

> **`gcs_service.py` already has a resumable-session helper** — `create_resumable_session(destination_blob_name, content_type, size, origin)` at line 272, minted for the Content library's direct upload. Plan B reuses it as-is; nothing new is needed for the session itself. What is missing is streaming: `download_bytes_from_gcs` and `upload_to_gcs` are both whole-object-in-RAM, and a 500 MB video through either would add 500 MB to an instance that also carries torch.

> **⚠ There is NO commit step, and that is a contract with the CMS.**
> The Content library's upload is a three-beat flow — session → PUT → `POST /content/commit` — and it is tempting to copy that shape here. **Do not.** The video session returns `{upload_url, source_url, source_name}` and the CMS (Plan C) calls `putToUploadSession(upload_url, file, onProgress)` and then goes straight to `POST /video/analyze`. It never calls a commit, because none exists.
>
> What that requires of this task: **the object must be readable at `source_url` the instant the PUT returns.** GCS gives us that for free — a resumable session finalises on the last chunk, so the blob is live at its own path with no further call. The consequence to be aware of is that an abandoned upload leaves an orphan blob under `creative-fit/sources/`, which is exactly what the retention sweep in Task 10 is for. Do not add a commit endpoint to "fix" that; it would break Plan C's uploader, which is already written against this shape.

- [ ] **Step 1: Add the two streaming helpers.**

In `markai-signage-api/app/core/gcs_service.py`, add `import os` and `from pathlib import Path` to the existing imports at the top (lines 3-9), then insert after line 328 (the end of `download_bytes_from_gcs`):

```python


def download_to_file(destination_blob_name: str, dest: Path) -> bool:
    """Stream a blob to a local path. True when it landed, False when missing.

    `download_bytes_from_gcs` holds the whole object in memory, which is right
    for an APK or a still and wrong for a 500 MB video on an instance that also
    carries torch. This streams, so peak memory is the chunk size.

    Written to a sibling `.part` and then `os.replace`d onto the final name.
    os.replace is atomic on one filesystem, so a crash mid-download can never
    leave a truncated file that ffprobe would happily report a wrong duration
    for.
    """
    from google.cloud.exceptions import NotFound

    if not settings.GCP_BUCKET_NAME:
        return False

    client = get_gcs_client()
    blob = client.bucket(settings.GCP_BUCKET_NAME).blob(destination_blob_name)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    try:
        with tmp.open("wb") as handle:
            blob.download_to_file(handle)
    except NotFound:
        tmp.unlink(missing_ok=True)
        return False
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, dest)
    return True


def upload_file_to_gcs(
    source_path: Path,
    destination_blob_name: str,
    content_type: str = "video/mp4",
) -> str:
    """Upload a local file to the bucket and return its canonical stored URL.

    The streaming counterpart of `upload_to_gcs`, for outputs too large to hold
    in memory. Same URL shape, so `extract_blob_name_from_url`, `signed_url_for`
    and the retention sweep all key off it identically.
    """
    if not settings.GCP_BUCKET_NAME:
        raise ValueError("GCP_BUCKET_NAME is not configured in the settings.")

    client = get_gcs_client()
    bucket = _ensure_bucket(client)
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_filename(str(source_path), content_type=content_type)

    url = public_url_for_blob(destination_blob_name)
    logger.info("Successfully uploaded file to GCS: %s", url)
    return url
```

- [ ] **Step 2: Start `video_service.py` with the module docstring and the upload session.**

Create `markai-signage-api/app/creative_fit/video_service.py`:

```python
"""Video Creative Fit orchestration — the video twin of service.py.

A separate module by contract. `service.py` is frozen and image-only by
construction: `_sniff` is Pillow, `_register_media` hardcodes `type="image"` and
`DEFAULT_IMAGE_DURATION_SECONDS`, and `resolve_source` refuses any asset whose
type is not "image". Where video needs the same idea it is written again here.

Four things are load-bearing and easy to get wrong:

* **The event loop is shared with the whole API.** The worker pool runs inside
  the uvicorn process (see worker.py). A video fit is minutes of ffmpeg and, on
  the compose tier, minutes of LaMa on CPU. Every heavy call goes through
  `run_in_threadpool`; anything inline stalls fleet-wide screen heartbeats.
* **Nothing downloads a source to measure it.** `_probe_source` runs ffprobe
  against the SIGNED URL, which reads the container header over HTTP range
  requests. A 500 MB master costs about a megabyte to measure, so both
  `/video/analyze` and job creation stay sub-second request handlers. Only the
  worker, which actually renders, pulls the whole file down.
* **`source_width`/`source_height` are NOT NULL** (models.py:73-74), so the
  probe runs BEFORE the insert — and its numbers win over anything the client
  sent.
* **`/tmp` is RAM on Cloud Run.** `VIDEO_WORK_DIR` lives there, so every job
  removes both its download directory and the pipeline's content-hash directory
  in a `finally`, or a handful of fits OOMs the instance.

Module map for the video half of this package:

    video_schemas.py   request/response shapes
    video_prompts.py   the video analyst's system prompt + the measured brief
    video_agent.py     the one structured LLM call
    video_service.py   this file — sessions, probing, the job, the result
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.content.models import MediaAsset
from app.core.config import settings
from app.core.gcs_service import (
    create_resumable_session,
    delete_from_gcs,
    download_to_file,
    get_blob_metadata,
    public_url_for_blob,
    signed_url_for,
    upload_file_to_gcs,
)
from app.creative_fit import analysis as geometry
from app.creative_fit import service
from app.creative_fit.models import (
    MEDIA_KIND_VIDEO,
    MODE_RESIZE,
    STATUS_RUNNING,
    CreativeFitJob,
)
from app.creative_fit.schemas import CreateJobRequest, JobResponse
from app.creative_fit.video_agent import read_video_creative
from app.creative_fit.video_schemas import (
    VideoAnalyzeRequest,
    VideoAnalyzeResponse,
    VideoFacts,
    VideoUploadSessionRequest,
    VideoUploadSessionResponse,
    VideoVariantOut,
)
from app.screens.models import Screen

logger = logging.getLogger(__name__)

# Reused deliberately, NOT re-implemented. `_finish_if_still_running` is the
# conditional write that stops a finished job overwriting a cancel; two
# divergent copies of that guard is precisely how a stopped job starts
# delivering results again. Importing is a read — the freeze forbids editing.
from app.creative_fit.service import (  # noqa: E402  (grouped with its rationale)
    RESULT_PREFIX,
    SOURCE_PREFIX,
    JobCancelled,
    _blob_name_for,
    _check_cancelled,
    _finish_if_still_running,
)

#: Video sources and results share the IMAGE prefixes on purpose — see the
#: retention note in this module's `execute_video_job` and Task 10 of the plan.
#: `service.cleanup_expired_fits` gates deletion on exactly these two strings,
#: and it is a frozen function.
VIDEO_SOURCE_PREFIX = SOURCE_PREFIX
VIDEO_RESULT_PREFIX = RESULT_PREFIX

#: Container extensions the pipeline can open. Mirrors markai-creative-fit's
#: `video_router.ALLOWED_SUFFIXES`.
_VIDEO_EXTENSIONS = {"mp4", "mov", "m4v", "webm", "mkv", "avi"}

#: One still is a seek plus a single frame decode; over HTTP it is a couple of
#: range requests. A minute is generous and still far below the pipeline's own
#: FFMPEG_TIMEOUT_SECONDS, so a stalled probe fails fast instead of pinning a
#: threadpool worker for the full render budget.
_KEYFRAME_TIMEOUT_SECONDS = 60


def _safe_extension(filename: str) -> str:
    """A safe container extension. The blob path is server-generated but the
    extension is caller-supplied, so strip anything that isn't alphanumeric."""
    raw = filename.rsplit(".", 1)[-1] if "." in filename else ""
    ext = re.sub(r"[^a-z0-9]", "", raw.lower())[:8]
    return ext if ext in _VIDEO_EXTENSIONS else "mp4"


async def create_video_upload_session(
    user_id: str, payload: VideoUploadSessionRequest
) -> VideoUploadSessionResponse:
    """Open a direct-to-GCS resumable session for one video source.

    Required, not an optimisation: Cloud Run's frontend hard-caps HTTP/1 request
    bodies at 32 MiB and returns an HTML 413 before FastAPI ever runs, so the
    image path's `POST /upload` (which proxies bytes) can never carry a 500 MB
    video and no in-app check could produce a friendly error if it tried.

    The blob path is server-generated and namespaced by user, and the declared
    size is bound into the session, so GCS itself refuses a body of any other
    length. `source_url` comes back to us on the next call; nothing about the
    object is taken from the client.
    """
    if not settings.gcs_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Cloud Storage is not configured. Set GCP_BUCKET_NAME "
            "in the backend .env.",
        )
    if not payload.content_type.startswith("video/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"{payload.content_type} is not a video.",
        )
    if payload.size_bytes > settings.CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES:
        limit_mb = settings.CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"That video is larger than the {limit_mb}MB limit.",
        )

    ext = _safe_extension(payload.filename or "")
    blob_name = f"{VIDEO_SOURCE_PREFIX}/{user_id}/{uuid.uuid4()}.{ext}"

    # Lets GCS return the CORS headers the browser's PUT needs. Requires the
    # bucket CORS config already applied for the Content library:
    #   gcloud storage buckets update gs://markai-storage --cors-file=gcs-cors.json
    origins = settings.allowed_origins
    origin = origins[0] if origins else None

    try:
        upload_url = await run_in_threadpool(
            create_resumable_session,
            blob_name,
            payload.content_type,
            payload.size_bytes,
            origin,
        )
    except Exception as exc:
        logger.exception(
            "Failed to open a GCS upload session for %s", payload.filename
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not start upload: {exc}",
        ) from exc

    return VideoUploadSessionResponse(
        upload_url=upload_url,
        source_url=public_url_for_blob(blob_name),
        source_name=(payload.filename or "creative")[:255],
    )
```

- [ ] **Step 3: Verify the helpers import and the session validates.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
poetry run python -c "
import asyncio, inspect
from app.core.gcs_service import download_to_file, upload_file_to_gcs, create_resumable_session
print(inspect.signature(download_to_file))
print(inspect.signature(upload_file_to_gcs))
print(inspect.signature(create_resumable_session))
from app.creative_fit.video_service import _safe_extension, create_video_upload_session
from app.creative_fit.video_schemas import VideoUploadSessionRequest
print([_safe_extension(n) for n in ('a.MP4','b.mov','c.exe','d','e.mkv','f.tar.gz')])
from fastapi import HTTPException
try:
    asyncio.run(create_video_upload_session('u1', VideoUploadSessionRequest(
        filename='big.mp4', content_type='video/mp4', size_bytes=600*1024*1024)))
except HTTPException as exc:
    print(exc.status_code, exc.detail)
"
```

Expected:

```
(destination_blob_name: str, dest: pathlib.Path) -> bool
(source_path: pathlib.Path, destination_blob_name: str, content_type: str = 'video/mp4') -> str
(destination_blob_name: str, content_type: str, size: int, origin: Optional[str] = None) -> str
['mp4', 'mov', 'mp4', 'mp4', 'mkv', 'mp4']
413 That video is larger than the 500MB limit.
```

---

## Task 8: `video_service.py` — probing, keyframes, the job, the result

**Files:**
- MODIFY `markai-signage-api/app/creative_fit/video_service.py` — append everything below `create_video_upload_session`.

**Interfaces:**
- Consumes: `app.video.probe.probe`, `app.video.ffmpeg.run/run_probe`, `app.video.shots.detect`, `app.video.pipeline.fit_video`, `service.resolve_target`, `service._check_cancelled`, `service._finish_if_still_running`, `service._blob_name_for`, `geometry.analyze`, `read_video_creative`.
- Produces: `extract_keyframes(path, count=6) -> list[bytes]`, `analyze_video(db, user, payload) -> VideoAnalyzeResponse`, `create_video_job(db, user, req) -> CreativeFitJob`, `execute_video_job(db, job) -> None`, `save_video_result(db, user, job, name) -> MediaAsset`, `to_video_response(job) -> JobResponse`.

- [ ] **Step 1: Add the remote-source shim, the probe wrappers and `extract_keyframes`.**

Append to `video_service.py`:

```python


class _RemoteSource:
    """Duck-types the two `Path` attributes `app.video.probe.probe` actually uses.

    `probe()` only ever does `str(path)` (into the ffprobe args) and
    `path.name` (into its error messages). Handing it a signed HTTPS URL through
    this shim is what lets `/video/analyze` and job creation measure a 500 MB
    master without downloading it: ffprobe reads the container header over HTTP
    range requests, which is roughly a megabyte.

    The coupling is real and narrow. Pin it with:
        grep -n 'path\\.' app/video/probe.py
    which must show `path.name` and nothing else. If Plan A's probe ever reaches
    for `path.exists()` or `path.stat()`, this shim grows those two lines — it
    does not become a download.
    """

    __slots__ = ("_url", "name")

    def __init__(self, url: str) -> None:
        self._url = url
        # Strip the query string first — a signed URL's name is everything up
        # to the '?', or the whole thing is unreadable in a log line.
        self.name = url.split("?", 1)[0].rsplit("/", 1)[-1] or "source"

    def __str__(self) -> str:
        return self._url

    def __fspath__(self) -> str:
        return self._url


def _probe_source(url_or_path) -> "object":
    """ffprobe -> VideoProbe, for a local path OR a signed HTTPS URL."""
    from app.video.probe import probe

    return probe(url_or_path)


def _duration_of(path) -> float:
    """Just the duration, in one small ffprobe call.

    `extract_keyframes` needs the length to space its samples, and a full
    `probe()` here would repeat the colour heuristic and the second audio-stream
    probe for a number we could ask for directly.
    """
    from app.video import ffmpeg

    raw = ffmpeg.run_probe(
        [
            "-select_streams", "v:0",
            "-show_entries", "stream=duration",
            "-show_entries", "format=duration",
            "-of", "json", str(path),
        ],
        timeout=_KEYFRAME_TIMEOUT_SECONDS,
    )
    parsed = json.loads(raw)
    streams = parsed.get("streams") or [{}]
    value = streams[0].get("duration") or parsed.get("format", {}).get("duration")
    return float(value or 0.0)


def extract_keyframes(path: Path, count: int = 6) -> list[bytes]:
    """`count` evenly spaced JPEG stills, downscaled for the model.

    Blocking and subprocess-bound — always call it through `run_in_threadpool`.

    `path` is stringified straight into the ffmpeg args, so a signed HTTPS URL
    works here exactly as a local file does (see `_RemoteSource`).

    Samples are inset by half a step rather than taken at 0, d/5, 2d/5 ... so a
    fade-in black frame and a fade-out black frame do not eat two of the six
    stills the analyst gets — on a 15s ad that is a third of everything it sees.
    `-ss` precedes `-i` on purpose: input seeking, so ffmpeg jumps to the
    keyframe rather than decoding from the top for every sample.
    """
    from app.video import ffmpeg

    count = max(1, min(int(count), 6))
    duration = _duration_of(path)
    if duration <= 0:
        raise ValueError("Could not read a duration from the source video.")

    step = duration / count
    frames: list[bytes] = []
    for index in range(count):
        at = max(0.0, min(duration - 0.05, step * (index + 0.5)))
        raw = ffmpeg.run(
            [
                "-ss", f"{at:.3f}",
                "-i", str(path),
                "-frames:v", "1",
                "-vf", f"scale={settings.VIDEO_ANALYSIS_WIDTH}:-2",
                "-f", "image2",
                "-c:v", "mjpeg",
                "-q:v", "3",
                "-",
            ],
            timeout=_KEYFRAME_TIMEOUT_SECONDS,
        )
        if raw:
            frames.append(raw)

    if not frames:
        raise ValueError("ffmpeg returned no frames from the source video.")
    return frames


def _count_shots(path: Path, probe_data) -> int:
    """How many cuts the film has. One scdet pass over a local file.

    Only ever called by the worker, never by a request handler: this decodes the
    whole clip, and over HTTP that is the entire file's egress.
    """
    from app.video import shots as shots_module

    try:
        found = shots_module.detect(
            path, probe_data.duration_seconds, probe_data.fps
        )
    except Exception:  # noqa: BLE001 - a shot count is context, never a blocker
        logger.warning("Shot detection failed for %s", path.name, exc_info=True)
        return 0
    return len(found)


def _facts_from(probe_data, shot_count: int) -> VideoFacts:
    return VideoFacts(
        width=probe_data.width,
        height=probe_data.height,
        duration_seconds=float(probe_data.duration_seconds),
        fps=float(probe_data.fps),
        shot_count=shot_count,
        has_audio=bool(probe_data.has_audio),
        color_inferred=bool(probe_data.color_inferred),
    )


def _assert_within_limits(probe_data) -> None:
    """Refuse a source the pipeline cannot serve, with a sentence an operator can act on."""
    if probe_data.width <= 0 or probe_data.height <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That file has no readable video stream.",
        )
    if probe_data.duration_seconds > settings.VIDEO_MAX_DURATION_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"That film is {probe_data.duration_seconds:.0f}s. Creative Fit "
                f"handles up to {settings.VIDEO_MAX_DURATION_SECONDS}s — trim it "
                "and try again."
            ),
        )


#: The only two fit modes a video job accepts. `contain` is absent on purpose:
#: it scales the film down until it fits and fills the remainder with a
#: backdrop, which is letterboxing. The user ruled bars out on the video path in
#: as many words — "I don't want to create a white space" — so the API refuses
#: rather than quietly ignoring the field. The CMS cannot construct one either
#: (`VideoResizeOptions` narrows the union), so a `contain` reaching here means
#: a hand-written request, and a 422 is the honest answer to it.
VIDEO_FIT_MODES = ("cover", "stretch")


def _assert_video_fit_mode(req) -> None:
    """Refuse a fit mode that would put bars on the panel."""
    if req.fit_mode is None:
        return
    if req.fit_mode not in VIDEO_FIT_MODES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "A video is never letterboxed, so 'fit whole ad' isn't "
                "available here. Use 'crop to fill' to fill the panel, or "
                "Rebuild with AI to reshape the film for it."
            ),
        )
```

- [ ] **Step 2: Add source/target resolution.**

Append:

```python


async def _resolve_video_source(
    db: AsyncSession, user, req
) -> tuple[str, str, Optional[str]]:
    """(source_url, source_name, source_media_id). Reads no bytes.

    The image path's `resolve_source` downloads and sniffs here; for video that
    would mean pulling half a gigabyte into a request handler to learn a width.
    The probe happens once, over HTTP, in the caller.
    """
    if req.source_media_id:
        from app.content.service import assert_media_visible

        # Raises 404 for a screenowner reaching outside their own scope.
        await assert_media_visible(db, user, req.source_media_id)
        asset = (
            await db.execute(
                select(MediaAsset).where(MediaAsset.id == req.source_media_id)
            )
        ).scalar_one_or_none()
        if asset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Creative not found."
            )
        if asset.type != "video":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="That creative is an image. Use the Image tab to refit it.",
            )
        return asset.file_url, (asset.name or "creative")[:255], asset.id

    url = (req.source_url or "").strip()
    blob_name = _blob_name_for(url)
    # Unlike the image path there is no proxied upload for video, so every
    # legitimate raw source_url is a blob this server minted for THIS user in
    # `create_video_upload_session`. Anything else is either a typo or someone
    # pointing the renderer at another operator's in-flight upload.
    if not blob_name or not blob_name.startswith(
        f"{VIDEO_SOURCE_PREFIX}/{user.id}/"
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload the video through /video/upload-session first, or pick "
            "one from the Content library.",
        )
    return url, (req.source_name or "creative")[:255], None


async def _slot_seconds_for(
    db: AsyncSession, screen_id: Optional[str]
) -> Optional[float]:
    """The airtime this ad will get, from the target screen's default slot.

    Reads `screens.slot_duration_seconds` directly rather than going through
    `app/screens/slots.py`: the grid's per-position lengths are only knowable
    once a booking claims a position, and Creative Fit runs long before that.
    The default slot length is the honest answer to "how long will this be on
    the glass" at fit time, and it is what `pipeline.fit_video` trims to.
    """
    if not screen_id:
        return None
    value = (
        await db.execute(
            select(Screen.slot_duration_seconds).where(Screen.id == screen_id)
        )
    ).scalar_one_or_none()
    return float(value) if value else None
```

- [ ] **Step 3: Add `analyze_video`.**

Append:

```python


def _apply_video_reading(measured, reading) -> None:
    """Let the analyst override the measured recommendation and reason, in place.

    A duplicate of `service._apply_reading` (service.py:341-362) because that one
    is typed to `CreativeReading` and lives in a frozen module. Same contract:
    geometry decides the band, the film decides the verdict, and a "rescale"
    (identical shapes) that the analyst downgrades to "resize" keeps the
    friendlier label because nothing is being cut.

    Writing `reason` onto `measured` rather than returning it separately is what
    keeps `VideoAnalyzeResponse` flat with no top-level `reason` — the card reads
    `analysis.reason` whether the sentence came from the model or from geometry.
    """
    if reading is None:
        return
    measured.recommendation = (
        "rebuild" if reading.recommendation == "rebuild" else "resize"
    )
    if measured.band == "identical" and measured.recommendation == "resize":
        measured.recommendation = "rescale"
    if reading.reason:
        measured.reason = reading.reason.strip()


async def analyze_video(
    db: AsyncSession, user, payload: VideoAnalyzeRequest
) -> VideoAnalyzeResponse:
    """Measure the fit and, when AI is on, have the analyst read the film.

    Deliberately cheap: one ffprobe and six single-frame decodes, all against
    the signed URL. Nothing is downloaded and no job is created.
    """
    source_url, _source_name, _media_id = await _resolve_video_source(db, user, payload)
    target_w, target_h, screen_id = await service.resolve_target(db, user, payload)

    signed = signed_url_for(source_url) or source_url
    probe_data = await run_in_threadpool(_probe_source, _RemoteSource(signed))
    _assert_within_limits(probe_data)

    measured = geometry.analyze(
        probe_data.width,
        probe_data.height,
        target_w,
        target_h,
        size_cap=settings.CREATIVE_FIT_MAX_SIZE,
    )
    # shot_count stays 0 here on purpose — segmenting is a full decode pass and
    # this is a synchronous request handler reading a remote file. The worker,
    # which has the file on local disk, fills in the real number.
    facts = _facts_from(probe_data, shot_count=0)
    slot_seconds = await _slot_seconds_for(db, screen_id)

    frames: list[bytes] = []
    if settings.ai_enabled:
        try:
            frames = await run_in_threadpool(
                extract_keyframes, _RemoteSource(signed), 6
            )
        except Exception:  # noqa: BLE001 - the geometry verdict still ships
            logger.warning("Keyframe extraction failed for %s", facts, exc_info=True)

    reading = await read_video_creative(
        keyframes=frames,
        analysis=measured.to_dict(),
        facts=facts,
        slot_seconds=slot_seconds,
        user_note=payload.user_note,
    )
    _apply_video_reading(measured, reading)

    # FLAT, mirroring service.analyze -> AnalyzeResponse. `reason` is NOT a
    # top-level field: `_apply_video_reading` has already written the analyst's
    # sentence into `measured.reason`, so it ships inside `analysis` and the
    # verdict card reads one field whichever verdict it got.
    return VideoAnalyzeResponse(
        analysis=measured.to_dict(),
        facts=facts,
        ai_reviewed=reading is not None,
        confidence=reading.confidence if reading else None,
        text_content=reading.text_content if reading else None,
        brand_colors=reading.brand_colors if reading else None,
        logo_present=reading.logo_present if reading else False,
        motion_note=reading.motion_note if reading else None,
        layout_plan=reading.layout_plan if reading else None,
        slot_seconds=slot_seconds,
        rebuild_available=settings.ai_enabled,
        fit_available=settings.gcs_configured,
    )
```

- [ ] **Step 4: Add `create_video_job` and the progress helper.**

Append:

```python


async def create_video_job(
    db: AsyncSession, user, req: CreateJobRequest
) -> CreativeFitJob:
    """Validate a video request and queue it for the video lane.

    Probes the source before inserting, because `source_width`/`source_height`
    are NOT NULL and because a client-supplied dimension is exactly the number
    the renderer must not be wrong about. The probe is one ffprobe over HTTP
    range requests, so this stays a sub-second handler even for a 500 MB master.
    """
    source_url, source_name, media_id = await _resolve_video_source(db, user, req)
    target_w, target_h, screen_id = await service.resolve_target(db, user, req)

    signed = signed_url_for(source_url) or source_url
    probe_data = await run_in_threadpool(_probe_source, _RemoteSource(signed))
    _assert_within_limits(probe_data)

    _assert_video_fit_mode(req)

    job = CreativeFitJob(
        cms_user_id=user.id,
        media_kind=MEDIA_KIND_VIDEO,
        source_media_id=media_id,
        source_url=source_url,
        source_name=source_name,
        # The probe's numbers, never the request's.
        source_width=probe_data.width,
        source_height=probe_data.height,
        target_screen_id=screen_id,
        target_width=target_w,
        target_height=target_h,
        # `mode` is the JOB kind (resize vs AI rebuild), not the render tier.
        # The renderer still picks its own tier per target — stretch | crop |
        # reframe | compose — from the shape gap, and the tier that actually ran
        # lands in analysis["executed_mode"].
        mode=req.mode,
        # The operator's two knobs, and the ONLY two the video path accepts.
        # `cover` means "you choose the tier"; `stretch` pins the stretch tier.
        # `anchor` positions the crop when a tier crops. `pad_fill`/`pad_color`
        # are never read for video and are deliberately not persisted — there
        # are no bars to fill.
        fit_mode=req.fit_mode,
        anchor=req.anchor,
        user_note=req.user_note,
        analysis={
            "auto_save": bool(req.auto_save),
            "media_kind": MEDIA_KIND_VIDEO,
            "stage": "queued",
            "progress": 0,
        },
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def _set_stage(
    job_id: str, analysis: dict, stage: str, progress: int
) -> dict:
    """Publish coarse progress for the polling CMS. Returns the new payload.

    Two rules, both learned from `service.execute_job`:

    * **Its own short-lived session**, like `service._check_cancelled`. A write
      on the worker's `db` would open a transaction that then stays open across
      a fifteen-minute render, pinning a connection idle-in-transaction and
      blocking vacuum to record a progress bar.
    * **It never assigns to the ORM object.** Dirtying `job.analysis` in the
      worker's identity map means the next autoflush writes it out as a plain
      UPDATE with no status guard, which is the exact mechanism by which a
      cancelled job comes back to life. The payload is a local dict, threaded
      through the caller, and lands on the row only via the guarded statements.
    """
    from app.core.database import AsyncSessionLocal

    payload = {**analysis, "stage": stage, "progress": int(progress)}
    async with AsyncSessionLocal() as probe:
        await probe.execute(
            update(CreativeFitJob)
            .where(
                CreativeFitJob.id == job_id,
                CreativeFitJob.status == STATUS_RUNNING,
            )
            .values(analysis=payload)
            .execution_options(synchronize_session=False)
        )
        await probe.commit()
    return payload
```

- [ ] **Step 5: Add `execute_video_job` — the worker's entry point.**

Append:

```python


async def _fetch_source(url: str, dest: Path) -> None:
    """Stream the source to local disk, refusing anything over the cap first."""
    blob_name = _blob_name_for(url)
    if blob_name:
        meta = await run_in_threadpool(get_blob_metadata, blob_name)
        if meta is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="The source video is no longer in storage.",
            )
        if int(meta["size"] or 0) > settings.CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES:
            limit_mb = settings.CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES // (1024 * 1024)
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"That video is larger than the {limit_mb}MB limit.",
            )
        landed = await run_in_threadpool(download_to_file, blob_name, dest)
        if landed:
            return
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The source video could not be read from storage.",
        )

    # Not our bucket: a legacy Cloudinary asset picked from the Content library.
    # `_resolve_video_source` only allows that path via source_media_id, so this
    # is a library creative, not a client-supplied URL.
    landed = await run_in_threadpool(_http_download_to_file, url, dest)
    if not landed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The source video could not be fetched.",
        )


def _http_download_to_file(url: str, dest: Path) -> bool:
    """Stream an http(s) URL to disk, capped. Blocking — threadpool only."""
    import urllib.request
    from urllib.parse import urlparse

    if urlparse(url).scheme not in ("http", "https"):
        return False
    cap = settings.CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES
    request = urllib.request.Request(url, headers={"User-Agent": "markai-creative-fit"})
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    written = 0
    try:
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            with tmp.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > cap:
                        raise ValueError("source exceeds the video size limit")
                    handle.write(chunk)
    except Exception as exc:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        logger.warning("Video fetch failed for %s: %s", url[:120], exc)
        return False
    tmp.replace(dest)
    return True


def _fit_video_sync(
    data: bytes, width: int, height: int, slot_seconds: Optional[float]
):
    """The one call into Plan A's pipeline. Blocking — threadpool only."""
    from app.video import pipeline as video_pipeline

    return video_pipeline.fit_video(
        data, [(width, height)], force=False, slot_seconds=slot_seconds
    )


def _purge(*paths: Path) -> None:
    """Remove a job's scratch directories. Never raises."""
    for path in paths:
        try:
            shutil.rmtree(path, ignore_errors=True)
        except Exception:  # noqa: BLE001 - cleanup must never fail a job
            logger.warning("[creative-fit] could not purge %s", path)


async def execute_video_job(db: AsyncSession, job: CreativeFitJob) -> None:
    """Do the work for one claimed VIDEO job and record the outcome.

    Called only by the video lane of the worker pool. Cancellation is
    cooperative and uses the image path's own primitives, so the two lanes stop
    identically: every stage boundary asks whether the operator stopped us, and
    the final write refuses to overwrite a cancel.
    """
    analysis: dict = dict(job.analysis or {})
    auto_save = bool(analysis.get("auto_save"))
    job_dir = Path(settings.VIDEO_WORK_DIR) / f"job-{job.id}"
    creative_dir: Optional[Path] = None

    try:
        await _check_cancelled(db, job)
        analysis = await _set_stage(job.id, analysis, "downloading", 5)

        source_path = job_dir / "source.bin"  # ffmpeg sniffs; the name is cosmetic
        await _fetch_source(job.source_url, source_path)

        await _check_cancelled(db, job)
        analysis = await _set_stage(job.id, analysis, "probing", 12)
        probe_data = await run_in_threadpool(_probe_source, source_path)
        _assert_within_limits(probe_data)

        analysis = await _set_stage(job.id, analysis, "segmenting", 20)
        shot_count = await run_in_threadpool(_count_shots, source_path, probe_data)

        await _check_cancelled(db, job)
        analysis = await _set_stage(job.id, analysis, "reading", 28)
        # Re-measure from the real file rather than the row: the stored
        # dimensions came from a probe of the remote header, and a source that
        # was replaced in the bucket between queueing and claiming would
        # otherwise be rendered against stale geometry.
        measured = geometry.analyze(
            probe_data.width,
            probe_data.height,
            job.target_width,
            job.target_height,
            size_cap=settings.CREATIVE_FIT_MAX_SIZE,
        )
        facts = _facts_from(probe_data, shot_count)
        slot_seconds = await _slot_seconds_for(db, job.target_screen_id)

        frames: list[bytes] = []
        if settings.ai_enabled:
            try:
                frames = await run_in_threadpool(extract_keyframes, source_path, 6)
            except Exception:  # noqa: BLE001 - the render does not need the read
                logger.warning(
                    "[creative-fit] keyframe extraction failed for %s",
                    job.id, exc_info=True,
                )
        reading = await read_video_creative(
            keyframes=frames,
            analysis=measured.to_dict(),
            facts=facts,
            slot_seconds=slot_seconds,
            user_note=job.user_note,
        )
        # Same override the analyze route applies, so the stored analysis carries
        # the analyst's sentence and the history strip re-renders the verdict
        # card without re-running the model.
        _apply_video_reading(measured, reading)

        # The analyst read is seconds; the render behind it is minutes. Checking
        # here is the difference between a stopped job costing one small call
        # and costing a full compose pass.
        await _check_cancelled(db, job)
        analysis = await _set_stage(job.id, analysis, "rendering", 40)

        data = await run_in_threadpool(source_path.read_bytes)
        try:
            creative_id, _rendered_probe, variants, failures = await run_in_threadpool(
                _fit_video_sync,
                data,
                job.target_width,
                job.target_height,
                slot_seconds,
            )
        finally:
            # `fit_video` is bytes-in by design (Plan A), so the file is briefly
            # resident twice — once on disk, once here. Drop the reference the
            # moment the call returns rather than holding it across the upload.
            del data
        creative_dir = Path(settings.VIDEO_WORK_DIR) / creative_id

        if not variants:
            reason = failures[0][1] if failures else "the renderer produced no output"
            raise RuntimeError(f"Could not refit this video: {reason}")
        variant = variants[0]

        await _check_cancelled(db, job)
        analysis = await _set_stage(job.id, analysis, "uploading", 85)

        variant_path = Path(variant.path)
        result_bytes = variant_path.stat().st_size
        blob_name = f"{VIDEO_RESULT_PREFIX}/{job.cms_user_id}/{job.id}.mp4"
        result_url = await run_in_threadpool(
            upload_file_to_gcs, variant_path, blob_name, "video/mp4"
        )

        duration_seconds = float(
            variant.duration_seconds or probe_data.duration_seconds
        )

        # Deliberately NOT assigning to `job` — see service.execute_job's own
        # note. Locals, then one conditional write.
        result_media_id = job.result_media_id
        if auto_save:
            media = await _register_video_media(
                db, job, result_url=result_url, duration_seconds=duration_seconds
            )
            result_media_id = media.id

        finished = await _finish_if_still_running(
            db,
            job,
            result_url=result_url,
            result_bytes=result_bytes,
            analysis={
                **analysis,
                **measured.to_dict(),
                "media_kind": MEDIA_KIND_VIDEO,
                "executed_mode": variant.mode,
                "stage": "done",
                "progress": 100,
                "facts": facts.model_dump(),
                "reading": reading.model_dump() if reading else None,
                "variants": [
                    VideoVariantOut(
                        width=variant.width,
                        height=variant.height,
                        mode=variant.mode,
                        url=result_url,
                        duration_seconds=duration_seconds,
                        warnings=list(variant.warnings),
                    ).model_dump()
                ],
            },
            rebuild_prompt=None,
            result_media_id=result_media_id,
        )
        if not finished:
            # Cancelled between the last checkpoint and the write. The rollback
            # inside `_finish_if_still_running` already dropped the auto-saved
            # MediaAsset; the blob is all that's left, and nothing will ever
            # reference it.
            try:
                await run_in_threadpool(delete_from_gcs, blob_name)
            except Exception:  # noqa: BLE001 - an orphan blob is not worth failing on
                logger.warning("[creative-fit] orphan video result blob %s", blob_name)
            raise JobCancelled(job.id)
    finally:
        # /tmp is RAM on Cloud Run. The pipeline's content-hash cache would let
        # a second target for the same film skip probe + blueprint + plate, but
        # that cache does not survive an instance anyway, and a 500 MB source
        # plus its mezzanine plate sitting in tmpfs is how the instance dies.
        # Both directories go, every time.
        await run_in_threadpool(
            _purge, *(p for p in (job_dir, creative_dir) if p is not None)
        )
```

- [ ] **Step 6: Add the video MediaAsset registration, save, and the response serializer.**

Append:

```python


async def _register_video_media(
    db: AsyncSession,
    job: CreativeFitJob,
    *,
    result_url: str,
    duration_seconds: float,
    name: Optional[str] = None,
) -> MediaAsset:
    """Put a finished video fit into the Content library so it can be booked.

    A separate function from `service._register_media` because that one is
    frozen AND wrong for video twice over: it hardcodes `type="image"` and it
    stamps `DEFAULT_IMAGE_DURATION_SECONDS` (5), which would tell the scheduler
    a 15-second film is 5 seconds long.

    `duration_seconds` is the REAL rendered length, from the variant sidecar.
    `checksum` stays null: hashing means reading the whole file back, and the
    direct-upload path already leaves it null for videos.
    """
    label = (
        name
        or f"{job.source_name or 'Creative'} — {job.target_width}×{job.target_height}"
    )
    media = MediaAsset(
        name=label[:255],
        type="video",
        file_url=result_url,
        duration_seconds=max(1, int(round(duration_seconds))),
        width=job.target_width,
        height=job.target_height,
        checksum=None,
        uploaded_by=job.cms_user_id,
    )
    db.add(media)
    await db.flush()
    return media


async def save_video_result(
    db: AsyncSession, user, job: CreativeFitJob, name: Optional[str]
) -> MediaAsset:
    """Promote a reviewed video result into the Content library (idempotent)."""
    from app.creative_fit.models import STATUS_DONE

    if job.status != STATUS_DONE or not job.result_url:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This fit hasn't finished yet.",
        )
    if job.result_media_id:
        existing = (
            await db.execute(
                select(MediaAsset).where(MediaAsset.id == job.result_media_id)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing

    payload = job.analysis or {}
    variants = payload.get("variants") or []
    duration = float(
        (variants[0].get("duration_seconds") if variants else None)
        or (payload.get("facts") or {}).get("duration_seconds")
        or 0.0
    )
    media = await _register_video_media(
        db, job, result_url=job.result_url, duration_seconds=duration, name=name
    )
    job.result_media_id = media.id
    await db.commit()
    await db.refresh(media)
    return media


def to_video_response(job: CreativeFitJob) -> JobResponse:
    """Serialize a video job, signing every stored URL the browser will load."""
    payload = job.analysis or {}
    facts = payload.get("facts") or {}
    raw_variants = payload.get("variants") or []
    variants = [
        VideoVariantOut(
            **{**item, "url": signed_url_for(item.get("url")) or ""}
        )
        for item in raw_variants
        if isinstance(item, dict)
    ]
    return JobResponse(
        id=job.id,
        status=job.status,
        mode=job.mode,
        media_kind=job.media_kind,
        source_url=signed_url_for(job.source_url),
        source_name=job.source_name,
        source_media_id=job.source_media_id,
        source_width=job.source_width,
        source_height=job.source_height,
        target_screen_id=job.target_screen_id,
        target_width=job.target_width,
        target_height=job.target_height,
        fit_mode=job.fit_mode,
        anchor=job.anchor,
        pad_fill=job.pad_fill,
        pad_color=job.pad_color,
        user_note=job.user_note,
        attempts=job.attempts,
        error=job.error,
        analysis=job.analysis,
        rebuild_prompt=job.rebuild_prompt,
        result_url=signed_url_for(job.result_url),
        result_media_id=job.result_media_id,
        result_width=job.result_width,
        result_height=job.result_height,
        result_bytes=job.result_bytes,
        created_at=job.created_at,
        finished_at=job.finished_at,
        progress=payload.get("progress"),
        stage=payload.get("stage"),
        duration_seconds=facts.get("duration_seconds"),
        variants=variants or None,
    )


__all__ = [
    "analyze_video",
    "create_video_job",
    "create_video_upload_session",
    "execute_video_job",
    "extract_keyframes",
    "save_video_result",
    "to_video_response",
]
```

- [ ] **Step 7: Verify the module and pin the `_RemoteSource` coupling.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
grep -n 'path\.' app/video/probe.py
```

Expected: every hit is `path.name` (inside an f-string or `.format`). If anything else appears — `path.exists()`, `path.stat()`, `path.open()` — stop and extend `_RemoteSource` accordingly.

```bash
poetry run python -c "
import inspect
from app.creative_fit import video_service as vs
for name in ('extract_keyframes','analyze_video','create_video_job','execute_video_job',
             'save_video_result','to_video_response','create_video_upload_session'):
    print(name, inspect.signature(getattr(vs, name)))
print('prefixes:', vs.VIDEO_SOURCE_PREFIX, vs.VIDEO_RESULT_PREFIX)
s = vs._RemoteSource('https://storage.googleapis.com/b/creative-fit/sources/u/x.mp4?X-Goog-Signature=abc')
print(s.name, '|', str(s)[:40])
"
```

Expected (abridged): `extract_keyframes (path: pathlib.Path, count: int = 6) -> list[bytes]`, `execute_video_job (db: sqlalchemy.ext.asyncio.session.AsyncSession, job: ...CreativeFitJob) -> None`, `prefixes: creative-fit/sources creative-fit/results`, and `x.mp4 | https://storage.googleapis.com/b/creative`.

- [ ] **Step 8: Verify ffprobe can read an https input on this machine.**

```bash
ffprobe -version | head -1
ffprobe -protocols 2>/dev/null | grep -E "^\s+(https|http)$"
```

Expected: a version ≥ 7, and both `http` and `https` listed under Input. If `https` is absent, `_RemoteSource` cannot work and the Dockerfile's ffmpeg needs a TLS-enabled build — flag it to the user rather than falling back to downloading.

---

## Task 9: Router, schemas and `list_jobs`

**Files:**
- MODIFY `markai-signage-api/app/creative_fit/schemas.py` — add fields to `CreateJobRequest` (after line 150), `JobResponse` (after line 180), `CreativeFitStatus` (after line 205).
- MODIFY `markai-signage-api/app/creative_fit/service.py` — `list_jobs` signature and body, lines 755-780.
- MODIFY `markai-signage-api/app/creative_fit/router.py` — imports (lines 12-32), `get_status` (39-55), `create_job` (97-105), `list_jobs` (108-119), `get_job` (122-130), `cancel_job` (133-146), `save_to_library` (149-163); add three routes.

**Interfaces:**
- Consumes: `video_service.*`, `video_schemas.*`, `MEDIA_KIND_IMAGE`, `MEDIA_KIND_VIDEO`.
- Produces: `GET /jobs?kind=`, `POST /video/upload-session`, `POST /video/analyze`, extended `GET /status`.

- [ ] **Step 1: Extend `schemas.py`, additively.**

In `CreateJobRequest`, after line 150 (`auto_save: bool = False`), add:

```python
    #: Which pipeline runs this job. "image" keeps today's behaviour exactly;
    #: "video" routes it to the video lane. Default preserves every existing
    #: caller, including the AI co-pilot and the current CMS page.
    media_kind: Literal["image", "video"] = "image"
```

In `JobResponse`, after line 180 (`finished_at: Optional[datetime] = None`), add:

```python
    #: Everything below is video-only and defaults to the image answer, so an
    #: image job serialises byte-identically to what it did before.
    media_kind: str = "image"
    #: 0-100. Coarse, published at stage boundaries by video_service._set_stage.
    progress: Optional[int] = None
    #: downloading | probing | segmenting | reading | rendering | uploading | done
    stage: Optional[str] = None
    #: The rendered film's real length, in seconds.
    duration_seconds: Optional[float] = None
    variants: Optional[list["VideoVariantOut"]] = None
```

Then append to the **very bottom** of `schemas.py`, after `CreativeFitStatus`:

```python


# Imported here rather than at the top purely for readability: the video shapes
# are a separate concern and this file's own classes should be the first thing
# a reader meets. `video_schemas` imports nothing from this module (see its
# docstring), so the direction is one-way and either import order works.
from app.creative_fit.video_schemas import VideoVariantOut  # noqa: E402

JobResponse.model_rebuild()
```

> `model_rebuild()` is what resolves the `"VideoVariantOut"` string annotation on `JobResponse.variants`. Without it, FastAPI raises `PydanticUndefinedAnnotation` when it builds the response model. Verified in Step 7.

In `CreativeFitStatus`, after line 205 (`retention_hours: int`), add:

```python
    #: Whether a video job can be CREATED here. Deliberately not "will this
    #: instance run it": the video lane may live in a separate Cloud Run
    #: service (CREATIVE_FIT_VIDEO_WORKERS=0 here, >0 there), so reporting the
    #: local worker count would tell the CMS video is off when it is on.
    video_enabled: bool = False
    video_max_upload_mb: int = 0
    video_max_duration_seconds: int = 0
```

- [ ] **Step 2: Add the `media_kind` parameter to `service.list_jobs`.**

Add `MEDIA_KIND_IMAGE` to the existing `from app.creative_fit.models import (...)` block at `service.py:43-51`, then replace lines 755-766:

```python
async def list_jobs(
    db: AsyncSession, user, limit: int, offset: int
) -> tuple[list[CreativeFitJob], int]:
    """This user's fit history, newest first.

    Scoped to the caller even for a superadmin: this is a personal workbench, and
    a superadmin does not want every operator's experiments in their strip.
    """
    where = CreativeFitJob.cms_user_id == user.id
    total = (
        await db.execute(select(func.count(CreativeFitJob.id)).where(where))
    ).scalar_one()
```

with:

```python
async def list_jobs(
    db: AsyncSession,
    user,
    limit: int,
    offset: int,
    media_kind: str = MEDIA_KIND_IMAGE,
) -> tuple[list[CreativeFitJob], int]:
    """This user's fit history in one lane, newest first.

    Scoped to the caller even for a superadmin: this is a personal workbench, and
    a superadmin does not want every operator's experiments in their strip.

    ``media_kind`` defaults to "image", which is what stops video rows appearing
    in the existing image history strip without the frontend changing at all.
    """
    where = (
        CreativeFitJob.cms_user_id == user.id,
        CreativeFitJob.media_kind == media_kind,
    )
    total = (
        await db.execute(select(func.count(CreativeFitJob.id)).where(*where))
    ).scalar_one()
```

and in the same function replace the two remaining `.where(where)` occurrences (line 771) with `.where(*where)`:

```python
    jobs = (
        (
            await db.execute(
                select(CreativeFitJob)
                .where(*where)
                .order_by(CreativeFitJob.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return list(jobs), int(total)
```

- [ ] **Step 3: Extend the router imports.**

Replace `router.py` lines 21-32:

```python
from app.creative_fit import service
from app.creative_fit.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    CreateJobRequest,
    CreativeFitStatus,
    JobListResponse,
    JobResponse,
    SaveResultRequest,
    ScreenTargetsResponse,
    SourceUploadResponse,
)
```

with:

```python
from app.creative_fit import service, video_service
from app.creative_fit.models import MEDIA_KIND_IMAGE, MEDIA_KIND_VIDEO
from app.creative_fit.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    CreateJobRequest,
    CreativeFitStatus,
    JobListResponse,
    JobResponse,
    SaveResultRequest,
    ScreenTargetsResponse,
    SourceUploadResponse,
)
from app.creative_fit.video_schemas import (
    VideoAnalyzeRequest,
    VideoAnalyzeResponse,
    VideoUploadSessionRequest,
    VideoUploadSessionResponse,
)
```

- [ ] **Step 4: Add the lane-aware serializer and extend `/status`.**

Immediately after `router = APIRouter(...)` (line 36), add:

```python


def _serialize(job) -> JobResponse:
    """One job, serialized by its lane.

    For an image row this is `service.to_response` unchanged, and `JobResponse`'s
    new fields all default to the image answer — so the existing page's payload
    is byte-identical to what it was before Plan B.
    """
    if job.media_kind == MEDIA_KIND_VIDEO:
        return video_service.to_video_response(job)
    return service.to_response(job)
```

Replace the `return CreativeFitStatus(...)` block in `get_status` (lines 48-55) with:

```python
    return CreativeFitStatus(
        ai_enabled=settings.ai_enabled,
        rebuild_available=settings.ai_enabled,
        image_model=settings.GEMINI_IMAGE_MODEL,
        workers=settings.CREATIVE_FIT_WORKERS,
        max_upload_mb=settings.CREATIVE_FIT_MAX_UPLOAD_BYTES // (1024 * 1024),
        retention_hours=settings.CREATIVE_FIT_RETENTION_HOURS,
        video_enabled=settings.gcs_configured,
        video_max_upload_mb=(
            settings.CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES // (1024 * 1024)
        ),
        video_max_duration_seconds=settings.VIDEO_MAX_DURATION_SECONDS,
    )
```

- [ ] **Step 5: Route the five job endpoints through the lane.**

Replace `create_job`'s body (lines 102-105):

```python
    """Queue a fit. One of the workers picks it up within a second."""
    job = await service.create_job(db, user, payload)
    return service.to_response(job)
```

with:

```python
    """Queue a fit. A worker in the matching lane picks it up within a second.

    The branch is the only reason `CreateJobRequest.media_kind` exists. It
    defaults to "image", so every existing caller — the CMS page, the AI
    co-pilot — reaches `service.create_job` on exactly the path it always did.
    """
    if payload.media_kind == MEDIA_KIND_VIDEO:
        job = await video_service.create_video_job(db, user, payload)
    else:
        job = await service.create_job(db, user, payload)
    return _serialize(job)
```

Replace `list_jobs`'s signature and body (lines 108-119) with:

```python
@router.get("/jobs", response_model=JobListResponse)
async def list_jobs(
    limit: int = Query(default=0, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    kind: str = Query(default=MEDIA_KIND_IMAGE, pattern="^(image|video)$"),
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
) -> JobListResponse:
    """This user's fit history in one lane, newest first.

    `kind` defaults to "image" — that default is what keeps video rows out of
    the existing image history strip with no frontend change.
    """
    jobs, total = await service.list_jobs(
        db, user, limit or settings.CREATIVE_FIT_HISTORY_LIMIT, offset, kind
    )
    return JobListResponse(jobs=[_serialize(j) for j in jobs], total=total)
```

In `get_job` (line 130) and `cancel_job` (line 146), replace `return service.to_response(job)` with `return _serialize(job)`.

Replace `save_to_library`'s body (lines 161-163) with:

```python
    job = await service.get_job(db, user, job_id)
    if job.media_kind == MEDIA_KIND_VIDEO:
        media = await video_service.save_video_result(db, user, job, payload.name)
    else:
        media = await service.save_result(db, user, job, payload.name)
    return media_to_response(media)
```

- [ ] **Step 6: Add the two new video routes.**

Insert after the `save_to_library` handler (after line 163, before the cron router section at line 166):

```python


# ---- Video (same auth, same scoping, its own modules) ----


@router.post("/video/upload-session", response_model=VideoUploadSessionResponse)
async def create_video_upload_session(
    payload: VideoUploadSessionRequest,
    user: CmsUser = Depends(get_current_cms_user),
) -> VideoUploadSessionResponse:
    """Open a direct-to-GCS session for one video source.

    There is no `POST /video/upload` twin of the image route, by construction:
    Cloud Run's frontend hard-caps HTTP/1 request bodies at 32 MiB and answers
    with an HTML 413 before FastAPI runs, so a 500 MB film can never be proxied
    through this service. The browser PUTs to `upload_url` and then sends
    `source_url` straight back to `/video/analyze` and `/jobs`.
    """
    return await video_service.create_video_upload_session(user.id, payload)


@router.post("/video/analyze", response_model=VideoAnalyzeResponse)
async def analyze_video(
    payload: VideoAnalyzeRequest,
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
) -> VideoAnalyzeResponse:
    """Measure the film against the screen and recommend a tier. Creates no job.

    Cheap on purpose: one ffprobe plus six single-frame decodes, all issued
    against the signed URL, so nothing is downloaded.
    """
    return await video_service.analyze_video(db, user, payload)
```

- [ ] **Step 7: Verify the whole surface imports and the routes are registered.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
poetry run python -c "import app.main"
# Both import orders must work — this is the pair that would deadlock on a cycle.
poetry run python -c "import app.creative_fit.video_schemas, app.creative_fit.schemas; print('video_schemas first: OK')"
poetry run python -c "import app.creative_fit.schemas, app.creative_fit.video_schemas; print('schemas first: OK')"
poetry run python -c "
from app.main import app
paths = sorted({r.path for r in app.routes if 'creative-fit' in getattr(r, 'path', '')})
for p in paths: print(p)
from app.creative_fit.schemas import CreateJobRequest, JobResponse, CreativeFitStatus
print('CreateJobRequest.media_kind default:', CreateJobRequest.model_fields['media_kind'].default)
print('JobResponse new fields:', [f for f in ('media_kind','progress','stage','duration_seconds','variants') if f in JobResponse.model_fields])
print('status new fields:', [f for f in ('video_enabled','video_max_upload_mb','video_max_duration_seconds') if f in CreativeFitStatus.model_fields])
"
```

Expected paths to include `/api/cms/creative-fit/video/upload-session` and `/api/cms/creative-fit/video/analyze` alongside every existing route, then:

```
CreateJobRequest.media_kind default: image
JobResponse new fields: ['media_kind', 'progress', 'stage', 'duration_seconds', 'variants']
status new fields: ['video_enabled', 'video_max_upload_mb', 'video_max_duration_seconds']
```

- [ ] **Step 8: Prove the image path is unchanged.**

Start the API (`./dev_start.sh`), then:

```bash
TOKEN=$(curl -s -X POST http://localhost:8095/api/cms/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mark-ai.tech","password":"Admin@123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -s "http://localhost:8095/api/cms/creative-fit/jobs" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -30
```

Expected: the same `{"jobs": [...], "total": N}` shape as before, every row carrying `"media_kind": "image"`, `"progress": null`, `"stage": null`, `"variants": null`. `total` must equal the pre-change count (video rows are excluded by the default).

```bash
curl -s "http://localhost:8095/api/cms/creative-fit/jobs?kind=video" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
curl -s "http://localhost:8095/api/cms/creative-fit/jobs?kind=nonsense" \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w '%{http_code}\n'
```

Expected: `{"jobs": [], "total": 0}` then `422`.

---

## Task 10: Retention, work-dir hygiene, and the end-to-end run

**Files:**
- MODIFY `markai-signage-api/app/creative_fit/video_service.py` — nothing new; this task **verifies** the prefix decision already encoded in Task 8.
- No edit to `service.cleanup_expired_fits`.

**Interfaces:**
- Consumes: `service.cleanup_expired_fits`, `SOURCE_PREFIX`, `RESULT_PREFIX`, `POST /api/cron/cleanup-creative-fit`.
- Produces: verified retention coverage for video blobs; a green end-to-end run.

### The retention decision, and why

`service.cleanup_expired_fits` (`service.py:783-878`) gates every deletion on two hard-coded strings:

```python
if name and name.startswith(RESULT_PREFIX):   # line 827
if name and name.startswith(SOURCE_PREFIX):   # line 832
```

A video job whose blobs lived anywhere else would have its **row deleted** (line 837, unconditional) while its **blobs were skipped** — a silent leak of the single largest objects in the bucket, with the only record of their existence removed in the same sweep. Two ways out:

- **(a) Reuse the same two prefixes** for video sources and results.
- **(b) Extend the checks** to also match video prefixes.

**Chosen: (a).** `cleanup_expired_fits` is a frozen function, and (b) requires editing it — the one thing the contract forbids. (a) requires editing nothing at all: `VIDEO_SOURCE_PREFIX = SOURCE_PREFIX` and `VIDEO_RESULT_PREFIX = RESULT_PREFIX` in `video_service.py`, and every blob path is already built from those (`create_video_upload_session`, `execute_video_job`). All three of the sweep's rules then hold for video unchanged and for the right reasons:

1. *A saved result is never touched* — `result_media_id` is set the same way by `_register_video_media`.
2. *A library source is never touched* — a video picked from Content has a `content/videos/...` URL, which fails `startswith(SOURCE_PREFIX)` exactly as an image library source does.
3. *A shared source outlives its first job* — two jobs from one upload share one blob and the survivor scan is prefix-agnostic.

The only cost is that a bucket lifecycle rule cannot expire video sources on a different schedule from image sources. That is not a requirement today, and if it becomes one the right fix is a lifecycle rule keyed on object size, not a second prefix.

**What retention does NOT cover, and Task 8 handles instead:** the local `VIDEO_WORK_DIR`. Nothing in `cleanup_expired_fits` knows about it, it is tmpfs (RAM) on Cloud Run, and a single 500 MB source plus its mezzanine plate is enough to kill a 2 GB instance. `execute_video_job`'s `finally` removes both `job-{id}/` and the pipeline's `{creative_id}/` directory on every path — success, failure and cancel.

- [ ] **Step 1: Prove the prefixes are shared, not parallel.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run python -c "
from app.creative_fit.service import SOURCE_PREFIX, RESULT_PREFIX
from app.creative_fit.video_service import VIDEO_SOURCE_PREFIX, VIDEO_RESULT_PREFIX
assert VIDEO_SOURCE_PREFIX == SOURCE_PREFIX == 'creative-fit/sources'
assert VIDEO_RESULT_PREFIX == RESULT_PREFIX == 'creative-fit/results'
print('video blobs are inside the retention sweep:', SOURCE_PREFIX, RESULT_PREFIX)
"
git -C . diff --stat app/creative_fit/service.py
```

Expected: the assertion line prints, and the diff for `service.py` touches only `list_jobs` and its import block (Task 9) — `cleanup_expired_fits` must show **zero** changed lines. (`git diff` is read-only; do not commit.)

- [ ] **Step 2: Prove the sweep would collect a video job's blobs.**

```bash
poetry run python -c "
from app.creative_fit.service import RESULT_PREFIX, SOURCE_PREFIX
job_id, user_id = 'JOB', 'USER'
result_blob = f'{RESULT_PREFIX}/{user_id}/{job_id}.mp4'
source_blob = f'{SOURCE_PREFIX}/{user_id}/abc.mp4'
library_blob = 'content/videos/def.mp4'
print('result collected :', result_blob.startswith(RESULT_PREFIX))
print('source collected :', source_blob.startswith(SOURCE_PREFIX))
print('library skipped  :', not library_blob.startswith(SOURCE_PREFIX))
"
```

Expected: `True`, `True`, `True`.

- [ ] **Step 3: Run the cron sweep against a real database and read the counters.**

```bash
curl -s -X POST http://localhost:8095/api/cron/cleanup-creative-fit \
  -H "X-Cron-Secret: markai-dev-cron-secret-change-in-production" \
  | python3 -m json.tool
```

Expected: `{"jobs_deleted": N, "blobs_deleted": M, "kept_saved": K}` with no traceback in the server log. (Use the real `CRON_SECRET` from `.env`.)

- [ ] **Step 4: The end-to-end run — upload, analyze, job, poll, library.**

> **ASK THE USER FIRST** — the `/video/analyze` call and the job's own analyst read each make a real Gemini API call when `GEMINI_API_KEY` is set. With the key unset both degrade to the deterministic verdict and the rest of this step still runs.

With the API up on `:8095`, a real ad film at `/tmp/ad.mp4`, and `CREATIVE_FIT_VIDEO_WORKERS >= 1`:

```bash
cd /tmp
TOKEN=$(curl -s -X POST http://localhost:8095/api/cms/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mark-ai.tech","password":"Admin@123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

SIZE=$(stat -f%z /tmp/ad.mp4)

# 1 — session
SESSION=$(curl -s -X POST http://localhost:8095/api/cms/creative-fit/video/upload-session \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"filename\":\"ad.mp4\",\"content_type\":\"video/mp4\",\"size_bytes\":$SIZE}")
echo "$SESSION" | python3 -m json.tool
UPLOAD_URL=$(echo "$SESSION" | python3 -c 'import sys,json;print(json.load(sys.stdin)["upload_url"])')
SOURCE_URL=$(echo "$SESSION" | python3 -c 'import sys,json;print(json.load(sys.stdin)["source_url"])')
```

Expected: `{"upload_url": "https://storage.googleapis.com/upload/storage/v1/b/...&upload_id=...", "source_url": "https://storage.googleapis.com/<bucket>/creative-fit/sources/<user>/<uuid>.mp4", "source_name": "ad.mp4"}`.

```bash
# 2 — the browser's PUT, done here with curl
curl -s -X PUT "$UPLOAD_URL" -H 'Content-Type: video/mp4' \
  --upload-file /tmp/ad.mp4 -o /dev/null -w 'PUT %{http_code}\n'
```

Expected: `PUT 200`.

```bash
# 3 — analyze (real Gemini call when the key is set)
curl -s -X POST http://localhost:8095/api/cms/creative-fit/video/analyze \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"source_url\":\"$SOURCE_URL\",\"source_name\":\"ad.mp4\",
       \"target_width\":1080,\"target_height\":1920}" | python3 -m json.tool
```

Expected: `facts` carrying the film's real `width`/`height`/`duration_seconds`/`fps`, `shot_count: 0`, `analysis.recommendation` of `resize` or `rebuild`, `ai_reviewed: true` (or `false` with `reading: null` when the key is unset), and `fit_available: true`. This must return in a couple of seconds — if it takes as long as a download, `_RemoteSource` is not being used.

```bash
# 4 — queue the job
JOB=$(curl -s -X POST http://localhost:8095/api/cms/creative-fit/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"media_kind\":\"video\",\"mode\":\"resize\",\"auto_save\":true,
       \"source_url\":\"$SOURCE_URL\",\"source_name\":\"ad.mp4\",
       \"target_width\":1080,\"target_height\":1920}")
echo "$JOB" | python3 -m json.tool
JOB_ID=$(echo "$JOB" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
```

Expected: HTTP 202, `"status": "queued"`, `"media_kind": "video"`, `"stage": "queued"`, `"progress": 0`, and `source_width`/`source_height` equal to the film's real dimensions — **not** anything the request sent.

```bash
# 5 — poll to done
for i in $(seq 1 120); do
  R=$(curl -s "http://localhost:8095/api/cms/creative-fit/jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN")
  echo "$R" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["status"], d.get("stage"), d.get("progress"))'
  S=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
  [ "$S" = "done" ] || [ "$S" = "failed" ] && break
  sleep 10
done
echo "$R" | python3 -m json.tool
```

Expected: the stage line walks `queued 0` → `downloading 5` → `probing 12` → `segmenting 20` → `reading 28` → `rendering 40` → `uploading 85` → `done 100`, then a final body with `"status": "done"`, a non-null `result_url` (a signed `storage.googleapis.com` URL), `result_width: 1080`, `result_height: 1920`, `result_bytes` > 0, `duration_seconds` matching the film, a non-null `result_media_id`, and `variants[0]` carrying `mode` of `stretch`/`crop`/`reframe`/`compose` plus its own signed `url`.

```bash
# 6 — it is in the Content library, as a VIDEO with its real duration
MEDIA_ID=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result_media_id"])')
curl -s "http://localhost:8095/api/cms/content" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
for a in json.load(sys.stdin):
    if a['id'] == '$MEDIA_ID':
        print(a['type'], a['duration_seconds'], a['width'], a['height'], a['name'])
"
```

Expected: `video <real seconds> 1080 1920 ad.mp4 — 1080×1920`. **`type` must be `video`, never `image`, and `duration_seconds` must be the film's real length, never 5.**

```bash
# 7 — the video row is in its own lane
curl -s "http://localhost:8095/api/cms/creative-fit/jobs?kind=video" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("video total:", d["total"], [j["media_kind"] for j in d["jobs"]])'
curl -s "http://localhost:8095/api/cms/creative-fit/jobs" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("image total:", d["total"], set(j["media_kind"] for j in d["jobs"]))'
```

Expected: `video total: 1 ['video']` and `image total: N {'image'}` — the video job must NOT appear in the default listing.

- [ ] **Step 5: Confirm the work directory was purged.**

```bash
ls -la /tmp/markai-video 2>/dev/null || echo "work dir absent (also fine)"
du -sh /tmp/markai-video 2>/dev/null
```

Expected: empty, or absent. **No `job-*` directory and no content-hash directory may survive a finished job.** If either does, `execute_video_job`'s `finally` is not running — fix that before anything ships, because on Cloud Run those bytes are RAM.

- [ ] **Step 6: Confirm the lanes cannot cross.**

Queue an image job and a video job at the same time, then read the log:

```bash
grep -E "\[creative-fit\] (image|video) worker" /tmp/markai-api.log | tail -20
```

Expected: every `image worker N claimed <id>` line refers to a job whose `media_kind` is `image`, and every `video worker N claimed <id>` to a `video` one. No line may show an image worker claiming a video job — verify with:

```bash
docker exec -i markai-postgres psql -U markai -d markai_signage -c \
  "SELECT media_kind, status, count(*) FROM creative_fit_jobs GROUP BY 1,2 ORDER BY 1,2;"
```

Expected: no `video | failed` row whose `error` mentions "isn't a readable image". Check explicitly:

```bash
docker exec -i markai-postgres psql -U markai -d markai_signage -c \
  "SELECT id, media_kind, error FROM creative_fit_jobs WHERE error ILIKE '%readable image%';"
```

Expected: `(0 rows)`. A hit here means the `media_kind` predicate is missing from one of the claim statements.

- [ ] **Step 7: Final gate.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
poetry run ruff check app/
poetry run python -c "import app.main"
poetry run alembic upgrade head && poetry run alembic current
```

Expected: no ruff findings, a clean import, `0045_creative_fit_media_kind (head)`.

---

## What Plan B deliberately does not do

- **No CMS frontend.** The Image|Video toggle, the video page and the duplicated components are Plan C's, per the contract's own table.
- **No per-target progress inside a render.** `pipeline.fit_video` has no progress hook; stages are published at its boundaries, not inside it. Instrumenting `blueprint.analyse`'s per-shot reads is not this plan's job.
- **No multi-target job.** One job, one target — the same shape the image path has. `fit_video` accepts a list; the job table has one `target_width`/`target_height` pair, and changing that is a schema change nobody has asked for.
- **No deployment change.** The two-Cloud-Run-service split (`cms-back` with `CREATIVE_FIT_VIDEO_WORKERS=0`, `cms-back-video` with `CREATIVE_FIT_WORKERS=0`) is documented in `worker.py`'s docstring and enabled by the env vars. Nothing here provisions it.
- **No regeneration of the source's audio.** The panels play silent; `has_audio` is reported to the analyst as context and nothing else.
