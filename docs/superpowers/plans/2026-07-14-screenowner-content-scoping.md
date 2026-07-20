# Multi-tenant Content & Solution Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope CMS content AND solutions per screenowner — an owner sees only what they created/uploaded or what runs on their assigned screens; superadmin sees everything. Attribute AI-promoted library creatives to their uploader.

**Architecture:** Add one `uploaded_by` FK on `media_assets`; stamp it on every create path (direct create, GCS commit, AI promotion). Add reusable "what this screenowner may see" SQL conditions for content (`screenowner_media_scope`) and solutions (`screenowner_solution_scope`), and apply them to lists, reads, and rename/delete. Open the solution routes (currently superadmin-only) to screenowners with scoping + a per-screen create guard. CMS gains a `Media.uploaded_by` type and exposes the Solution nav to owners.

**Tech Stack:** FastAPI, async SQLAlchemy 2.0 (asyncpg in prod, aiosqlite in tests), Alembic (sync psycopg2), pytest-asyncio; Next.js/TypeScript CMS.

**Task map:** Tasks 1–4 = content backend. Task 5 = CMS media type. Task 6 = AI-promotion attribution. Task 7 = solutions backend scoping. Task 8 = CMS solutions exposure. Task 9 = scope the AI co-pilot's `list_media` tool. Tasks are independently testable; do them in order — 6 depends on `create_media(uploaded_by=…)` from 2; 9 depends on `screenowner_media_scope` from 3; 7 depends on the `get_assigned_screen_ids` usage pattern from 3.

## Global Constraints

- Backend repo: `markai-signage-api`. CMS repo: `markai-Web-cms`.
- Tests build the schema from the models via `Base.metadata.create_all` (aiosqlite in-memory) — they do **NOT** run Alembic migrations. So a model column appears in tests automatically; the migration is verified separately on real Postgres.
- Roles are `superadmin` / `screenowner` (`CmsUser.role`). Superadmin is unrestricted everywhere.
- The lint gate is `ruff` (not black). Run `poetry run ruff check app tests` before committing backend changes.
- Do NOT change the player REST contract or any `/api/ext/*` route.
- Migration head is currently `0029_screenowner_enrollment_key`; the new migration is `0030`. Solutions need **no** migration — `solutions.created_by` and `solutions.screen_id` already exist.
- Roles helpers: `require_superadmin`, `require_screenowner_or_super`, and `assert_can_manage_screen(db, user, screen_id)` all live in `app/cms_users/deps.py`.
- Commit as `akshatgg`; end commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do not push or open PRs unless explicitly asked.

---

### Task 1: Add `uploaded_by` column, migration, and response field

**Files:**
- Modify: `app/content/models.py` (add column + import)
- Create: `alembic/versions/0030_media_uploaded_by.py`
- Modify: `app/content/schemas.py:50-59` (`MediaAssetResponse`)
- Modify: `app/content/service.py:18-29` (`to_response`)

**Interfaces:**
- Produces: `MediaAsset.uploaded_by: Mapped[str | None]` (FK → `cms_users.id`, `ON DELETE SET NULL`); `MediaAssetResponse.uploaded_by: Optional[str]`.

- [ ] **Step 1: Add the column to the model**

In `app/content/models.py`, change the import line
```python
from sqlalchemy import DateTime, Integer, String, func
```
to
```python
from sqlalchemy import DateTime, ForeignKey, Integer, String, func
```
and add this column immediately after the `checksum` column (before `created_at`):
```python
    # Who uploaded this creative (CMS user id). Null for legacy rows and the
    # admin-key / AI-chat paths that carry no CMS user. ON DELETE SET NULL so
    # deleting a user never deletes their creatives (bookings reference them).
    uploaded_by: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("cms_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
```

- [ ] **Step 2: Expose it on the response schema**

In `app/content/schemas.py`, add to `MediaAssetResponse` (after `checksum`):
```python
    uploaded_by: Optional[str] = None
```

- [ ] **Step 3: Pass it through `to_response`**

In `app/content/service.py`, add to the `MediaAssetResponse(...)` call in `to_response` (after `checksum=asset.checksum,`):
```python
        uploaded_by=asset.uploaded_by,
```

- [ ] **Step 4: Write the migration**

Create `alembic/versions/0030_media_uploaded_by.py`:
```python
"""media uploaded_by

Adds ``media_assets.uploaded_by`` — the CMS user who uploaded the creative.
Nullable (legacy rows + admin-key/AI-chat paths carry no CMS user). ON DELETE
SET NULL so removing a user never deletes their creatives (bookings reference
them). Enables per-screenowner content scoping.

Revision ID: 0030_media_uploaded_by
Revises: 0029_screenowner_enrollment_key
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0030_media_uploaded_by"
down_revision: Union[str, Sequence[str], None] = "0029_screenowner_enrollment_key"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "media_assets",
        sa.Column("uploaded_by", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_media_assets_uploaded_by", "media_assets", ["uploaded_by"]
    )
    op.create_foreign_key(
        "fk_media_assets_uploaded_by_cms_users",
        "media_assets",
        "cms_users",
        ["uploaded_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_media_assets_uploaded_by_cms_users", "media_assets", type_="foreignkey"
    )
    op.drop_index("ix_media_assets_uploaded_by", table_name="media_assets")
    op.drop_column("media_assets", "uploaded_by")
```

