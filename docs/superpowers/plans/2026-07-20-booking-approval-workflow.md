# Booking Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An advertiser booking made on the Mark AI platform becomes a *request* that the screen's owner — or any superadmin — must approve before it is created in the CMS.

**Architecture:** The pending request lives in the platform DB (`markai-backend-new`); the CMS learns nothing until approval, at which point the existing `cms_client.create_booking()` call runs. CMS operators are identified by **email** (Phase 0 renames `cms_users.username` → `email`), and sign into the platform with that same credential, verified live over a new `/api/ext/auth/verify` endpoint — the two systems hash passwords differently and always will, so a live check is the only correct bridge. A **checkbox** on the sign-in page chooses which auth system to ask, because one email may legitimately exist in both.

**Tech Stack:** FastAPI + async SQLAlchemy 2.0 + Alembic + pytest (both backends), Next.js 15 + React 19 + Tailwind + framer-motion + three@0.128.0 (frontend), Next.js + vitest (CMS).

**Spec:** `docs/superpowers/specs/2026-07-20-booking-approval-workflow-design.md`

## Global Constraints

- All **four** repos are already on branch `feature/booking-approval`, cut from `main`. Do not create branches.
- CMS operators are identified by `email`, never `username`. After Phase 0 the string `username` must not appear in `cms_users` code, the CMS login payload, or the ext auth contract.
- The seeded superadmin is `admin@mark-ai.tech` / `Admin@123` (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`). This replaces the old `superadmin` username login — an accepted, deliberate change.
- The sign-in checkbox reads exactly **"I'm a screen owner or administrator"**. Not "superadmin" — a screenowner who reads that leaves it unticked and is wrongly told no account exists.
- `markai-Web-cms` test gate: `npm test` (vitest, `src/lib/` logic only — there is no component-testing setup and adding one is out of scope) plus `npm run build`.
- **Never run `black` in either Python repo.** Neither `main` is black-clean; a repo-wide format would bury this change in an unrelated diff. Match surrounding hand-formatting.
- `markai-signage-api` lint gate: `poetry run ruff check app/api_keys app/cms_users` must stay clean (it passes on `main` today). Ruff has 3 pre-existing failures elsewhere in `app/` — ignore them.
- `markai-backend-new` test gate: `poetry run pytest -q` (15 tests pass on `main` today).
- `markai-frontend-new` has **no test framework**, and no ESLint config either — `npm run lint` runs `next lint`, which prompts interactively to scaffold one and therefore cannot be used as a gate. Gates are `npx tsc --noEmit` and `npm run build`. Do not add vitest, and do not scaffold ESLint.
- Both Python repos use `asyncio_mode = "auto"` — async test functions need no `@pytest.mark.asyncio` decorator.
- `markai-backend-new` has **no `tests/conftest.py`**; the `client` fixture is defined inline at the top of `tests/test_auth.py`. New test modules define their own copy.
- Roles are exactly `advertiser` (platform-native), `screenowner`, `superadmin`. Approval statuses are exactly `pending`, `approved`, `rejected`.
- Production data is wiped before launch: no backfill logic, no data migration of existing sample rows.
- Never commit `.env` or credentials. `CMS_EXT_*` values stay backend-only, never `NEXT_PUBLIC_*`.

---

# Phase 0 — CMS operators get an email

Must land before Phase A: every later task speaks `email`.

### Task A: `cms_users.username` → `cms_users.email`

**Files:**
- Create: `markai-signage-api/alembic/versions/0032_cms_user_email.py`
- Modify: `markai-signage-api/app/cms_users/models.py:37-39`, `app/cms_users/schemas.py`, `app/cms_users/service.py`, `app/cms_users/router.py`, `app/core/config.py:63-64`, `app/gmail/service.py:66`
- Test: `markai-signage-api/tests/test_cms.py` (update), `tests/test_enrollment.py` (update)

**Interfaces:**
- Produces: `CmsUser.email` (String(320), unique, indexed, not null); `LoginRequest{email, password}`; `CmsUserPublic.email`; `CreateUserRequest{email, password, role, ...}`; `service.authenticate(db, email, password)`; `seed_superadmin` seeds `settings.SEED_SUPERADMIN_EMAIL`.

- [ ] **Step 1: Update the existing tests to the new field**

Every test that logs in or creates a user currently sends `username`. In `tests/test_cms.py` and `tests/test_enrollment.py`, change every `"username": "superadmin"` to `"email": "admin@mark-ai.tech"`, every other `"username": "<name>"` in a create-user payload to `"email": "<name>@example.com"`, and every assertion reading `body["username"]` to `body["email"]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd markai-signage-api && poetry run pytest tests/test_cms.py tests/test_enrollment.py -q`
Expected: FAIL — 422 validation errors, because the request models still require `username`.

- [ ] **Step 3: Rename the column on the model**

In `markai-signage-api/app/cms_users/models.py`, replace the `username` column (lines 37-39) with:

```python
    email: Mapped[str] = mapped_column(
        String(320), unique=True, index=True, nullable=False
    )
```

- [ ] **Step 4: Update the schemas**

In `markai-signage-api/app/cms_users/schemas.py`, replace `username` with `email` in `LoginRequest`, `CmsUserPublic` and `CreateUserRequest`. Use `EmailStr` so a malformed address is rejected at the edge:

```python
from pydantic import BaseModel, EmailStr, Field
```

```python
class LoginRequest(BaseModel):
    email: EmailStr
    password: str
```

```python
class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=4)
    role: Literal["superadmin", "screenowner"]
    can_manage_api_keys: Optional[bool] = False
    screen_ids: Optional[List[str]] = None
