# CMS APK Update Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator clicks "Update now" on a screen (or "Update all outdated") in the CMS, and that screen's player APK is upgraded to the current release without anyone visiting it.

**Architecture:** The CMS writes an `apk_update_jobs` row. A small **updater agent** running on the existing `headscale` GCE VM polls the backend for queued jobs, pulls the release straight from `gs://markai-storage/apk/releases/<code>/markai-player.apk`, verifies its sha256, reaches the screen over the Headscale tunnel with `adb`, installs, confirms the installed versionCode, and reports back. The agent **polls** rather than being called, so nothing inbound is exposed — the same shape as the existing cron endpoints. The heartbeat is deliberately **not modified**: the player stays completely unaware of updates, so no APK release is needed to ship this.

**Tech Stack:** FastAPI · SQLAlchemy async · Alembic · Postgres · Next.js 15 (CMS) · Python 3 agent on Debian 12 · adb · Headscale/Tailscale

## Global Constraints

- **Do not run pytest.** Verify with `python -c "import app.main"` and `ruff check app/`. The user runs the test suite. Write the tests; do not execute them.
- **Lint gate is `ruff`, not `black`** — `markai-signage-api` main is not black-clean. Run `ruff check app/`.
- CMS gate is `npm test` (vitest) plus `npm run build`.
- **Never add Claude `Co-Authored-By` trailers to commits.**
- Migration head is `0042_screen_slots` (the slot-grid work landed after this plan was drafted). New revision ids must be **under 32 characters** (`alembic_version.version_num` is `VARCHAR(32)`).
- Any new CMS route must live under `/api/cms/*` — the BFF proxy (`src/app/api/cms/[...path]/route.ts`) forwards only that prefix.
- Bulk/literal routes must be declared **before** `/{screen_id}` in `app/cms/screens_router.py`, or the literal path is captured as a screen id.
- Role rule: superadmin → any screen; screenowner → only screens assigned to them. Use `assert_can_manage_screen` (`app/cms_users/deps.py:87`) and `_visible_screen_conditions` (`app/screens/service.py:531`). Do not write new auth logic.
- Secrets stay backend-only. Never `NEXT_PUBLIC_*`.
- GCS release path: `apk/releases/{version_code}/markai-player.apk` in bucket `markai-storage`.
- Headscale control server: `https://headscale.mark-ai.tech`. Agent VM: `headscale`, zone `us-central1-a`, project `markai-499512`.

---

## Known limitations this plan does NOT solve

State these plainly rather than discovering them in the field:

1. **`adb tcpip 5555` does not survive a reboot** without root (`persist.adb.tcp.port` is not writable by the shell user under SELinux). A screen that power-cycles drops off adb until someone re-enables it. **Verify on the AndBox before relying on this.** If it does not survive, this plan is a debugging tool, not an update channel, and the Device-Owner + heartbeat design in `docs/superpowers/specs/2026-08-13-apk-auto-update-design.md` is the real answer.
2. **The agent's adb key must be authorized on every box**, and authorizing a new key requires a physical tap. The agent's keypair must therefore be installed on the provisioning laptop *before* the first box is set up. See Task 12.
3. **No rollback.** Android refuses lower versionCodes. Fix forward only.
4. **MIUI/Xiaomi firmware blocks adb installs** (`INSTALL_FAILED_USER_RESTRICTED`) unless "Install via USB" is enabled. Generic AOSP boxes do not. Re-verify install works on every new hardware batch.

---

## File Structure

**Backend — `markai-signage-api/`**
| File | Responsibility |
|---|---|
| `alembic/versions/0043_screen_tailscale_ip.py` | adds `screens.tailscale_ip` |
| `alembic/versions/0044_apk_update_jobs.py` | adds `apk_update_jobs` |
| `app/apk/models.py` (modify) | `ApkUpdateJob` model |
| `app/apk/update_service.py` (new) | job creation, claiming, completion — all business logic |
| `app/apk/update_schemas.py` (new) | request/response shapes for both routers |
| `app/apk/cms_router.py` (modify) | operator-facing endpoints |
| `app/apk/agent_router.py` (new) | agent-facing endpoints, secret auth |
| `app/screens/models.py` (modify) | `tailscale_ip` column |
| `app/screens/schemas.py` (modify) | expose `tailscale_ip` + `update_status` |
| `app/screens/service.py` (modify) | persist `tailscale_ip` on edit |
| `app/core/config.py` (modify) | `AGENT_SECRET` |
| `app/main.py` (modify) | mount `agent_router` |

Job logic goes in a **separate `update_service.py`** rather than `app/apk/service.py`, which is already 215 lines of release-publishing and key-injection concerns. Different responsibility, different file.

**Agent — new repo folder `markai-update-agent/`**
| File | Responsibility |
|---|---|
| `agent.py` | poll → download → verify → install → report |
| `requirements.txt` | `requests` only |
| `markai-update-agent.service` | systemd unit |
| `deploy.sh` | push to the VM and restart |
| `README.md` | operational runbook |

**CMS — `markai-Web-cms/`**
| File | Responsibility |
|---|---|
| `src/lib/types.ts` (modify) | `tailscale_ip`, `update_status`, `ApkUpdateJob` |
| `src/lib/api.ts` (modify) | `updateScreenApk`, `bulkUpdateApk`, `apkUpdateJobs` |
| `src/app/(dashboard)/screens/[id]/page.tsx` (modify) | per-screen "Update now" |
| `src/app/(dashboard)/screens/page.tsx` (modify) | bulk "Update outdated" |

---

## Task 1: `tailscale_ip` on screens

The agent needs to know which address to `adb connect` to. Set once, at install time.

**Files:**
- Create: `alembic/versions/0043_screen_tailscale_ip.py`
- Modify: `app/screens/models.py:77`, `app/screens/schemas.py:106`, `app/screens/service.py`
- Test: `tests/test_screen_tailscale_ip.py`

**Interfaces:**
- Consumes: nothing
- Produces: `Screen.tailscale_ip: str | None`; `ScreenSummary.tailscale_ip: Optional[str]`; `ScreenUpdateRequest.tailscale_ip: Optional[str]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_screen_tailscale_ip.py
import pytest
from app.screens.models import Screen


def test_screen_has_tailscale_ip_column():
    assert hasattr(Screen, "tailscale_ip")
    col = Screen.__table__.c.tailscale_ip
    assert col.nullable is True
    assert col.type.length == 45  # fits IPv6


def test_screen_summary_exposes_tailscale_ip():
    from app.screens.schemas import ScreenSummary
    assert "tailscale_ip" in ScreenSummary.model_fields
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd markai-signage-api && python -c "import tests.test_screen_tailscale_ip"`
Expected: passes import, but the assertions would fail — confirm by `python -c "from app.screens.models import Screen; print(hasattr(Screen,'tailscale_ip'))"` → `False`

- [ ] **Step 3: Add the column to the model**

In `app/screens/models.py`, directly after the `app_version_code` line (currently `:77`):