- [ ] **Step 5: Verify the model change loads and tests still pass**

Run: `poetry run pytest tests/test_cms.py -q`
Expected: PASS (the new nullable column is additive; `create_all` picks it up, existing content responses now include `uploaded_by: null`).

- [ ] **Step 6: Verify the migration on a throwaway Postgres**

Run:
```bash
docker run -d --name mig0030 -e POSTGRES_USER=markai -e POSTGRES_PASSWORD=markai -e POSTGRES_DB=markai_signage -p 5467:5432 postgres:15-alpine
sleep 4
DATABASE_URL="postgresql://markai:markai@localhost:5467/markai_signage" poetry run alembic upgrade head
DATABASE_URL="postgresql://markai:markai@localhost:5467/markai_signage" poetry run alembic downgrade -1
docker rm -f mig0030
```
Expected: `upgrade head` runs through `0030` with no error; `downgrade -1` cleanly drops the column. (If Docker/Postgres is unavailable, note it — the model + create_all path is exercised by the tests.)

- [ ] **Step 7: Commit**

```bash
git add app/content/models.py app/content/schemas.py app/content/service.py alembic/versions/0030_media_uploaded_by.py
git commit -m "feat(content): add uploaded_by to media_assets (migration 0030)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Attribute uploads/creates to the CMS user

**Files:**
- Modify: `app/content/service.py:32-46` (`create_media` — add `uploaded_by` param)
- Modify: `app/cms/content_router.py:29-35` (`create_content` — pass `user.id`)
- Modify: `app/content/gcs_service.py:171-181` (`commit_upload` — stamp `uploaded_by`)
- Test: `tests/test_content_scoping.py` (new; created here, extended in Task 3/4)

**Interfaces:**
- Consumes: `MediaAsset.uploaded_by` (Task 1).
- Produces: `create_media(db, payload, uploaded_by: str | None = None)`; content created via `POST /cms/content` and committed via `POST /cms/content/commit` now carries the caller's id.

- [ ] **Step 1: Write the failing test**

Create `tests/test_content_scoping.py`:
```python
"""Per-screenowner content scoping: attribution + visibility."""

import pytest_asyncio

from app.cms_users.service import seed_superadmin

SUPERADMIN_USERNAME = "superadmin"
SUPERADMIN_PASSWORD = "Admin@123"


@pytest_asyncio.fixture
async def seeded(db_sessionmaker):
    async with db_sessionmaker() as session:
        await seed_superadmin(session)
        await session.commit()