```

and in `CmsUserPublic` replace `username: str` with `email: EmailStr`.

Confirm `email-validator` is available: it is already a dependency of this repo's Pydantic usage elsewhere; if `poetry run python -c "import email_validator"` fails, run `poetry add email-validator`.

- [ ] **Step 5: Update the service and seed**

In `markai-signage-api/app/cms_users/service.py`, in `to_public` replace `username=user.username` with `email=user.email`; in `authenticate` rename the parameter and the lookup:

```python
async def authenticate(
    db: AsyncSession, email: str, password: str
) -> Optional[CmsUser]:
    """Return the user if credentials are valid and the user is active."""
    user = (
        await db.execute(select(CmsUser).where(CmsUser.email == email.lower().strip()))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
```

In `create_user`, store the address lowercased (`email=payload.email.lower().strip()`), and in `seed_superadmin` use `settings.SEED_SUPERADMIN_EMAIL`.

In `markai-signage-api/app/core/config.py`, replace `SEED_SUPERADMIN_USERNAME` (line 63) with:

```python
    SEED_SUPERADMIN_EMAIL: str = "admin@mark-ai.tech"
```

- [ ] **Step 6: Update the router and the Gmail placeholder**

In `markai-signage-api/app/cms_users/router.py`, update the login handler to pass `payload.email`, and any log line or response referencing `username`.

In `markai-signage-api/app/gmail/service.py:66`, replace the `f"{username}@gmail.com"` placeholder with the operator's real `email` — there is a real address now.

- [ ] **Step 7: Write the migration**

Create `markai-signage-api/alembic/versions/0032_cms_user_email.py`:

```python
"""CMS operators are identified by email, not username.

One credential that works in the CMS and on the Mark AI platform. A straight
rename: production is wiped before launch, so there is no backfill and no
dual-read period to manage.

Revision ID: 0032_cms_user_email
Revises: 0031_booking_ext_attribution
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0032_cms_user_email"
down_revision: Union[str, Sequence[str], None] = "0031_booking_ext_attribution"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_cms_users_username", table_name="cms_users")
    op.alter_column(
        "cms_users",
        "username",
        new_column_name="email",
        existing_type=sa.String(length=255),
        type_=sa.String(length=320),
        existing_nullable=False,
    )
    op.create_index("ix_cms_users_email", "cms_users", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_cms_users_email", table_name="cms_users")
    op.alter_column(
        "cms_users",
        "email",
        new_column_name="username",
        existing_type=sa.String(length=320),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
    op.create_index("ix_cms_users_username", "cms_users", ["username"], unique=True)
```

Before writing this, confirm the existing index name with
`cd markai-signage-api && poetry run alembic upgrade head && psql postgresql://markai:markai@localhost:5433/markai_signage -c '\d cms_users'`
and use the real name if it differs.

- [ ] **Step 8: Run the tests**

Run: `cd markai-signage-api && poetry run pytest -q`
Expected: all pass.

- [ ] **Step 9: Verify the migration and the seeded login**

```bash
cd markai-signage-api && poetry run alembic upgrade head
poetry run pytest -q
```
Expected: migration applies cleanly; suite green.

- [ ] **Step 10: Lint and commit**

Run: `cd markai-signage-api && poetry run ruff check app/api_keys app/cms_users`
Expected: `All checks passed!`

```bash
cd markai-signage-api
git add app alembic tests
git commit -m "feat(cms): identify operators by email instead of username"
```

---

### Task B: The CMS asks for an email

**Files:**
- Modify: `markai-Web-cms/src/app/(dashboard)/users/page.tsx`, the login page under `markai-Web-cms/src/app/login/`, and the API client types (search for `username` under `src/lib/`)

**Interfaces:**
- Consumes: `CmsUserPublic.email`, `LoginRequest{email}`, `CreateUserRequest{email}` (Task A).

- [ ] **Step 1: Find every `username` reference**

Run: `cd markai-Web-cms && grep -rn "username" src/`
Expected: a list covering the login page, the users page form + table, and the API types. That list is this task's work queue.

- [ ] **Step 2: Update the API client types**

In the file that declares the CMS user type and the login/create payloads (under `src/lib/`), rename `username: string` to `email: string` on the user type, the login request, and the create-user request.

- [ ] **Step 3: Update the login page**

Change the field to an email input: `type="email"`, label `Email`, `autoComplete="username"` (correct for a login identifier, email or not), placeholder `admin@mark-ai.tech`, and send `{ email, password }`.

- [ ] **Step 4: Update the users page**

In `markai-Web-cms/src/app/(dashboard)/users/page.tsx`:
- rename the `username` state to `email` and its `FormField` to an email input with label `Email`, placeholder `owner@cafe.com`
- change the validation at line 87 from `!username.trim()` to `!email.trim()`, and keep the min-4-character password rule
- send `email: email.trim().toLowerCase()` in the create payload
- replace `{u.username}` in both the desktop table and the mobile card list with `{u.email}`, and the column header `Username` with `Email`
- update the delete confirmation text at line 131 to name the email

- [ ] **Step 5: Verify**

Run: `cd markai-Web-cms && npm test && npm run build`
Expected: vitest suite green (it covers `src/lib/` logic, none of which changes), build succeeds.

Run: `cd markai-Web-cms && grep -rn "username" src/`
Expected: no matches except `autoComplete="username"`, which is the correct HTML value for a login identifier.

- [ ] **Step 6: Commit**

```bash
cd markai-Web-cms
git add src
git commit -m "feat(users): create and sign in operators with an email"
```

---

# Phase A — `markai-signage-api`

Two additive ext endpoints. No migration, no change to any existing route.

### Task 1: `POST /api/ext/auth/verify`

**Files:**
- Create: `markai-signage-api/app/cms_users/auth_ratelimit.py`
- Modify: `markai-signage-api/app/api_keys/ext_router.py` (imports at 1-45; append endpoint at end of file)
- Test: `markai-signage-api/tests/test_ext_operator_auth.py`

**Interfaces:**
- Consumes: `cms_users.service.authenticate(db, email, password) -> Optional[CmsUser]`, `cms_users.service.get_assigned_screen_ids(db, user_id) -> List[str]`, `api_keys.deps.require_api_key`.
- Produces: `POST /api/ext/auth/verify` → `ExtOperator{id, email, role, screen_ids, is_active}`; the `ExtOperator` pydantic model reused by Task 2.

- [ ] **Step 1: Write the failing test**

Create `markai-signage-api/tests/test_ext_operator_auth.py`:

```python
"""Ext operator auth: the Mark AI platform verifying a CMS credential.

Contract: the platform sends a CMS email+password over its partner key and
gets back the operator's role and the screens they own. Nothing else in the
CMS is reachable this way.
"""

import pytest_asyncio

from app.cms_users import auth_ratelimit
from app.cms_users.service import seed_superadmin

PROVISIONING_KEY = "test-provisioning-key"


@pytest_asyncio.fixture
async def seeded(db_sessionmaker):
    auth_ratelimit.reset()
    async with db_sessionmaker() as session:
        await seed_superadmin(session)


async def _login(client):
    resp = await client.post(
        "/api/cms/auth/login",
        json={"email": "admin@mark-ai.tech", "password": "Admin@123"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _mint_key(client, sa_token):
    resp = await client.post(
        "/api/cms/api-keys", headers=_bearer(sa_token), json={"label": "Platform"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return {"X-Api-Key-Id": body["key_id"], "X-Api-Secret": body["secret"]}


async def _register_screen(client, device_uid="op-auth-device"):
    reg = await client.post(
        "/api/screens/register",
        json={
            "device_uid": device_uid,
            "provisioning_key": PROVISIONING_KEY,
            "device_info": {"model": "Pixel"},
        },
    )
    assert reg.status_code == 200, reg.text
    return reg.json()["screen_id"]


async def _make_owner(client, sa_token, email, screen_ids):
    resp = await client.post(
        "/api/cms/users",
        headers=_bearer(sa_token),
        json={
            "email": email,
            "password": "Owner@123",
            "role": "screenowner",
            "screen_ids": screen_ids,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_verify_returns_role_and_owned_screens(client, seeded):
    sa_token = await _login(client)
    key = await _mint_key(client, sa_token)
    screen_id = await _register_screen(client)
    owner = await _make_owner(client, sa_token, "bs@cafe.com", [screen_id])

    resp = await client.post(
        "/api/ext/auth/verify",
        headers=key,
        json={"email": "bs@cafe.com", "password": "Owner@123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == owner["id"]
    assert body["email"] == "bs@cafe.com"
    assert body["role"] == "screenowner"
    assert body["screen_ids"] == [screen_id]
    assert body["is_active"] is True


async def test_verify_superadmin_has_no_screen_ids(client, seeded):
    sa_token = await _login(client)
    key = await _mint_key(client, sa_token)

    resp = await client.post(
        "/api/ext/auth/verify",
        headers=key,
        json={"email": "admin@mark-ai.tech", "password": "Admin@123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["role"] == "superadmin"
    # Authority comes from the role, not from assignments.
    assert body["screen_ids"] == []


async def test_verify_rejects_bad_password_and_unknown_user(client, seeded):
    sa_token = await _login(client)
    key = await _mint_key(client, sa_token)
    await _make_owner(client, sa_token, "bs@cafe.com", [])

    bad = await client.post(
        "/api/ext/auth/verify",
        headers=key,
        json={"email": "bs@cafe.com", "password": "wrong"},
    )
    assert bad.status_code == 401

    unknown = await client.post(
        "/api/ext/auth/verify",
        headers=key,
        json={"email": "nobody@cafe.com", "password": "Owner@123"},
    )
    assert unknown.status_code == 401


async def test_verify_requires_a_partner_key(client, seeded):
    resp = await client.post(
        "/api/ext/auth/verify",
        json={"email": "admin@mark-ai.tech", "password": "Admin@123"},
    )
    assert resp.status_code == 401


async def test_verify_rate_limits_repeated_failures(client, seeded):
    sa_token = await _login(client)
    key = await _mint_key(client, sa_token)
    await _make_owner(client, sa_token, "bs@cafe.com", [])

    for _ in range(10):
        resp = await client.post(
            "/api/ext/auth/verify",
            headers=key,
            json={"email": "bs@cafe.com", "password": "wrong"},
        )
        assert resp.status_code == 401

    blocked = await client.post(
        "/api/ext/auth/verify",
        headers=key,
        json={"email": "bs@cafe.com", "password": "Owner@123"},
    )
    assert blocked.status_code == 429
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_ext_operator_auth.py -q`
Expected: FAIL — collection error, `ModuleNotFoundError: No module named 'app.cms_users.auth_ratelimit'`.

- [ ] **Step 3: Create the login failure limiter**

Create `markai-signage-api/app/cms_users/auth_ratelimit.py`:

```python
"""Brute-force speed bump for operator credential verification.

`POST /api/ext/auth/verify` lets a partner check a CMS email+password. The
partner key already gates who may ask, but a leaked key must not become an
offline-speed password oracle against every operator account, so failed
attempts are capped per source IP.

Deliberately separate from `screens.enrollment_ratelimit` rather than sharing
its counters: enrollment guesses a 40-bit key and gets a short, generous
window; a password guess deserves a longer, tighter one, and the two budgets
should never consume each other. Same in-memory, per-process caveat applies —
with several Cloud Run instances this limits each independently. Move to Redis
if a fleet-wide guarantee is ever needed.
"""

import time
from collections import defaultdict
from threading import Lock

# At most _MAX_FAILURES bad passwords per _WINDOW_SECONDS per ACCOUNT.
_WINDOW_SECONDS = 300.0
_MAX_FAILURES = 10

_failures: dict[str, list[float]] = defaultdict(list)
_lock = Lock()


def _prune(now: float, times: list[float]) -> list[float]:
    return [t for t in times if now - t < _WINDOW_SECONDS]


def is_blocked(key: str) -> bool:
    """True when this account has already used up its failed-attempt budget."""
    now = time.time()
    with _lock:
        times = _prune(now, _failures.get(key, []))
        _failures[key] = times
        return len(times) >= _MAX_FAILURES


def record_failure(key: str) -> None:
    """Register one failed verification for this account."""
    now = time.time()
    with _lock:
        times = _prune(now, _failures.get(key, []))
        times.append(now)
        _failures[key] = times


def reset() -> None:
    """Clear all counters. For tests."""
    with _lock:
        _failures.clear()
```

- [ ] **Step 4: Add the endpoint**

Add these imports alongside the existing `from app.bookings import service as booking_service` block:

```python
from app.cms_users import auth_ratelimit
from app.cms_users import service as cms_user_service
from app.cms_users.models import CmsUser
```

Append to the **end** of the file:

```python
# --- Operator identity (the Mark AI platform signing a CMS user in) ----------


class ExtVerifyRequest(BaseModel):
    email: str
    password: str


class ExtOperator(BaseModel):
    """A CMS operator as the platform sees them.

    `screen_ids` is the screenowner's assigned set and is always empty for a
    superadmin — their authority comes from the role, not from assignments.
    """

    id: str
    email: str
    role: str
    screen_ids: List[str] = []
    is_active: bool = True


async def _to_ext_operator(db: AsyncSession, user: CmsUser) -> ExtOperator:
    screen_ids = (
        await cms_user_service.get_assigned_screen_ids(db, user.id)
        if user.role == "screenowner"
        else []
    )
    return ExtOperator(
        id=user.id,
        email=user.email,
        role=user.role,
        screen_ids=screen_ids,
        is_active=user.is_active,
    )


@router.post("/auth/verify", response_model=ExtOperator)
async def ext_verify_operator(
    payload: ExtVerifyRequest,
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> ExtOperator:
    """Verify a CMS email+password and return who they are.

    The platform calls this so a screenowner can sign in there with the
    credentials the superadmin issued in the CMS. The CMS stays the single
    source of truth — no password hash is ever copied out of this service
    (and could not be used if it were: the CMS hashes with pbkdf2_sha256 and
    the platform with bcrypt).
    """
    # Keyed on the account, NOT the caller's IP: the caller here is the Mark
    # AI platform's server, so every operator in the fleet shares one IP and an
    # IP-keyed cap would let ten fumbled passwords lock out every screen owner.
    limiter_key = payload.email.lower().strip()
    if auth_ratelimit.is_blocked(limiter_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-in attempts. Try again in a few minutes.",
        )

    user = await cms_user_service.authenticate(db, payload.email, payload.password)
    if user is None:
        auth_ratelimit.record_failure(limiter_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    return await _to_ext_operator(db, user)
```

- [ ] **Step 5: Run the tests**

Run: `cd markai-signage-api && poetry run pytest tests/test_ext_operator_auth.py -q`
Expected: PASS — 5 passed.

- [ ] **Step 6: Verify nothing else regressed and lint is clean**

Run: `cd markai-signage-api && poetry run pytest -q && poetry run ruff check app/api_keys app/cms_users`
Expected: all tests pass; `All checks passed!`.

- [ ] **Step 7: Commit**

```bash
cd markai-signage-api
git add app/cms_users/auth_ratelimit.py app/api_keys/ext_router.py tests/test_ext_operator_auth.py
git commit -m "feat(ext): verify CMS operator credentials for the platform"
```

---

### Task 2: `GET /api/ext/operators/{id}/scope`

Authority is re-resolved live on every approvals read and every decision, so re-enrollment and deactivation take effect at once instead of waiting out a JWT.

**Files:**
- Modify: `markai-signage-api/app/api_keys/ext_router.py` (append)
- Test: `markai-signage-api/tests/test_ext_operator_auth.py` (append)

**Interfaces:**
- Consumes: `ExtOperator` and `_to_ext_operator` from Task 1.
- Produces: `GET /api/ext/operators/{cms_user_id}/scope` → `ExtOperator`; 404 when unknown.

- [ ] **Step 1: Write the failing test**

Append to `markai-signage-api/tests/test_ext_operator_auth.py`:

```python
async def test_scope_reflects_reassignment_and_deactivation(client, seeded):
    sa_token = await _login(client)
    key = await _mint_key(client, sa_token)
    screen_a = await _register_screen(client, "scope-a")
    screen_b = await _register_screen(client, "scope-b")
    owner = await _make_owner(client, sa_token, "bs@cafe.com", [screen_a])

    scope = await client.get(f"/api/ext/operators/{owner['id']}/scope", headers=key)
    assert scope.status_code == 200, scope.text
    assert scope.json()["screen_ids"] == [screen_a]

    # The superadmin re-assigns them to a different screen.
    moved = await client.patch(
        f"/api/cms/users/{owner['id']}",
        headers=_bearer(sa_token),
        json={"screen_ids": [screen_b]},
    )
    assert moved.status_code == 200, moved.text

    scope = await client.get(f"/api/ext/operators/{owner['id']}/scope", headers=key)
    assert scope.json()["screen_ids"] == [screen_b]

    # Deactivating them is visible immediately — the platform signs them out.
    off = await client.patch(
        f"/api/cms/users/{owner['id']}",
        headers=_bearer(sa_token),
        json={"is_active": False},
    )
    assert off.status_code == 200, off.text

    scope = await client.get(f"/api/ext/operators/{owner['id']}/scope", headers=key)
    assert scope.status_code == 200
    assert scope.json()["is_active"] is False


async def test_scope_404s_on_unknown_operator(client, seeded):
    sa_token = await _login(client)
    key = await _mint_key(client, sa_token)
    resp = await client.get("/api/ext/operators/no-such-id/scope", headers=key)
    assert resp.status_code == 404
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_ext_operator_auth.py -q -k scope`
Expected: FAIL — both assert 404/200 mismatches (the route does not exist, FastAPI returns 404 for the unknown path, so `test_scope_reflects_reassignment_and_deactivation` fails on its first `assert scope.status_code == 200`).

- [ ] **Step 3: Add the endpoint**

Append to `markai-signage-api/app/api_keys/ext_router.py`:

```python
@router.get("/operators/{cms_user_id}/scope", response_model=ExtOperator)
async def ext_operator_scope(
    cms_user_id: str,
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> ExtOperator:
    """Re-resolve an operator's role, owned screens and active flag.

    The platform calls this on every approvals read and every decision rather
    than trusting what it learned at sign-in, so a re-enrolled screen or a
    deactivated owner takes effect at once instead of waiting out a token.
    """
    user = (
        await db.execute(select(CmsUser).where(CmsUser.id == cms_user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Operator not found"
        )
    return await _to_ext_operator(db, user)
```

Add `select` to the SQLAlchemy imports near the top of the file:

```python
from sqlalchemy import select
```

- [ ] **Step 4: Run the tests**

Run: `cd markai-signage-api && poetry run pytest tests/test_ext_operator_auth.py -q`
Expected: PASS — 7 passed.

- [ ] **Step 5: Full suite and lint**

Run: `cd markai-signage-api && poetry run pytest -q && poetry run ruff check app/api_keys app/cms_users`
Expected: all pass; `All checks passed!`.

- [ ] **Step 6: Commit**

```bash
cd markai-signage-api
git add app/api_keys/ext_router.py tests/test_ext_operator_auth.py
git commit -m "feat(ext): live operator scope lookup for approval authority"
```

---

# Phase B — `markai-backend-new`

### Task 3: Approval columns on `bookings`

**Files:**
- Create: `markai-backend-new/alembic/versions/0004_booking_approval.py`
- Modify: `markai-backend-new/app/bookings/models.py`, `markai-backend-new/app/bookings/schemas.py`, `markai-backend-new/app/bookings/service.py:28-47` (`to_out`)
- Test: `markai-backend-new/tests/test_approvals.py`

**Interfaces:**
- Produces: `Booking.approval_status` (`pending`|`approved`|`rejected`), `Booking.cms_booking_id` now `Optional[str]`, `Booking.decided_by_cms_user_id/decided_by_email/decided_by_role/decided_at/reject_reason`; `BookingOut.approval_status`, `BookingOut.reject_reason`, `BookingOut.cms_booking_id: Optional[str]`; `to_out()` maps a pending row to `status="pending_approval"` and a rejected one to `status="rejected"`.

- [ ] **Step 1: Write the failing test**

Create `markai-backend-new/tests/test_approvals.py`:

```python
"""Booking approval: a platform booking waits for a screenowner or superadmin.

The CMS is never called until someone approves. These tests stub the CMS
client entirely — the contract under test is ours, not the CMS's.
"""

from datetime import datetime, timedelta, timezone

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.bookings.models import Booking
from app.core.database import get_db
from app.main import app
from app.models import Base, User


@pytest_asyncio.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite://", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    TestSession = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        c.session_factory = TestSession
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


# Real datetimes, not ISO strings: SQLAlchemy's SQLite dialect rejects a str
# bound to a DateTime column, so string literals here would fail against a
# perfectly correct implementation.
IST = timezone(timedelta(hours=5, minutes=30))
START_AT = datetime(2026, 8, 1, 9, 0, tzinfo=IST)
END_AT = datetime(2026, 8, 8, 17, 0, tzinfo=IST)


async def test_booking_row_defaults_to_pending_with_no_cms_twin(client):
    """A booking row can exist with no CMS twin — that is the pending state."""
    async with client.session_factory() as session:
        user = User(
            email="ada@example.com",
            first_name="Ada",
            last_name="Lovelace",
            password_hash="x",
        )
        session.add(user)
        await session.commit()
        booking = Booking(
            user_id=user.id,
            cms_booking_id=None,
            screen_id="screen-b",
            name="Nike",
            schedule_type="continuous",
            start_at=START_AT,
            end_at=END_AT,
        )
        session.add(booking)
        await session.commit()
        await session.refresh(booking)

        assert booking.approval_status == "pending"
        assert booking.cms_booking_id is None
        assert booking.decided_at is None
        assert booking.reject_reason is None


async def test_to_out_reports_pending_and_rejected_status(client):
    from app.bookings.service import to_out

    booking = Booking(
        user_id="u1",
        cms_booking_id=None,
        screen_id="screen-b",
        name="Nike",
        schedule_type="continuous",
        start_at=START_AT,
        end_at=END_AT,
        approval_status="pending",
        status_cache="pending",
        created_at=datetime.now(timezone.utc),
    )
    assert to_out(booking).status == "pending_approval"

    booking.approval_status = "rejected"
    booking.reject_reason = "Creative is off-brand for this venue."
    out = to_out(booking)
    assert out.status == "rejected"
    assert out.reject_reason == "Creative is off-brand for this venue."

    booking.approval_status = "approved"
    booking.cms_booking_id = "cms-1"
    booking.status_cache = "active"
    assert to_out(booking).status == "active"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd markai-backend-new && poetry run pytest tests/test_approvals.py -q`
Expected: FAIL — `TypeError: 'approval_status' is an invalid keyword argument for Booking`.

- [ ] **Step 3: Add the model columns**

In `markai-backend-new/app/bookings/models.py`, change the SQLAlchemy import line (currently line 4) to add `Text`:

```python
from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
```

Replace the `cms_booking_id` column (lines 30-32) with:

```python
    # NULL until approved: a pending request has no CMS twin yet, and a
    # rejected one never gets one. Unique still holds — Postgres allows many
    # NULLs in a unique index.
    cms_booking_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, unique=True, index=True
    )
```

Insert after the `status_cache` column (after line 57):

```python
    # Approval gate. A booking raised on the platform waits here until the
    # screen's owner or any superadmin decides. Decided-by fields are a
    # snapshot of the CMS operator (that identity lives in another database,
    # so there is no foreign key to hang it on).
    approval_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending"
    )
    decided_by_cms_user_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True
    )
    decided_by_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    decided_by_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Update the schemas**

In `markai-backend-new/app/bookings/schemas.py`, replace the `cms_booking_id` line in `BookingOut` (line 42) with:

```python
    cms_booking_id: Optional[str] = None
```

Add to `BookingOut`, after the `status` field (line 56):

```python
    approval_status: str = "approved"
    reject_reason: Optional[str] = None
    decided_at: Optional[datetime] = None
```

- [ ] **Step 5: Update `to_out`**

In `markai-backend-new/app/bookings/service.py`, replace `to_out` (lines 28-47) with:

```python
def to_out(b: Booking, status_override: Optional[str] = None) -> BookingOut:
    # A booking the CMS has never seen has no CMS status to report. Surface
    # the approval state as the campaign status so one field still answers
    # "what is happening with this?" everywhere in the UI.
    if b.approval_status == "pending":
        status_value = "pending_approval"
    elif b.approval_status == "rejected":
        status_value = "rejected"
    else:
        status_value = status_override or b.status_cache
    return BookingOut(
        id=b.id,
        cms_booking_id=b.cms_booking_id,
        name=b.name,
        screen_id=b.screen_id,
        screen_name=b.screen_name,
        screen_city=b.screen_city,
        content_id=b.content_id,
        solution_id=b.solution_id,
        schedule_type=b.schedule_type,
        start_at=b.start_at,
        end_at=b.end_at,
        daily_windows=b.daily_windows,
        days_of_week=b.days_of_week,
        target_plays_per_day=b.target_plays_per_day,
        layout=b.layout,
        status=status_value,
        approval_status=b.approval_status,
        reject_reason=b.reject_reason,
        decided_at=b.decided_at,
        created_at=b.created_at,
    )
```

- [ ] **Step 6: Write the migration**

Create `markai-backend-new/alembic/versions/0004_booking_approval.py`:

```python
"""Booking approval gate — a platform booking waits for an owner's decision.

`cms_booking_id` becomes nullable because a pending request has no CMS twin
yet and a rejected one never will. Existing rows are backfilled `approved`:
every booking that already exists was pushed straight to the CMS under the
old behaviour, so that is the honest value for them.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "bookings",
        "cms_booking_id",
        existing_type=sa.String(length=36),
        nullable=True,
    )
    op.add_column(
        "bookings",
        sa.Column(
            "approval_status",
            sa.String(length=16),
            nullable=False,
            server_default="approved",
        ),
    )
    op.add_column(
        "bookings",
        sa.Column("decided_by_cms_user_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "bookings",
        sa.Column("decided_by_email", sa.String(length=320), nullable=True),
    )
    op.add_column(
        "bookings", sa.Column("decided_by_role", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "bookings",
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("bookings", sa.Column("reject_reason", sa.Text(), nullable=True))
    op.create_index(
        "ix_bookings_approval_screen",
        "bookings",
        ["approval_status", "screen_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_bookings_approval_screen", table_name="bookings")
    op.drop_column("bookings", "reject_reason")
    op.drop_column("bookings", "decided_at")
    op.drop_column("bookings", "decided_by_role")
    op.drop_column("bookings", "decided_by_email")
    op.drop_column("bookings", "decided_by_cms_user_id")
    op.drop_column("bookings", "approval_status")
    op.alter_column(
        "bookings",
        "cms_booking_id",
        existing_type=sa.String(length=36),
        nullable=False,
    )
```

Note the deliberate asymmetry: the migration backfills `approved`, while the ORM column defaults to `pending`. New rows are always inserted by the ORM, so they get `pending`; the `server_default` only ever applies to rows that already existed.

- [ ] **Step 7: Run the tests**

Run: `cd markai-backend-new && poetry run pytest tests/test_approvals.py -q`
Expected: PASS — 2 passed.

- [ ] **Step 8: Verify the migration applies**

Run: `cd markai-backend-new && ./dev_start.sh && poetry run alembic upgrade head && poetry run alembic current`
Expected: no error; `alembic current` reports `0004 (head)`.

- [ ] **Step 9: Commit**

```bash
cd markai-backend-new
git add app/bookings/models.py app/bookings/schemas.py app/bookings/service.py alembic/versions/0004_booking_approval.py tests/test_approvals.py
git commit -m "feat(bookings): approval columns, nullable CMS twin id"
```

---

### Task 4: Operator principal — CMS client calls, token, dependency

**Files:**
- Modify: `markai-backend-new/app/cms/client.py` (append two methods before the `cms_client = CmsClient()` line at 208)
- Modify: `markai-backend-new/app/core/security.py`
- Test: `markai-backend-new/tests/test_operator_auth.py`

**Interfaces:**
- Produces:
  - `cms_client.verify_operator(email, password) -> dict` and `cms_client.get_operator_scope(cms_user_id) -> dict`, both returning `{id, email, role, screen_ids, is_active}`.
  - `security.Operator` dataclass with `.id`, `.email`, `.role`.
  - `security.create_operator_token(cms_user_id, email, role) -> str`.
  - `security.require_operator` FastAPI dependency → `Operator`, 401 otherwise.
  - `get_current_user` now explicitly rejects an operator token.

- [ ] **Step 1: Write the failing test**

Create `markai-backend-new/tests/test_operator_auth.py`:

```python
"""Operator tokens: a CMS identity carried by a platform JWT.

An operator token must never satisfy an advertiser route — that separation is
what keeps screenowners out of the booking wizard without a single check on
those endpoints.
"""

from app.core.security import (
    Operator,
    create_access_token,
    create_operator_token,
    decode_access_token,
)


def test_operator_token_carries_role_and_namespaced_subject():
    token = create_operator_token("cms-user-1", "bs@cafe.com", "screenowner")
    payload = decode_access_token(token)

    assert payload["sub"] == "cms:cms-user-1"
    assert payload["email"] == "bs@cafe.com"
    assert payload["role"] == "screenowner"


def test_advertiser_token_is_marked_advertiser():
    token = create_access_token("user-1", "ada@example.com")
    payload = decode_access_token(token)

    assert payload["sub"] == "user-1"
    assert payload["role"] == "advertiser"


def test_operator_dataclass_round_trips():
    op = Operator(id="cms-user-1", email="bs@cafe.com", role="screenowner")
    assert op.is_superadmin is False
    assert Operator(id="x", email="admin@mark-ai.tech", role="superadmin").is_superadmin is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd markai-backend-new && poetry run pytest tests/test_operator_auth.py -q`
Expected: FAIL — `ImportError: cannot import name 'Operator' from 'app.core.security'`.

- [ ] **Step 3: Add the CMS client methods**

In `markai-backend-new/app/cms/client.py`, insert immediately before the final `cms_client = CmsClient()` line:

```python
    # --- Operator identity ----------------------------------------------------

    async def verify_operator(self, email: str, password: str) -> dict:
        """Check a CMS email+password. 401 passes through as 401."""
        return await self._request(
            "POST", "/auth/verify", json={"email": email, "password": password}
        )

    async def get_operator_scope(self, cms_user_id: str) -> dict:
        """Re-read an operator's role, owned screens and active flag."""
        return await self._request("GET", f"/operators/{cms_user_id}/scope")
```

- [ ] **Step 4: Add the operator principal to security**

In `markai-backend-new/app/core/security.py`, add `dataclass` to the imports at the top:

```python
from dataclasses import dataclass
```

Replace `create_access_token` (lines 33-41) with:

```python
def create_access_token(user_id: str, email: str) -> str:
    """Token for a platform-native advertiser."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "role": "advertiser",
        "iat": now,
        "exp": now + timedelta(hours=settings.JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_operator_token(cms_user_id: str, email: str, role: str) -> str:
    """Token for a CMS operator (screenowner or superadmin).

    The subject is namespaced `cms:<id>` because that identity lives in the
    CMS database, not ours — the prefix makes it impossible for an operator
    token to accidentally resolve to a platform user row.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"cms:{cms_user_id}",
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=settings.JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


OPERATOR_ROLES = ("screenowner", "superadmin")


@dataclass(frozen=True)
class Operator:
    """A signed-in CMS operator. Not a row in this database."""

    id: str
    email: str
    role: str

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin"


def operator_from_payload(payload: dict) -> Optional[Operator]:
    """Read an Operator out of a decoded JWT, or None if it isn't one."""
    sub = payload.get("sub") or ""
    if not sub.startswith("cms:"):
        return None
    if payload.get("role") not in OPERATOR_ROLES:
        return None
    return Operator(
        id=sub[len("cms:") :],
        email=payload.get("email") or "",
        role=payload["role"],
    )
```

Append at the end of the file:

```python
async def require_operator(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Operator:
    """FastAPI dependency: resolve the Bearer JWT into a CMS operator.

    No database lookup — the operator lives in the CMS. Callers that act on
    their authority re-resolve their scope from the CMS at that moment.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )
    operator = operator_from_payload(payload)
    if operator is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This area is for screen owners and administrators.",
        )
    return operator
```

Then make the advertiser dependencies reject operators explicitly. In `get_optional_user`, after the `payload` guard (line 81-82), add:

```python
    if operator_from_payload(payload) is not None:
        return None
```

In `get_current_user`, after the `payload` guard (lines 102-105), add:

```python
    if operator_from_payload(payload) is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Screen owners can't book campaigns. Sign in with an "
            "advertiser account.",
        )
```

- [ ] **Step 5: Run the tests**

Run: `cd markai-backend-new && poetry run pytest tests/test_operator_auth.py -q`
Expected: PASS — 3 passed.

- [ ] **Step 6: Run the full suite**

Run: `cd markai-backend-new && poetry run pytest -q`
Expected: all pass (20 tests).

- [ ] **Step 7: Commit**

```bash
cd markai-backend-new
git add app/cms/client.py app/core/security.py tests/test_operator_auth.py
git commit -m "feat(auth): operator principal, tokens and CMS verification calls"
```

---

### Task 5: The checkbox chooses the auth system

Unticked, sign-in hits the platform's own `users` table exactly as it does today.
Ticked, it hits the CMS. Note what this does **not** change: `identify` keeps its
current request and response shape, because it only ever runs for advertisers — an
operator's account cannot be probed without a password, and probing the CMS would
leak which operator accounts exist.

**Files:**
- Modify: `markai-backend-new/app/users/schemas.py`, `markai-backend-new/app/users/service.py`, `markai-backend-new/app/users/router.py`
- Test: `markai-backend-new/tests/test_operator_login.py`

**Interfaces:**
- Consumes: `cms_client.verify_operator`, `security.create_operator_token`, `security.Operator` (Task 4).
- Produces:
  - `POST /api/auth/login {email, password, as_operator?: bool}` → `AuthResponse{access_token, token_type, role, user?, operator?}`.
  - `GET /api/auth/me` → `MeResponse{role, id, email, first_name?, last_name?, avatar_url?, google_linked, has_password}` for both principal kinds.
  - `OperatorOut{id, email, role}`.
  - `service.login_advertiser` (the former `service.login`, renamed) and `service.login_operator(email, password)`.
  - `POST /api/auth/identify` is **unchanged**.

- [ ] **Step 1: Write the failing test**

Create `markai-backend-new/tests/test_operator_login.py`:

```python
"""The checkbox decides which auth system answers.

Once CMS operators have emails, one address can legitimately exist in both
systems — a cafe owner who also buys ads. Nothing about the address can
disambiguate them, so the caller declares it.
"""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.main import app
from app.models import Base

SIGNUP = {
    "email": "ada@example.com",
    "first_name": "Ada",
    "last_name": "Lovelace",
    "password": "S3cretPass!",
}


@pytest_asyncio.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite://", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    TestSession = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        c.session_factory = TestSession
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


def _stub_verify(monkeypatch, result, good_password="Owner@123"):
    async def fake_verify(email, password):
        if password != good_password:
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="Invalid email or password")
        return result

    monkeypatch.setattr("app.users.service.cms_client.verify_operator", fake_verify)


OPERATOR = {
    "id": "cms-1",
    "email": "bs@cafe.com",
    "role": "screenowner",
    "screen_ids": ["screen-b"],
    "is_active": True,
}


async def test_ticking_the_box_signs_in_through_the_cms(client, monkeypatch):
    _stub_verify(monkeypatch, OPERATOR)
    resp = await client.post(
        "/api/auth/login",
        json={"email": "bs@cafe.com", "password": "Owner@123", "as_operator": True},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["role"] == "screenowner"
    assert body["operator"]["email"] == "bs@cafe.com"
    assert body["user"] is None

    me = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200, me.text
    assert me.json()["role"] == "screenowner"
    assert me.json()["email"] == "bs@cafe.com"


async def test_leaving_the_box_unticked_never_asks_the_cms(client, monkeypatch):
    called = []

    async def fake_verify(email, password):
        called.append(email)
        return OPERATOR

    monkeypatch.setattr("app.users.service.cms_client.verify_operator", fake_verify)
    await client.post("/api/auth/signup", json=SIGNUP)

    resp = await client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": SIGNUP["password"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "advertiser"
    assert resp.json()["operator"] is None
    assert called == []


async def test_one_email_can_hold_both_accounts(client, monkeypatch):
    """The whole reason the checkbox exists rather than inspecting the address."""
    shared = "owner@cafe.com"
    await client.post(
        "/api/auth/signup",
        json={
            "email": shared,
            "first_name": "Cafe",
            "last_name": "Owner",
            "password": "Advertiser@1",
        },
    )
    _stub_verify(
        monkeypatch,
        {**OPERATOR, "email": shared},
        good_password="Operator@1",
    )

    as_advertiser = await client.post(
        "/api/auth/login", json={"email": shared, "password": "Advertiser@1"}
    )
    assert as_advertiser.json()["role"] == "advertiser"

    as_operator = await client.post(
        "/api/auth/login",
        json={"email": shared, "password": "Operator@1", "as_operator": True},
    )
    assert as_operator.json()["role"] == "screenowner"


async def test_operator_login_passes_the_cms_401_through(client, monkeypatch):
    _stub_verify(monkeypatch, OPERATOR)
    resp = await client.post(
        "/api/auth/login",
        json={"email": "bs@cafe.com", "password": "nope", "as_operator": True},
    )
    assert resp.status_code == 401


async def test_inactive_operator_cannot_sign_in(client, monkeypatch):
    _stub_verify(monkeypatch, {**OPERATOR, "is_active": False})
    resp = await client.post(
        "/api/auth/login",
        json={"email": "bs@cafe.com", "password": "Owner@123", "as_operator": True},
    )
    assert resp.status_code == 403


async def test_advertiser_me_still_reports_advertiser(client):
    await client.post("/api/auth/signup", json=SIGNUP)
    resp = await client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": SIGNUP["password"]},
    )
    me = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {resp.json()['access_token']}"},
    )
    assert me.json()["role"] == "advertiser"
    assert me.json()["email"] == "ada@example.com"
    assert me.json()["first_name"] == "Ada"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd markai-backend-new && poetry run pytest tests/test_operator_login.py -q`
Expected: FAIL — the operator sign-ins return 404 `unknown_email`, because `as_operator` is ignored and every login goes to the platform table.

- [ ] **Step 3: Update the schemas**

In `markai-backend-new/app/users/schemas.py`, replace `LoginRequest` (lines 27-29) with:

```python
class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Ticked on the sign-in page by a screen owner or administrator. One email
    # may exist in both systems, so the caller declares which one they mean.
    as_operator: bool = False
```

Replace `AuthResponse` (lines 54-57) with:

```python
class OperatorOut(BaseModel):
    """A CMS operator signed into the platform."""

    id: str
    email: EmailStr
    role: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str = "advertiser"
    user: Optional[UserOut] = None
    operator: Optional[OperatorOut] = None


class MeResponse(BaseModel):
    """One shape for both principal kinds, so the frontend has one session type."""

    role: str
    id: str
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None
    google_linked: bool = False
    has_password: bool = False
```

`IdentifyRequest` and `IdentifyResponse` are unchanged.

- [ ] **Step 4: Update the service**

In `markai-backend-new/app/users/service.py`, add the imports:

```python
from app.cms.client import cms_client
from app.core.security import Operator
```

Rename the existing `login` to `login_advertiser` — change only the `def` line at 91, the body is unchanged:

```python
async def login_advertiser(db: AsyncSession, email: str, password: str) -> User:
```

Append the operator path after it:

```python
async def login_operator(email: str, password: str) -> Operator:
    """Verify a CMS credential against the CMS and return the operator.

    The CMS's 401 passes straight through; an operator the superadmin has
    deactivated is refused here rather than being handed a token that every
    later call would reject anyway.
    """
    data = await cms_client.verify_operator(email.lower().strip(), password)
    if not data.get("is_active", True):
        raise _err(
            status.HTTP_403_FORBIDDEN,
            "operator_inactive",
            "This account has been deactivated. Ask your administrator to "
            "re-enable it.",
        )
    return Operator(id=data["id"], email=data["email"], role=data["role"])


async def describe_principal(db: AsyncSession, credentials) -> dict:
    """Resolve a bearer credential into the unified /me shape."""
    from app.core.security import decode_access_token, operator_from_payload
    from app.users.schemas import user_out

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    payload = decode_access_token(credentials.credentials)
    # The oauth_state guard mirrors get_current_user. It is not optional: this
    # function hand-rolls credential resolution (it cannot use get_current_user,
    # which 403s operators), so every check that lives there must live here too.
    if not payload or payload.get("purpose") == "oauth_state":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )

    operator = operator_from_payload(payload)
    if operator is not None:
        return {"role": operator.role, "id": operator.id, "email": operator.email}

    user = (
        await db.execute(select(User).where(User.id == payload.get("sub")))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    out = user_out(user)
    return {
        "role": "advertiser",
        "id": out.id,
        "email": out.email,
        "first_name": out.first_name,
        "last_name": out.last_name,
        "avatar_url": out.avatar_url,
        "google_linked": out.google_linked,
        "has_password": out.has_password,
    }
```

- [ ] **Step 5: Update the router**

In `markai-backend-new/app/users/router.py`, extend the schema import block (lines 14-24) with `MeResponse` and `OperatorOut`, and replace the security import (line 12) with:

```python
from app.core.security import create_access_token, create_operator_token, get_current_user
```

Add below `router = APIRouter(...)`:

```python
from fastapi.security import HTTPBearer

_me_bearer = HTTPBearer(auto_error=False)
```

Replace `login` (lines 51-54) with:

```python
@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Sign in. `as_operator` sends the credential to the CMS instead of here."""
    if body.as_operator:
        operator = await service.login_operator(body.email, body.password)
        return AuthResponse(
            access_token=create_operator_token(
                operator.id, operator.email, operator.role
            ),
            role=operator.role,
            operator=OperatorOut(
                id=operator.id, email=operator.email, role=operator.role
            ),
        )
    user = await service.login_advertiser(db, body.email, body.password)
    return _auth_response(user)
```

Replace `me` (lines 106-108) with:

```python
@router.get("/me", response_model=MeResponse)
async def me(credentials=Depends(_me_bearer), db: AsyncSession = Depends(get_db)):
    """One endpoint for both principal kinds — the frontend keeps one session."""
    return await service.describe_principal(db, credentials)
```

Search for any remaining `service.login(` and change it to `service.login_advertiser(`.

- [ ] **Step 6: Run the tests**

Run: `cd markai-backend-new && poetry run pytest tests/test_operator_login.py -q`
Expected: PASS — 6 passed.

- [ ] **Step 7: Run the full suite**

`tests/test_auth.py` asserts on `/auth/me`, whose response no longer carries `created_at` and now always carries `role`. Update those assertions; the `/login` and `/identify` payloads are unchanged.

Run: `cd markai-backend-new && poetry run pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd markai-backend-new
git add app/users tests/test_operator_login.py tests/test_auth.py
git commit -m "feat(auth): as_operator flag routes sign-in to the CMS"
```

---

### Task 6: Booking create becomes a pending request

**Files:**
- Create: `markai-backend-new/app/bookings/hours.py`
- Modify: `markai-backend-new/app/bookings/service.py`
- Test: `markai-backend-new/tests/test_approvals.py` (append)

**Interfaces:**
- Consumes: `screen_service.get_screen(screen_id)` (already returns `on_start_minute`/`on_end_minute`).
- Produces: `hours.window_within_screen_hours(window, screen) -> bool`; `create_booking` no longer calls the CMS and persists `approval_status="pending"`.

- [ ] **Step 1: Write the failing test**

Append to `markai-backend-new/tests/test_approvals.py`:

```python
async def test_create_booking_never_calls_the_cms(client, monkeypatch):
    """The whole point of the gate: a request leaves no trace in the CMS."""
    calls = []

    async def fake_create(payload):
        calls.append(payload)
        return {"id": "cms-should-not-happen", "status": "active"}

    async def fake_get_screen(screen_id):
        return {
            "id": screen_id,
            "name": "Cafe MG Road",
            "city": "Bengaluru",
            "on_start_minute": 540,
            "on_end_minute": 1020,
        }

    monkeypatch.setattr("app.bookings.service.cms_client.create_booking", fake_create)
    monkeypatch.setattr(
        "app.bookings.service.screen_service.get_screen", fake_get_screen
    )

    token = await _signup(client)
    content_id = await _seed_content(client)

    resp = await client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Nike",
            "screen_id": "screen-b",
            "content_id": content_id,
            "schedule_type": "continuous",
            "start_at": "2026-08-01T09:00:00+05:30",
            "end_at": "2026-08-08T17:00:00+05:30",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["approval_status"] == "pending"
    assert body["status"] == "pending_approval"
    assert body["cms_booking_id"] is None
    assert calls == []


async def test_out_of_hours_window_is_refused_at_request_time(client, monkeypatch):
    async def fake_get_screen(screen_id):
        return {
            "id": screen_id,
            "name": "Cafe MG Road",
            "city": "Bengaluru",
            "on_start_minute": 540,   # 09:00
            "on_end_minute": 1020,    # 17:00
        }

    monkeypatch.setattr(
        "app.bookings.service.screen_service.get_screen", fake_get_screen
    )
    token = await _signup(client)
    content_id = await _seed_content(client)

    resp = await client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Nike",
            "screen_id": "screen-b",
            "content_id": content_id,
            "schedule_type": "specific_time",
            "start_at": "2026-08-01T09:00:00+05:30",
            "end_at": "2026-08-08T17:00:00+05:30",
            "daily_windows": [{"start": "20:00", "end": "22:00"}],
        },
    )
    assert resp.status_code == 422
    assert "09:00" in resp.json()["detail"]
```

Add these helpers near the top of the module (below the `client` fixture):

```python
SIGNUP = {
    "email": "ada@example.com",
    "first_name": "Ada",
    "last_name": "Lovelace",
    "password": "S3cretPass!",
}


async def _signup(client) -> str:
    resp = await client.post("/api/auth/signup", json=SIGNUP)
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


async def _seed_content(client) -> str:
    """Insert a media asset directly — the upload path isn't under test here."""
    from app.content.models import MediaAsset
    from app.users.models import User
    from sqlalchemy import select

    async with client.session_factory() as session:
        user = (await session.execute(select(User))).scalars().first()
        asset = MediaAsset(
            user_id=user.id,
            name="creative.png",
            type="image",
            size_bytes=1024,
            file_url="https://cdn/creative.png",
            cms_media_id="cms-media-1",
        )
        session.add(asset)
        await session.commit()
        return asset.id
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd markai-backend-new && poetry run pytest tests/test_approvals.py -q -k "never_calls or out_of_hours"`
Expected: FAIL — `assert calls == []` fails (the CMS was called), and the out-of-hours booking returns 201 instead of 422.

- [ ] **Step 3: Write the operating-hours check**

Create `markai-backend-new/app/bookings/hours.py`:

```python
"""Operating-hours validation, mirrored from the CMS.

The CMS rejects a booking whose daily window falls outside the screen's ON
window (`bookings.service._apply_screen_operating_hours`). Under the approval
gate the CMS is not called until someone approves, which could be days later
— far too late to tell an advertiser their times are wrong. So the same rule
runs here, at request time, against the live screen. The CMS remains the
backstop at approval.
"""

from typing import Optional


def hhmm_to_minute(value: str) -> Optional[int]:
    """"HH:MM" -> minute of day, or None if malformed."""
    parts = value.strip().split(":")
    if len(parts) != 2:
        return None
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour * 60 + minute


def minute_to_hhmm(minute: int) -> str:
    return f"{(minute // 60) % 24:02d}:{minute % 60:02d}"


def _minute_in_window(minute: int, start: int, end: int) -> bool:
    if start == end:
        return True  # degenerate = always on
    if start < end:
        return start <= minute < end
    return minute >= start or minute < end  # wraps midnight


def window_within_screen_hours(
    window_start: str, window_end: str, on_start: Optional[int], on_end: Optional[int]
) -> bool:
    """Is [start, end) inside the screen's ON window? Wrap-aware."""
    if on_start is None or on_end is None:
        return True  # 24/7 screen
    start = hhmm_to_minute(window_start)
    end = hhmm_to_minute(window_end)
    if start is None or end is None or start == end:
        return False
    # End is exclusive: a window closing exactly at close is fine, so test the
    # last minute it actually occupies.
    end_ok = True if end == on_end else _minute_in_window((end + 1439) % 1440, on_start, on_end)
    return _minute_in_window(start, on_start, on_end) and end_ok
```

- [ ] **Step 4: Make `create_booking` hold the request**

In `markai-backend-new/app/bookings/service.py`, add the import:

```python
from app.bookings import hours
```

Insert after the screen is fetched (after line 66, `screen = await screen_service.get_screen(payload.screen_id)`):

```python
    # Operating-hours check, run here rather than at approval so the
    # advertiser learns immediately (see app/bookings/hours.py).
    on_start = screen.get("on_start_minute")
    on_end = screen.get("on_end_minute")
    for window in payload.daily_windows or []:
        if not hours.window_within_screen_hours(
            window.start, window.end, on_start, on_end
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"This screen runs "
                    f"{hours.minute_to_hhmm(on_start)}–{hours.minute_to_hhmm(on_end)}. "
                    f"Pick times inside that window."
                ),
            )
```

Delete the CMS call (line 110, `cms_booking = await cms_client.create_booking(cms_payload)`) and the whole `cms_payload = {...}` block (lines 88-108) — the payload is rebuilt at approval time from the stored row, so keeping it here would be dead code that silently drifts.

Change the `Booking(...)` construction (lines 112-134) so the two CMS-derived fields become the pending state:

```python
    booking = Booking(
        id=our_id,
        user_id=user.id,
        cms_booking_id=None,
        screen_id=payload.screen_id,
        screen_name=screen.get("name"),
        screen_city=screen.get("city"),
        content_id=content_id,
        solution_id=solution_id,
        name=payload.name,
        schedule_type=payload.schedule_type,
        start_at=payload.start_at,
        end_at=payload.end_at,
        daily_windows=(
            [w.model_dump() for w in payload.daily_windows]
            if payload.daily_windows
            else None
        ),
        days_of_week=payload.days_of_week,
        target_plays_per_day=payload.target_plays_per_day,
        layout=layout,
        approval_status="pending",
        status_cache="pending",
    )
```

Replace the log line (lines 138-141) with:

```python
    logger.info(
        "User %s requested campaign %s on screen %s — awaiting approval",
        user.id, booking.id, booking.screen_id,
    )
```

Note `display_name` (line 86) is now unused in this function — remove it; it is rebuilt at approval time.

- [ ] **Step 5: Guard every CMS call against a pending booking**

Five call sites dereference `cms_booking_id`. A pending campaign has none, and without guards each would send `None` into a URL path and 500 the advertiser's dashboard.

In `_refresh_statuses` (line 173), change the loop body so pending rows are skipped:

```python
    for b in bookings:
        if not b.cms_booking_id:
            continue  # not in the CMS yet — its status is the approval state
        new_status = live.get(b.cms_booking_id)
        if new_status and new_status != b.status_cache:
            b.status_cache = new_status
            changed = True
```

Add this helper next to `get_own_booking`:

```python
def _require_cms_twin(booking: Booking) -> str:
    """The CMS id, or a clear 409 for a campaign that has no CMS twin yet."""
    if not booking.cms_booking_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This campaign is still waiting for the screen owner to "
                "approve it."
                if booking.approval_status == "pending"
                else "This campaign was declined, so it never ran."
            ),
        )
    return booking.cms_booking_id
```

Then in `get_booking_detail`, wrap the CMS read so a pending booking simply renders from our row:

```python
    booking = await get_own_booking(db, user_id, booking_id)
    cms_detail: dict = {}
    if booking.cms_booking_id:
        try:
            cms_detail = await cms_client.get_booking(booking.cms_booking_id)
            ...
```

In `get_booking_report`, `set_booking_status` and `get_booking_plays`, replace `booking.cms_booking_id` with `_require_cms_twin(booking)`.

- [ ] **Step 6: Run the tests**

Run: `cd markai-backend-new && poetry run pytest tests/test_approvals.py -q`
Expected: PASS — 4 passed.

- [ ] **Step 7: Run the full suite**

Run: `cd markai-backend-new && poetry run pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd markai-backend-new
git add app/bookings tests/test_approvals.py
git commit -m "feat(bookings): hold new bookings as pending approval requests"
```

---

### Task 7: The approvals and console API

**Files:**
- Create: `markai-backend-new/app/approvals/__init__.py`, `schemas.py`, `service.py`, `router.py`
- Modify: `markai-backend-new/app/main.py`
- Test: `markai-backend-new/tests/test_approvals.py` (append)

**Interfaces:**
- Consumes: `require_operator`, `Operator` (Task 4); `cms_client.get_operator_scope`, `cms_client.create_booking`; `bookings.service.to_out`.
- Produces:
  - `GET /api/approvals?status=` → `{requests: [ApprovalOut], total}`
  - `GET /api/approvals/count` → `{pending: int}`
  - `POST /api/approvals/{id}/approve` → `ApprovalOut`
  - `POST /api/approvals/{id}/reject` `{reason?}` → `ApprovalOut`
  - `GET /api/console/screens` → `{screens: [dict]}`
  - `GET /api/console/overview` → `{pending, screens_total, screens_online, decided_this_week}`

- [ ] **Step 1: Write the failing test**

Append to `markai-backend-new/tests/test_approvals.py`:

```python
def _stub_scope(monkeypatch, scope):
    async def fake_scope(cms_user_id):
        return scope

    monkeypatch.setattr(
        "app.approvals.service.cms_client.get_operator_scope", fake_scope
    )


def _operator_token(cms_user_id, email, role):
    from app.core.security import create_operator_token

    return create_operator_token(cms_user_id, email, role)


async def _pending_booking(client, monkeypatch, screen_id="screen-b"):
    async def fake_get_screen(sid):
        return {
            "id": sid,
            "name": "Cafe MG Road",
            "city": "Bengaluru",
            "on_start_minute": None,
            "on_end_minute": None,
        }

    monkeypatch.setattr(
        "app.bookings.service.screen_service.get_screen", fake_get_screen
    )
    token = await _signup(client)
    content_id = await _seed_content(client)
    resp = await client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Nike",
            "screen_id": screen_id,
            "content_id": content_id,
            "schedule_type": "continuous",
            "start_at": "2026-08-01T09:00:00+05:30",
            "end_at": "2026-08-08T17:00:00+05:30",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_owner_sees_only_their_screens_superadmin_sees_all(client, monkeypatch):
    booking_id = await _pending_booking(client, monkeypatch, "screen-b")

    _stub_scope(
        monkeypatch,
        {"role": "screenowner", "screen_ids": ["screen-a"], "is_active": True},
    )
    other = await client.get(
        "/api/approvals",
        headers={"Authorization": f"Bearer {_operator_token('o2', 'as@cafe.com', 'screenowner')}"},
    )
    assert other.status_code == 200, other.text
    assert other.json()["total"] == 0

    _stub_scope(
        monkeypatch,
        {"role": "screenowner", "screen_ids": ["screen-b"], "is_active": True},
    )
    mine = await client.get(
        "/api/approvals",
        headers={"Authorization": f"Bearer {_operator_token('o1', 'bs@cafe.com', 'screenowner')}"},
    )
    assert mine.json()["total"] == 1
    assert mine.json()["requests"][0]["id"] == booking_id


async def test_ownerless_screen_still_reaches_the_superadmin(client, monkeypatch):
    await _pending_booking(client, monkeypatch, "orphan-screen")
    # A superadmin's queue is unfiltered, so nothing can be orphaned.
    _stub_scope(
        monkeypatch, {"role": "superadmin", "screen_ids": [], "is_active": True}
    )
    resp = await client.get(
        "/api/approvals",
        headers={"Authorization": f"Bearer {_operator_token('sa', 'admin@mark-ai.tech', 'superadmin')}"},
    )
    assert resp.json()["total"] == 1


async def test_approve_creates_the_cms_booking_once(client, monkeypatch):
    booking_id = await _pending_booking(client, monkeypatch)
    created = []

    async def fake_create(payload):
        created.append(payload)
        return {"id": "cms-77", "status": "active"}

    monkeypatch.setattr("app.approvals.service.cms_client.create_booking", fake_create)
    _stub_scope(
        monkeypatch,
        {"role": "screenowner", "screen_ids": ["screen-b"], "is_active": True},
    )
    headers = {"Authorization": f"Bearer {_operator_token('o1', 'bs@cafe.com', 'screenowner')}"}

    resp = await client.post(f"/api/approvals/{booking_id}/approve", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["approval_status"] == "approved"
    assert body["cms_booking_id"] == "cms-77"
    assert body["decided_by_email"] == "bs@cafe.com"
    assert len(created) == 1
    assert created[0]["external_ref"]["order_id"] == booking_id

    # Deciding twice is refused, and never books twice.
    again = await client.post(f"/api/approvals/{booking_id}/approve", headers=headers)
    assert again.status_code == 409
    assert len(created) == 1


async def test_non_owner_cannot_approve(client, monkeypatch):
    booking_id = await _pending_booking(client, monkeypatch, "screen-b")
    _stub_scope(
        monkeypatch,
        {"role": "screenowner", "screen_ids": ["screen-a"], "is_active": True},
    )
    resp = await client.post(
        f"/api/approvals/{booking_id}/approve",
        headers={"Authorization": f"Bearer {_operator_token('o2', 'as@cafe.com', 'screenowner')}"},
    )
    assert resp.status_code == 403


async def test_reject_never_calls_the_cms(client, monkeypatch):
    booking_id = await _pending_booking(client, monkeypatch)
    calls = []

    async def fake_create(payload):
        calls.append(payload)
        return {"id": "cms-should-not-happen"}

    monkeypatch.setattr("app.approvals.service.cms_client.create_booking", fake_create)
    _stub_scope(
        monkeypatch, {"role": "superadmin", "screen_ids": [], "is_active": True}
    )
    resp = await client.post(
        f"/api/approvals/{booking_id}/reject",
        headers={"Authorization": f"Bearer {_operator_token('sa', 'admin@mark-ai.tech', 'superadmin')}"},
        json={"reason": "Creative is off-brand for this venue."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["approval_status"] == "rejected"
    assert resp.json()["reject_reason"] == "Creative is off-brand for this venue."
    assert calls == []


async def test_cms_failure_on_approve_leaves_the_request_pending(client, monkeypatch):
    booking_id = await _pending_booking(client, monkeypatch)

    async def failing_create(payload):
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="This screen runs 09:00–17:00.")

    monkeypatch.setattr(
        "app.approvals.service.cms_client.create_booking", failing_create
    )
    _stub_scope(
        monkeypatch,
        {"role": "screenowner", "screen_ids": ["screen-b"], "is_active": True},
    )
    headers = {"Authorization": f"Bearer {_operator_token('o1', 'bs@cafe.com', 'screenowner')}"}

    resp = await client.post(f"/api/approvals/{booking_id}/approve", headers=headers)
    assert resp.status_code == 422
    assert "09:00" in resp.json()["detail"]

    # Still decidable — nothing was lost.
    listed = await client.get("/api/approvals", headers=headers)
    assert listed.json()["total"] == 1


async def test_deactivated_operator_is_refused(client, monkeypatch):
    await _pending_booking(client, monkeypatch)
    _stub_scope(
        monkeypatch,
        {"role": "screenowner", "screen_ids": ["screen-b"], "is_active": False},
    )
    resp = await client.get(
        "/api/approvals",
        headers={"Authorization": f"Bearer {_operator_token('o1', 'bs@cafe.com', 'screenowner')}"},
    )
    assert resp.status_code == 403


async def test_an_operator_token_cannot_book(client, monkeypatch):
    resp = await client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {_operator_token('o1', 'bs@cafe.com', 'screenowner')}"},
        json={
            "name": "Nike",
            "screen_id": "screen-b",
            "content_id": "x",
            "schedule_type": "continuous",
            "start_at": "2026-08-01T09:00:00+05:30",
            "end_at": "2026-08-08T17:00:00+05:30",
        },
    )
    assert resp.status_code == 403
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd markai-backend-new && poetry run pytest tests/test_approvals.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.approvals'`.

- [ ] **Step 3: Create the schemas**

Create `markai-backend-new/app/approvals/__init__.py` (empty file) and `markai-backend-new/app/approvals/schemas.py`:

```python
"""Shapes for the operator approvals console."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RejectRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)


class ApprovalOut(BaseModel):
    """A booking request as an approver sees it — including who asked."""

    id: str
    name: str
    screen_id: str
    screen_name: Optional[str] = None
    screen_city: Optional[str] = None
    advertiser_name: Optional[str] = None
    advertiser_email: Optional[str] = None
    creative_url: Optional[str] = None
    creative_type: Optional[str] = None
    schedule_type: str
    start_at: datetime
    end_at: datetime
    daily_windows: Optional[List[Dict[str, Any]]] = None
    days_of_week: Optional[List[int]] = None
    target_plays_per_day: Optional[int] = None
    approval_status: str
    cms_booking_id: Optional[str] = None
    decided_by_email: Optional[str] = None
    decided_by_role: Optional[str] = None
    decided_at: Optional[datetime] = None
    reject_reason: Optional[str] = None
    created_at: datetime


class ApprovalListResponse(BaseModel):
    requests: List[ApprovalOut]
    total: int


class PendingCountResponse(BaseModel):
    pending: int


class ConsoleOverviewResponse(BaseModel):
    pending: int
    screens_total: int
    screens_online: int
    decided_this_week: int
```

- [ ] **Step 4: Create the service**

Create `markai-backend-new/app/approvals/service.py`:

```python
"""Approvals — the decision that turns a request into a CMS booking.

Authority is re-resolved from the CMS on every call rather than trusted from
the token, so a re-enrolled screen or a deactivated owner takes effect at once.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.approvals.schemas import ApprovalOut
from app.bookings.models import Booking
from app.cms.client import cms_client
from app.content.models import MediaAsset
from app.core.security import Operator
from app.solutions.service import get_own_solution, layout_for_cms
from app.users.models import User

logger = logging.getLogger(__name__)


class Scope:
    """What this operator may act on, as of right now."""

    def __init__(self, role: str, screen_ids: List[str]):
        self.role = role
        self.screen_ids = screen_ids

    @property
    def sees_everything(self) -> bool:
        return self.role == "superadmin"

    def may_decide(self, screen_id: str) -> bool:
        return self.sees_everything or screen_id in self.screen_ids


async def resolve_scope(operator: Operator) -> Scope:
    """Ask the CMS who this operator is now. 403 if they've been switched off."""
    data = await cms_client.get_operator_scope(operator.id)
    if not data.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated.",
        )
    return Scope(data.get("role", operator.role), list(data.get("screen_ids") or []))


def _to_out(
    booking: Booking,
    advertiser: Optional[User] = None,
    creative: Optional[MediaAsset] = None,
) -> ApprovalOut:
    advertiser_name = None
    if advertiser is not None:
        advertiser_name = (
            f"{advertiser.first_name} {advertiser.last_name}".strip()
            or advertiser.email
        )
    return ApprovalOut(
        id=booking.id,
        name=booking.name,
        screen_id=booking.screen_id,
        screen_name=booking.screen_name,
        screen_city=booking.screen_city,
        advertiser_name=advertiser_name,
        advertiser_email=advertiser.email if advertiser else None,
        creative_url=creative.file_url if creative else None,
        creative_type=creative.type if creative else None,
        schedule_type=booking.schedule_type,
        start_at=booking.start_at,
        end_at=booking.end_at,
        daily_windows=booking.daily_windows,
        days_of_week=booking.days_of_week,
        target_plays_per_day=booking.target_plays_per_day,
        approval_status=booking.approval_status,
        cms_booking_id=booking.cms_booking_id,
        decided_by_email=booking.decided_by_email,
        decided_by_role=booking.decided_by_role,
        decided_at=booking.decided_at,
        reject_reason=booking.reject_reason,
        created_at=booking.created_at,
    )


def _scoped(query, scope: Scope):
    """Superadmins see everything; owners see only their screens.

    An ownerless screen is therefore not a gap — its requests still appear in
    the superadmin queue, which has no filter to fall out of.
    """
    if scope.sees_everything:
        return query
    if not scope.screen_ids:
        return query.where(Booking.screen_id.in_([]))
    return query.where(Booking.screen_id.in_(scope.screen_ids))


async def list_requests(
    db: AsyncSession, operator: Operator, approval_status: str
) -> Tuple[List[ApprovalOut], int]:
    scope = await resolve_scope(operator)
    query = _scoped(
        select(Booking).where(Booking.approval_status == approval_status), scope
    )
    rows = list(
        (await db.execute(query.order_by(Booking.created_at.asc()))).scalars().all()
    )
    if not rows:
        return [], 0

    users = {
        u.id: u
        for u in (
            await db.execute(
                select(User).where(User.id.in_({r.user_id for r in rows}))
            )
        )
        .scalars()
        .all()
    }
    media_ids = {r.content_id for r in rows if r.content_id}
    media = {
        m.id: m
        for m in (
            await db.execute(select(MediaAsset).where(MediaAsset.id.in_(media_ids)))
        )
        .scalars()
        .all()
    } if media_ids else {}

    out = [
        _to_out(r, users.get(r.user_id), media.get(r.content_id) if r.content_id else None)
        for r in rows
    ]
    return out, len(out)


async def pending_count(db: AsyncSession, operator: Operator) -> int:
    scope = await resolve_scope(operator)
    query = _scoped(
        select(func.count(Booking.id)).where(Booking.approval_status == "pending"),
        scope,
    )
    return int((await db.execute(query)).scalar() or 0)


async def _load_for_decision(
    db: AsyncSession, operator: Operator, booking_id: str
) -> Tuple[Booking, Scope]:
    scope = await resolve_scope(operator)
    booking = (
        await db.execute(
            select(Booking).where(Booking.id == booking_id).with_for_update()
        )
    ).scalar_one_or_none()
    if booking is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Request not found"
        )
    if not scope.may_decide(booking.screen_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This request is for a screen you don't manage.",
        )
    if booking.approval_status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This request was already {booking.approval_status}"
                + (
                    f" by {booking.decided_by_email}."
                    if booking.decided_by_email
                    else "."
                )
            ),
        )
    return booking, scope


async def _cms_payload(db: AsyncSession, booking: Booking) -> dict:
    """Rebuild the CMS booking payload from our stored row."""
    advertiser = (
        await db.execute(select(User).where(User.id == booking.user_id))
    ).scalar_one_or_none()
    if advertiser is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The advertiser who raised this request no longer exists.",
        )
    display_name = (
        f"{advertiser.first_name} {advertiser.last_name}".strip() or advertiser.email
    )

    if booking.solution_id:
        solution = await get_own_solution(db, booking.user_id, booking.solution_id)
        layout, cms_media_id = await layout_for_cms(db, booking.user_id, solution)
    else:
        media = (
            await db.execute(
                select(MediaAsset).where(MediaAsset.id == booking.content_id)
            )
        ).scalar_one_or_none()
        if media is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The creative for this request has been deleted.",
            )
        layout, cms_media_id = None, media.cms_media_id

    return {
        "name": booking.name,
        "screen_id": booking.screen_id,
        "media_id": cms_media_id,
        "schedule_type": booking.schedule_type,
        "start_at": booking.start_at.isoformat(),
        "end_at": booking.end_at.isoformat(),
        "daily_windows": booking.daily_windows,
        "days_of_week": booking.days_of_week,
        "target_plays_per_day": booking.target_plays_per_day,
        "layout": booking.layout,
        "external_ref": {
            "user_id": booking.user_id,
            "name": display_name,
            "order_id": booking.id,
        },
    }


async def approve(
    db: AsyncSession, operator: Operator, booking_id: str
) -> ApprovalOut:
    """Create the CMS booking, then record the decision — in that order.

    The row is locked for the whole call, so a simultaneous approval by the
    owner and a superadmin cannot both reach the CMS. If the CMS refuses, the
    transaction rolls back and the request stays pending rather than being
    lost; the CMS's own message is what the operator reads.
    """
    booking, _ = await _load_for_decision(db, operator, booking_id)
    payload = await _cms_payload(db, booking)

    cms_booking = await cms_client.create_booking(payload)

    booking.cms_booking_id = cms_booking["id"]
    booking.status_cache = cms_booking.get("status", "active")
    booking.approval_status = "approved"
    booking.decided_by_cms_user_id = operator.id
    booking.decided_by_email = operator.email
    booking.decided_by_role = operator.role
    booking.decided_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(booking)
    logger.info(
        "Request %s approved by %s (%s) -> cms %s",
        booking.id, operator.email, operator.role, booking.cms_booking_id,
    )
    return _to_out(booking)


async def reject(
    db: AsyncSession, operator: Operator, booking_id: str, reason: Optional[str]
) -> ApprovalOut:
    """Decline the request. The CMS is never told it existed."""
    booking, _ = await _load_for_decision(db, operator, booking_id)
    booking.approval_status = "rejected"
    booking.status_cache = "rejected"
    booking.reject_reason = (reason or "").strip() or None
    booking.decided_by_cms_user_id = operator.id
    booking.decided_by_email = operator.email
    booking.decided_by_role = operator.role
    booking.decided_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(booking)
    logger.info(
        "Request %s rejected by %s (%s)", booking.id, operator.email, operator.role
    )
    return _to_out(booking)


async def console_screens(operator: Operator) -> List[dict]:
    """The operator's screens, live from the CMS."""
    scope = await resolve_scope(operator)
    screens = await cms_client.list_screens()
    if scope.sees_everything:
        return screens
    owned = set(scope.screen_ids)
    return [s for s in screens if s.get("id") in owned]


async def console_overview(db: AsyncSession, operator: Operator) -> dict:
    scope = await resolve_scope(operator)
    pending = int(
        (
            await db.execute(
                _scoped(
                    select(func.count(Booking.id)).where(
                        Booking.approval_status == "pending"
                    ),
                    scope,
                )
            )
        ).scalar()
        or 0
    )
    week_floor = datetime.now(timezone.utc) - timedelta(days=7)
    decided = int(
        (
            await db.execute(
                _scoped(
                    select(func.count(Booking.id)).where(
                        Booking.decided_at.is_not(None),
                        Booking.decided_at >= week_floor,
                    ),
                    scope,
                )
            )
        ).scalar()
        or 0
    )

    try:
        screens = await console_screens(operator)
    except HTTPException:
        screens = []  # a CMS blip must not blank the whole overview
    return {
        "pending": pending,
        "screens_total": len(screens),
        "screens_online": sum(1 for s in screens if s.get("status") == "online"),
        "decided_this_week": decided,
    }
```

- [ ] **Step 5: Create the router**

Create `markai-backend-new/app/approvals/router.py`:

```python
"""Operator console — booking approvals and the screens they cover."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.approvals import service
from app.approvals.schemas import (
    ApprovalListResponse,
    ApprovalOut,
    ConsoleOverviewResponse,
    PendingCountResponse,
    RejectRequest,
)
from app.core.database import get_db
from app.core.security import Operator, require_operator

router = APIRouter(tags=["approvals"])


@router.get("/approvals", response_model=ApprovalListResponse)
async def list_approvals(
    status: str = Query(default="pending", pattern="^(pending|approved|rejected)$"),
    operator: Operator = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> ApprovalListResponse:
    """Requests this operator may decide. Superadmins see every screen."""
    requests, total = await service.list_requests(db, operator, status)
    return ApprovalListResponse(requests=requests, total=total)


@router.get("/approvals/count", response_model=PendingCountResponse)
async def pending_count(
    operator: Operator = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> PendingCountResponse:
    return PendingCountResponse(pending=await service.pending_count(db, operator))


@router.post("/approvals/{booking_id}/approve", response_model=ApprovalOut)
async def approve(
    booking_id: str,
    operator: Operator = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    """Approve the request and book it on the screen."""
    return await service.approve(db, operator, booking_id)


@router.post("/approvals/{booking_id}/reject", response_model=ApprovalOut)
async def reject(
    booking_id: str,
    payload: RejectRequest,
    operator: Operator = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    """Decline the request. Nothing is sent to the CMS."""
    return await service.reject(db, operator, booking_id, payload.reason)


@router.get("/console/screens")
async def console_screens(
    operator: Operator = Depends(require_operator),
) -> dict:
    return {"screens": await service.console_screens(operator)}


@router.get("/console/overview", response_model=ConsoleOverviewResponse)
async def console_overview(
    operator: Operator = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> ConsoleOverviewResponse:
    return ConsoleOverviewResponse(**await service.console_overview(db, operator))
```

- [ ] **Step 6: Mount the router and register the module**

In `markai-backend-new/app/main.py`, add the import next to the others (after line 8):

```python
from app.approvals.router import router as approvals_router
```

And mount it after the bookings router (after line 80):

```python
app.include_router(approvals_router, prefix=settings.API_PREFIX)
```

- [ ] **Step 7: Run the tests**

Run: `cd markai-backend-new && poetry run pytest tests/test_approvals.py -q`
Expected: PASS — 12 passed.

- [ ] **Step 8: Run the full suite**

Run: `cd markai-backend-new && poetry run pytest -q`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
cd markai-backend-new
git add app/approvals app/main.py tests/test_approvals.py
git commit -m "feat(approvals): operator console API for deciding booking requests"
```

---

# Phase C — `markai-frontend-new`

No test framework here. After every task run all three gates:
`npx tsc --noEmit && npm run build`.

### Task 8: Session layer — one shape, two principal kinds

**Files:**
- Modify: `markai-frontend-new/lib/auth.ts`

**Interfaces:**
- Produces: `Role`; `AuthUser{id, role, email, first_name, last_name, avatar_url, google_linked, has_password}` (names now nullable, `email` always present); `login(email, password, asOperator?)`; `displayName(user)`; `initials(user)`; `isOperator(user)`. `identify(email)` is unchanged.

- [ ] **Step 1: Update the types and calls**

In `markai-frontend-new/lib/auth.ts`, replace the `AuthUser` interface (lines 18-26) with:

```ts
export type Role = "advertiser" | "screenowner" | "superadmin";

/** The signed-in principal. One shape for both kinds: an advertiser has a
 *  name, a CMS operator has only an email and a role. */
export interface AuthUser {
  id: string;
  role: Role;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  google_linked: boolean;
  has_password: boolean;
}

/** True for a screen owner or superadmin — the people who approve bookings. */
export function isOperator(user: AuthUser | null): boolean {
  return user?.role === "screenowner" || user?.role === "superadmin";
}

/** What to call this person in the UI: their name, or their email. */
export function displayName(user: AuthUser): string {
  const full = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return full || user.email;
}

/** Up to two letters for the avatar chip. */
export function initials(user: AuthUser): string {
  if (user.first_name) {
    return `${user.first_name[0] ?? ""}${user.last_name?.[0] ?? ""}`.toUpperCase();
  }
  return user.email.slice(0, 2).toUpperCase();
}
```

`IdentifyResult` is unchanged — `identify` only ever runs for advertisers.

Replace `AuthResult` (lines 35-38) with:

```ts
export interface AuthResult {
  access_token: string;
  role: Role;
  user: AuthUser | null;
  operator: { id: string; email: string; role: Role } | null;
}
```

Replace `login` (lines 83-84) with:

```ts
/** `asOperator` is the sign-in page's "I'm a screen owner or administrator"
 *  checkbox: it sends the credential to the CMS instead of our own table.
 *  One email may exist in both systems, so the person tells us which. */
export const login = (email: string, password: string, asOperator = false) =>
  api<AuthResult>("/login", { email, password, as_operator: asOperator });
```

- [ ] **Step 2: See what breaks**

Run: `cd markai-frontend-new && npx tsc --noEmit`
Expected: FAIL, listing the call sites that assume the old shape — `components/layout/Navbar.tsx` (`user.first_name[0]`), `app/dashboard/page.tsx` (`user.first_name`). Those are fixed in Task 12. Record the list; it is the work queue.

- [ ] **Step 3: Commit**

```bash
cd markai-frontend-new
git add lib/auth.ts
git commit -m "feat(auth): role-aware session shared by advertisers and operators"
```

---

### Task 9: The sign-in checkbox

**Files:**
- Modify: `markai-frontend-new/components/auth/AuthCard.tsx`

**Interfaces:**
- Consumes: `identify`, `login`, `Role` (Task 8).
- Produces: post-login routing — operator → `/console`, advertiser → `/`.

- [ ] **Step 1: Add the checkbox state and the operator submit path**

In `markai-frontend-new/components/auth/AuthCard.tsx`, add beside the other state (after line 33):

```tsx
  const [asOperator, setAsOperator] = useState(false);
```

Replace `onEmailContinue` (lines 62-73) with:

```tsx
  const onEmailContinue = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (data.get("email") as string).trim();

    // Operators sign in in one step: identify can't answer for them without a
    // password, and asking the CMS would leak which operator accounts exist.
    if (asOperator) {
      const password = data.get("password") as string;
      run(async () => {
        const res = await login(value, password, true);
        storeSession(res.access_token);
        router.push("/console");
      });
      return;
    }

    run(async () => {
      const who = await identify(value);
      setEmail(value);
      setFirstName(who.first_name ?? "");
      if (!who.exists) setStep("details");
      else if (who.has_password) setStep("password");
      else setStep("google-only");
    });
  };
```

Replace `onLogin` (lines 75-83) with:

```tsx
  const onLogin = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password") as string;
    run(async () => {
      const res = await login(email, password);
      storeSession(res.access_token);
      router.push(res.role === "advertiser" ? "/" : "/console");
    });
  };
```

- [ ] **Step 2: Render the checkbox and the conditional password field**

Replace the body of the `"email"` step (lines 121-146) with:

```tsx
            <StepPanel key="email">
              <Heading
                eyebrow="Mark AI account"
                title={asOperator ? "Welcome back." : "Step into the city."}
                sub={
                  asOperator
                    ? "Sign in with the email and password your administrator gave you."
                    : "Sign in or create your account — enter your email and we'll take it from there."
                }
              />
              <div className="flex flex-col gap-4">
                {/* A CMS credential has nothing to do with Google, so the
                    Google path disappears once the box is ticked. */}
                {!asOperator && (
                  <>
                    <GoogleButton />
                    <Divider />
                  </>
                )}
                <form onSubmit={onEmailContinue} className="flex flex-col gap-4">
                  <Field
                    id="email"
                    name="email"
                    type="email"
                    label="Email"
                    placeholder={asOperator ? "you@venue.com" : "you@company.com"}
                    autoComplete="email"
                    defaultValue={email}
                    required
                    autoFocus
                  />
                  {asOperator && (
                    <Field
                      id="operator_password"
                      name="password"
                      type="password"
                      label="Password"
                      autoComplete="current-password"
                      required
                    />
                  )}
                  <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-snug text-muted">
                    <input
                      type="checkbox"
                      checked={asOperator}
                      onChange={(e) => {
                        setAsOperator(e.target.checked);
                        setError("");
                      }}
                      className="mt-0.5 h-4 w-4 flex-none accent-[var(--blue)]"
                    />
                    I&rsquo;m a screen owner or administrator
                  </label>
                  <ErrorNote>{error}</ErrorNote>
                  <SubmitButton busy={busy}>
                    {asOperator ? "Sign in" : "Continue"}
                  </SubmitButton>
                </form>
              </div>
            </StepPanel>
```

- [ ] **Step 3: Verify**

Run: `cd markai-frontend-new && npx tsc --noEmit`
Expected: the AuthCard reports no errors; Navbar and dashboard errors from Task 8 remain until Task 12.

- [ ] **Step 4: Commit**

```bash
cd markai-frontend-new
git add components/auth/AuthCard.tsx
git commit -m "feat(auth): screen owner and administrator sign-in checkbox"
```

---

### Task 10: The console shell

**Files:**
- Create: `markai-frontend-new/lib/console.ts`, `markai-frontend-new/lib/three/console-scene.ts`, `markai-frontend-new/app/console/layout.tsx`, `markai-frontend-new/components/console/ConsoleNav.tsx`
- Test: none (no framework — verified via the three gates and the manual run in Task 13)

**Interfaces:**
- Produces:
  - `lib/console.ts`: `ApprovalRequest` interface, `listApprovals(status)`, `pendingCount()`, `approveRequest(id)`, `rejectRequest(id, reason)`, `consoleScreens()`, `consoleOverview()`.
  - `ConsoleScene` class with `constructor(host)`, `setTheme(theme)`, `dispose()`.
  - `app/console/layout.tsx` — role gate + persistent backdrop + sidebar.

- [ ] **Step 1: Create the API client**

Create `markai-frontend-new/lib/console.ts`:

```ts
"use client";

/**
 * Operator console API — booking approvals and the screens they cover.
 *
 * Every route here requires a screenowner or superadmin token; the backend
 * re-resolves the operator's authority from the CMS on each call, so a screen
 * re-enrolled to someone else moves between queues without a re-login.
 */

import { ApiError, getToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8096/api";

export interface ApprovalRequest {
  id: string;
  name: string;
  screen_id: string;
  screen_name: string | null;
  screen_city: string | null;
  advertiser_name: string | null;
  advertiser_email: string | null;
  creative_url: string | null;
  creative_type: string | null;
  schedule_type: "continuous" | "specific_time" | "times_per_day" | "custom";
  start_at: string;
  end_at: string;
  daily_windows: { start: string; end: string }[] | null;
  days_of_week: number[] | null;
  target_plays_per_day: number | null;
  approval_status: "pending" | "approved" | "rejected";
  cms_booking_id: string | null;
  decided_by_email: string | null;
  decided_by_role: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface ConsoleOverview {
  pending: number;
  screens_total: number;
  screens_online: number;
  decided_this_week: number;
}

async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : (detail as { message?: string })?.message ?? "Something went wrong. Please try again.";
    throw new ApiError(res.status, (detail as { code?: string })?.code ?? "unknown", message);
  }
  return data as T;
}

export const listApprovals = (status: "pending" | "approved" | "rejected" = "pending") =>
  api<{ requests: ApprovalRequest[]; total: number }>(`/approvals?status=${status}`);

export const pendingCount = () => api<{ pending: number }>("/approvals/count");

export const approveRequest = (id: string) =>
  api<ApprovalRequest>(`/approvals/${id}/approve`, { method: "POST" });

export const rejectRequest = (id: string, reason: string) =>
  api<ApprovalRequest>(`/approvals/${id}/reject`, { body: { reason } });

export const consoleOverview = () => api<ConsoleOverview>("/console/overview");

export const consoleScreens = () =>
  api<{ screens: import("./platform").Screen[] }>("/console/screens").then((d) => d.screens);
```

- [ ] **Step 2: Create the console 3D backdrop**

Create `markai-frontend-new/lib/three/console-scene.ts`:

```ts
import * as THREE from "three";

export type SceneTheme = "dark" | "light";

/**
 * The console's ambient backdrop: a slow drift through a field of dark screen
 * panels, each catching a faint edge of brand light — the fleet, abstracted.
 *
 * Deliberately lighter than AuthScene: no post-processing, no bloom, no
 * canvas ad textures. It is mounted once in the console layout and persists
 * across navigation, so it must stay cheap to run for an hour, not just
 * impressive for ten seconds. Reduced motion freezes the drift to one frame.
 */
export class ConsoleScene {
  private host: HTMLElement;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private amb!: THREE.AmbientLight;
  private panels: THREE.Mesh[] = [];
  private panelMats: THREE.MeshStandardMaterial[] = [];

  private raf = 0;
  private clock = 0;
  private disposed = false;
  private reducedMotion = false;
  private onResize: () => void;

  constructor(host: HTMLElement) {
    this.host = host;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.onResize = () => this.resize();
    window.addEventListener("resize", this.onResize);
    this.init();
  }

  private init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050a);
    this.scene.fog = new THREE.Fog(0x05070c, 18, 78);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.host.clientWidth / this.host.clientHeight,
      0.5,
      140,
    );
    this.camera.position.set(0, 2, 26);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    this.host.appendChild(this.renderer.domElement);

    this.amb = new THREE.AmbientLight(0xffffff, 0.5);
    const key = new THREE.DirectionalLight(0x6ea8ff, 0.55);
    key.position.set(6, 10, 12);
    this.scene.add(this.amb, key);

    // A deterministic field of panels so the console looks the same each visit.
    const rand = mulberry32(20260720);
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 46; i++) {
      const w = 2.4 + rand() * 3.2;
      const h = w * (9 / 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0a0d16,
        emissive: new THREE.Color().setHSL(0.55 + rand() * 0.09, 0.7, 0.06),
        roughness: 0.75,
        metalness: 0.2,
        transparent: true,
        opacity: 0.5 + rand() * 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(w, h, 1);
      mesh.position.set(
        (rand() - 0.5) * 46,
        (rand() - 0.5) * 24,
        -4 - rand() * 52,
      );
      mesh.rotation.set((rand() - 0.5) * 0.3, (rand() - 0.5) * 0.7, (rand() - 0.5) * 0.12);
      this.panels.push(mesh);
      this.panelMats.push(mat);
      this.scene.add(mesh);
    }

    this.animate();
  }

  setTheme(theme: SceneTheme) {
    const dark = theme === "dark";
    this.scene.background = new THREE.Color(dark ? 0x04050a : 0xdfe7f2);
    this.scene.fog = new THREE.Fog(dark ? 0x05070c : 0xccd7e7, 18, 78);
    this.amb.intensity = dark ? 0.5 : 0.95;
    this.panelMats.forEach((m) => {
      m.color.setHex(dark ? 0x0a0d16 : 0xb9c6da);
      m.emissiveIntensity = dark ? 1 : 0.25;
    });
  }

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    if (!this.reducedMotion) this.clock += 1 / 60;

    // Very slow forward drift; panels that pass the camera wrap to the back,
    // so the field is endless without ever allocating a new mesh.
    const t = this.clock * 0.06;
    this.camera.position.x = Math.sin(t) * 1.6;
    this.camera.position.y = 2 + Math.sin(t * 0.7) * 0.5;
    this.camera.lookAt(0, 0, -20);
    for (const panel of this.panels) {
      if (!this.reducedMotion) panel.position.z += 0.012;
      if (panel.position.z > 8) panel.position.z = -56;
    }

    this.renderer?.render(this.scene, this.camera);
  };

  private resize() {
    if (!this.renderer) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
}