```python
    # Tailscale/Headscale address of this box, e.g. "100.64.0.7". Set by the
    # operator during physical install (from `headscale nodes list`). It is the
    # ONLY way the updater agent can reach a screen behind a cafe's NAT, so a
    # screen without one simply cannot be updated remotely — the CMS says so
    # rather than queueing a job that can never run.
    tailscale_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
```

- [ ] **Step 4: Write the migration**

Create `alembic/versions/0043_screen_tailscale_ip.py`:

```python
"""Add screens.tailscale_ip

Revision ID: 0043_screen_tailscale_ip
Revises: 0041_gmail_booking_drafts
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa

revision: str = "0043_screen_tailscale_ip"
down_revision: str = "0042_screen_slots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("screens", sa.Column("tailscale_ip", sa.String(45), nullable=True))


def downgrade() -> None:
    op.drop_column("screens", "tailscale_ip")
```

- [ ] **Step 5: Expose it in the schema**

In `app/screens/schemas.py`, beside `app_version_code` (currently `:106`), add to `ScreenSummary`:

```python
    tailscale_ip: Optional[str] = None
```

And to `ScreenUpdateRequest`:

```python
    tailscale_ip: Optional[str] = None
```

- [ ] **Step 6: Populate it in `to_summary` and persist it in `update_screen`**

In `app/screens/service.py`, in `to_summary(...)` beside `app_version_code=screen.app_version_code`:

```python
        tailscale_ip=screen.tailscale_ip,
```

In `update_screen(...)`, alongside the other optional field assignments:

```python
    if tailscale_ip is not None:
        # Empty string clears it — an operator must be able to unset a stale
        # address without an admin touching the database.
        screen.tailscale_ip = tailscale_ip.strip() or None
```

Add `tailscale_ip: str | None = None` to the `update_screen` signature and pass `payload.tailscale_ip` from `app/cms/screens_router.py:update_screen`.

**Do not** bump `schedule_updated_at` for this field — it is not a schedule change, and bumping it makes every edited screen re-download its whole schedule.

- [ ] **Step 7: Verify**

```bash
cd markai-signage-api
python -c "import app.main" && ruff check app/
alembic upgrade head
python -c "from app.screens.models import Screen; print(Screen.__table__.c.tailscale_ip)"
```
Expected: no errors; prints `screens.tailscale_ip`

- [ ] **Step 8: Commit**

```bash
git add alembic/versions/0043_screen_tailscale_ip.py app/screens/ app/cms/screens_router.py tests/test_screen_tailscale_ip.py
git commit -m "feat(screens): add tailscale_ip for remote update addressing"
```

---

## Task 2: `apk_update_jobs` table

**Files:**
- Create: `alembic/versions/0044_apk_update_jobs.py`
- Modify: `app/apk/models.py`
- Test: `tests/test_apk_update_job_model.py`

**Interfaces:**
- Consumes: `Task 1` (`Screen.tailscale_ip`)
- Produces: `ApkUpdateJob` with fields `id, screen_id, release_id, target_version_code, status, attempts, error, requested_by_user_id, claimed_at, finished_at, installed_version_code, created_at, updated_at`. Status is one of `queued | running | succeeded | failed`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_apk_update_job_model.py
from app.apk.models import ApkUpdateJob


def test_job_columns_exist():
    cols = ApkUpdateJob.__table__.c
    for name in (
        "screen_id", "release_id", "target_version_code", "status",
        "attempts", "error", "requested_by_user_id", "claimed_at",
        "finished_at", "installed_version_code",
    ):
        assert name in cols, f"missing column {name}"


def test_status_defaults_to_queued():
    assert ApkUpdateJob.__table__.c.status.default.arg == "queued"


def test_one_open_job_per_screen_index_exists():
    names = {ix.name for ix in ApkUpdateJob.__table__.indexes}
    assert "uq_apk_update_jobs_open_per_screen" in names
```

- [ ] **Step 2: Verify it fails**

Run: `python -c "from app.apk.models import ApkUpdateJob"`
Expected: `ImportError: cannot import name 'ApkUpdateJob'`

- [ ] **Step 3: Add the model**

Append to `app/apk/models.py`:

```python
class ApkUpdateJob(Base):
    """One operator-requested APK install on one screen.

    Created by the CMS, executed by the updater agent on the headscale VM. The
    agent is the only thing that can reach a screen behind a cafe's NAT, so this
    table is the entire queue between "operator clicked" and "box installed".

    `status` is deliberately a plain string rather than an enum: the agent is a
    separate process on a separate machine with its own deploy cycle, and a
    Postgres enum would make adding a state a coordinated migration.
    """

    __tablename__ = "apk_update_jobs"

    __table_args__ = (
        # At most one unfinished job per screen. Without this, an impatient
        # operator clicking "Update now" three times queues three installs of
        # the same APK, and the second one lands while the first has the player
        # mid-replace. The partial index makes the database refuse it rather
        # than relying on the UI to disable the button.
        Index(
            "uq_apk_update_jobs_open_per_screen",
            "screen_id",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
            sqlite_where=text("status IN ('queued', 'running')"),
        ),
        # The agent polls "give me queued jobs" on a short timer forever.
        Index("ix_apk_update_jobs_status", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    screen_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("screens.id", ondelete="CASCADE"), nullable=False, index=True
    )
    release_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("apk_releases.id", ondelete="RESTRICT"), nullable=False
    )
    # Denormalised from the release so a job still reads correctly if the release
    # row is ever edited, and so the agent needs one fewer join.
    target_version_code: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # SET NULL on user delete — losing the operator must not lose the record that
    # the update was requested.
    requested_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("cms_users.id", ondelete="SET NULL"), nullable=True
    )
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # What the box actually reported after installing. The agent reads it back
    # with `dumpsys package` rather than trusting adb's exit code, because a
    # successful install routinely returns truncated output.
    installed_version_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=_now, nullable=False
    )