async def _login(client, username=SUPERADMIN_USERNAME, password=SUPERADMIN_PASSWORD):
    resp = await client.post(
        "/api/cms/auth/login", json={"username": username, "password": password}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _create_screenowner(client, sa_token, username="owner1"):
    resp = await client.post(
        "/api/cms/users",
        headers=_bearer(sa_token),
        json={"username": username, "password": "pass1234", "role": "screenowner"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_create_content_attributes_uploader(client, seeded):
    sa = await _login(client)
    owner = await _create_screenowner(client, sa["access_token"])
    owner_login = await _login(client, "owner1", "pass1234")

    resp = await client.post(
        "/api/cms/content",
        headers=_bearer(owner_login["access_token"]),
        json={"type": "image", "file_url": "https://x/y.png", "duration_seconds": 10},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["uploaded_by"] == owner["id"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `poetry run pytest tests/test_content_scoping.py::test_create_content_attributes_uploader -q`
Expected: FAIL — `uploaded_by` is `None` (create path doesn't stamp it yet).

- [ ] **Step 3: Add the `uploaded_by` param to `create_media`**

In `app/content/service.py`, change `create_media`:
```python
async def create_media(
    db: AsyncSession, payload: CreateMediaRequest, uploaded_by: str | None = None
) -> MediaAssetResponse:
    name = payload.name.strip() if payload.name and payload.name.strip() else None
    asset = MediaAsset(
        name=name,
        type=payload.type,
        file_url=payload.file_url,
        duration_seconds=payload.duration_seconds,
        width=payload.width,
        height=payload.height,
        checksum=payload.checksum,
        uploaded_by=uploaded_by,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return to_response(asset)
```

- [ ] **Step 4: Pass the user id from the router**

In `app/cms/content_router.py`, change `create_content` so the user is bound (not discarded) and forwarded:
```python
@router.post("", response_model=MediaAssetResponse)
async def create_content(
    payload: CreateMediaRequest,
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
) -> MediaAssetResponse:
    return await service.create_media(db, payload, uploaded_by=user.id)
```

- [ ] **Step 5: Stamp `uploaded_by` on the direct-upload commit path**

In `app/content/gcs_service.py`, in `commit_upload`, add `uploaded_by=user_id` to the `MediaAsset(...)` construction (after `checksum=None,`):
```python
    asset = MediaAsset(
        name=clean_name or None,
        type=media_type,
        file_url=public_url_for_blob(blob_name),
        duration_seconds=_duration_for(media_type, payload.duration_seconds),
        width=int(payload.width) if payload.width else None,
        height=int(payload.height) if payload.height else None,
        checksum=None,
        uploaded_by=user_id,
    )
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `poetry run pytest tests/test_content_scoping.py::test_create_content_attributes_uploader -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/content/service.py app/cms/content_router.py app/content/gcs_service.py tests/test_content_scoping.py
git commit -m "feat(content): attribute uploads to the CMS user

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Scope the content list for screenowners

**Files:**
- Modify: `app/content/service.py` (add `screenowner_media_scope` helper)
- Modify: `app/cms/content_router.py:68-101` (`list_content` — apply scope)
- Test: `tests/test_content_scoping.py` (add visibility tests)

**Interfaces:**
- Consumes: `MediaAsset.uploaded_by` (Task 1); `get_assigned_screen_ids(db, user_id)` from `app.cms_users.service`.
- Produces: `async def screenowner_media_scope(db, user) -> ColumnElement | None` — a SQLAlchemy boolean condition limiting `MediaAsset` rows a screenowner may see; `None` for superadmin (no restriction).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_content_scoping.py`:
```python
from app.bookings.models import Booking
from app.content.models import MediaAsset


async def _make_media(db_sessionmaker, media_id, uploaded_by=None):
    async with db_sessionmaker() as db:
        db.add(MediaAsset(
            id=media_id, name=media_id, type="image",
            file_url=f"https://x/{media_id}.png", duration_seconds=10,
            uploaded_by=uploaded_by,
        ))
        await db.commit()


async def _book_media_on_screen(db_sessionmaker, booking_id, screen_id, media_id):
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    async with db_sessionmaker() as db:
        db.add(Booking(
            id=booking_id, name=booking_id, screen_id=screen_id, media_id=media_id,
            schedule_type="continuous", status="active",
            start_at=now, end_at=now + timedelta(days=1),
        ))
        await db.commit()


async def _loop_media_on_screen(db_sessionmaker, loop_id, screen_id, media_id):
    from app.loops.models import LoopItem
    async with db_sessionmaker() as db:
        db.add(LoopItem(id=loop_id, screen_id=screen_id, media_id=media_id))
        await db.commit()


async def _register_screen_for_owner(client, enrollment_key, device_uid):
    resp = await client.post("/api/screens/register", json={
        "device_uid": device_uid,
        "enrollment_key": enrollment_key,
        "device_info": {"model": "Pixel"},
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["screen_id"]


async def _content_ids(client, token):
    resp = await client.get("/api/cms/content", headers=_bearer(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return {m["id"] for m in body["content"]}, body["total"]


async def test_owner_sees_own_upload(client, seeded, db_sessionmaker):
    sa = await _login(client)
    owner = await _create_screenowner(client, sa["access_token"])
    owner_login = await _login(client, "owner1", "pass1234")
    await _make_media(db_sessionmaker, "mine", uploaded_by=owner["id"])

    ids, total = await _content_ids(client, owner_login["access_token"])
    assert ids == {"mine"}
    assert total == 1


async def test_owner_sees_media_booked_on_their_screen(client, seeded, db_sessionmaker):
    sa = await _login(client)
    owner = await _create_screenowner(client, sa["access_token"])
    owner_login = await _login(client, "owner1", "pass1234")
    screen_id = await _register_screen_for_owner(
        client, owner["enrollment_key"], "dev-own-1"
    )
    # Uploaded by superadmin (uploaded_by unrelated), but runs on my screen.
    await _make_media(db_sessionmaker, "onscreen", uploaded_by=sa["user"]["id"])
    await _book_media_on_screen(db_sessionmaker, "bk1", screen_id, "onscreen")

    ids, _ = await _content_ids(client, owner_login["access_token"])
    assert "onscreen" in ids


async def test_owner_sees_media_looped_on_their_screen(client, seeded, db_sessionmaker):
    sa = await _login(client)
    owner = await _create_screenowner(client, sa["access_token"])
    owner_login = await _login(client, "owner1", "pass1234")
    screen_id = await _register_screen_for_owner(
        client, owner["enrollment_key"], "dev-loop-1"
    )
    await _make_media(db_sessionmaker, "looped", uploaded_by=sa["user"]["id"])
    await _loop_media_on_screen(db_sessionmaker, "lp1", screen_id, "looped")

    ids, _ = await _content_ids(client, owner_login["access_token"])
    assert "looped" in ids


async def test_owner_does_not_see_unrelated_media(client, seeded, db_sessionmaker):
    sa = await _login(client)
    owner_a = await _create_screenowner(client, sa["access_token"], "ownerA")
    await _create_screenowner(client, sa["access_token"], "ownerB")
    a_login = await _login(client, "ownerA", "pass1234")
    # Uploaded by ownerB, not on any of ownerA's screens.
    await _make_media(db_sessionmaker, "theirs", uploaded_by=owner_a["id"] + "-B")

    ids, total = await _content_ids(client, a_login["access_token"])
    assert "theirs" not in ids
    assert total == 0


async def test_superadmin_sees_everything(client, seeded, db_sessionmaker):
    sa = await _login(client)
    await _make_media(db_sessionmaker, "a", uploaded_by=None)
    await _make_media(db_sessionmaker, "b", uploaded_by="someone-else")

    ids, total = await _content_ids(client, sa["access_token"])
    assert {"a", "b"}.issubset(ids)
    assert total >= 2
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `poetry run pytest tests/test_content_scoping.py -q -k "owner_sees or does_not_see"`
Expected: FAIL — `test_owner_sees_own_upload` and `test_owner_does_not_see_unrelated_media` fail because the list is currently unscoped (an owner sees all rows / `total` is wrong).

- [ ] **Step 3: Add the scope helper**

In `app/content/service.py`, add `or_` to the existing sqlalchemy import line — change `from sqlalchemy import func, select` to `from sqlalchemy import func, or_, select`. (`LoopItem` and `Schedule` are already imported at the top of the file, so no other imports are needed.)

Then add the helper:
```python
async def screenowner_media_scope(db: AsyncSession, user):
    """A boolean condition limiting MediaAsset to what a screenowner may see:
    creatives they uploaded, OR creatives booked / looped / scheduled on one of
    their assigned screens. Returns None for superadmin (no restriction)."""
    if user.role == "superadmin":
        return None
    # Lazy import avoids any import cycle with cms_users.
    from app.cms_users.service import get_assigned_screen_ids

    assigned = await get_assigned_screen_ids(db, user.id)
    return or_(
        MediaAsset.uploaded_by == user.id,
        MediaAsset.id.in_(
            select(Booking.media_id).where(Booking.screen_id.in_(assigned))
        ),
        MediaAsset.id.in_(
            select(LoopItem.media_id).where(LoopItem.screen_id.in_(assigned))
        ),
        MediaAsset.id.in_(
            select(Schedule.media_id).where(Schedule.screen_id.in_(assigned))
        ),
    )
```

- [ ] **Step 4: Apply the scope in `list_content`**

In `app/cms/content_router.py`, change `list_content` so the user is bound and the scope is added to `conditions`:
```python
@router.get("")
async def list_content(
    q: Optional[str] = Query(default=None, description="Case-insensitive search on media name"),
    limit: Optional[int] = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    if q and q.strip():
        conditions.append(MediaAsset.name.ilike(f"%{q.strip()}%"))

    scope = await service.screenowner_media_scope(db, user)
    if scope is not None:
        conditions.append(scope)

    total = (
        await db.execute(
            select(func.count()).select_from(MediaAsset).where(*conditions)
        )
    ).scalar_one()

    stmt = select(MediaAsset).where(*conditions).order_by(MediaAsset.created_at.desc())
    if limit is not None:
        stmt = stmt.offset(offset).limit(limit)

    result = await db.execute(stmt)
    return {
        "content": [service.to_response(a) for a in result.scalars().all()],
        "total": total,
    }
```
(Keep the existing docstring.)

- [ ] **Step 5: Run all scoping tests to verify they pass**

Run: `poetry run pytest tests/test_content_scoping.py -q`
Expected: PASS (all attribution + visibility tests).

- [ ] **Step 6: Run the broader content/cms suite for regressions**

Run: `poetry run pytest tests/test_cms.py tests/test_content_scoping.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/content/service.py app/cms/content_router.py tests/test_content_scoping.py
git commit -m "feat(content): scope the content list to a screenowner's own + on-screen media

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Scope rename/delete authorization

**Files:**
- Modify: `app/content/service.py` (add `assert_media_visible` helper)
- Modify: `app/cms/content_router.py:104-124` (`rename_content`, `delete_content`)
- Test: `tests/test_content_scoping.py` (add rename/delete auth tests)

**Interfaces:**
- Consumes: `screenowner_media_scope(db, user)` (Task 3).
- Produces: `async def assert_media_visible(db, user, media_id) -> None` — raises 404 if a screenowner tries to touch a creative they can't see; no-op for superadmin.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_content_scoping.py`:
```python
async def test_owner_cannot_rename_invisible_media(client, seeded, db_sessionmaker):
    sa = await _login(client)
    await _create_screenowner(client, sa["access_token"], "ownerX")
    x_login = await _login(client, "ownerX", "pass1234")
    await _make_media(db_sessionmaker, "notmine", uploaded_by="someone")

    resp = await client.patch(
        "/api/cms/content/notmine",
        headers=_bearer(x_login["access_token"]),
        json={"name": "hacked"},
    )
    assert resp.status_code == 404, resp.text


async def test_owner_can_rename_own_media(client, seeded, db_sessionmaker):
    sa = await _login(client)
    owner = await _create_screenowner(client, sa["access_token"], "ownerY")
    y_login = await _login(client, "ownerY", "pass1234")
    await _make_media(db_sessionmaker, "ymine", uploaded_by=owner["id"])

    resp = await client.patch(
        "/api/cms/content/ymine",
        headers=_bearer(y_login["access_token"]),
        json={"name": "renamed"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "renamed"


async def test_owner_cannot_delete_invisible_media(client, seeded, db_sessionmaker):
    sa = await _login(client)
    await _create_screenowner(client, sa["access_token"], "ownerZ")
    z_login = await _login(client, "ownerZ", "pass1234")
    await _make_media(db_sessionmaker, "znotmine", uploaded_by="someone")

    resp = await client.delete(
        "/api/cms/content/znotmine", headers=_bearer(z_login["access_token"])
    )
    assert resp.status_code == 404, resp.text
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `poetry run pytest tests/test_content_scoping.py -q -k "rename or delete"`
Expected: FAIL — rename/delete currently ignore ownership (rename returns 200, delete returns 200/404-from-service, not the visibility 404).

- [ ] **Step 3: Add the visibility guard**

In `app/content/service.py`, add:
```python
async def assert_media_visible(db: AsyncSession, user, media_id: str) -> None:
    """Raise 404 if a screenowner tries to touch a creative they can't see.
    No-op for superadmin. 404 (not 403) so the endpoint never leaks the
    existence of another owner's media."""
    scope = await screenowner_media_scope(db, user)
    if scope is None:
        return
    visible = (
        await db.execute(
            select(MediaAsset.id).where(MediaAsset.id == media_id, scope)
        )
    ).scalar_one_or_none()
    if visible is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Media not found"
        )
```

- [ ] **Step 4: Guard rename and delete in the router**

In `app/cms/content_router.py`, bind the user and call the guard first:
```python
@router.patch("/{media_id}", response_model=MediaAssetResponse)
async def rename_content(
    media_id: str,
    payload: RenameMediaRequest,
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
) -> MediaAssetResponse:
    """Rename a media asset (label only). The file/type/dimensions are immutable."""
    await service.assert_media_visible(db, user, media_id)
    return await service.rename_media(db, media_id, payload.name)


@router.delete("/{media_id}")
async def delete_content(
    media_id: str,
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete a media asset. 404 if not visible to this screenowner; 409 if it's
    currently playing or used by a booking / loop / schedule."""
    await service.assert_media_visible(db, user, media_id)
    await service.delete_media(db, media_id)
    return {"deleted": True}
```

- [ ] **Step 5: Run the full scoping suite to verify it passes**

Run: `poetry run pytest tests/test_content_scoping.py -q`
Expected: PASS (all attribution + visibility + rename/delete tests).

- [ ] **Step 6: Run ruff + the content/cms suite**

Run: `poetry run ruff check app tests && poetry run pytest tests/test_cms.py tests/test_content_scoping.py -q`
Expected: ruff clean; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/content/service.py app/cms/content_router.py tests/test_content_scoping.py
git commit -m "feat(content): gate rename/delete to media a screenowner can see

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CMS — expose `uploaded_by` on the Media type

**Files:**
- Modify: `markai-Web-cms/src/lib/types.ts` (`Media`)

**Interfaces:**
- Consumes: `uploaded_by` on the `/cms/content` response (Task 1).
- Produces: `Media.uploaded_by?: string | null`.

- [ ] **Step 1: Add the field to the Media type**

In `markai-Web-cms/src/lib/types.ts`, add to the `Media` interface:
```typescript
  uploaded_by?: string | null;
```

- [ ] **Step 2: Typecheck**

Run (in `markai-Web-cms`): `npm run typecheck`
Expected: clean. No functional change — the Content page and dashboard "My Media" already read `/cms/content`, which is now scoped server-side, so a screenowner automatically sees only their subset.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(content): add uploaded_by to the Media type

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Attribute AI-promoted library creatives to their uploader

**Files:**
- Modify: `app/ai/executors.py:74-88` (the `create_media` call in `_resolve_bookable_media_id`)
- Test: `tests/test_content_scoping.py` (add one test)

**Interfaces:**
- Consumes: `create_media(db, payload, uploaded_by=...)` (Task 2); `AiChatMedia.uploaded_by`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content_scoping.py`:
```python
async def test_ai_promoted_media_is_attributed(seeded, db_sessionmaker):
    from sqlalchemy import select
    from app.ai.models import AiChatMedia
    from app.ai.executors import _resolve_bookable_media_id
    from app.content.models import MediaAsset

    async with db_sessionmaker() as db:
        db.add(AiChatMedia(
            id="chat-1", turn_id="turn-x", uploaded_by="owner-42",
            gcs_bucket="b", gcs_key="k", file_url="https://x/c.png",
            filename="c.png", type="image", mime_type="image/png",
            size_bytes=123, checksum=None,
        ))
        await db.commit()

    async with db_sessionmaker() as db:
        new_id = await _resolve_bookable_media_id(db, "chat-1")
        asset = (
            await db.execute(select(MediaAsset).where(MediaAsset.id == new_id))
        ).scalar_one()
        assert asset.uploaded_by == "owner-42"
```
(FK enforcement is off in the SQLite test engine, so the fake `turn_id` is fine; `checksum=None` skips dedup so a fresh library row is created.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `poetry run pytest tests/test_content_scoping.py::test_ai_promoted_media_is_attributed -q`
Expected: FAIL — the promoted `MediaAsset.uploaded_by` is `None`.

- [ ] **Step 3: Pass the uploader through the promotion**

In `app/ai/executors.py`, add `uploaded_by=chat_media.uploaded_by` to the `create_media(...)` call (after the `CreateMediaRequest(...)` argument):
```python
    created = await content_service.create_media(
        db,
        CreateMediaRequest(
            name=chat_media.filename,
            type=chat_media.type,
            file_url=chat_media.file_url,
            duration_seconds=chat_media.duration_seconds
            or _PROMOTED_MEDIA_DURATION_SECONDS,
            width=chat_media.width,
            height=chat_media.height,
            checksum=chat_media.checksum,
        ),
        uploaded_by=chat_media.uploaded_by,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `poetry run pytest tests/test_content_scoping.py::test_ai_promoted_media_is_attributed -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/ai/executors.py tests/test_content_scoping.py
git commit -m "feat(content): attribute AI-promoted library creatives to the uploader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Scope solutions and open them to screenowners

**Files:**
- Modify: `app/solutions/service.py` (add scope helper + visibility guard; `list_solutions` gains a `user` arg)
- Modify: `app/solutions/router.py` (auth → `require_screenowner_or_super`; create guard; apply scope)
- Test: `tests/test_solutions_scoping.py` (new)

**Interfaces:**
- Consumes: `get_assigned_screen_ids`, `assert_can_manage_screen`, `require_screenowner_or_super` (`app/cms_users/*`).
- Produces: `screenowner_solution_scope(db, user) -> ColumnElement | None`; `assert_solution_visible(db, user, solution_id) -> None`; `list_solutions(db, user)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_solutions_scoping.py`:
```python
"""Per-screenowner solution scoping: create authz + visibility."""

import pytest_asyncio

from app.cms_users.service import seed_superadmin

SUPERADMIN_USERNAME = "superadmin"
SUPERADMIN_PASSWORD = "Admin@123"
LAYOUT = {"partition_count": 1, "zones": []}


@pytest_asyncio.fixture
async def seeded(db_sessionmaker):
    async with db_sessionmaker() as session:
        await seed_superadmin(session)
        await session.commit()


async def _login(client, username=SUPERADMIN_USERNAME, password=SUPERADMIN_PASSWORD):
    resp = await client.post(
        "/api/cms/auth/login", json={"username": username, "password": password}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_screenowner(client, sa_token, username):
    resp = await client.post(
        "/api/cms/users", headers=_bearer(sa_token),
        json={"username": username, "password": "pass1234", "role": "screenowner"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _register_screen(client, enrollment_key, device_uid):
    resp = await client.post("/api/screens/register", json={
        "device_uid": device_uid, "enrollment_key": enrollment_key,
        "device_info": {"model": "Pixel"},
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["screen_id"]


async def _create_solution(client, token, screen_id, name):
    return await client.post(
        "/api/cms/solutions", headers=_bearer(token),
        json={"name": name, "screen_id": screen_id, "layout": LAYOUT},
    )


async def _list_ids(client, token):
    resp = await client.get("/api/cms/solutions", headers=_bearer(token))
    assert resp.status_code == 200, resp.text
    return {s["id"] for s in resp.json()["solutions"]}


async def test_owner_creates_on_own_screen(client, seeded):
    sa = await _login(client)
    owner = await _create_screenowner(client, sa["access_token"], "owner1")
    o = await _login(client, "owner1", "pass1234")
    screen_id = await _register_screen(client, owner["enrollment_key"], "dev-s-1")
    resp = await _create_solution(client, o["access_token"], screen_id, "Mine")
    assert resp.status_code == 200, resp.text
    assert resp.json()["created_by"] == owner["id"]


async def test_owner_cannot_create_on_unowned_screen(client, seeded):
    sa = await _login(client)
    await _create_screenowner(client, sa["access_token"], "ownerA")
    owner_b = await _create_screenowner(client, sa["access_token"], "ownerB")
    a = await _login(client, "ownerA", "pass1234")
    b_screen = await _register_screen(client, owner_b["enrollment_key"], "dev-b-1")
    resp = await _create_solution(client, a["access_token"], b_screen, "X")
    assert resp.status_code == 403, resp.text


async def test_owner_sees_only_own_and_on_screen(client, seeded):
    sa = await _login(client)
    owner = await _create_screenowner(client, sa["access_token"], "owner1")
    owner_b = await _create_screenowner(client, sa["access_token"], "ownerB")
    o = await _login(client, "owner1", "pass1234")
    my_screen = await _register_screen(client, owner["enrollment_key"], "dev-my-1")
    b_screen = await _register_screen(client, owner_b["enrollment_key"], "dev-b-2")
    mine = (await _create_solution(client, sa["access_token"], my_screen, "OnMine")).json()["id"]
    theirs = (await _create_solution(client, sa["access_token"], b_screen, "OnTheirs")).json()["id"]

    ids = await _list_ids(client, o["access_token"])
    assert mine in ids
    assert theirs not in ids
    sa_ids = await _list_ids(client, sa["access_token"])
    assert {mine, theirs}.issubset(sa_ids)


async def test_owner_cannot_get_or_delete_invisible_solution(client, seeded):
    sa = await _login(client)
    await _create_screenowner(client, sa["access_token"], "owner1")
    owner_b = await _create_screenowner(client, sa["access_token"], "ownerB")
    o = await _login(client, "owner1", "pass1234")
    b_screen = await _register_screen(client, owner_b["enrollment_key"], "dev-b-3")
    theirs = (await _create_solution(client, sa["access_token"], b_screen, "Theirs")).json()["id"]

    g = await client.get(f"/api/cms/solutions/{theirs}", headers=_bearer(o["access_token"]))
    assert g.status_code == 404, g.text
    d = await client.delete(f"/api/cms/solutions/{theirs}", headers=_bearer(o["access_token"]))
    assert d.status_code == 404, d.text
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `poetry run pytest tests/test_solutions_scoping.py -q`
Expected: FAIL — `create_solution` is superadmin-only (owner create → 403 for the wrong reason / 200 never reached), and the list/get/delete are unscoped.

- [ ] **Step 3: Add the scope + visibility helpers to the service**

In `app/solutions/service.py`, add `or_` to the sqlalchemy import (`from sqlalchemy import or_, select`) and add:
```python
async def screenowner_solution_scope(db: AsyncSession, user):
    """Condition limiting Solution rows a screenowner may see: ones they created
    OR ones on one of their assigned screens. None for superadmin."""
    if user.role == "superadmin":
        return None
    from app.cms_users.service import get_assigned_screen_ids

    assigned = await get_assigned_screen_ids(db, user.id)
    return or_(
        Solution.created_by == user.id,
        Solution.screen_id.in_(assigned),
    )


async def assert_solution_visible(db: AsyncSession, user, solution_id: str) -> None:
    """Raise 404 if a screenowner can't see this solution. No-op for superadmin."""
    scope = await screenowner_solution_scope(db, user)
    if scope is None:
        return
    visible = (
        await db.execute(select(Solution.id).where(Solution.id == solution_id, scope))
    ).scalar_one_or_none()
    if visible is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Solution not found"
        )
```

- [ ] **Step 4: Scope `list_solutions`**

In `app/solutions/service.py`, change `list_solutions` to take `user` and apply the scope:
```python
async def list_solutions(db: AsyncSession, user) -> List[SolutionResponse]:
    scope = await screenowner_solution_scope(db, user)
    stmt = select(Solution, Screen).join(Screen, Screen.id == Solution.screen_id)
    if scope is not None:
        stmt = stmt.where(scope)
    stmt = stmt.order_by(Solution.created_at.desc())
    result = await db.execute(stmt)
    return [to_response(sol, screen_name=screen.name) for sol, screen in result.all()]
```

- [ ] **Step 5: Open the routes to screenowners + guard create/get/delete**

Replace `app/solutions/router.py` body (keep the module docstring/imports; add the two new deps):
```python
from app.cms_users.deps import assert_can_manage_screen, require_screenowner_or_super

router = APIRouter(prefix="/cms/solutions", tags=["cms-solutions"])


@router.post("", response_model=SolutionResponse)
async def create_solution(
    payload: CreateSolutionRequest,
    actor: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
) -> SolutionResponse:
    # Owner may only attach a solution to a screen they manage; superadmin any.
    await assert_can_manage_screen(db, actor, payload.screen_id)
    return await service.create_solution(db, payload, created_by=actor.id)


@router.get("", response_model=SolutionListResponse)
async def list_solutions(
    user: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
) -> SolutionListResponse:
    return SolutionListResponse(solutions=await service.list_solutions(db, user))


@router.get("/{solution_id}", response_model=SolutionResponse)
async def get_solution(
    solution_id: str,
    user: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
) -> SolutionResponse:
    await service.assert_solution_visible(db, user, solution_id)
    return await service.get_solution_response(db, solution_id)


@router.delete("/{solution_id}")
async def delete_solution(
    solution_id: str,
    user: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await service.assert_solution_visible(db, user, solution_id)
    await service.delete_solution(db, solution_id)
    return {"deleted": True}
```
Update the import line `from app.cms_users.deps import require_superadmin` → remove it (replaced by the two new deps above).

- [ ] **Step 6: Run the solution tests + ruff**

Run: `poetry run pytest tests/test_solutions_scoping.py -q && poetry run ruff check app tests`
Expected: PASS; ruff clean.

- [ ] **Step 7: Commit**

```bash
git add app/solutions/service.py app/solutions/router.py tests/test_solutions_scoping.py
git commit -m "feat(solutions): scope to screenowner's own + on-screen, open create to owners

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: CMS — expose Solutions to screenowners

**Files:**
- Modify: `markai-Web-cms/src/components/layout/Sidebar.tsx:58`
- Verify: `markai-Web-cms/src/app/(dashboard)/solution/page.tsx` + dashboard "My Solutions" card have no client-side superadmin-only guard.

- [ ] **Step 1: Make the Solution nav item visible to everyone**

In `src/components/layout/Sidebar.tsx`, change line 58 from:
```typescript
    items: [{ href: "/solution", label: "Solution", icon: Layers, visible: isSuperadmin }],
```
to:
```typescript
    items: [{ href: "/solution", label: "Solution", icon: Layers, visible: true }],
```

- [ ] **Step 2: Check for other role guards on the solution page/card**

Run (in `markai-Web-cms`):
```bash
grep -rniE "isSuperadmin|role.*superadmin|superadmin.*only" src/app/\(dashboard\)/solution src/app/\(dashboard\)/page.tsx
```
Expected: no guard that hides the solution page or the "My Solutions" dashboard card from screenowners. If one exists, relax it the same way (owners are allowed; the backend scopes what they receive). The screen-picker in the solution builder should list only the owner's screens — it reads `api.screens()`, which the backend already scopes, so no extra change.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat(solutions): expose the Solution page to screenowners (scoped server-side)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Scope the AI co-pilot's `list_media` tool

**Files:**
- Modify: `app/ai/tools.py` (extract a scoped `list_media_impl`; the tool delegates)
- Test: `tests/test_content_scoping.py` (add one test)

**Interfaces:**
- Consumes: `screenowner_media_scope(db, user)` (Task 3); `AiDeps.user`; the existing
  module-level `search_screens_impl` pattern.
- Produces: `list_media_impl(db, user, query=None) -> list[dict]`.

**Why:** The AI agent's `list_media` tool runs `select(MediaAsset)` unscoped, so a
screenowner using the co-pilot would see every creative — bypassing the REST scoping. The
agent's write executors (`app/ai/executors.py`) already reuse manual authorization
(bookings are superadmin-only + `booked_by`; screen edits go through
`assert_can_manage_screen`), and `list_bookings` / `search_screens` are already
user-scoped, so `list_media` is the only read leak.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content_scoping.py`:
```python
async def test_ai_list_media_is_scoped(client, seeded, db_sessionmaker):
    from sqlalchemy import select
    from app.ai.tools import list_media_impl
    from app.cms_users.models import CmsUser

    sa = await _login(client)
    owner = await _create_screenowner(client, sa["access_token"])
    await _make_media(db_sessionmaker, "mine-ai", uploaded_by=owner["id"])
    await _make_media(db_sessionmaker, "theirs-ai", uploaded_by="someone-else")

    async with db_sessionmaker() as db:
        owner_user = (
            await db.execute(select(CmsUser).where(CmsUser.id == owner["id"]))
        ).scalar_one()
        items = await list_media_impl(db, owner_user)
        ids = {m["media_id"] for m in items}
    assert "mine-ai" in ids
    assert "theirs-ai" not in ids
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `poetry run pytest tests/test_content_scoping.py::test_ai_list_media_is_scoped -q`
Expected: FAIL — `list_media_impl` doesn't exist yet (ImportError).

- [ ] **Step 3: Extract a scoped `list_media_impl` and delegate the tool to it**

In `app/ai/tools.py`, add the import `from app.content import service as content_service`
near the other `app.content` imports, then add this module-level function next to
`search_screens_impl`:
```python
async def list_media_impl(
    db, user, query: Optional[str] = None
) -> list[dict[str, Any]]:
    """Creatives the current user may see — same scope as the manual content list:
    a screenowner sees their own uploads + media on their screens; superadmin all."""
    stmt = select(MediaAsset).order_by(MediaAsset.created_at.desc())
    scope = await content_service.screenowner_media_scope(db, user)
    if scope is not None:
        stmt = stmt.where(scope)
    result = await db.execute(stmt)
    items = [_media_dict(m) for m in result.scalars().all()]
    if query:
        scored = [(text_score(query, m["name"], m["type"]), m) for m in items]
        scored = [(s, m) for s, m in scored if s >= settings.AI_TEXT_MATCH_FLOOR]
        scored.sort(key=lambda pair: pair[0], reverse=True)
        items = [m for _, m in scored]
    return items
```
Then replace the `@agent.tool list_media` body so it delegates:
```python
    @agent.tool
    async def list_media(
        ctx: RunContext[AiDeps], query: Optional[str] = None
    ) -> list[dict]:
        """List uploaded media assets (creatives) the current user may see. Optional name/type filter."""
        return await list_media_impl(ctx.deps.db, ctx.deps.user, query)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `poetry run pytest tests/test_content_scoping.py::test_ai_list_media_is_scoped -q`
Expected: PASS.

- [ ] **Step 5: Run the AI + content suites + ruff for regressions**

Run: `poetry run pytest tests/test_content_scoping.py tests/test_ai_confirm.py -q && poetry run ruff check app tests`
Expected: PASS; ruff clean. (The by-id media fetch in the `check_fit` tool receives ids the agent already got from the now-scoped `list_media`, so it is not an enumeration leak and needs no change.)

- [ ] **Step 6: Commit**

```bash
git add app/ai/tools.py tests/test_content_scoping.py
git commit -m "feat(ai): scope the co-pilot's list_media tool like the manual content list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- The tests share DB state across the `client` (API) and `db_sessionmaker` (direct insert) because both draw sessions from the same per-test in-memory engine — this is the established pattern (see `tests/test_ai_confirm.py`). Direct inserts of `MediaAsset` / `Booking` rows are visible to the API calls.
- `Booking` NOT-NULL columns without defaults are `name`, `screen_id`, `media_id`, `schedule_type`, `start_at`, `end_at` (see `app/bookings/models.py`); `status` defaults to `"active"`. The `_book_media_on_screen` helper sets all of them. `LoopItem` only needs `screen_id` + `media_id` (`position`/`is_active`/`created_at` have defaults).
- Empty `assigned` list → `screen_id.in_([])` matches nothing, so an owner with no screens correctly sees only their own uploads. This is intended.
- Superadmin bypass is centralized in `screenowner_media_scope` returning `None` — list, rename, and delete all funnel through it, so the rule stays in one place.
- `list_solutions` gains a `user` parameter (Task 7). It is called **only** from `app/solutions/router.py`, so the signature change is safe; grep `service.list_solutions(` to confirm no other caller before committing.
- `create_solution` requires the screen to exist (the service raises 404 if not) — the solution tests register a real screen via the enrollment key first, so `screen_id` is valid.
- Solutions reuse the SAME superadmin-bypass pattern (`screenowner_solution_scope` returns `None`) across list / get / delete, mirroring content — keep the rule in that one helper.