/** Deterministic PRNG so the field is identical every visit. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 3: Create the console navigation**

Create `markai-frontend-new/components/console/ConsoleNav.tsx`:

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardCheck, History, LayoutDashboard, LogOut, MonitorPlay } from "lucide-react";
import { displayName, initials, signOut, type AuthUser } from "@/lib/auth";

const LINKS = [
  { href: "/console", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/console/approvals", label: "Approvals", icon: ClipboardCheck, exact: true },
  { href: "/console/approvals/history", label: "History", icon: History, exact: true },
  { href: "/console/screens", label: "Screens", icon: MonitorPlay, exact: true },
];

/** Console chrome: a quiet rail. The operator has one job here, so the
 *  navigation stays out of the way of the queue. */
export default function ConsoleNav({
  user,
  pending,
}: {
  user: AuthUser;
  pending: number | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = () => {
    signOut();
    router.push("/auth");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-nav-edge bg-nav-bg backdrop-blur-[22px] backdrop-saturate-[1.6]">
      <div className="mx-auto flex max-w-[1180px] items-center gap-4 px-5 py-3 sm:px-7">
        <Link href="/console" className="flex flex-none items-center" aria-label="Mark AI console">
          <Image
            src="/mark_ai_logo2-removebg-preview.png"
            alt="Mark AI"
            width={500}
            height={500}
            priority
            className="h-8 w-auto max-w-none"
          />
        </Link>
        <span className="hidden h-6 w-px flex-none bg-nav-edge sm:block" />

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            const showBadge = href === "/console/approvals" && !!pending;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex flex-none items-center gap-2 rounded-full px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                  active
                    ? "bg-panel-strong text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Icon size={15} aria-hidden />
                {label}
                {showBadge && (
                  <span className="ml-0.5 inline-flex min-w-[20px] items-center justify-center rounded-full bg-cta-gradient px-1.5 py-0.5 text-[11px] font-bold text-on-accent">
                    {pending}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-none items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-[13px] font-bold leading-tight text-foreground">
              {displayName(user)}
            </div>
            <div className="text-[11px] capitalize text-faint">
              {user.role === "superadmin" ? "Administrator" : "Screen owner"}
            </div>
          </div>
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-cta-gradient text-[13px] font-bold text-on-accent">
            {initials(user)}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-nav-edge text-muted transition-colors hover:text-foreground"
          >
            <LogOut size={15} aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Create the layout**

Create `markai-frontend-new/app/console/layout.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { isOperator, useAuth } from "@/lib/auth";
import { pendingCount } from "@/lib/console";
import { ConsoleScene } from "@/lib/three/console-scene";
import { useTheme } from "@/components/theme/ThemeProvider";
import ConsoleNav from "@/components/console/ConsoleNav";

/**
 * The operator console shell. Owns three things the pages should not repeat:
 * the role gate, the one 3D backdrop (mounted here so it survives navigation
 * instead of re-initialising per page), and the pending count in the nav.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ConsoleScene | null>(null);
  const { theme } = useTheme();
  const [pending, setPending] = useState<number | null>(null);

  const operator = isOperator(user);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/auth");
    else if (!operator) router.replace("/dashboard");
  }, [loading, user, operator, router]);

  // A ref CALLBACK, not an effect with [] deps. The host div only exists in
  // the resolved branch below, and on the login -> /console path the first
  // commit is always the loading branch (storeSession clears the session
  // cache), so a once-only effect would find hostRef.current null, bail, and
  // never retry — the backdrop would silently never mount.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const attachScene = useCallback((node: HTMLDivElement | null) => {
    if (node && !sceneRef.current) {
      sceneRef.current = new ConsoleScene(node);
      sceneRef.current.setTheme(themeRef.current);
    } else if (!node && sceneRef.current) {
      sceneRef.current.dispose();
      sceneRef.current = null;
    }
  }, []);

  useEffect(() => {
    sceneRef.current?.setTheme(theme);
  }, [theme]);

  const refreshCount = useCallback(() => {
    pendingCount()
      .then((d) => setPending(d.pending))
      .catch(() => setPending(null));
  }, []);

  useEffect(() => {
    if (operator) refreshCount();
  }, [operator, refreshCount]);

  // Pages tell the shell the queue changed after a decision.
  useEffect(() => {
    const onChanged = () => refreshCount();
    window.addEventListener("markai:approvals-changed", onChanged);
    return () => window.removeEventListener("markai:approvals-changed", onChanged);
  }, [refreshCount]);

  const ready = !loading && !!user && operator;

  return (
    <div className="relative min-h-screen bg-surface">
      {/* Mounted for operators only — an advertiser being redirected away
          should not pay for a WebGL context, and the ref callback disposes
          the scene the moment this node detaches. */}
      {ready && <div ref={attachScene} aria-hidden className="fixed inset-0 z-0" />}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,transparent_35%,color-mix(in_srgb,var(--bg)_78%,transparent)_100%)]"
      />
      <div className="relative z-[2]">
        {ready ? (
          <>
            <ConsoleNav user={user} pending={pending} />
            <main className="mx-auto max-w-[1180px] px-5 pb-24 pt-9 sm:px-7">
              {children}
            </main>
          </>
        ) : (
          <div className="mx-auto max-w-[1180px] px-5 pt-24 sm:px-7">
            <div className="h-10 w-56 animate-pulse rounded-xl bg-panel" />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify the gates**

Run: `cd markai-frontend-new && npx tsc --noEmit`
Expected: no errors from the new files (Navbar/dashboard errors from Task 8 remain until Task 12).

- [ ] **Step 6: Commit**

```bash
cd markai-frontend-new
git add lib/console.ts lib/three/console-scene.ts app/console/layout.tsx components/console/ConsoleNav.tsx
git commit -m "feat(console): operator shell with persistent 3D backdrop"
```

---

### Task 11: The approvals queue

The page an owner sees most, so the empty state and the decision affordances carry the design weight. The one place 3D does real work is the request card: the creative is shown on a tilted, true-aspect screen panel, so the owner sees what will actually be on their glass before deciding.

**Files:**
- Create: `markai-frontend-new/components/console/RequestCard.tsx`, `markai-frontend-new/components/console/ScheduleSummary.tsx`, `markai-frontend-new/app/console/approvals/page.tsx`, `markai-frontend-new/app/console/approvals/history/page.tsx`

**Interfaces:**
- Consumes: `listApprovals`, `approveRequest`, `rejectRequest`, `ApprovalRequest` (Task 10); `DAY_LABELS` from `lib/platform`.
- Produces: `<RequestCard request onApprove onReject busy />`, `<ScheduleSummary request />`.

- [ ] **Step 1: Create the schedule summary**

Create `markai-frontend-new/components/console/ScheduleSummary.tsx`:

```tsx
import { CalendarDays, Clock, Repeat } from "lucide-react";
import { DAY_LABELS } from "@/lib/platform";
import type { ApprovalRequest } from "@/lib/console";

function istDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

const TYPE_LABEL: Record<ApprovalRequest["schedule_type"], string> = {
  continuous: "Runs every loop",
  specific_time: "Specific times",
  times_per_day: "Target plays per day",
  custom: "Custom schedule",
};

/** The three things an owner needs to judge a request: when it runs, on which
 *  days, and how often. Everything else lives on the card around it. */
export default function ScheduleSummary({ request }: { request: ApprovalRequest }) {
  const days =
    request.days_of_week && request.days_of_week.length > 0
      ? request.days_of_week.map((d) => DAY_LABELS[d]).join(", ")
      : "Every day";
  const windows =
    request.daily_windows && request.daily_windows.length > 0
      ? request.daily_windows.map((w) => `${w.start}–${w.end}`).join(", ")
      : "Whenever the screen is on";

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
      <div>
        <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          <CalendarDays size={12} aria-hidden /> Dates
        </dt>
        <dd className="mt-1 text-sm font-semibold text-foreground">
          {istDate(request.start_at)} – {istDate(request.end_at)}
        </dd>
      </div>
      <div>
        <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          <Clock size={12} aria-hidden /> Hours
        </dt>
        <dd className="mt-1 text-sm font-semibold text-foreground">{windows}</dd>
      </div>
      <div>
        <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          <Repeat size={12} aria-hidden /> Cadence
        </dt>
        <dd className="mt-1 text-sm font-semibold text-foreground">
          {TYPE_LABEL[request.schedule_type]}
          {request.target_plays_per_day
            ? ` · ${request.target_plays_per_day}/day`
            : ""}
          <span className="block text-xs font-medium text-muted">{days}</span>
        </dd>
      </div>
    </dl>
  );
}
```

- [ ] **Step 2: Create the request card**

Create `markai-frontend-new/components/console/RequestCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, MapPin, User, X } from "lucide-react";
import type { ApprovalRequest } from "@/lib/console";
import ScheduleSummary from "./ScheduleSummary";

/**
 * One booking request. The creative sits on a tilted, true-aspect screen
 * panel — the owner is deciding what appears on a physical screen they own,
 * so the card shows them the thing itself rather than a filename.
 */
export default function RequestCard({
  request,
  onApprove,
  onReject,
  busy = false,
}: {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: (reason: string) => void;
  busy?: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
      className="overflow-hidden rounded-[22px] border border-edge bg-panel backdrop-blur-md"
    >
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:p-7">
        {/* The screen, as an object in space. */}
        <div
          className="relative w-full flex-none sm:w-[230px]"
          style={{ perspective: "900px" }}
        >
          <div
            className="relative overflow-hidden rounded-[10px] border border-edge bg-screen-bg shadow-deep"
            style={{ aspectRatio: "16 / 9", transform: "rotateY(-9deg) rotateX(3deg)" }}
          >
            {request.creative_url ? (
              request.creative_type === "video" ? (
                <video
                  src={request.creative_url}
                  muted
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={request.creative_url}
                  alt={`Creative for ${request.name}`}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )
            ) : (
              <div className="absolute inset-0 mk-ad opacity-70" aria-hidden />
            )}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-1/4 bg-[linear-gradient(to_bottom,var(--screen-glare),transparent)]"
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="m-0 font-display text-[22px] font-bold leading-tight text-foreground">
            {request.name}
          </h3>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} className="flex-none text-faint" aria-hidden />
              {request.screen_name ?? request.screen_id}
              {request.screen_city ? `, ${request.screen_city}` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <User size={14} className="flex-none text-faint" aria-hidden />
              {request.advertiser_name ?? request.advertiser_email ?? "Unknown advertiser"}
            </span>
          </div>

          <div className="mt-5 border-t border-edge pt-5">
            <ScheduleSummary request={request} />
          </div>

          {rejecting ? (
            <div className="mt-6 flex flex-col gap-3">
              <label
                htmlFor={`reason-${request.id}`}
                className="text-[12px] font-bold uppercase tracking-[0.14em] text-faint"
              >
                Why are you declining? The advertiser will see this.
              </label>
              <textarea
                id={`reason-${request.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                autoFocus
                placeholder="This slot is already committed to a local sponsor."
                className="w-full resize-none rounded-xl border border-edge bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] px-4 py-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-accent-blue focus:ring-2 focus:ring-[color-mix(in_srgb,var(--blue)_35%,transparent)]"
              />
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onReject(reason)}
                  className="inline-flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--red)_45%,transparent)] bg-[color-mix(in_srgb,var(--red)_12%,transparent)] px-5 py-2.5 text-sm font-bold text-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
                >
                  <X size={15} aria-hidden /> Decline request
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="rounded-xl border border-edge px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:text-foreground"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={onApprove}
                className="inline-flex items-center gap-2 rounded-xl bg-cta-gradient px-5 py-2.5 text-sm font-bold text-on-accent shadow-cta-glow transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
              >
                <Check size={15} aria-hidden /> Approve and book
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejecting(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-edge px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-nav-edge hover:text-foreground disabled:opacity-60"
              >
                <X size={15} aria-hidden /> Decline
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}
```

- [ ] **Step 3: Create the queue page**

Create `markai-frontend-new/app/console/approvals/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { CheckCheck } from "lucide-react";
import { ApiError } from "@/lib/auth";
import {
  approveRequest,
  listApprovals,
  rejectRequest,
  type ApprovalRequest,
} from "@/lib/console";
import ErrorCard from "@/components/dashboard/ErrorCard";
import RequestCard from "@/components/console/RequestCard";

export default function ApprovalsPage() {
  const [requests, setRequests] = useState<ApprovalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listApprovals("pending")
      .then((d) => setRequests(d.requests))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Something went wrong."),
      );
  }, []);

  useEffect(load, [load]);

  const decide = async (
    request: ApprovalRequest,
    action: () => Promise<ApprovalRequest>,
    success: string,
  ) => {
    setBusyId(request.id);
    setError(null);
    try {
      await action();
      // Optimistic only after the server agrees — approving books a real ad
      // on a real screen, so it should never appear done before it is.
      setRequests((prev) => (prev ?? []).filter((r) => r.id !== request.id));
      setNote(success);
      window.dispatchEvent(new Event("markai:approvals-changed"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      load();
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="m-0 font-display text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.1] text-foreground">
          Approvals
        </h1>
        <p className="mb-0 mt-2.5 max-w-[520px] text-[15px] leading-relaxed text-muted">
          Advertisers have asked to run these on your screens. Approving books the
          campaign; the screen picks it up within a minute.
        </p>
      </div>

      {note && (
        <div
          role="status"
          className="rounded-2xl border border-[color-mix(in_srgb,var(--green)_40%,transparent)] bg-[color-mix(in_srgb,var(--green)_10%,transparent)] px-5 py-3.5 text-sm font-semibold text-foreground"
        >
          {note}
        </div>
      )}

      {error && <ErrorCard message={error} onRetry={load} />}

      {requests === null && !error ? (
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-[260px] animate-pulse rounded-[22px] border border-edge bg-panel backdrop-blur-md"
            />
          ))}
        </div>
      ) : requests && requests.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[22px] border border-edge bg-panel px-6 py-16 text-center backdrop-blur-md">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cta-gradient text-on-accent">
            <CheckCheck size={24} aria-hidden />
          </span>
          <h2 className="m-0 font-display text-2xl font-bold text-foreground">
            Nothing waiting
          </h2>
          <p className="m-0 max-w-[400px] text-sm leading-relaxed text-muted">
            Every request has been decided. New ones appear here as advertisers book
            your screens.
          </p>
          <Link
            href="/console/screens"
            className="mt-2 rounded-xl border border-edge bg-panel px-5 py-2.5 text-sm font-bold text-foreground transition-transform hover:-translate-y-0.5"
          >
            See your screens
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <AnimatePresence mode="popLayout">
            {(requests ?? []).map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                busy={busyId === request.id}
                onApprove={() =>
                  decide(
                    request,
                    () => approveRequest(request.id),
                    `“${request.name}” is booked on ${request.screen_name ?? "the screen"}.`,
                  )
                }
                onReject={(reason) =>
                  decide(
                    request,
                    () => rejectRequest(request.id, reason),
                    `“${request.name}” was declined.`,
                  )
                }
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the history page**

Create `markai-frontend-new/app/console/approvals/history/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/auth";
import { listApprovals, type ApprovalRequest } from "@/lib/console";
import ErrorCard from "@/components/dashboard/ErrorCard";

const TABS = [
  ["approved", "Approved"],
  ["rejected", "Declined"],
] as const;

function decidedLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  })}, ${d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  })}`;
}

export default function ApprovalHistoryPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("approved");
  const [rows, setRows] = useState<ApprovalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setRows(null);
    listApprovals(tab)
      .then((d) => setRows(d.requests))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Something went wrong."),
      );
  }, [tab]);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="m-0 font-display text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.1] text-foreground">
          History
        </h1>
        <p className="mb-0 mt-2.5 max-w-[520px] text-[15px] leading-relaxed text-muted">
          Every request you and your fellow approvers have decided.
        </p>
      </div>

      <div className="flex gap-2">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              tab === value
                ? "bg-panel-strong text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <ErrorCard message={error} onRetry={load} />}

      {rows === null && !error ? (
        <div className="h-64 animate-pulse rounded-[22px] border border-edge bg-panel backdrop-blur-md" />
      ) : rows && rows.length === 0 ? (
        <div className="rounded-[22px] border border-edge bg-panel px-6 py-14 text-center backdrop-blur-md">
          <p className="m-0 text-sm text-muted">
            Nothing {tab === "approved" ? "approved" : "declined"} yet.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[22px] border border-edge bg-panel backdrop-blur-md">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
                <th className="px-5 py-3.5">Campaign</th>
                <th className="px-5 py-3.5">Screen</th>
                <th className="px-5 py-3.5">Advertiser</th>
                <th className="px-5 py-3.5">Decided by</th>
                <th className="px-5 py-3.5">When</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="align-top text-sm">
                  <td className="border-t border-edge px-5 py-4">
                    <div className="font-semibold text-foreground">{r.name}</div>
                    {r.reject_reason && (
                      <div className="mt-1 max-w-[280px] text-xs leading-relaxed text-muted">
                        {r.reject_reason}
                      </div>
                    )}
                  </td>
                  <td className="border-t border-edge px-5 py-4 text-muted">
                    {r.screen_name ?? r.screen_id}
                  </td>
                  <td className="border-t border-edge px-5 py-4 text-muted">
                    {r.advertiser_name ?? r.advertiser_email ?? "—"}
                  </td>
                  <td className="border-t border-edge px-5 py-4 text-muted">
                    {r.decided_by_email ?? "—"}
                  </td>
                  <td className="border-t border-edge px-5 py-4 text-muted">
                    {decidedLabel(r.decided_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `cd markai-frontend-new && npx tsc --noEmit`
Expected: no errors from these files.

- [ ] **Step 6: Commit**

```bash
cd markai-frontend-new
git add components/console app/console/approvals
git commit -m "feat(console): approvals queue and decision history"
```

---

### Task 12: Overview, screens, and the advertiser's pending state

**Files:**
- Create: `markai-frontend-new/app/console/page.tsx`, `markai-frontend-new/app/console/screens/page.tsx`
- Modify: `markai-frontend-new/components/layout/Navbar.tsx`, `markai-frontend-new/components/dashboard/StatusBadge.tsx`, `markai-frontend-new/app/dashboard/campaigns/page.tsx`, `markai-frontend-new/lib/platform.ts`, `markai-frontend-new/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `consoleOverview`, `consoleScreens` (Task 10); `initials`, `displayName`, `isOperator` (Task 8).
- Produces: `Booking["status"]` gains `"pending_approval" | "rejected"`; `Booking` gains `approval_status` and `reject_reason`.

- [ ] **Step 1: Teach the platform types about the new states**

In `markai-frontend-new/lib/platform.ts`, replace the `Booking` interface's `cms_booking_id` and `status` lines (77 and 91) with:

```ts
  cms_booking_id: string | null;
```

```ts
  status:
    | "pending_approval"
    | "rejected"
    | "active"
    | "paused"
    | "cancelled"
    | "completed";
  approval_status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
```

- [ ] **Step 2: Render the new states**

In `markai-frontend-new/components/dashboard/StatusBadge.tsx`, add two entries to `STYLES`:

```tsx
  pending_approval: {
    label: "Awaiting approval",
    box: "border-[color-mix(in_srgb,var(--blue)_45%,transparent)] bg-[color-mix(in_srgb,var(--blue)_12%,transparent)] text-foreground",
    dot: "bg-accent-blue",
    pulse: true,
  },
  rejected: {
    label: "Declined",
    box: "border-[color-mix(in_srgb,var(--red)_45%,transparent)] bg-[color-mix(in_srgb,var(--red)_12%,transparent)] text-foreground",
    dot: "bg-accent-red",
    pulse: false,
  },
```

In `markai-frontend-new/app/dashboard/campaigns/page.tsx`, add two entries to `FILTERS` after `["all", "All statuses"]`:

```tsx
  ["pending_approval", "Awaiting approval"],
  ["rejected", "Declined"],
```

- [ ] **Step 3: Make the navbar handle a null name**

In `markai-frontend-new/components/layout/Navbar.tsx`, change the `Avatar` component's initials line (312) to use the shared helper. Update the import (line 20):

```tsx
import { displayName, getToken, initials, useAuth, type AuthUser } from "@/lib/auth";
```

and replace line 312 with:

```tsx
  const chars = initials(user);
```

then replace the `{initials}` usage at line 332 with `{chars}`. Replace the two places that render `{user.first_name} {user.last_name}` (lines 253 and 428) with `{displayName(user)}`. The `{user.email}` lines beneath them (255, 430) need no change — `email` is now always present on `AuthUser`.

- [ ] **Step 4: Fix the advertiser dashboard greeting**

In `markai-frontend-new/app/dashboard/page.tsx`, update the import to include `displayName`, and replace the heading (line 185):

```tsx
                  Hey <span className="grad-text">{user.first_name ?? displayName(user)}</span>
```

- [ ] **Step 5: Create the console overview**

Create `markai-frontend-new/app/console/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ApiError, displayName, useAuth } from "@/lib/auth";
import { consoleOverview, type ConsoleOverview } from "@/lib/console";
import ErrorCard from "@/components/dashboard/ErrorCard";
import StatTile from "@/components/dashboard/StatTile";

export default function ConsoleOverviewPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ConsoleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    consoleOverview()
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Something went wrong."),
      );
  }, []);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="m-0 font-display text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.1] text-foreground">
            {user ? `Hello, ${displayName(user)}` : "Console"}
          </h1>
          <p className="mb-0 mt-2.5 max-w-[480px] text-[15px] leading-relaxed text-muted">
            {user?.role === "superadmin"
              ? "Every screen on the network, and every request waiting on a decision."
              : "Your screens, and the campaigns advertisers want to run on them."}
          </p>
        </div>
        <Link
          href="/console/approvals"
          className="inline-flex flex-none items-center justify-center gap-2 rounded-xl bg-cta-gradient px-5 py-2.5 text-sm font-bold text-on-accent shadow-cta-glow transition-transform hover:-translate-y-0.5"
        >
          Review approvals
          <ArrowRight size={15} aria-hidden />
        </Link>
      </div>

      {error ? (
        <ErrorCard message={error} onRetry={load} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/console/approvals" className="block">
            <StatTile
              label="Waiting on you"
              live={!!data?.pending}
              value={data ? data.pending : "—"}
              sub={
                data && data.pending === 0
                  ? "nothing to decide"
                  : "campaigns awaiting a decision"
              }
            />
          </Link>
          <StatTile
            label="Screens online"
            value={data ? `${data.screens_online}/${data.screens_total}` : "—"}
            sub="reporting in right now"
          />
          <StatTile
            label="Decided this week"
            value={data ? data.decided_this_week : "—"}
            sub="approved or declined"
          />
          <StatTile
            label="Screens you manage"
            value={data ? data.screens_total : "—"}
            sub={user?.role === "superadmin" ? "the whole network" : "assigned to you"}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create the console screens page**

Create `markai-frontend-new/app/console/screens/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { MonitorPlay } from "lucide-react";
import { ApiError } from "@/lib/auth";
import { consoleScreens } from "@/lib/console";
import { operatingHoursLabel, statusLabel, type Screen } from "@/lib/platform";
import ErrorCard from "@/components/dashboard/ErrorCard";

const DOT: Record<Screen["status"], string> = {
  online: "bg-accent-green",
  off_hours: "bg-accent-amber",
  display_off: "bg-faint",
  offline: "bg-accent-red",
};

export default function ConsoleScreensPage() {
  const [screens, setScreens] = useState<Screen[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    consoleScreens()
      .then(setScreens)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Something went wrong."),
      );
  }, []);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="m-0 font-display text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.1] text-foreground">
          Screens
        </h1>
        <p className="mb-0 mt-2.5 max-w-[520px] text-[15px] leading-relaxed text-muted">
          The screens you approve campaigns for, and how they are running right now.
        </p>
      </div>

      {error && <ErrorCard message={error} onRetry={load} />}

      {screens === null && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-[22px] border border-edge bg-panel backdrop-blur-md"
            />
          ))}
        </div>
      ) : screens && screens.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[22px] border border-edge bg-panel px-6 py-14 text-center backdrop-blur-md">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cta-gradient text-on-accent">
            <MonitorPlay size={24} aria-hidden />
          </span>
          <h2 className="m-0 font-display text-2xl font-bold text-foreground">
            No screens yet
          </h2>
          <p className="m-0 max-w-[400px] text-sm leading-relaxed text-muted">
            Screens appear here once they are enrolled with your enrollment key.
            Your administrator can share it with you.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(screens ?? []).map((s) => (
            <div
              key={s.id}
              className="rounded-[22px] border border-edge bg-panel p-5 backdrop-blur-md"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="m-0 min-w-0 truncate font-display text-lg font-bold text-foreground">
                  {s.name}
                </h3>
                <span className="inline-flex flex-none items-center gap-2 rounded-full border border-edge px-2.5 py-1 text-[11px] font-semibold text-muted">
                  <span className={`h-2 w-2 rounded-full ${DOT[s.status]}`} aria-hidden />
                  {statusLabel(s.status)}
                </span>
              </div>
              <p className="mb-0 mt-2 truncate text-sm text-muted">
                {s.city ?? s.location ?? "Location not set"}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-edge pt-4 text-sm">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
                    Open
                  </dt>
                  <dd className="mt-1 font-semibold text-foreground">
                    {operatingHoursLabel(s)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
                    Loop
                  </dt>
                  <dd className="mt-1 font-semibold text-foreground">
                    {s.slot_duration_seconds}s × {s.total_slots}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Keep operators out of the advertiser pages**

In `markai-frontend-new/app/dashboard/page.tsx`, `app/dashboard/campaigns/page.tsx`, `app/dashboard/content/page.tsx` and `app/screens/[id]/book/page.tsx`, extend the existing auth redirect effect to bounce operators. Import `isOperator` from `@/lib/auth` and change the effect to:

```tsx
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/auth");
    else if (isOperator(user)) router.replace("/console");
  }, [loading, user, router]);
```

- [ ] **Step 8: Verify all three gates**

Run: `cd markai-frontend-new && npx tsc --noEmit && npm run build`
Expected: all clean — zero type errors, zero lint errors, build succeeds.

- [ ] **Step 9: Commit**

```bash
cd markai-frontend-new
git add app components lib
git commit -m "feat(console): overview and screens, advertiser pending-approval states"
```

---

### Task 13: End-to-end verification and pull requests

**Files:** none — this task runs the system and opens the PRs.

- [ ] **Step 1: Start the whole stack**

```bash
cd markai-signage-api && ./dev_start.sh          # Postgres :5433, API :8095
cd ../markai-backend-new && ./dev_start.sh       # Postgres :5434, API :8096
cd ../markai-backend-new && poetry run alembic upgrade head
cd ../markai-Web-cms && npm run dev              # CMS :5120
cd ../markai-frontend-new && npm run dev         # platform :3100
```

- [ ] **Step 2: Create the operator in the CMS**

In the CMS at http://localhost:5120/login, sign in as `admin@mark-ai.tech` / `Admin@123` (the seeded superadmin — note this replaces the old `superadmin` username login). Under **Users**, create a screenowner `bs@cafe.com` with password `Owner@123`, assigned to one screen (register a screen first if the fleet is empty). Note the screen's name.

- [ ] **Step 3: Raise a request as an advertiser**

At http://localhost:3100/auth, sign in with an advertiser email — checkbox left **unticked** — then upload a creative and book the screen you assigned to `bs@cafe.com`.

Confirm the campaign shows **Awaiting approval** at http://localhost:3100/dashboard/campaigns.

Confirm the CMS bookings page shows **nothing new** — this is the core guarantee.

- [ ] **Step 4: Approve as the screen owner**

Sign out. At http://localhost:3100/auth **tick "I'm a screen owner or administrator"**, then enter `bs@cafe.com` / `Owner@123`. Confirm the Google button disappears when the box is ticked, that you land on `/console`, that the Approvals badge shows 1, and that the request card shows the real creative, the advertiser's name and the schedule.

Approve it. Confirm:
- the campaign now appears in the CMS bookings list,
- the advertiser's dashboard shows it as **Active**,
- the screen reloads within one heartbeat (≤60s).

- [ ] **Step 5: Verify a rejection leaves the CMS clean**

Raise a second request, decline it as `bs@cafe.com` with a reason, and confirm the CMS shows no new booking and the advertiser sees **Declined** with the reason.

- [ ] **Step 6: Verify the superadmin's unfiltered queue**

Sign in at :3100 with the box ticked as `admin@mark-ai.tech` / `Admin@123`. Confirm the queue shows requests for screens `bs@cafe.com` does not own — including any screen with no owner at all.

- [ ] **Step 7: Confirm the role separation and the shared-email case**

While signed in as `bs@cafe.com`, navigate to http://localhost:3100/screens and http://localhost:3100/dashboard. Confirm both redirect to `/console`.

Then sign up an **advertiser** account using the same address `bs@cafe.com` with a different password. Confirm that with the box unticked it signs in as the advertiser, and with the box ticked as the screen owner — one email, two accounts, the checkbox choosing between them. This is the case that motivated the checkbox, so it must be exercised.

- [ ] **Step 8: Run every gate one final time**

```bash
cd markai-signage-api  && poetry run pytest -q && poetry run ruff check app/api_keys app/cms_users
cd ../markai-backend-new && poetry run pytest -q
cd ../markai-frontend-new && npx tsc --noEmit && npm run build
```

Expected: all green. Do not proceed past a failure — report it instead.

- [ ] **Step 9: Push and open the pull requests**

Push each repo and open a PR to `main` describing the whole change. Do **not** add a Claude co-author trailer to any commit.

```bash
cd markai-signage-api  && git push -u origin feature/booking-approval
cd ../markai-Web-cms    && git push -u origin feature/booking-approval
cd ../markai-backend-new && git push -u origin feature/booking-approval
cd ../markai-frontend-new && git push -u origin feature/booking-approval
```

Open one PR per repo with `gh pr create --base main`. Each description must state: what the gate does, that the CMS is never called until approval, that CMS-originated bookings are unaffected, and that the change targets newly created operators only (production data is wiped before launch). Call out prominently that **the CMS sign-in credential changes from the `superadmin` username to `admin@mark-ai.tech`**, since that is the one change a reader must not discover by being locked out.

Cross-link the four PRs and state the merge order, which is not optional: `markai-signage-api` first (it owns the `username` → `email` migration and the two new ext endpoints), then `markai-Web-cms` (its login breaks until that migration lands), then `markai-backend-new`, then `markai-frontend-new`.

---

## Self-Review

**Spec coverage.** Every numbered decision in the spec maps to a task: approvals-on-platform-only (Tasks 10-12), either approver (Task 7 `_scoped`/`may_decide`), unfiltered superadmin queue including ownerless screens (Task 7, tested), CMS bookings stay instant (nothing in Phase A or 0 touches `/api/cms/bookings`), no expiry (no sweep job anywhere), no notifications (badge only, Task 10), approvals-only console (Task 4's `get_current_user` rejection + Task 12 Step 7), new users only (no backfill; migration 0004 marks pre-existing rows `approved` and migration 0032 is a bare rename), operators identified by email (Tasks A and B), and the checkbox choosing the auth system (Tasks 5 and 9). Both ext endpoints, both migrations, the operating-hours move, the row-lock ordering, and all four console pages have tasks.

**Known gap accepted:** the frontend has no automated test coverage because the repo has no test framework and adding one is out of scope; Task 13's manual walkthrough is the substitute, and it exercises every path the tests would.

**Type consistency.** `cms_users.email` (Task A) is the identifier in Task B's forms, Task 1's `ExtVerifyRequest`, and Task 5's `login_operator`. `ExtOperator{id, email, role, screen_ids, is_active}` (Task 1) is consumed unchanged by Task 2 and mapped in Task 4's `verify_operator`/`get_operator_scope`. `Operator{id, email, role}` is used identically in Tasks 4, 5 and 7, and `decided_by_email` is the column name in Tasks 3, 7 and 11. `approval_status` values `pending`/`approved`/`rejected` are the same strings in the model (Task 3), the service (Task 7), the router's regex (Task 7), and the frontend types (Tasks 10, 12). `to_out`'s derived `status` values `pending_approval`/`rejected` (Task 3) match the `Booking["status"]` union and the `StatusBadge` keys (Task 12). `displayName`/`initials`/`isOperator` are defined once in Task 8 and consumed in Tasks 9, 10 and 12.