```

Add to the imports at the top of the file: `ForeignKey`, `Index`, `text` from `sqlalchemy`.

- [ ] **Step 4: Write the migration**

Create `alembic/versions/0044_apk_update_jobs.py`:

```python
"""Add apk_update_jobs

Revision ID: 0044_apk_update_jobs
Revises: 0043_screen_tailscale_ip
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa

revision: str = "0044_apk_update_jobs"
down_revision: str = "0043_screen_tailscale_ip"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "apk_update_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("screen_id", sa.String(36), sa.ForeignKey("screens.id", ondelete="CASCADE"), nullable=False),
        sa.Column("release_id", sa.String(36), sa.ForeignKey("apk_releases.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("target_version_code", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("requested_by_user_id", sa.String(36), sa.ForeignKey("cms_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("installed_version_code", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_apk_update_jobs_screen_id", "apk_update_jobs", ["screen_id"])
    op.create_index("ix_apk_update_jobs_status", "apk_update_jobs", ["status"])
    op.create_index(
        "uq_apk_update_jobs_open_per_screen",
        "apk_update_jobs",
        ["screen_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
        sqlite_where=sa.text("status IN ('queued', 'running')"),
    )


def downgrade() -> None:
    op.drop_index("uq_apk_update_jobs_open_per_screen", table_name="apk_update_jobs")
    op.drop_index("ix_apk_update_jobs_status", table_name="apk_update_jobs")
    op.drop_index("ix_apk_update_jobs_screen_id", table_name="apk_update_jobs")
    op.drop_table("apk_update_jobs")
```

- [ ] **Step 5: Verify**

```bash
python -c "import app.main" && ruff check app/ && alembic upgrade head
```

- [ ] **Step 6: Commit**

```bash
git add app/apk/models.py alembic/versions/0044_apk_update_jobs.py tests/test_apk_update_job_model.py
git commit -m "feat(apk): add apk_update_jobs queue table"
```

---

## Task 3: Job creation service (role-scoped)

**Files:**
- Create: `app/apk/update_service.py`, `app/apk/update_schemas.py`
- Test: `tests/test_apk_update_service.py`

**Interfaces:**
- Consumes: Tasks 1–2; `latest_apk_version_code` and `_visible_screen_conditions` from `app/screens/service.py`; `assert_can_manage_screen` from `app/cms_users/deps.py`
- Produces:
  - `async def queue_update(db, actor, screen_id) -> ApkUpdateJob`
  - `async def queue_bulk_update(db, actor, *, screen_ids=None, only_outdated=True) -> tuple[int, int, list[str]]` returning `(queued, skipped, reasons)`
  - `async def claim_jobs(db, limit) -> list[dict]`
  - `async def complete_job(db, job_id, *, ok, installed_version_code, error) -> None`
  - `class UpdateNotPossible(Exception)` with `.reason: str`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_apk_update_service.py
import pytest
from app.apk.update_service import UpdateNotPossible, queue_update


@pytest.mark.asyncio
async def test_screen_without_tailscale_ip_is_refused(db, superadmin, screen_no_ip):
    with pytest.raises(UpdateNotPossible) as exc:
        await queue_update(db, superadmin, screen_no_ip.id)
    assert "tailscale" in exc.value.reason.lower()


@pytest.mark.asyncio
async def test_screen_already_current_is_refused(db, superadmin, screen_current):
    with pytest.raises(UpdateNotPossible) as exc:
        await queue_update(db, superadmin, screen_current.id)
    assert "already" in exc.value.reason.lower()


@pytest.mark.asyncio
async def test_queues_job_for_outdated_screen(db, superadmin, screen_outdated, latest_release):
    job = await queue_update(db, superadmin, screen_outdated.id)
    assert job.status == "queued"
    assert job.target_version_code == latest_release.version_code
    assert job.requested_by_user_id == superadmin.id


@pytest.mark.asyncio
async def test_screenowner_cannot_update_unassigned_screen(db, screenowner, other_screen):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await queue_update(db, screenowner, other_screen.id)
    assert exc.value.status_code == 403
```

- [ ] **Step 2: Verify it fails**

Run: `python -c "from app.apk.update_service import queue_update"`
Expected: `ModuleNotFoundError: No module named 'app.apk.update_service'`

- [ ] **Step 3: Write the schemas**

Create `app/apk/update_schemas.py`:

```python
"""Request/response shapes for operator-triggered APK updates."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class QueueUpdateResponse(BaseModel):
    job_id: str
    screen_id: str
    target_version_code: int
    status: str


class BulkUpdateRequest(BaseModel):
    # Explicit ids, or None to mean "every screen this actor can manage".
    screen_ids: Optional[List[str]] = None
    # Default True so "Update all" never reinstalls the same build on screens
    # that are already current — that would black out a healthy fleet for
    # nothing, and there is no rollback if the new build is bad.
    only_outdated: bool = True


class BulkUpdateResponse(BaseModel):
    queued: int
    skipped: int
    # Human-readable reasons, one per skipped screen, so the CMS can tell the
    # operator WHY 4 of 6 screens did nothing instead of silently succeeding.
    reasons: List[str] = []


class ApkUpdateJobOut(BaseModel):
    id: str
    screen_id: str
    target_version_code: int
    status: str
    attempts: int
    error: Optional[str] = None
    installed_version_code: Optional[int] = None
    created_at: datetime
    finished_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AgentJob(BaseModel):
    """One claimed job, shaped for the updater agent."""

    job_id: str
    screen_id: str
    tailscale_ip: str
    target_version_code: int
    gcs_object: str
    sha256: str


class AgentClaimResponse(BaseModel):
    jobs: List[AgentJob] = []


class AgentReportRequest(BaseModel):
    job_id: str
    ok: bool
    installed_version_code: Optional[int] = None
    error: Optional[str] = None
```

- [ ] **Step 4: Write the service**

Create `app/apk/update_service.py`:

```python
"""Queue and run operator-triggered APK updates.

Separate from `app.apk.service`, which owns publishing releases and stamping
enrollment keys. This module owns only the "install release X on screen Y"
lifecycle, which has a different shape and a different consumer (the agent).
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apk.models import ApkRelease, ApkUpdateJob
from app.apk.update_schemas import AgentJob
from app.cms_users.deps import assert_can_manage_screen
from app.cms_users.models import CmsUser
from app.screens.models import Screen
from app.screens.service import _visible_screen_conditions

logger = logging.getLogger(__name__)

# A job that has been claimed but never reported is stuck — the agent died, the
# VM rebooted, or the box hung mid-install. Re-queue it rather than leaving the
# screen showing "installing" forever.
STALE_CLAIM_MINUTES = 15
MAX_ATTEMPTS = 3


class UpdateNotPossible(Exception):
    """A screen cannot be updated, with an operator-readable reason."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _latest_release(db: AsyncSession) -> ApkRelease:
    rel = (
        await db.execute(select(ApkRelease).where(ApkRelease.is_latest.is_(True)))
    ).scalar_one_or_none()
    if rel is None:
        raise UpdateNotPossible("No APK release has been published yet.")
    return rel


def _blocking_reason(screen: Screen, release: ApkRelease) -> Optional[str]:
    """Why this screen cannot be updated right now, or None if it can."""
    if not screen.tailscale_ip:
        return (
            f"{screen.name}: no Tailscale address on record — set it during "
            "install before this screen can be updated remotely."
        )
    if screen.app_version_code is None:
        # Same rule as `is_outdated`: unknown is not behind. A screen that has
        # never reported a version is one we know nothing about, and pushing an
        # install at it is a guess.
        return f"{screen.name}: has never reported its player version."
    if screen.app_version_code >= release.version_code:
        return f"{screen.name}: already on {screen.app_version_name or release.version_name}."
    return None


async def queue_update(
    db: AsyncSession, actor: CmsUser, screen_id: str
) -> ApkUpdateJob:
    """Queue one screen for update. Raises HTTPException(403) if out of scope."""
    await assert_can_manage_screen(db, actor, screen_id)

    screen = (
        await db.execute(select(Screen).where(Screen.id == screen_id))
    ).scalar_one_or_none()
    if screen is None:
        raise UpdateNotPossible("Screen not found.")

    release = await _latest_release(db)
    reason = _blocking_reason(screen, release)
    if reason:
        raise UpdateNotPossible(reason)

    existing = (
        await db.execute(
            select(ApkUpdateJob).where(
                ApkUpdateJob.screen_id == screen_id,
                ApkUpdateJob.status.in_(("queued", "running")),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        # Idempotent rather than an error: a double-click should be a no-op, not
        # a 500 from the partial unique index.
        return existing

    job = ApkUpdateJob(
        screen_id=screen_id,
        release_id=release.id,
        target_version_code=release.version_code,
        requested_by_user_id=actor.id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    logger.info("Queued APK update for screen %s → %s", screen_id, release.version_code)
    return job


async def queue_bulk_update(
    db: AsyncSession,
    actor: CmsUser,
    *,
    screen_ids: Optional[List[str]] = None,
    only_outdated: bool = True,
) -> Tuple[int, int, List[str]]:
    """Queue many screens. Screens the actor cannot manage are skipped, not errored
    — mirroring `bulk_set_operating_hours`."""
    release = await _latest_release(db)

    # NOTE the order: this helper returns (conditions, visible), not the reverse.
    conditions, visible = await _visible_screen_conditions(db, actor)
    if not visible:
        return 0, 0, ["You have no screens assigned."]

    stmt = select(Screen)
    for cond in conditions:
        stmt = stmt.where(cond)
    if screen_ids:
        stmt = stmt.where(Screen.id.in_(screen_ids))
    screens = list((await db.execute(stmt)).scalars())

    open_ids = set(
        (
            await db.execute(
                select(ApkUpdateJob.screen_id).where(
                    ApkUpdateJob.status.in_(("queued", "running"))
                )
            )
        )
        .scalars()
        .all()
    )

    queued = 0
    skipped = 0
    reasons: List[str] = []

    for screen in screens:
        if screen.id in open_ids:
            skipped += 1
            reasons.append(f"{screen.name}: an update is already in progress.")
            continue
        reason = _blocking_reason(screen, release)
        if reason:
            # "already on X" is the normal case for a healthy fleet, so it is only
            # worth reporting when the operator explicitly asked to reinstall.
            if only_outdated and "already on" in reason:
                skipped += 1
                continue
            skipped += 1
            reasons.append(reason)
            continue
        db.add(
            ApkUpdateJob(
                screen_id=screen.id,
                release_id=release.id,
                target_version_code=release.version_code,
                requested_by_user_id=actor.id,
            )
        )
        queued += 1

    await db.commit()
    logger.info("Bulk APK update by %s: queued=%s skipped=%s", actor.id, queued, skipped)
    return queued, skipped, reasons


async def claim_jobs(db: AsyncSession, limit: int = 5) -> List[AgentJob]:
    """Hand queued jobs to the agent and mark them running.

    Also re-queues jobs whose claim went stale, so an agent crash mid-install does
    not strand a screen in "installing" forever.
    """
    cutoff = _now().timestamp() - STALE_CLAIM_MINUTES * 60
    stale = (
        await db.execute(
            select(ApkUpdateJob).where(ApkUpdateJob.status == "running")
        )
    ).scalars()
    for job in stale:
        if job.claimed_at and job.claimed_at.timestamp() < cutoff:
            if job.attempts >= MAX_ATTEMPTS:
                job.status = "failed"
                job.error = f"Gave up after {job.attempts} attempts (agent never reported)."
                job.finished_at = _now()
            else:
                job.status = "queued"
                job.claimed_at = None

    rows = (
        await db.execute(
            select(ApkUpdateJob, Screen, ApkRelease)
            .join(Screen, Screen.id == ApkUpdateJob.screen_id)
            .join(ApkRelease, ApkRelease.id == ApkUpdateJob.release_id)
            .where(ApkUpdateJob.status == "queued")
            .order_by(ApkUpdateJob.created_at)
            .limit(limit)
        )
    ).all()

    out: List[AgentJob] = []
    for job, screen, release in rows:
        if not screen.tailscale_ip:
            job.status = "failed"
            job.error = "Screen has no Tailscale address."
            job.finished_at = _now()
            continue
        job.status = "running"
        job.claimed_at = _now()
        job.attempts += 1
        out.append(
            AgentJob(
                job_id=job.id,
                screen_id=screen.id,
                tailscale_ip=screen.tailscale_ip,
                target_version_code=job.target_version_code,
                gcs_object=release.gcs_object,
                sha256=release.sha256,
            )
        )

    await db.commit()
    return out


async def complete_job(
    db: AsyncSession,
    job_id: str,
    *,
    ok: bool,
    installed_version_code: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    """Record the agent's verdict.

    A failure below MAX_ATTEMPTS returns to `queued` so a flaky cafe link retries
    on its own; at the cap it stays `failed` so the CMS shows a real problem
    instead of retrying forever.
    """
    job = (
        await db.execute(select(ApkUpdateJob).where(ApkUpdateJob.id == job_id))
    ).scalar_one_or_none()
    if job is None:
        return

    if ok:
        job.status = "succeeded"
        job.installed_version_code = installed_version_code
        job.error = None
        job.finished_at = _now()
    elif job.attempts >= MAX_ATTEMPTS:
        job.status = "failed"
        job.error = error
        job.finished_at = _now()
    else:
        job.status = "queued"
        job.error = error
        job.claimed_at = None

    await db.commit()
```

- [ ] **Step 5: Verify**

```bash
python -c "import app.apk.update_service" && ruff check app/apk/
```

- [ ] **Step 6: Commit**

```bash
git add app/apk/update_service.py app/apk/update_schemas.py tests/test_apk_update_service.py
git commit -m "feat(apk): queue + claim + complete service for operator-driven updates"
```

---

## Task 4: CMS endpoints

**Files:**
- Modify: `app/apk/cms_router.py`
- Test: `tests/test_apk_update_cms_routes.py`

**Interfaces:**
- Consumes: Task 3
- Produces: `POST /api/cms/screens/{screen_id}/update-apk`, `POST /api/cms/screens/update-apk` (bulk), `GET /api/cms/screens/{screen_id}/update-jobs`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_apk_update_cms_routes.py
import pytest


@pytest.mark.asyncio
async def test_update_now_returns_job(client, super_token, outdated_screen):
    r = await client.post(
        f"/api/cms/screens/{outdated_screen.id}/update-apk",
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "queued"


@pytest.mark.asyncio
async def test_update_now_422_when_no_tailscale_ip(client, super_token, screen_no_ip):
    r = await client.post(
        f"/api/cms/screens/{screen_no_ip.id}/update-apk",
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 422
    assert "tailscale" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_screenowner_403_on_foreign_screen(client, owner_token, foreign_screen):
    r = await client.post(
        f"/api/cms/screens/{foreign_screen.id}/update-apk",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r.status_code == 403
```

- [ ] **Step 2: Verify it fails**

Run: `grep -c "update-apk" app/apk/cms_router.py`
Expected: `0`

- [ ] **Step 3: Add the endpoints**

Append to `app/apk/cms_router.py` (add imports for `update_service`, the schemas, `require_screenowner_or_super`, `get_current_cms_user`):

```python
# NOTE ON ROUTE ORDER: the bulk route uses the literal path segment "update-apk"
# under /screens, so it MUST be declared before any "/screens/{screen_id}" route
# in whichever router owns that prefix — otherwise "update-apk" is captured as a
# screen id. Same trap as PATCH /cms/screens/operating-hours.


@router.post("/screens/update-apk", response_model=BulkUpdateResponse)
async def bulk_update_apk(
    payload: BulkUpdateRequest,
    actor: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
) -> BulkUpdateResponse:
    """Queue an APK update on many screens.

    A superadmin hits every screen they can see; a screenowner only their assigned
    ones. Screens that cannot be updated are skipped with a reason, never errored —
    one screen missing a Tailscale address must not fail the whole rollout.
    """
    try:
        queued, skipped, reasons = await update_service.queue_bulk_update(
            db, actor, screen_ids=payload.screen_ids, only_outdated=payload.only_outdated
        )
    except update_service.UpdateNotPossible as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.reason)
    return BulkUpdateResponse(queued=queued, skipped=skipped, reasons=reasons)


@router.post("/screens/{screen_id}/update-apk", response_model=QueueUpdateResponse)
async def update_screen_apk(
    screen_id: str,
    actor: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
) -> QueueUpdateResponse:
    """Queue this one screen for an APK update. Screenowners: own screens only."""
    try:
        job = await update_service.queue_update(db, actor, screen_id)
    except update_service.UpdateNotPossible as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.reason)
    return QueueUpdateResponse(
        job_id=job.id,
        screen_id=job.screen_id,
        target_version_code=job.target_version_code,
        status=job.status,
    )


@router.get("/screens/{screen_id}/update-jobs", response_model=List[ApkUpdateJobOut])
async def list_update_jobs(
    screen_id: str,
    actor: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
) -> List[ApkUpdateJobOut]:
    """Recent update attempts for one screen — this is what the CMS status chip reads."""
    await assert_can_manage_screen(db, actor, screen_id)
    rows = (
        await db.execute(
            select(ApkUpdateJob)
            .where(ApkUpdateJob.screen_id == screen_id)
            .order_by(ApkUpdateJob.created_at.desc())
            .limit(10)
        )
    ).scalars()
    return [ApkUpdateJobOut.model_validate(r) for r in rows]
```

- [ ] **Step 4: Verify**

```bash
python -c "import app.main" && ruff check app/apk/
python -c "
from app.main import app
for r in app.routes:
    if 'update-apk' in getattr(r, 'path', ''): print(r.methods, r.path)
"
```
Expected: prints the bulk route **before** the `{screen_id}` route.

- [ ] **Step 5: Commit**

```bash
git add app/apk/cms_router.py tests/test_apk_update_cms_routes.py
git commit -m "feat(cms): update-apk endpoints, per-screen and bulk, role-scoped"
```

---

## Task 5: Agent endpoints + secret

**Files:**
- Create: `app/apk/agent_router.py`
- Modify: `app/core/config.py`, `app/main.py`
- Test: `tests/test_apk_agent_routes.py`

**Interfaces:**
- Consumes: Task 3
- Produces: `POST /api/agent/apk/claim`, `POST /api/agent/apk/report`, both gated on header `X-Agent-Secret`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_apk_agent_routes.py
import pytest


@pytest.mark.asyncio
async def test_claim_requires_secret(client):
    r = await client.post("/api/agent/apk/claim", json={"limit": 5})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_claim_returns_queued_jobs(client, agent_secret, queued_job):
    r = await client.post(
        "/api/agent/apk/claim",
        json={"limit": 5},
        headers={"X-Agent-Secret": agent_secret},
    )
    assert r.status_code == 200
    jobs = r.json()["jobs"]
    assert jobs[0]["job_id"] == queued_job.id
    assert jobs[0]["tailscale_ip"]
    assert jobs[0]["sha256"]
```

- [ ] **Step 2: Verify it fails**

Run: `python -c "import app.apk.agent_router"`
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Add the setting**

In `app/core/config.py`, beside `CRON_SECRET` (currently `:147`):

```python
    # Shared secret for the updater agent on the headscale VM. Same pattern as
    # CRON_SECRET: the agent is an unattended machine, not a person, so there is
    # no JWT to issue it. Must be overridden in production.
    AGENT_SECRET: str = "markai-dev-agent-secret-change-in-production"
```

- [ ] **Step 4: Write the router**

Create `app/apk/agent_router.py`:

```python
"""Endpoints for the updater agent on the headscale VM.

The agent POLLS these; nothing calls into the agent. That keeps the VM with no
inbound exposure beyond Headscale itself, and mirrors how cron-job.org drives the
existing /api/cron endpoints.
"""

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.apk import update_service
from app.apk.update_schemas import AgentClaimResponse, AgentReportRequest
from app.core.config import settings
from app.core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent/apk", tags=["agent"])


def _require_agent_secret(x_agent_secret: str = Header(default="")) -> None:
    if not settings.AGENT_SECRET or x_agent_secret != settings.AGENT_SECRET:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid agent secret")


class ClaimRequest(BaseModel):
    # Small by default: each job blacks out a screen for up to a minute, so the
    # agent working a few at a time is a feature, not a throughput problem.
    limit: int = 5


@router.post("/claim", response_model=AgentClaimResponse)
async def claim(
    payload: ClaimRequest,
    _=Depends(_require_agent_secret),
    db: AsyncSession = Depends(get_db),
) -> AgentClaimResponse:
    jobs = await update_service.claim_jobs(db, limit=payload.limit)
    return AgentClaimResponse(jobs=jobs)


@router.post("/report")
async def report(
    payload: AgentReportRequest,
    _=Depends(_require_agent_secret),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await update_service.complete_job(
        db,
        payload.job_id,
        ok=payload.ok,
        installed_version_code=payload.installed_version_code,
        error=payload.error,
    )
    logger.info("Agent reported job %s ok=%s", payload.job_id, payload.ok)
    return {"ok": True}
```

- [ ] **Step 5: Mount it**

In `app/main.py`, beside the other `include_router` calls (around `:132`):

```python
from app.apk.agent_router import router as apk_agent_router

app.include_router(apk_agent_router, prefix=settings.API_PREFIX)
```

- [ ] **Step 6: Verify**

```bash
python -c "import app.main" && ruff check app/apk/
python -c "
from app.main import app
print([r.path for r in app.routes if 'agent' in getattr(r,'path','')])
"
```
Expected: `['/api/agent/apk/claim', '/api/agent/apk/report']`

- [ ] **Step 7: Commit**

```bash
git add app/apk/agent_router.py app/core/config.py app/main.py tests/test_apk_agent_routes.py
git commit -m "feat(apk): agent claim/report endpoints with shared-secret auth"
```

---

## Task 6: The updater agent

**Files:**
- Create: `markai-update-agent/agent.py`, `requirements.txt`, `markai-update-agent.service`, `deploy.sh`, `README.md`
- Test: `markai-update-agent/test_agent.py`

**Interfaces:**
- Consumes: Task 5 (`/api/agent/apk/claim`, `/api/agent/apk/report`)
- Produces: nothing consumed by other tasks

- [ ] **Step 1: Write the failing test**

```python
# markai-update-agent/test_agent.py
import hashlib
from agent import verify_sha256, parse_installed_version


def test_verify_sha256_accepts_matching(tmp_path):
    f = tmp_path / "a.apk"
    f.write_bytes(b"hello")
    assert verify_sha256(str(f), hashlib.sha256(b"hello").hexdigest()) is True


def test_verify_sha256_rejects_mismatch(tmp_path):
    f = tmp_path / "a.apk"
    f.write_bytes(b"hello")
    assert verify_sha256(str(f), "0" * 64) is False


def test_parse_installed_version_reads_dumpsys():
    out = "    versionCode=10100 minSdk=24 targetSdk=34\n    versionName=1.1.0"
    assert parse_installed_version(out) == 10100


def test_parse_installed_version_returns_none_when_absent():
    assert parse_installed_version("no package found") is None
```

- [ ] **Step 2: Verify it fails**

Run: `cd markai-update-agent && python -c "import agent"`
Expected: `ModuleNotFoundError: No module named 'agent'`

- [ ] **Step 3: Write the agent**

Create `markai-update-agent/agent.py`:

```python
#!/usr/bin/env python3
"""Mark AI updater agent — installs player APKs onto screens over Headscale.

Runs on the `headscale` GCE VM, which is the only machine that is both on the
tailnet and holds an adb key the screens have authorized.

Design notes worth keeping:

* It POLLS the backend. Nothing calls in, so the VM needs no inbound exposure
  beyond Headscale itself.
* It NEVER trusts adb's exit code. Under some setups the install succeeds while
  the output is truncated or empty, because the package manager kills the pipe.
  Success is confirmed by reading the installed versionCode back off the device.
* It verifies sha256 BEFORE touching the device. A truncated download must fail
  here, cheaply, rather than part-way through replacing a running player.
"""

import hashlib
import logging
import os
import re
import subprocess
import sys
import time
from typing import Optional

import requests

API_BASE = os.environ["MARKAI_API_BASE"].rstrip("/")
AGENT_SECRET = os.environ["MARKAI_AGENT_SECRET"]
BUCKET = os.environ.get("MARKAI_BUCKET", "markai-storage")
POLL_SECONDS = int(os.environ.get("MARKAI_POLL_SECONDS", "20"))
CACHE_DIR = os.environ.get("MARKAI_CACHE_DIR", "/var/lib/markai-agent/apk")
PKG = "tech.markai.player"

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout
)
log = logging.getLogger("markai-agent")

_VERSION_CODE_RE = re.compile(r"versionCode=(\d+)")


def verify_sha256(path: str, expected: str) -> bool:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest() == expected


def parse_installed_version(dumpsys_output: str) -> Optional[int]:
    m = _VERSION_CODE_RE.search(dumpsys_output)
    return int(m.group(1)) if m else None


def run(cmd: list, timeout: int = 180) -> subprocess.CompletedProcess:
    log.info("$ %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def fetch_apk(gcs_object: str, version_code: int, sha256: str) -> str:
    """Download the release once and reuse it for every screen in this rollout."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    local = os.path.join(CACHE_DIR, f"{version_code}.apk")
    if os.path.exists(local) and verify_sha256(local, sha256):
        return local
    res = run(["gcloud", "storage", "cp", f"gs://{BUCKET}/{gcs_object}", local], timeout=600)
    if res.returncode != 0:
        raise RuntimeError(f"GCS download failed: {res.stderr.strip()[:300]}")
    if not verify_sha256(local, sha256):
        os.remove(local)
        raise RuntimeError("sha256 mismatch — refusing to install")
    return local


def installed_version(target: str) -> Optional[int]:
    res = run(["adb", "-s", target, "shell", "dumpsys", "package", PKG])
    return parse_installed_version(res.stdout)


def install_on(ip: str, apk_path: str, expected_code: int) -> int:
    """Install and return the versionCode the device reports afterwards."""
    target = f"{ip}:5555"

    run(["adb", "disconnect", target], timeout=30)
    con = run(["adb", "connect", target], timeout=60)
    if "connected" not in con.stdout.lower():
        raise RuntimeError(f"adb connect failed: {con.stdout.strip()} {con.stderr.strip()}")
    if "unauthorized" in run(["adb", "devices"]).stdout:
        raise RuntimeError(
            "Device reports 'unauthorized' — this agent's adb key was never approved "
            "on that box. It cannot be approved remotely; someone must tap Allow on "
            "the screen."
        )

    res = run(["adb", "-s", target, "install", "-r", apk_path], timeout=600)
    combined = f"{res.stdout} {res.stderr}"

    # Do not gate on returncode: confirm from the device itself.
    actual = installed_version(target)
    run(["adb", "disconnect", target], timeout=30)

    if actual == expected_code:
        return actual
    raise RuntimeError(
        f"install did not take (device reports {actual}, wanted {expected_code}): "
        f"{combined.strip()[:300]}"
    )


def claim(limit: int = 5) -> list:
    r = requests.post(
        f"{API_BASE}/api/agent/apk/claim",
        json={"limit": limit},
        headers={"X-Agent-Secret": AGENT_SECRET},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("jobs", [])


def report(job_id: str, ok: bool, code: Optional[int], error: Optional[str]) -> None:
    requests.post(
        f"{API_BASE}/api/agent/apk/report",
        json={
            "job_id": job_id,
            "ok": ok,
            "installed_version_code": code,
            "error": (error or "")[:1000] or None,
        },
        headers={"X-Agent-Secret": AGENT_SECRET},
        timeout=30,
    ).raise_for_status()


def main() -> None:
    log.info("markai updater agent starting; api=%s poll=%ss", API_BASE, POLL_SECONDS)
    while True:
        try:
            for job in claim():
                jid = job["job_id"]
                try:
                    apk = fetch_apk(job["gcs_object"], job["target_version_code"], job["sha256"])
                    code = install_on(job["tailscale_ip"], apk, job["target_version_code"])
                    log.info("job %s OK — screen now on %s", jid, code)
                    report(jid, True, code, None)
                except Exception as exc:  # noqa: BLE001 - report everything upward
                    log.warning("job %s FAILED: %s", jid, exc)
                    report(jid, False, None, str(exc))
        except Exception as exc:  # noqa: BLE001 - never let the loop die
            log.error("poll cycle failed: %s", exc)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write requirements and the unit**

`markai-update-agent/requirements.txt`:
```
requests==2.32.3
```

`markai-update-agent/markai-update-agent.service`:
```ini
[Unit]
Description=Mark AI player APK updater agent
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
Environment=MARKAI_API_BASE=https://cms-api.mark-ai.tech
Environment=MARKAI_BUCKET=markai-storage
Environment=MARKAI_CACHE_DIR=/var/lib/markai-agent/apk
EnvironmentFile=/etc/markai-agent.env
ExecStart=/usr/bin/python3 /opt/markai-agent/agent.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

`/etc/markai-agent.env` on the VM holds only `MARKAI_AGENT_SECRET=...`, mode `600`. It is **not** in the repo.

- [ ] **Step 5: Write the deploy script**

`markai-update-agent/deploy.sh`:
```bash
#!/bin/bash
# Ship the agent to the headscale VM and restart it.
set -euo pipefail
ZONE=us-central1-a
PROJECT=markai-499512
VM=headscale

gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap \
  --command="sudo mkdir -p /opt/markai-agent /var/lib/markai-agent/apk"

for f in agent.py requirements.txt markai-update-agent.service; do
  gcloud compute scp "$f" "$VM:/tmp/$f" --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap
done

gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap --command="
  set -e
  sudo mv /tmp/agent.py /opt/markai-agent/agent.py
  sudo mv /tmp/requirements.txt /opt/markai-agent/requirements.txt
  sudo mv /tmp/markai-update-agent.service /etc/systemd/system/markai-update-agent.service
  sudo apt-get install -y -qq python3-pip adb
  sudo pip3 install --break-system-packages -q -r /opt/markai-agent/requirements.txt
  test -f /etc/markai-agent.env || { echo 'MISSING /etc/markai-agent.env — create it with MARKAI_AGENT_SECRET=...'; exit 1; }
  sudo systemctl daemon-reload
  sudo systemctl enable --now markai-update-agent
  sudo systemctl is-active markai-update-agent
"
```

- [ ] **Step 6: Verify locally**

```bash
cd markai-update-agent
python -c "import ast,sys; ast.parse(open('agent.py').read())" && echo "syntax ok"
chmod +x deploy.sh
```

- [ ] **Step 7: Commit**

```bash
git add markai-update-agent/
git commit -m "feat(agent): updater agent that installs APKs over Headscale"
```

---

## Task 7: CMS types and API client

**Files:**
- Modify: `markai-Web-cms/src/lib/types.ts`, `src/lib/api.ts`
- Test: `src/lib/__tests__/api-apk-update.test.ts`

**Interfaces:**
- Consumes: Task 4
- Produces: `api.updateScreenApk(id)`, `api.bulkUpdateApk(body)`, `api.apkUpdateJobs(id)`; types `ApkUpdateJob`, `BulkUpdateResponse`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/api-apk-update.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "@/lib/api";

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ queued: 2, skipped: 1, reasons: [] }),
  }) as unknown as typeof fetch;
});

describe("apk update api", () => {
  it("posts to the per-screen route", async () => {
    await api.updateScreenApk("screen-1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/cms/screens/screen-1/update-apk"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("posts a raw object, not a pre-stringified body", async () => {
    await api.bulkUpdateApk({ only_outdated: true });
    const [, init] = (global.fetch as unknown as vi.Mock).mock.calls[0];
    expect(typeof JSON.parse(init.body as string)).toBe("object");
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd markai-Web-cms && npx vitest run src/lib/__tests__/api-apk-update.test.ts`
Expected: FAIL — `api.updateScreenApk is not a function`

- [ ] **Step 3: Add the types**

In `src/lib/types.ts`, inside `Screen` beside `is_outdated` (currently `:133`):

```typescript
  tailscale_ip?: string | null;
```

And at the end of the file:

```typescript
export type ApkUpdateJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface ApkUpdateJob {
  id: string;
  screen_id: string;
  target_version_code: number;
  status: ApkUpdateJobStatus;
  attempts: number;
  error?: string | null;
  installed_version_code?: number | null;
  created_at: string;
  finished_at?: string | null;
}

export interface BulkApkUpdateResponse {
  queued: number;
  skipped: number;
  reasons: string[];
}
```

- [ ] **Step 4: Add the client methods**

In `src/lib/api.ts`, beside `rescanLocation` (currently `:430-434`). Pass a **raw object** as `body` — `request` stringifies it, and double-stringifying produces a 422:

```typescript
  updateScreenApk: (screenId: string) =>
    request<{ job_id: string; screen_id: string; target_version_code: number; status: string }>(
      `/api/cms/screens/${screenId}/update-apk`,
      { method: "POST" },
    ),

  bulkUpdateApk: (body: { screen_ids?: string[]; only_outdated?: boolean }) =>
    request<BulkApkUpdateResponse>("/api/cms/screens/update-apk", {
      method: "POST",
      body,
    }),

  apkUpdateJobs: (screenId: string) =>
    request<ApkUpdateJob[]>(`/api/cms/screens/${screenId}/update-jobs`),
```

- [ ] **Step 5: Verify**

```bash
npx vitest run src/lib/__tests__/api-apk-update.test.ts && npx tsc --noEmit
```
Expected: PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/api.ts src/lib/__tests__/api-apk-update.test.ts
git commit -m "feat(cms): api client + types for APK update jobs"
```

---

## Task 8: Per-screen "Update now" button

**Files:**
- Modify: `markai-Web-cms/src/app/(dashboard)/screens/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 7
- Produces: nothing

- [ ] **Step 1: Add state and handler**

Near the existing `rescanLocation` handler (currently `:184-186`):

```typescript
const [updating, setUpdating] = useState(false);
const [updateJob, setUpdateJob] = useState<ApkUpdateJob | null>(null);

const startApkUpdate = async () => {
  setUpdating(true);
  try {
    await api.updateScreenApk(id);
    toast.success("Update queued — the screen will install it within a minute.");
    await refreshJobs();
  } catch (e) {
    // The backend returns 422 with a plain-language reason (no Tailscale address,
    // already current, update already running). Show it as-is: it is written for
    // the operator, not for a developer.
    toast.error(e instanceof Error ? e.message : "Could not queue the update.");
  } finally {
    setUpdating(false);
  }
};

const refreshJobs = async () => {
  const jobs = await api.apkUpdateJobs(id);
  setUpdateJob(jobs[0] ?? null);
};
```

- [ ] **Step 2: Add the card**

Model it on the Location card's re-scan affordance (currently `:332-347`), including its "runs the next time this screen checks in" copy style:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Player app</CardTitle>
  </CardHeader>
  <CardContent className="flex flex-col gap-3">
    <div className="font-data text-sm">
      {screen.app_version_name ? `v${screen.app_version_name}` : "version unknown"}
      {screen.is_outdated && <Badge tone="amber" className="ml-2">Outdated</Badge>}
    </div>

    {!screen.tailscale_ip && (
      <p className="text-sm text-muted">
        This screen has no Tailscale address, so it cannot be updated remotely.
        Add one in Edit screen.
      </p>
    )}

    {updateJob && updateJob.status === "running" && (
      <p className="text-sm text-muted">Installing now — the screen goes black for up to a minute.</p>
    )}
    {updateJob && updateJob.status === "failed" && (
      <p className="text-sm text-danger">Last attempt failed: {updateJob.error}</p>
    )}

    <Button
      onClick={startApkUpdate}
      disabled={updating || !screen.tailscale_ip || !screen.is_outdated}
    >
      {updating ? "Queueing…" : "Update now"}
    </Button>
  </CardContent>
</Card>
```

- [ ] **Step 2b: Poll while a job is in flight**

```typescript
useEffect(() => {
  if (!updateJob || !["queued", "running"].includes(updateJob.status)) return;
  const t = setInterval(refreshJobs, 5000);
  return () => clearInterval(t);
}, [updateJob?.status]);
```

- [ ] **Step 3: Verify**

```bash
npm run build && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/screens/[id]/page.tsx"
git commit -m "feat(cms): per-screen Update now button with live job status"
```

---

## Task 9: Bulk "Update outdated" on the screens list

**Files:**
- Modify: `markai-Web-cms/src/app/(dashboard)/screens/page.tsx`

**Interfaces:**
- Consumes: Task 7
- Produces: nothing

- [ ] **Step 1: Add the handler**

Beside `saveBulk` (currently `:130-164`), following its dual-shape convention — explicit ids when a selection exists, otherwise no ids meaning "everything I can manage":

```typescript
const [bulkUpdating, setBulkUpdating] = useState(false);

const bulkUpdateApk = async () => {
  setBulkUpdating(true);
  try {
    const body = hasSelection && !selectAllMatching
      ? { screen_ids: [...selected], only_outdated: true }
      : { only_outdated: true };
    const res = await api.bulkUpdateApk(body);
    toast.success(
      res.skipped
        ? `Queued ${res.queued}. Skipped ${res.skipped}.`
        : `Queued ${res.queued} update${res.queued === 1 ? "" : "s"}.`,
    );
    // Reasons explain the skips — silently skipping reads as success and hides
    // screens that can never be updated (no Tailscale address, never reported).
    res.reasons.slice(0, 5).forEach((r) => toast.info(r));
    clearSelection();
    await load();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Bulk update failed.");
  } finally {
    setBulkUpdating(false);
  }
};
```

- [ ] **Step 2: Add the button**

In the selection bar (currently `:244-273`), next to "Set operating hours":

```tsx
<Button variant="secondary" onClick={bulkUpdateApk} disabled={bulkUpdating}>
  {bulkUpdating
    ? "Queueing…"
    : hasSelection
      ? `Update ${selectionCount} screen${selectionCount === 1 ? "" : "s"}`
      : "Update all outdated"}
</Button>
```

- [ ] **Step 3: Verify**

```bash
npm run build && npm test
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/screens/page.tsx"
git commit -m "feat(cms): bulk Update outdated action on the screens list"
```

---

## Task 10: Deploy and wire up production

**Files:** none in the repo — infrastructure only.

- [ ] **Step 1: Generate and set the agent secret**

```bash
SECRET=$(openssl rand -hex 32)
gcloud run services update cms-back --region=us-central1 --project=markai-499512 \
  --update-env-vars="AGENT_SECRET=$SECRET"
gcloud compute ssh headscale --zone=us-central1-a --project=markai-499512 --tunnel-through-iap \
  --command="echo 'MARKAI_AGENT_SECRET=$SECRET' | sudo tee /etc/markai-agent.env >/dev/null && sudo chmod 600 /etc/markai-agent.env"
```

- [ ] **Step 2: Grant the VM read access to the release bucket**

```bash
SA=$(gcloud compute instances describe headscale --zone=us-central1-a --project=markai-499512 \
  --format="value(serviceAccounts[0].email)")
gcloud storage buckets add-iam-policy-binding gs://markai-storage \
  --member="serviceAccount:$SA" --role=roles/storage.objectViewer --project=markai-499512
```

- [ ] **Step 3: Deploy the agent**

```bash
cd markai-update-agent && ./deploy.sh
gcloud compute ssh headscale --zone=us-central1-a --project=markai-499512 --tunnel-through-iap \
  --command="sudo journalctl -u markai-update-agent -n 20 --no-pager"
```
Expected: `markai updater agent starting; api=https://cms-api.mark-ai.tech poll=20s`

- [ ] **Step 4: Run the migrations in production**

Follow the project's existing Cloud Run migration procedure for `0043` and `0044`.

- [ ] **Step 5: Smoke test end to end**

Set a real screen's `tailscale_ip` in the CMS, click **Update now**, then:
```bash
gcloud compute ssh headscale --zone=us-central1-a --project=markai-499512 --tunnel-through-iap \
  --command="sudo journalctl -u markai-update-agent -n 40 --no-pager"
```
Expected: a claim, a GCS download, an `adb install`, and `job <id> OK — screen now on <code>`. The CMS chip flips to **succeeded**, and the screen's next heartbeat clears its **Outdated** badge on its own — no new code needed, because `is_outdated` already derives from the reported version.

---

## Task 11: Shared adb key (do this BEFORE provisioning any box)

**Files:** none in the repo. Operational, and **order-critical**.

The agent can only reach a box whose adb daemon has authorized the agent's key. That approval requires a physical tap on the device and **cannot be granted remotely**. So the key must exist before the first install, and the same key must be used by whoever provisions boxes.

- [ ] **Step 1: Take the VM's adb key as the fleet key**

```bash
gcloud compute ssh headscale --zone=us-central1-a --project=markai-499512 --tunnel-through-iap \
  --command="sudo adb start-server >/dev/null 2>&1; sudo cat /root/.android/adbkey" > ~/markai-fleet-adbkey
gcloud compute ssh headscale --zone=us-central1-a --project=markai-499512 --tunnel-through-iap \
  --command="sudo cat /root/.android/adbkey.pub" > ~/markai-fleet-adbkey.pub
chmod 600 ~/markai-fleet-adbkey
```

- [ ] **Step 2: Install it on the provisioning laptop**

```bash
cp ~/.android/adbkey ~/.android/adbkey.backup 2>/dev/null || true
cp ~/markai-fleet-adbkey ~/.android/adbkey
cp ~/markai-fleet-adbkey.pub ~/.android/adbkey.pub
adb kill-server && adb start-server
```

From now on, the laptop and the agent present the **same identity**, so the "Allow USB debugging?" tap done once at install also authorizes the server forever.

- [ ] **Step 3: Store the key safely**

Put both files in the team password manager. Losing them means every box needs a physical visit to re-authorize.

---

## Task 12: Field runbook

**Files:** Create `markai-update-agent/README.md`

- [ ] **Step 1: Write the runbook**

It must contain: the per-box provisioning checklist (install release APK → enable USB debugging → `adb tcpip 5555` → install Tailscale → join `https://headscale.mark-ai.tech` with a reusable tagged key → allow the VPN prompt → enable Always-on VPN → record the Tailscale IP into the CMS → **reboot and confirm the box is still reachable**), the `./hs` commands, how to read agent logs, and the four known limitations listed at the top of this plan.

- [ ] **Step 2: Commit**

```bash
git add markai-update-agent/README.md
git commit -m "docs(agent): field runbook for provisioning and troubleshooting"
```

---

## Out of scope, deliberately

- **Canary rings, health-gated auto-halt, rollout objects.** Right at one screen. Add when the fleet makes manual selection painful — the design is in the spec.
- **Any change to the APK or the heartbeat.** This entire plan ships without a new player release, which is what makes it deliverable now.
- **Rollback.** Impossible on Android; fix forward.
- **`sha256` correctness for personalized APKs.** The agent installs the **master** release from `gs://markai-storage/apk/releases/...`, whose `release.sha256` is correct. The known bug — `app/apk/service.py:204` returning the master hash while serving personalized bytes — only affects the per-owner download path and is not touched here. Fix it separately.
