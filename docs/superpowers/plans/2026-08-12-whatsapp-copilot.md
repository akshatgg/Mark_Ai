# WhatsApp → CMS Co-Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a CMS operator talk to the existing AI co-pilot over WhatsApp — link their number from the CMS, message the business number, and get the same agent (same tools, same role scoping, same booking draft) replying with tappable Confirm buttons.

**Architecture:** A transport adapter in `app/whatsapp/`. Meta's webhook writes a durable row into `whatsapp_messages` (whose `UNIQUE(wamid)` doubles as the retry-dedup guard *and* the work queue), returns 200 immediately, and an in-process worker pool — copied from `app/creative_fit/worker.py`'s Postgres-as-queue pattern — claims the row, resolves the phone to a `CmsUser`, and `await`s the **unchanged** `app/ai/agent.run_turn`. The finished turn is rendered into WhatsApp markup and pushed back. No new agent, no second copy of the permission model.

**Tech Stack:** Python 3.12, FastAPI, async SQLAlchemy 2.0 + asyncpg, Alembic, pydantic-settings, `httpx`, stdlib `hmac`/`hashlib`/`secrets`. Frontend: Next.js (`markai-Web-cms`).

**Design spec:** `docs/superpowers/specs/2026-08-12-whatsapp-copilot-design.md`

---

## Global Constraints

These apply to **every** task. Do not restate them per task; do not violate them.

- **Working directory:** `/Users/akshat/projects/MarkAi/markai-signage-api` unless a task says otherwise.
- **The user runs pytest, agents do not.** Each task lists its `pytest` command for the user. An agent's own verification gate is `poetry run ruff check app/ tests/` plus an import check (`poetry run python -c "import app.main"`). Write the tests; hand the command over; do not run the suite.
- **`ruff` is the lint gate.** This repo is *not* black-clean — do not reformat files you are not otherwise changing.
- **JSONB columns have NO SQLAlchemy mutation tracking anywhere in this codebase.** `row.col["k"] = v` and `row.col.append(x)` write **nothing** — the commit silently succeeds having saved no change. Always reassign the whole object: `row.col = {**row.col, "k": v}`. See `app/gmail/draft_state.py`.
- **CMS-facing routes must live under `/api/cms/*`** or the browser cannot reach them (the CMS BFF proxy forwards only that prefix). The Meta webhook is the deliberate exception — Meta calls it directly.
- **Never commit without being asked.** Steps that say "Commit" are for the user to approve; stage and propose, do not push.
- **No Claude attribution in commit messages.** No `Co-Authored-By` trailer.
- **Secrets are backend-only.** Never `NEXT_PUBLIC_*`.
- **Tests run on aiosqlite, production on Postgres.** Two consequences you must handle every time: `FOR UPDATE SKIP LOCKED` is Postgres-only (provide a SQLite branch, as `creative_fit/worker.py` does), and SQLite returns **naive** datetimes while Postgres returns aware ones (normalise with an `_as_aware` helper, as `app/cms_users/password_reset.py` does).
- **Timezone:** the platform is IST end-to-end (`settings.APP_TIMEZONE`). Store UTC, display IST.
- **Localhost-first.** The user tests on localhost before any Meta credentials exist. Every task must remain exercisable with `WHATSAPP_ACCESS_TOKEN` unset. This is why Task 4 has a dry-run mode and Task 9 has a simulator.

### Naming and copy rules

- Message copy is plain, lowercase-friendly, no marketing tone. Emoji sparingly (✅ ⚠️ 📺 📅).
- WhatsApp markup is `*bold*`, `_italic_`, `~strike~` — **not** markdown, and **no tables**.

---

## File Structure

**New package — `markai-signage-api/app/whatsapp/`**

| File | Responsibility |
|---|---|
| `models.py` | `WhatsAppLink`, `WhatsAppLinkToken`, `WhatsAppMessage` |
| `constants.py` | status/direction/kind enums, button-payload prefixes |
| `render.py` | Pure: markdown → WhatsApp markup, chunking, card → messages |
| `client.py` | Meta Graph calls (send text/buttons/list, fetch media) + dry-run mode |
| `link_service.py` | Mint / bind / revoke the phone↔operator binding |
| `worker.py` | Postgres-as-queue claim loop (adapted from `creative_fit/worker.py`) |
| `inbound.py` | Orchestrates one inbound message → turn → reply |
| `media.py` | Fetch WhatsApp media → GCS → `ai_chat_media` |
| `webhook.py` | HMAC verification + Meta payload parsing (pure where possible) |
| `router.py` | Public webhook router + CMS router + dev simulator |
| `schemas.py` | Pydantic request/response models |

**Modified**

| File | Change |
|---|---|
| `app/ai/confirm_service.py` | **New** — extracted from `app/ai/router.py:392` |
| `app/ai/router.py` | `confirm_action` becomes a thin wrapper |
| `app/core/config.py` | `WHATSAPP_*` block + `whatsapp_configured` property |
| `app/models.py` | Import the three new models for Alembic |
| `app/api/routers/routers.py` | Register the public + CMS routers |
| `app/main.py` | Start/stop the worker pool in `lifespan` |
| `alembic/versions/0042_whatsapp_copilot.py` | **New** migration |
| `markai-Web-cms/src/lib/api.ts` | Link/unlink/status calls |
| `markai-Web-cms/src/components/whatsapp/LinkPanel.tsx` | **New** profile panel |

**Task dependency order.** 1 → 2 → (3, 4 parallel) → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12.
**First end-to-end localhost test is possible at the end of Task 10.**

---

## Task 1: Data model and migration

**Files:**
- Create: `app/whatsapp/__init__.py`, `app/whatsapp/constants.py`, `app/whatsapp/models.py`
- Create: `alembic/versions/0042_whatsapp_copilot.py`
- Modify: `app/models.py`
- Test: `tests/test_whatsapp_models.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `WhatsAppLink`, `WhatsAppLinkToken`, `WhatsAppMessage` ORM classes; the constants `MSG_STATUS_*`, `DIRECTION_IN`, `DIRECTION_OUT`, `KIND_*`, `BTN_CONFIRM_PREFIX`, `LINK_PREFIX`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_whatsapp_models.py`:

```python
import pytest
from sqlalchemy.exc import IntegrityError

from app.whatsapp.models import WhatsAppLink, WhatsAppMessage


@pytest.mark.asyncio
async def test_wamid_is_unique(db_session, cms_user):
    """The wamid UNIQUE constraint IS the dedup guard for Meta's retries."""
    db_session.add(WhatsAppMessage(
        wamid="wamid.ABC", direction="in", phone_e164="+919999999999",
        kind="text", body="hi", status="queued",
    ))
    await db_session.commit()

    db_session.add(WhatsAppMessage(
        wamid="wamid.ABC", direction="in", phone_e164="+919999999999",
        kind="text", body="hi again", status="queued",
    ))
    with pytest.raises(IntegrityError):
        await db_session.commit()


@pytest.mark.asyncio
async def test_one_phone_maps_to_one_operator(db_session, cms_user, second_cms_user):
    """Without this, a handset could resolve to two operators and authority is ambiguous."""
    db_session.add(WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+919999999999"))
    await db_session.commit()

    db_session.add(WhatsAppLink(cms_user_id=second_cms_user.id, phone_e164="+919999999999"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
```

Check `tests/conftest.py` for the existing fixture names. If `second_cms_user` does not exist, add it there mirroring `cms_user`.

- [ ] **Step 2: Run the test to verify it fails**

Command for the user: `poetry run pytest tests/test_whatsapp_models.py -v`
Expected: `ModuleNotFoundError: No module named 'app.whatsapp'`

- [ ] **Step 3: Write `app/whatsapp/constants.py`**

```python
"""Shared constants for the WhatsApp co-pilot transport."""

# Row lifecycle for whatsapp_messages. `ignored` is terminal-but-fine: an
# unlinked number got its one polite line and there is nothing more to do.
MSG_QUEUED = "queued"
MSG_RUNNING = "running"
MSG_DONE = "done"
MSG_FAILED = "failed"
MSG_IGNORED = "ignored"

DIRECTION_IN = "in"
DIRECTION_OUT = "out"

KIND_TEXT = "text"
KIND_IMAGE = "image"
KIND_VIDEO = "video"
KIND_DOCUMENT = "document"
KIND_AUDIO = "audio"
KIND_BUTTON = "button"
KIND_UNSUPPORTED = "unsupported"

MEDIA_KINDS = (KIND_IMAGE, KIND_VIDEO, KIND_DOCUMENT, KIND_AUDIO)

# Interactive reply-button payload prefixes. WhatsApp allows 256 chars in a
# button id, so "cfm:<turn_uuid>:<action_id>" fits comfortably.
BTN_CONFIRM_PREFIX = "cfm:"
BTN_CONFIRM_ALL_PREFIX = "cfmall:"
BTN_CANCEL_PREFIX = "cnl:"
BTN_REVIEW_PREFIX = "rev:"

# The prefilled text of the wa.me deep link. Matched case-insensitively on the
# way in, so an operator who retypes it with different capitalisation still links.
LINK_PREFIX = "link my mark ai account:"
```

- [ ] **Step 4: Write `app/whatsapp/models.py`**

```python
"""WhatsApp co-pilot transport tables.

Three tables, three jobs:

* ``whatsapp_links`` — the phone <-> operator binding. BOTH columns are unique:
  one operator has one number, and one number resolves to one operator. Without
  the second, a single handset could speak as two people and the authority of a
  message would be ambiguous.
* ``whatsapp_link_tokens`` — one-time linking tokens, modelled directly on
  ``CmsPasswordResetToken``: only the sha256 is stored, minting a new one
  strands the old, and validating never consumes.
* ``whatsapp_messages`` — dedup guard, work queue and audit log in one table.
  ``wamid`` is UNIQUE because Meta retries a failed delivery for up to 7 days;
  the INSERT is what makes a retry a no-op. The same row is then claimed by the
  worker pool, so we never needed a separate queue.

⚠️ ``media_ref`` is JSONB and this codebase has NO SQLAlchemy mutation tracking.
Assign the whole object (``row.media_ref = {**row.media_ref, ...}``); an in-place
mutation writes nothing and the commit silently succeeds.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db_base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class WhatsAppLink(Base):
    """One operator's linked handset."""

    __tablename__ = "whatsapp_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    cms_user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("cms_users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    phone_e164: Mapped[str] = mapped_column(
        String(20), unique=True, index=True, nullable=False
    )
    # What WhatsApp reports as the sender's display name. Cosmetic only — never
    # used for identity, which comes from the verified number alone.
    wa_profile_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # The ai_chat_session this number is currently talking in. Rolled to a fresh
    # session after WHATSAPP_SESSION_IDLE_HOURS so yesterday's half-finished
    # booking draft cannot leak into tomorrow's conversation.
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )


class WhatsAppLinkToken(Base):
    """A single-use token that binds a handset to an operator.

    Mirrors ``CmsPasswordResetToken``. The raw token exists in exactly one place
    — the wa.me deep link — so a database dump yields nothing spendable.
    """

    __tablename__ = "whatsapp_link_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    cms_user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("cms_users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WhatsAppMessage(Base):
    """One inbound or outbound WhatsApp message. Dedup guard + queue + audit."""

    __tablename__ = "whatsapp_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # Meta's own message id. UNIQUE, and that uniqueness IS the retry guard.
    wamid: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    phone_e164: Mapped[str] = mapped_column(String(20), index=True, nullable=False)

    # Null until the phone is resolved to a link (and stays null for messages
    # from unlinked numbers). SET NULL rather than CASCADE so unlinking keeps
    # the audit trail that explains what happened.
    cms_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("cms_users.id", ondelete="SET NULL"), nullable=True
    )
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    turn_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_ref: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="queued", server_default="queued"
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Meta's timestamp for the message, not ours — used for the staleness bound.
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_whatsapp_messages_claim", "status", "received_at"),
    )
```

- [ ] **Step 5: Register the models for Alembic**

In `app/models.py`, add alongside the existing imports (match the file's existing style):

```python
from app.whatsapp.models import (  # noqa: F401
    WhatsAppLink,
    WhatsAppLinkToken,
    WhatsAppMessage,
)
```

- [ ] **Step 6: Write the migration**

Create `alembic/versions/0042_whatsapp_copilot.py`. Open `alembic/versions/0041_gmail_booking_drafts.py` first and copy its header/formatting conventions exactly.

```python
"""whatsapp co-pilot transport tables

Revision ID: 0042_whatsapp_copilot
Revises: 0041_gmail_booking_drafts
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0042_whatsapp_copilot"
down_revision = "0041_gmail_booking_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_links",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("cms_user_id", sa.String(36), nullable=False),
        sa.Column("phone_e164", sa.String(20), nullable=False),
        sa.Column("wa_profile_name", sa.String(128), nullable=True),
        sa.Column("session_id", sa.String(36), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["cms_user_id"], ["cms_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cms_user_id", name="uq_whatsapp_links_user"),
        sa.UniqueConstraint("phone_e164", name="uq_whatsapp_links_phone"),
    )
    op.create_index("ix_whatsapp_links_cms_user_id", "whatsapp_links", ["cms_user_id"])
    op.create_index("ix_whatsapp_links_phone_e164", "whatsapp_links", ["phone_e164"])

    op.create_table(
        "whatsapp_link_tokens",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("cms_user_id", sa.String(36), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["cms_user_id"], ["cms_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_whatsapp_link_tokens_cms_user_id",
                    "whatsapp_link_tokens", ["cms_user_id"])
    op.create_index("ix_whatsapp_link_tokens_token_hash",
                    "whatsapp_link_tokens", ["token_hash"])

    op.create_table(
        "whatsapp_messages",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("wamid", sa.String(128), nullable=False),
        sa.Column("direction", sa.String(8), nullable=False),
        sa.Column("phone_e164", sa.String(20), nullable=False),
        sa.Column("cms_user_id", sa.String(36), nullable=True),
        sa.Column("session_id", sa.String(36), nullable=True),
        sa.Column("turn_id", sa.String(36), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("body", sa.Text, nullable=True),
        sa.Column("media_ref", postgresql.JSONB, nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["cms_user_id"], ["cms_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("wamid", name="uq_whatsapp_messages_wamid"),
    )
    op.create_index("ix_whatsapp_messages_claim", "whatsapp_messages",
                    ["status", "received_at"])
    op.create_index("ix_whatsapp_messages_phone_e164", "whatsapp_messages", ["phone_e164"])


def downgrade() -> None:
    op.drop_table("whatsapp_messages")
    op.drop_table("whatsapp_link_tokens")
    op.drop_table("whatsapp_links")
```

- [ ] **Step 7: Verify the migration round-trips**

```bash
poetry run alembic upgrade head
poetry run alembic downgrade -1
poetry run alembic upgrade head
```
Expected: all three succeed with no error. A failure on `downgrade` usually means an index was created outside the table definition and must be dropped explicitly.

- [ ] **Step 8: Agent verification gate**

```bash
poetry run ruff check app/whatsapp/ app/models.py alembic/versions/0042_whatsapp_copilot.py
poetry run python -c "import app.main; print('ok')"
```
Expected: `All checks passed` and `ok`.

- [ ] **Step 9: Hand the test command to the user**

`poetry run pytest tests/test_whatsapp_models.py -v` — expected: 2 passed.

- [ ] **Step 10: Stage and propose a commit**

```bash
git add app/whatsapp/ app/models.py alembic/versions/0042_whatsapp_copilot.py tests/test_whatsapp_models.py
git commit -m "feat(whatsapp): transport tables — link, link token, message queue"
```

---

## Task 2: Configuration

**Files:**
- Modify: `app/core/config.py`
- Modify: `.env.example`
- Test: `tests/test_whatsapp_config.py`

**Interfaces:**
- Consumes: Task 1's constants (none directly).
- Produces: `settings.WHATSAPP_*` (12 settings) and `settings.whatsapp_configured -> bool`. Everything downstream branches on `whatsapp_configured` to choose live vs dry-run.

- [ ] **Step 1: Write the failing test**

Create `tests/test_whatsapp_config.py`:

```python
from app.core.config import Settings


def test_unconfigured_is_dry_run():
    """With no credentials the feature must degrade to dry-run, never crash."""
    s = Settings(WHATSAPP_ACCESS_TOKEN=None, WHATSAPP_PHONE_NUMBER_ID=None,
                 WHATSAPP_APP_SECRET=None)
    assert s.whatsapp_configured is False


def test_all_three_credentials_make_it_live():
    s = Settings(WHATSAPP_ACCESS_TOKEN="tok", WHATSAPP_PHONE_NUMBER_ID="123",
                 WHATSAPP_APP_SECRET="sec")
    assert s.whatsapp_configured is True


def test_partial_credentials_are_not_live():
    """A half-configured deployment must not try to call Meta."""
    s = Settings(WHATSAPP_ACCESS_TOKEN="tok", WHATSAPP_PHONE_NUMBER_ID=None,
                 WHATSAPP_APP_SECRET="sec")
    assert s.whatsapp_configured is False


def test_defaults():
    s = Settings()
    assert s.WHATSAPP_ENABLED is True
    assert s.WHATSAPP_WORKERS == 2
    assert s.WHATSAPP_SESSION_IDLE_HOURS == 12
    assert s.WHATSAPP_LINK_TOKEN_TTL_MINUTES == 15
    assert s.WHATSAPP_MAX_MESSAGE_AGE_MINUTES == 360
    assert s.WHATSAPP_MAX_ATTEMPTS == 3
```

- [ ] **Step 2: Run to verify it fails**

User command: `poetry run pytest tests/test_whatsapp_config.py -v`
Expected: FAIL — `Settings` has no attribute `whatsapp_configured`.

- [ ] **Step 3: Add the settings block**

In `app/core/config.py`, place this immediately after the existing `GMAIL_*` block (keep the file's comment style — every non-obvious setting gets a *why*):

```python
    # --- WhatsApp co-pilot -------------------------------------------------
    # A second door onto the AI co-pilot: an operator links their handset and
    # talks to the same agent they use in the CMS. Unconfigured, the webhook
    # 503s and the client runs dry (logs instead of sending), so the whole
    # pipeline is exercisable on localhost with no Meta account at all.
    WHATSAPP_ENABLED: bool = True
    WHATSAPP_PHONE_NUMBER_ID: Optional[str] = None
    # E.164 without the '+', e.g. "919876543210" — this is what goes in the
    # wa.me deep link the operator taps to link their number.
    WHATSAPP_BUSINESS_NUMBER: Optional[str] = None
    # MUST be a Business Manager *System User* token. The token the Meta
    # dashboard offers on setup expires after 24 hours, which makes the whole
    # integration die overnight looking like an unrelated auth bug.
    WHATSAPP_ACCESS_TOKEN: Optional[str] = None
    # App Secret — the HMAC key for X-Hub-Signature-256. The webhook is a public
    # unauthenticated endpoint; this signature is the only thing proving Meta
    # sent the payload.
    WHATSAPP_APP_SECRET: Optional[str] = None
    # Shared secret echoed during Meta's one-time GET verification handshake.
    WHATSAPP_VERIFY_TOKEN: Optional[str] = None
    WHATSAPP_API_VERSION: str = "v21.0"

    # Worker pool size on THIS instance. 0 disables it here (the row stays
    # queued for another instance), mirroring CREATIVE_FIT_WORKERS.
    WHATSAPP_WORKERS: int = 2
    # Idle gap after which the next message starts a fresh ai_chat_session, so
    # yesterday's half-finished booking draft cannot leak into tomorrow.
    WHATSAPP_SESSION_IDLE_HOURS: int = 12
    WHATSAPP_LINK_TOKEN_TTL_MINUTES: int = 15
    # Staleness bound. Answering a six-hour-old "book it" is worse than not
    # answering, and Meta's 24h service window would reject the send anyway.
    WHATSAPP_MAX_MESSAGE_AGE_MINUTES: int = 360
    WHATSAPP_MAX_ATTEMPTS: int = 3
    # A claimed row whose worker died is reclaimed after this many minutes.
    WHATSAPP_CLAIM_TIMEOUT_MINUTES: int = 10
```

- [ ] **Step 4: Add the property**

Beside the existing `ai_enabled` / `cloudinary_configured` properties:

```python
    @property
    def whatsapp_configured(self) -> bool:
        """True only when we can BOTH verify inbound and send outbound.

        Partial configuration is treated as unconfigured on purpose: a
        deployment holding a token but no app secret would happily send replies
        to payloads it could not prove came from Meta.
        """
        return bool(
            self.WHATSAPP_PHONE_NUMBER_ID
            and self.WHATSAPP_ACCESS_TOKEN
            and self.WHATSAPP_APP_SECRET
        )
```

- [ ] **Step 5: Document in `.env.example`**

```bash
# --- WhatsApp co-pilot (all optional; unset = dry-run, safe for localhost) ---
WHATSAPP_ENABLED=true
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_NUMBER=
# MUST be a Business Manager System User token — the dashboard one expires in 24h
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_WORKERS=2
```

- [ ] **Step 6: Agent verification gate**

```bash
poetry run ruff check app/core/config.py
poetry run python -c "from app.core.config import settings; print(settings.whatsapp_configured)"
```
Expected: `All checks passed`, then `False`.

- [ ] **Step 7: Hand over the test command**

`poetry run pytest tests/test_whatsapp_config.py -v` — expected: 4 passed.

- [ ] **Step 8: Stage and propose a commit**

```bash
git add app/core/config.py .env.example tests/test_whatsapp_config.py
git commit -m "feat(whatsapp): configuration block with dry-run default"
```

---

## Task 3: The renderer (pure functions)

This is the largest pure-logic surface and the easiest to get subtly wrong. It has no dependencies, so build it early and test it hard.

**Files:**
- Create: `app/whatsapp/render.py`
- Test: `tests/test_whatsapp_render.py`

**Interfaces:**
- Consumes: Task 1's `constants` (button prefixes).
- Produces:
  - `to_whatsapp_markup(text: str) -> str`
  - `chunk(text: str, limit: int = 4096) -> list[str]`
  - `card_to_messages(card: dict | None, turn_id: str) -> list[dict]`
  - `render_turn(final_response: str | None, card: dict | None, turn_id: str) -> list[dict]`
  - An outbound message dict is `{"kind": "text"|"buttons"|"list", "body": str, ...}` — Task 4's client consumes exactly this shape.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_whatsapp_render.py`:

```python
from app.whatsapp.render import (
    card_to_messages,
    chunk,
    render_turn,
    to_whatsapp_markup,
)


class TestMarkup:
    def test_bold_becomes_single_asterisk(self):
        assert to_whatsapp_markup("**hi**") == "*hi*"

    def test_underscore_italic_survives(self):
        assert to_whatsapp_markup("_hi_") == "_hi_"

    def test_heading_becomes_bold(self):
        assert to_whatsapp_markup("## Screens") == "*Screens*"

    def test_bullets_become_dots(self):
        assert to_whatsapp_markup("- one\n- two") == "• one\n• two"

    def test_table_becomes_row_blocks(self):
        """WhatsApp has no tables. A table must degrade to readable lines,
        never be emitted raw with pipes."""
        table = (
            "| Screen | Plays |\n"
            "| --- | --- |\n"
            "| Cafe MG Road | 412 |\n"
            "| Airport | 98 |\n"
        )
        out = to_whatsapp_markup(table)
        assert "|" not in out
        assert "*Screen*: Cafe MG Road" in out
        assert "*Plays*: 412" in out

    def test_idempotent(self):
        once = to_whatsapp_markup("**hi** and - a")
        assert to_whatsapp_markup(once) == once


class TestChunk:
    def test_short_text_is_one_chunk(self):
        assert chunk("hello") == ["hello"]

    def test_respects_limit(self):
        parts = chunk("word " * 2000, limit=4096)
        assert all(len(p) <= 4096 for p in parts)

    def test_never_splits_mid_word(self):
        parts = chunk("alpha bravo charlie delta", limit=12)
        for p in parts:
            assert not p.startswith(" ")
            assert "alph a" not in p

    def test_multipart_is_numbered(self):
        parts = chunk("x " * 5000, limit=4096)
        assert len(parts) > 1
        assert parts[0].startswith("(1/")


class TestCards:
    def _action(self, i):
        return {"id": f"a{i}", "tool": "create_booking",
                "summary": f"Book on screen {i}", "executed": False}

    def test_single_action_gets_three_buttons(self):
        card = {"type": "action", "actions": [self._action(1)]}
        msgs = card_to_messages(card, turn_id="t1")
        btns = msgs[-1]["buttons"]
        assert len(btns) == 3
        assert btns[0]["id"] == "cfm:t1:a1"

    def test_button_titles_are_truncated_to_twenty(self):
        card = {"type": "action", "actions": [
            {"id": "a1", "tool": "create_booking",
             "summary": "Book an extremely long campaign name here", "executed": False}]}
        msgs = card_to_messages(card, turn_id="t1")
        for b in msgs[-1]["buttons"]:
            assert len(b["title"]) <= 20

    def test_many_actions_collapse_to_confirm_all(self):
        """WhatsApp caps reply buttons at 3, so 7 proposals cannot each get one."""
        card = {"type": "action", "actions": [self._action(i) for i in range(7)]}
        msgs = card_to_messages(card, turn_id="t1")
        btns = msgs[-1]["buttons"]
        assert len(btns) <= 3
        assert any(b["id"].startswith("cfmall:") for b in btns)
        assert "7" in msgs[-1]["body"]

    def test_executed_actions_get_no_button(self):
        card = {"type": "action", "actions": [
            {"id": "a1", "tool": "create_booking", "summary": "x", "executed": True}]}
        msgs = card_to_messages(card, turn_id="t1")
        assert all(m.get("kind") != "buttons" for m in msgs)

    def test_screen_grid_becomes_a_list(self):
        card = {"type": "screen_grid", "title": "3 screens near Indiranagar",
                "screens": [{"id": "s1", "name": "Cafe MG Road", "location": "MG Road"},
                            {"id": "s2", "name": "Airport", "location": "T2"}]}
        msgs = card_to_messages(card, turn_id="t1")
        body = " ".join(m["body"] for m in msgs)
        assert "Cafe MG Road" in body
        assert "|" not in body


class TestRenderTurn:
    def test_text_only(self):
        msgs = render_turn("hello **there**", None, "t1")
        assert msgs[0]["body"] == "hello *there*"

    def test_empty_response_still_says_something(self):
        """Silence is the worst failure mode on WhatsApp — the operator cannot
        tell 'thinking' from 'broken'."""
        msgs = render_turn(None, None, "t1")
        assert len(msgs) == 1
        assert msgs[0]["body"]
```

- [ ] **Step 2: Run to verify it fails**

User command: `poetry run pytest tests/test_whatsapp_render.py -v`
Expected: `ModuleNotFoundError: No module named 'app.whatsapp.render'`

- [ ] **Step 3: Implement `app/whatsapp/render.py`**

```python
"""Turn a finished co-pilot turn into WhatsApp messages.

WhatsApp is not a browser and it is not markdown. It has *bold*, _italic_,
~strike~ and monospace, a 4096-character body, at most 3 reply buttons of 20
characters each, and NO TABLES. The co-pilot answers in markdown, so everything
here is a lossy translation — the job is to lose the right things.

Every function in this module is pure. No DB, no network, no settings that
change behaviour. That is deliberate: this is where the fiddly rules live, and
pure functions are the only ones worth testing exhaustively.
"""

from __future__ import annotations

import re

from app.whatsapp.constants import (
    BTN_CANCEL_PREFIX,
    BTN_CONFIRM_ALL_PREFIX,
    BTN_CONFIRM_PREFIX,
    BTN_REVIEW_PREFIX,
)

TEXT_LIMIT = 4096
BUTTON_TITLE_LIMIT = 20
MAX_BUTTONS = 3
MAX_LIST_ROWS = 10

_FENCE = re.compile(r"```.*?```", re.DOTALL)
_BOLD = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.*)$", re.MULTILINE)
_BULLET = re.compile(r"^(\s*)[-*+]\s+", re.MULTILINE)
_TABLE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")
_TABLE_SEP = re.compile(r"^\s*\|[\s:|-]+\|\s*$")


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _tables_to_blocks(text: str) -> str:
    """Rewrite every markdown table as one labelled block per row.

    A pipe table on a phone wraps into unreadable noise. `*Screen*: Cafe MG Road`
    on its own line is the same information a human can actually read.
    """
    out: list[str] = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if _TABLE_ROW.match(line) and i + 1 < len(lines) and _TABLE_SEP.match(lines[i + 1]):
            headers = _cells(line)
            i += 2
            blocks: list[str] = []
            while i < len(lines) and _TABLE_ROW.match(lines[i]):
                values = _cells(lines[i])
                blocks.append(
                    "\n".join(
                        f"*{h}*: {v}"
                        for h, v in zip(headers, values)
                        if v
                    )
                )
                i += 1
            out.append("\n\n".join(blocks))
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def to_whatsapp_markup(text: str) -> str:
    """Markdown -> WhatsApp markup. Idempotent: running it twice is a no-op."""
    if not text:
        return ""

    # Protect code fences from every other rule.
    fences: list[str] = []

    def _stash(m: re.Match) -> str:
        fences.append(m.group(0))
        return f"\x00FENCE{len(fences) - 1}\x00"

    text = _FENCE.sub(_stash, text)

    text = _tables_to_blocks(text)
    # Bold BEFORE bullets: '**x**' would otherwise have its leading '*' eaten
    # by the bullet rule and render as a stray asterisk.
    text = _BOLD.sub(r"*\1*", text)
    text = _HEADING.sub(r"*\1*", text)
    text = _BULLET.sub(r"\1• ", text)
    # Collapse 3+ blank lines; markdown spacing looks cavernous on a phone.
    text = re.sub(r"\n{3,}", "\n\n", text)

    for idx, fence in enumerate(fences):
        text = text.replace(f"\x00FENCE{idx}\x00", fence)
    return text.strip()


def chunk(text: str, limit: int = TEXT_LIMIT) -> list[str]:
    """Split to WhatsApp's body cap on paragraph, then line, then word.

    Multi-part output is numbered because WhatsApp does not guarantee ordering
    between separate sends, and '(2/3)' is the only thing that lets a reader
    reassemble them.
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]

    # Reserve room for the "(n/m) " prefix added at the end.
    budget = limit - 10
    parts: list[str] = []
    current = ""

    def _flush() -> None:
        nonlocal current
        if current.strip():
            parts.append(current.strip())
        current = ""

    for para in text.split("\n\n"):
        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) <= budget:
            current = candidate
            continue
        _flush()
        if len(para) <= budget:
            current = para
            continue
        # Paragraph alone is too long — fall back to words, never mid-word.
        for word in para.split(" "):
            trial = f"{current} {word}" if current else word
            if len(trial) <= budget:
                current = trial
            else:
                _flush()
                current = word
    _flush()

    if len(parts) == 1:
        return parts
    total = len(parts)
    return [f"({i + 1}/{total}) {p}" for i, p in enumerate(parts)]


def _truncate(title: str, limit: int = BUTTON_TITLE_LIMIT) -> str:
    title = (title or "").strip()
    return title if len(title) <= limit else title[: limit - 1] + "…"


def _text_messages(body: str) -> list[dict]:
    return [{"kind": "text", "body": part} for part in chunk(to_whatsapp_markup(body))]


def _pending(card: dict) -> list[dict]:
    actions = card.get("actions") or []
    return [a for a in actions if not a.get("executed") and not a.get("dismissed")]


def card_to_messages(card: dict | None, turn_id: str) -> list[dict]:
    """Render a card as outbound messages.

    Returns dicts the client consumes directly:
      {"kind": "text",    "body": str}
      {"kind": "buttons", "body": str, "buttons": [{"id": str, "title": str}]}
      {"kind": "list",    "body": str, "button": str, "rows": [{"id","title","description"}]}
    """
    if not card:
        return []
    ctype = (card.get("type") or "").lower()

    if ctype == "action":
        pending = _pending(card)
        if not pending:
            return []
        if len(pending) == 1:
            a = pending[0]
            return [{
                "kind": "buttons",
                "body": to_whatsapp_markup(a.get("summary") or "Confirm this action?"),
                "buttons": [
                    {"id": f"{BTN_CONFIRM_PREFIX}{turn_id}:{a['id']}", "title": "Confirm"},
                    {"id": f"{BTN_REVIEW_PREFIX}{turn_id}", "title": "Change"},
                    {"id": f"{BTN_CANCEL_PREFIX}{turn_id}", "title": "Cancel"},
                ],
            }]
        if len(pending) <= MAX_BUTTONS:
            return [{
                "kind": "buttons",
                "body": to_whatsapp_markup(
                    "\n".join(f"• {a.get('summary', 'action')}" for a in pending)
                ),
                "buttons": [
                    {"id": f"{BTN_CONFIRM_PREFIX}{turn_id}:{a['id']}",
                     "title": _truncate(a.get("summary") or "Confirm")}
                    for a in pending
                ],
            }]
        # More proposals than buttons: one aggregate action plus a list to pick from.
        return [{
            "kind": "buttons",
            "body": to_whatsapp_markup(
                f"*{len(pending)} actions ready*\n"
                + "\n".join(f"• {a.get('summary', 'action')}" for a in pending)
            ),
            "buttons": [
                {"id": f"{BTN_CONFIRM_ALL_PREFIX}{turn_id}",
                 "title": _truncate(f"Confirm all {len(pending)}")},
                {"id": f"{BTN_REVIEW_PREFIX}{turn_id}", "title": "Review"},
                {"id": f"{BTN_CANCEL_PREFIX}{turn_id}", "title": "Cancel"},
            ],
        }]

    if ctype == "screen_grid":
        screens = card.get("screens") or []
        title = card.get("title") or f"{len(screens)} screen(s)"
        lines = [f"*{title}*"]
        for i, s in enumerate(screens, start=1):
            loc = s.get("location") or s.get("address") or ""
            lines.append(f"{i}. {s.get('name', 'Screen')}" + (f" — {loc}" if loc else ""))
        msgs = _text_messages("\n".join(lines))
        if 0 < len(screens) <= MAX_LIST_ROWS:
            msgs.append({
                "kind": "list",
                "body": "Tap one to pick it.",
                "button": "Choose screen",
                "rows": [
                    {"id": f"screen:{s['id']}",
                     "title": _truncate(s.get("name", "Screen"), 24),
                     "description": _truncate(s.get("location") or "", 72)}
                    for s in screens
                ],
            })
        return msgs

    return []


def render_turn(final_response: str | None, card: dict | None, turn_id: str) -> list[dict]:
    """The whole outbound rendering for one finished turn."""
    msgs = _text_messages(final_response or "")
    msgs.extend(card_to_messages(card, turn_id))
    if not msgs:
        # Never leave the operator staring at nothing. On WhatsApp, silence is
        # indistinguishable from a broken bot.
        msgs = [{"kind": "text",
                 "body": "I didn't have anything to say to that — try rephrasing?"}]
    return msgs
```

- [ ] **Step 4: Agent verification gate**

```bash
poetry run ruff check app/whatsapp/render.py
poetry run python -c "from app.whatsapp.render import render_turn; print(render_turn('**hi**', None, 't1'))"
```
Expected: `All checks passed`, then `[{'kind': 'text', 'body': '*hi*'}]`.

- [ ] **Step 5: Hand over the test command**

`poetry run pytest tests/test_whatsapp_render.py -v` — expected: 17 passed.

- [ ] **Step 6: Stage and propose a commit**

```bash
git add app/whatsapp/render.py tests/test_whatsapp_render.py
git commit -m "feat(whatsapp): markdown-to-WhatsApp renderer with card and chunk handling"
```

---

## Task 4: Meta client with dry-run mode

**Files:**
- Create: `app/whatsapp/client.py`
- Test: `tests/test_whatsapp_client.py`

**Interfaces:**
- Consumes: `settings.whatsapp_configured`, Task 3's message dicts.
- Produces:
  - `async send(db, phone_e164, message: dict, *, cms_user_id=None, session_id=None, turn_id=None) -> str` (returns the wamid, real or `sim:<uuid>`)
  - `async send_all(db, phone_e164, messages: list[dict], **kw) -> list[str]`
  - `async fetch_media(media_id: str) -> tuple[bytes, str, str]` → `(data, mime_type, filename)`
  - `class WhatsAppSendError(Exception)`

- [ ] **Step 1: Write the failing test**

Create `tests/test_whatsapp_client.py`:

```python
import pytest
from sqlalchemy import select

from app.whatsapp import client
from app.whatsapp.models import WhatsAppMessage


@pytest.mark.asyncio
async def test_dry_run_records_but_does_not_call_meta(db_session, monkeypatch):
    """Unconfigured, the client must still record an outbound row so localhost
    testing can read replies back — and must never touch the network."""
    monkeypatch.setattr(client.settings, "WHATSAPP_ACCESS_TOKEN", None)

    def _boom(*a, **k):
        raise AssertionError("dry-run must not call Meta")

    monkeypatch.setattr(client.httpx, "AsyncClient", _boom)

    wamid = await client.send(
        db_session, "+919999999999", {"kind": "text", "body": "hello"}
    )
    assert wamid.startswith("sim:")

    rows = (await db_session.execute(
        select(WhatsAppMessage).where(WhatsAppMessage.direction == "out")
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].body == "hello"
    assert rows[0].status == "done"


@pytest.mark.asyncio
async def test_send_all_preserves_order(db_session, monkeypatch):
    monkeypatch.setattr(client.settings, "WHATSAPP_ACCESS_TOKEN", None)
    msgs = [{"kind": "text", "body": f"m{i}"} for i in range(3)]
    ids = await client.send_all(db_session, "+919999999999", msgs)
    assert len(ids) == 3

    rows = (await db_session.execute(
        select(WhatsAppMessage)
        .where(WhatsAppMessage.direction == "out")
        .order_by(WhatsAppMessage.created_at.asc())
    )).scalars().all()
    assert [r.body for r in rows] == ["m0", "m1", "m2"]


def test_buttons_payload_shape():
    payload = client.build_payload("+919999999999", {
        "kind": "buttons", "body": "Confirm?",
        "buttons": [{"id": "cfm:t1:a1", "title": "Confirm"}],
    })
    assert payload["type"] == "interactive"
    assert payload["interactive"]["type"] == "button"
    btns = payload["interactive"]["action"]["buttons"]
    assert btns[0]["reply"]["id"] == "cfm:t1:a1"


def test_text_payload_shape():
    payload = client.build_payload("+919999999999", {"kind": "text", "body": "hi"})
    assert payload["type"] == "text"
    assert payload["text"]["body"] == "hi"
    assert payload["text"]["preview_url"] is False
```

- [ ] **Step 2: Run to verify it fails**

User command: `poetry run pytest tests/test_whatsapp_client.py -v`
Expected: `ModuleNotFoundError: No module named 'app.whatsapp.client'`

- [ ] **Step 3: Implement `app/whatsapp/client.py`**

```python
"""Meta Graph API calls — and a dry-run mode that makes localhost work.

When ``settings.whatsapp_configured`` is False the client sends nothing. It
still records the outbound row exactly as a live send would and logs the body,
so the entire pipeline — webhook, queue, worker, agent, renderer — can be
exercised on a laptop with no Meta account, no phone number and no tunnel.
That is not a testing convenience bolted on afterwards; it is how this feature
is developed at all before business verification completes.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.whatsapp.constants import DIRECTION_OUT, MSG_DONE, MSG_FAILED
from app.whatsapp.models import WhatsAppMessage

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class WhatsAppSendError(Exception):
    """Meta refused a send. Never swallowed — a dropped reply is invisible."""


def _graph_url(path: str) -> str:
    return f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{path}"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}"}


def build_payload(phone_e164: str, message: dict) -> dict[str, Any]:
    """Message dict (from render.py) -> Meta's send payload."""
    to = phone_e164.lstrip("+")
    base: dict[str, Any] = {"messaging_product": "whatsapp", "to": to}
    kind = message.get("kind", "text")

    if kind == "buttons":
        return {
            **base,
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": message["body"]},
                "action": {
                    "buttons": [
                        {"type": "reply",
                         "reply": {"id": b["id"], "title": b["title"]}}
                        for b in message.get("buttons", [])[:3]
                    ]
                },
            },
        }

    if kind == "list":
        return {
            **base,
            "type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": message["body"]},
                "action": {
                    "button": message.get("button", "Choose"),
                    "sections": [{
                        "title": message.get("section_title", "Options"),
                        "rows": message.get("rows", [])[:10],
                    }],
                },
            },
        }

    return {
        **base,
        "type": "text",
        # preview_url False: an unfurled link preview on a booking confirmation
        # is noise, and it leaks a fetch to whatever host is mentioned.
        "text": {"body": message.get("body", ""), "preview_url": False},
    }


async def send(
    db,
    phone_e164: str,
    message: dict,
    *,
    cms_user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    turn_id: Optional[str] = None,
) -> str:
    """Send one message and record it. Returns the wamid (or a sim: id)."""
    payload = build_payload(phone_e164, message)
    wamid: str
    status = MSG_DONE
    error: Optional[str] = None

    if not settings.whatsapp_configured:
        wamid = f"sim:{uuid.uuid4()}"
        logger.info(
            "[whatsapp][dry-run] -> %s: %s", phone_e164, message.get("body", "")[:400]
        )
    else:
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
                resp = await http.post(
                    _graph_url(f"{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"),
                    headers=_headers(),
                    json=payload,
                )
            if resp.status_code >= 400:
                raise WhatsAppSendError(f"{resp.status_code}: {resp.text[:500]}")
            wamid = (resp.json().get("messages") or [{}])[0].get(
                "id", f"unknown:{uuid.uuid4()}"
            )
        except WhatsAppSendError as exc:
            wamid, status, error = f"failed:{uuid.uuid4()}", MSG_FAILED, str(exc)
            logger.error("WhatsApp send failed to %s: %s", phone_e164, exc)
        except Exception as exc:  # network, DNS, timeout
            wamid, status, error = f"failed:{uuid.uuid4()}", MSG_FAILED, str(exc)
            logger.exception("WhatsApp send crashed for %s", phone_e164)

    db.add(WhatsAppMessage(
        wamid=wamid,
        direction=DIRECTION_OUT,
        phone_e164=phone_e164,
        cms_user_id=cms_user_id,
        session_id=session_id,
        turn_id=turn_id,
        kind=message.get("kind", "text"),
        body=message.get("body"),
        status=status,
        error=error,
    ))
    await db.commit()

    if status == MSG_FAILED:
        raise WhatsAppSendError(error or "send failed")
    return wamid


async def send_all(db, phone_e164: str, messages: list[dict], **kw) -> list[str]:
    """Send in order, one at a time.

    Sequential on purpose: WhatsApp does not guarantee ordering between
    concurrent sends, and a Confirm button arriving before the summary it
    belongs to is worse than being a second slower.
    """
    return [await send(db, phone_e164, m, **kw) for m in messages]


async def fetch_media(media_id: str) -> tuple[bytes, str, str]:
    """Two-step media download: id -> short-lived URL -> bytes.

    The URL expires after 5 MINUTES and the byte fetch needs the bearer token
    too (omitting it fails). Both steps happen together here so nothing is ever
    deferred past that window.
    """
    if not settings.whatsapp_configured:
        raise WhatsAppSendError("WhatsApp is not configured; cannot fetch media")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
        meta = await http.get(_graph_url(media_id), headers=_headers())
        if meta.status_code >= 400:
            raise WhatsAppSendError(f"media lookup {meta.status_code}: {meta.text[:300]}")
        info = meta.json()
        url = info.get("url")
        if not url:
            raise WhatsAppSendError("media lookup returned no url")

        blob = await http.get(url, headers=_headers())
        if blob.status_code >= 400:
            raise WhatsAppSendError(f"media download {blob.status_code}")

    mime = info.get("mime_type") or "application/octet-stream"
    filename = info.get("file_name") or f"{media_id}"
    return blob.content, mime, filename
```

- [ ] **Step 4: Agent verification gate**

```bash
poetry run ruff check app/whatsapp/client.py
poetry run python -c "from app.whatsapp.client import build_payload; print(build_payload('+91999', {'kind':'text','body':'hi'}))"
```
Expected: `All checks passed`, then a dict with `'type': 'text'`.

- [ ] **Step 5: Hand over the test command**

`poetry run pytest tests/test_whatsapp_client.py -v` — expected: 4 passed.

- [ ] **Step 6: Stage and propose a commit**

```bash
git add app/whatsapp/client.py tests/test_whatsapp_client.py
git commit -m "feat(whatsapp): Meta client with dry-run mode for local development"
```

---

## Task 5: Link service

**Files:**
- Create: `app/whatsapp/link_service.py`
- Test: `tests/test_whatsapp_link.py`

**Interfaces:**
- Consumes: Task 1 models, Task 2 settings.
- Produces:
  - `async mint_link_token(db, user) -> tuple[str, datetime]` → `(deep_link, expires_at)`
  - `async try_bind(db, phone_e164, text, profile_name=None) -> CmsUser | None`
  - `async resolve_operator(db, phone_e164) -> tuple[WhatsAppLink, CmsUser] | None`
  - `async unlink(db, user) -> bool`
  - `def extract_token(text) -> str | None`

Read `app/cms_users/password_reset.py` in full before writing this — it is the pattern being copied, including `_hash_token` and `_as_aware`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_whatsapp_link.py`:

```python
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.whatsapp import link_service
from app.whatsapp.models import WhatsAppLink, WhatsAppLinkToken

PHONE = "+919999999999"


def test_extract_token_is_case_insensitive():
    assert link_service.extract_token("Link my Mark AI account: ABC123") == "ABC123"
    assert link_service.extract_token("link my mark ai account: xyz") == "xyz"
    assert link_service.extract_token("hello there") is None


@pytest.mark.asyncio
async def test_mint_then_bind(db_session, cms_user):
    deep_link, _ = await link_service.mint_link_token(db_session, cms_user)
    raw = deep_link.split("account%3A%20")[-1].split("&")[0]

    bound = await link_service.try_bind(db_session, PHONE, f"Link my Mark AI account: {raw}")
    assert bound is not None and bound.id == cms_user.id

    link = (await db_session.execute(
        select(WhatsAppLink).where(WhatsAppLink.phone_e164 == PHONE)
    )).scalar_one()
    assert link.cms_user_id == cms_user.id


@pytest.mark.asyncio
async def test_token_is_single_use(db_session, cms_user):
    deep_link, _ = await link_service.mint_link_token(db_session, cms_user)
    raw = deep_link.split("account%3A%20")[-1].split("&")[0]
    msg = f"Link my Mark AI account: {raw}"

    assert await link_service.try_bind(db_session, PHONE, msg) is not None
    assert await link_service.try_bind(db_session, "+918888888888", msg) is None


@pytest.mark.asyncio
async def test_new_token_strands_the_old_one(db_session, cms_user):
    first, _ = await link_service.mint_link_token(db_session, cms_user)
    raw_first = first.split("account%3A%20")[-1].split("&")[0]
    await link_service.mint_link_token(db_session, cms_user)

    result = await link_service.try_bind(
        db_session, PHONE, f"Link my Mark AI account: {raw_first}"
    )
    assert result is None, "a leaked older link must already be dead"


@pytest.mark.asyncio
async def test_expired_token_is_rejected(db_session, cms_user):
    deep_link, _ = await link_service.mint_link_token(db_session, cms_user)
    raw = deep_link.split("account%3A%20")[-1].split("&")[0]

    row = (await db_session.execute(select(WhatsAppLinkToken))).scalars().first()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()

    assert await link_service.try_bind(
        db_session, PHONE, f"Link my Mark AI account: {raw}"
    ) is None


@pytest.mark.asyncio
async def test_inactive_user_cannot_bind(db_session, cms_user):
    deep_link, _ = await link_service.mint_link_token(db_session, cms_user)
    raw = deep_link.split("account%3A%20")[-1].split("&")[0]
    cms_user.is_active = False
    await db_session.commit()

    assert await link_service.try_bind(
        db_session, PHONE, f"Link my Mark AI account: {raw}"
    ) is None


@pytest.mark.asyncio
async def test_resolve_skips_deactivated_operator(db_session, cms_user):
    """is_active is re-checked on EVERY message, not just at bind — that is what
    makes deactivating an operator revoke WhatsApp access instantly."""
    deep_link, _ = await link_service.mint_link_token(db_session, cms_user)
    raw = deep_link.split("account%3A%20")[-1].split("&")[0]
    await link_service.try_bind(db_session, PHONE, f"Link my Mark AI account: {raw}")

    assert await link_service.resolve_operator(db_session, PHONE) is not None
    cms_user.is_active = False
    await db_session.commit()
    assert await link_service.resolve_operator(db_session, PHONE) is None
```

- [ ] **Step 2: Run to verify it fails**

User command: `poetry run pytest tests/test_whatsapp_link.py -v`
Expected: `ModuleNotFoundError: No module named 'app.whatsapp.link_service'`

- [ ] **Step 3: Implement `app/whatsapp/link_service.py`**

```python
"""Bind a handset to a CMS operator, and resolve it on every message.

The flow, and why each half is required:

* Only someone authenticated in the CMS can mint a token.
* Only the real handset can send it back.

Both halves together are the proof. Neither alone is worth anything, which is
why there is no "type your number in the CMS" path — a typo there would bind
the co-pilot to a stranger with nothing to detect it.

Token mechanics are copied verbatim in spirit from
``app/cms_users/password_reset.py``: 24 random bytes, only the sha256 stored,
minting a new one strands every earlier unused one, and validation is separate
from consumption.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.cms_users.models import CmsUser
from app.core.config import settings
from app.whatsapp.constants import LINK_PREFIX
from app.whatsapp.models import WhatsAppLink, WhatsAppLinkToken

logger = logging.getLogger(__name__)


def _hash_token(raw: str) -> str:
    """sha256 of the raw token. Not password hashing — 192 bits of randomness
    has no guessable structure, so there is nothing for a slow KDF to defend."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite (tests) returns naive datetimes, Postgres returns aware ones.
    Treat naive as UTC so expiry comparisons behave identically on both."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def normalize_phone(raw: str) -> str:
    """Meta sends digits only; we store E.164 with a leading '+'."""
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    return f"+{digits}" if digits else ""


def deep_link_for(raw_token: str) -> str:
    number = (settings.WHATSAPP_BUSINESS_NUMBER or "").lstrip("+")
    text = quote(f"Link my Mark AI account: {raw_token}")
    return f"https://wa.me/{number}?text={text}"


def extract_token(text: Optional[str]) -> Optional[str]:
    """Pull the raw token out of a linking message, or None."""
    if not text:
        return None
    lowered = text.strip().lower()
    if not lowered.startswith(LINK_PREFIX):
        return None
    token = text.strip()[len(LINK_PREFIX):].strip()
    return token or None


async def mint_link_token(db: AsyncSession, user: CmsUser) -> tuple[str, datetime]:
    """Mint a single-use token and return (deep_link, expires_at)."""
    raw = secrets.token_urlsafe(24)

    # Newest link wins — strand every earlier unused token for this operator so
    # a screenshot of an older one is already dead.
    await db.execute(
        update(WhatsAppLinkToken)
        .where(
            WhatsAppLinkToken.cms_user_id == user.id,
            WhatsAppLinkToken.used_at.is_(None),
        )
        .values(used_at=_now())
    )
    expires_at = _now() + timedelta(minutes=settings.WHATSAPP_LINK_TOKEN_TTL_MINUTES)
    db.add(WhatsAppLinkToken(
        cms_user_id=user.id, token_hash=_hash_token(raw), expires_at=expires_at
    ))
    await db.commit()
    return deep_link_for(raw), expires_at


async def try_bind(
    db: AsyncSession,
    phone_e164: str,
    text: Optional[str],
    profile_name: Optional[str] = None,
) -> Optional[CmsUser]:
    """If `text` carries a valid token, bind this phone. Returns the operator."""
    raw = extract_token(text)
    if not raw:
        return None

    row = (await db.execute(
        select(WhatsAppLinkToken).where(
            WhatsAppLinkToken.token_hash == _hash_token(raw)
        )
    )).scalar_one_or_none()
    if row is None or row.used_at is not None:
        return None
    expires = _as_aware(row.expires_at)
    if expires is None or expires <= _now():
        return None

    user = (await db.execute(
        select(CmsUser).where(CmsUser.id == row.cms_user_id)
    )).scalar_one_or_none()
    if user is None or not user.is_active:
        return None

    # Re-linking replaces: an operator who changes handset links again and the
    # old number stops working, without an admin in the loop.
    existing = (await db.execute(
        select(WhatsAppLink).where(WhatsAppLink.cms_user_id == user.id)
    )).scalar_one_or_none()

    # A number previously bound to someone else must be released first, or the
    # unique constraint rejects the bind.
    other = (await db.execute(
        select(WhatsAppLink).where(WhatsAppLink.phone_e164 == phone_e164)
    )).scalar_one_or_none()
    if other is not None and (existing is None or other.id != existing.id):
        await db.delete(other)
        await db.flush()

    if existing is None:
        existing = WhatsAppLink(cms_user_id=user.id, phone_e164=phone_e164)
        db.add(existing)
    else:
        existing.phone_e164 = phone_e164
        # A new handset starts a new conversation — never inherit the previous
        # device's in-flight booking draft.
        existing.session_id = None
        existing.last_message_at = None
    existing.wa_profile_name = profile_name

    row.used_at = _now()
    await db.commit()
    logger.info("WhatsApp linked: user=%s phone=%s", user.id, phone_e164)
    return user


async def resolve_operator(
    db: AsyncSession, phone_e164: str
) -> Optional[tuple[WhatsAppLink, CmsUser]]:
    """The link + operator for this number, or None.

    ``is_active`` is checked HERE, on every message — not only at bind time.
    That is what makes deactivating an operator revoke WhatsApp access
    instantly, matching the enrollment-key rule for screens.
    """
    link = (await db.execute(
        select(WhatsAppLink).where(WhatsAppLink.phone_e164 == phone_e164)
    )).scalar_one_or_none()
    if link is None:
        return None
    user = (await db.execute(
        select(CmsUser).where(CmsUser.id == link.cms_user_id)
    )).scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    return link, user


async def unlink(db: AsyncSession, user: CmsUser) -> bool:
    """Hard delete. A soft delete would collide with the unique phone
    constraint on re-link; the audit trail lives in whatsapp_messages."""
    link = (await db.execute(
        select(WhatsAppLink).where(WhatsAppLink.cms_user_id == user.id)
    )).scalar_one_or_none()
    if link is None:
        return False
    await db.delete(link)
    await db.commit()
    return True
```

- [ ] **Step 4: Agent verification gate**

```bash
poetry run ruff check app/whatsapp/link_service.py
poetry run python -c "from app.whatsapp.link_service import extract_token; print(extract_token('Link my Mark AI account: ABC'))"
```
Expected: `All checks passed`, then `ABC`.

- [ ] **Step 5: Hand over the test command**

`poetry run pytest tests/test_whatsapp_link.py -v` — expected: 7 passed.

- [ ] **Step 6: Stage and propose a commit**

```bash
git add app/whatsapp/link_service.py tests/test_whatsapp_link.py
git commit -m "feat(whatsapp): single-use link tokens binding a handset to an operator"
```

---

## Task 6: Extract the shared confirm service ⚠️ RISKY

This is the only edit to an existing live write path. It must change **no behaviour**. The existing AI confirm tests are the regression gate — they must pass unchanged, with no edits to the test file.

**Files:**
- Create: `app/ai/confirm_service.py`
- Modify: `app/ai/router.py:392-500` (`confirm_action`)
- Test: `tests/test_ai_confirm.py` (existing — **must not be modified**)

**Interfaces:**
- Consumes: `app/ai/executors.execute_proposal`, `app/ai/service`, `app/ai/draft`, `app/ai/bus`.
- Produces: `async execute_actions(db, user, session_id, turn_id, *, action_id=None, overrides=None) -> dict` returning `{"executed": bool, "results": list, "summaries": list[str]}`, and `class ConfirmError(Exception)` carrying `.status_code` and `.detail`.

- [ ] **Step 1: Read the current implementation in full**

```bash
sed -n '380,505p' app/ai/router.py
```
Transcribe its logic exactly before writing anything. The parts that must survive byte-for-byte in behaviour:
1. target selection — one by `action_id`, or every non-executed non-dismissed action
2. the 409s for already-executed and dismissed
3. `executed = True` persisted **immediately after each action succeeds**, not batched
4. the post-booking draft archive (`archive_draft` → `store_draft({})` → `store_archive`)
5. the `bus.publish` success note

- [ ] **Step 2: Run the existing tests to establish the baseline**

User command: `poetry run pytest tests/test_ai_confirm.py -v`
Expected: all pass. **Record the count.** It must be identical at the end.

- [ ] **Step 3: Create `app/ai/confirm_service.py`**

Move the body of `confirm_action` here verbatim, changing only how errors are raised. Preserve every comment — they explain the double-execution guard.

```python
"""Execute a turn's write proposals. The single implementation.

This lived inside ``router.py``'s confirm endpoint until the WhatsApp transport
needed the same behaviour for a tapped reply button. It is extracted rather
than copied on purpose: what this function guards is creating the same booking
twice on a real screen, and a second copy of that guard would drift from this
one the first time either was touched.

Raises ``ConfirmError`` rather than ``HTTPException`` so it has no dependency on
being called from a request. The HTTP route translates it.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import bus, draft, service
from app.ai.constants import CardType, EventType, Role, ToolName
from app.ai.executors import execute_proposal
from app.cms_users.models import CmsUser


class ConfirmError(Exception):
    """A confirm could not proceed. Carries the HTTP shape the route needs."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def card_actions(card: Optional[dict]) -> list[dict]:
    """Normalise a card's actions, including the legacy single-action shape."""
    # Copy the existing _card_actions body from app/ai/router.py:66 verbatim.
    ...


async def execute_actions(
    db: AsyncSession,
    user: CmsUser,
    session_id: str,
    turn_id: str,
    *,
    action_id: Optional[str] = None,
    overrides: Optional[dict] = None,
) -> dict[str, Any]:
    """Run one action, or every still-pending action, on a turn's card."""
    turn = await service.get_turn(db, turn_id)
    actions = card_actions(turn.card) if turn is not None else []
    if turn is None or turn.session_id != session_id or not actions:
        raise ConfirmError(404, "No pending action found for that turn.")

    if action_id is not None:
        targets = [a for a in actions if a.get("id") == action_id]
        if not targets:
            raise ConfirmError(404, "No action with that id on this turn.")
        if targets[0].get("executed"):
            raise ConfirmError(409, "This action was already executed.")
        if targets[0].get("dismissed"):
            raise ConfirmError(409, "This action was dismissed.")
    else:
        targets = [a for a in actions
                   if not a.get("executed") and not a.get("dismissed")]
        if not targets:
            raise ConfirmError(409, "No pending actions to confirm.")

    # Persist each action's executed flag AS SOON AS it succeeds. Executors
    # commit per action, so if a later one fails the earlier bookings are
    # already committed — marking each executed immediately means a retry
    # skips them instead of double-booking a real screen.
    current = [dict(a) for a in actions]
    by_id = {a["id"]: a for a in current}
    results: list = []
    booked = False
    for action in targets:
        args = dict(action.get("args") or {})
        if overrides and action_id is not None:
            args = {**args, **overrides}
        results.append(
            await execute_proposal(db, user, {"tool": action.get("tool"), "args": args})
        )
        by_id[action["id"]]["executed"] = True
        await service.update_turn(
            db, turn,
            card={**(turn.card or {}), "type": CardType.ACTION, "actions": current},
        )
        if action.get("tool") == ToolName.CREATE_BOOKING:
            booked = True

    if booked:
        session = await service.get_session(db, user.id, session_id)
        _, new_archive = draft.archive_draft(
            draft.get_draft(session.session_state),
            draft.get_archive(session.session_state),
            reason="booked",
        )
        new_state = draft.store_draft(session.session_state, {})
        new_state = draft.store_archive(new_state, new_archive)
        await service.touch_session(db, session, session_state=new_state)

    summaries = [a.get("summary", "action") for a in targets]
    note = summaries[0] if len(summaries) == 1 else f"{len(summaries)} actions"
    await bus.publish(
        user.id, session_id,
        {
            "type": EventType.MESSAGE,
            "id": turn.id,
            "role": Role.ASSISTANT,
            "content": f"✅ Done: {note}.",
            "card": {"type": CardType.INFO, "executed_count": len(targets)},
        },
    )
    return {"executed": True, "results": results, "summaries": summaries}
```

Replace the `...` in `card_actions` with the real body from `app/ai/router.py:66`. Check whether `ToolName` is imported from `app.ai.constants` in `router.py` and match it.

- [ ] **Step 4: Make the route a thin wrapper**

Replace the body of `confirm_action` in `app/ai/router.py` (keep the decorator, signature and docstring):

```python
    _require_ai_enabled()
    await service.get_session(db, user.id, session_id)  # ownership check

    try:
        outcome = await confirm_service.execute_actions(
            db, user, session_id, payload.turn_id,
            action_id=payload.action_id,
            overrides=payload.overrides,
        )
    except confirm_service.ConfirmError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    results = outcome["results"]
    return ConfirmActionResponse(
        executed=True,
        result=results[0] if results else None,
        results=results,
        message=f"Executed {len(results)} action(s) successfully.",
    )
```

Add `from app.ai import confirm_service` to the imports. Remove `_card_actions` from `router.py` only if nothing else uses it — check first:

```bash
grep -n "_card_actions" app/ai/router.py
```
`_card_has_pending` likely calls it; if so, keep `_card_actions` as a one-line delegation to `confirm_service.card_actions`.

- [ ] **Step 5: Verify the regression gate**

User command: `poetry run pytest tests/test_ai_confirm.py -v`
Expected: **the exact same count of passes as Step 2, with `tests/test_ai_confirm.py` unmodified.** Any change here means behaviour drifted — revert and redo.

- [ ] **Step 6: Agent verification gate**

```bash
poetry run ruff check app/ai/confirm_service.py app/ai/router.py
poetry run python -c "import app.main; print('ok')"
```

- [ ] **Step 7: Stage and propose a commit**

```bash
git add app/ai/confirm_service.py app/ai/router.py
git commit -m "refactor(ai): extract confirm execution into a shared service"
```

---

## Task 7: The worker pool

**Files:**
- Create: `app/whatsapp/worker.py`
- Test: `tests/test_whatsapp_worker.py`

**Interfaces:**
- Consumes: Task 1 models, Task 2 settings.
- Produces: `async claim_one(db) -> WhatsAppMessage | None`, `async reclaim_stale(db) -> int`, `async worker_loop(index: int)`, `def start_workers() -> list`, `async stop_workers()`. Task 8's `inbound.handle` is what `worker_loop` calls.

**Read `app/creative_fit/worker.py` in full first.** This task is that file adapted; do not invent a different claim strategy.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_whatsapp_worker.py`:

```python
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.whatsapp import worker
from app.whatsapp.models import WhatsAppMessage


def _queued(wamid="wamid.1", **kw):
    return WhatsAppMessage(
        wamid=wamid, direction="in", phone_e164="+919999999999",
        kind="text", body="hi", status="queued", **kw
    )


@pytest.mark.asyncio
async def test_claim_marks_running(db_session):
    db_session.add(_queued())
    await db_session.commit()

    row = await worker.claim_one(db_session)
    assert row is not None
    assert row.status == "running"
    assert row.claimed_at is not None


@pytest.mark.asyncio
async def test_claim_returns_none_when_empty(db_session):
    assert await worker.claim_one(db_session) is None


@pytest.mark.asyncio
async def test_claim_ignores_outbound(db_session):
    db_session.add(WhatsAppMessage(
        wamid="wamid.out", direction="out", phone_e164="+919999999999",
        kind="text", body="hi", status="queued",
    ))
    await db_session.commit()
    assert await worker.claim_one(db_session) is None


@pytest.mark.asyncio
async def test_claim_takes_oldest_first(db_session):
    old = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.add(_queued("wamid.new"))
    db_session.add(_queued("wamid.old", received_at=old))
    await db_session.commit()

    row = await worker.claim_one(db_session)
    assert row.wamid == "wamid.old"


@pytest.mark.asyncio
async def test_reclaim_stale_requeues_a_dead_worker_row(db_session):
    """An instance reaped mid-turn leaves a running row. This is what makes
    that recoverable instead of silently lost."""
    stale = datetime.now(timezone.utc) - timedelta(hours=2)
    row = _queued()
    row.status = "running"
    row.claimed_at = stale
    db_session.add(row)
    await db_session.commit()

    assert await worker.reclaim_stale(db_session) == 1
    refreshed = (await db_session.execute(select(WhatsAppMessage))).scalar_one()
    assert refreshed.status == "queued"


@pytest.mark.asyncio
async def test_reclaim_leaves_a_fresh_claim_alone(db_session):
    row = _queued()
    row.status = "running"
    row.claimed_at = datetime.now(timezone.utc)
    db_session.add(row)
    await db_session.commit()

    assert await worker.reclaim_stale(db_session) == 0
```

- [ ] **Step 2: Run to verify it fails**

User command: `poetry run pytest tests/test_whatsapp_worker.py -v`
Expected: `ModuleNotFoundError: No module named 'app.whatsapp.worker'`

- [ ] **Step 3: Implement `app/whatsapp/worker.py`**

```python
"""The WhatsApp worker pool — Postgres IS the queue.

Adapted from ``app/creative_fit/worker.py``, which chose this shape for reasons
that apply here unchanged: it runs identically on a laptop and in production,
and there is no second thing to deploy, scale, or forget to restart.

Why a queue at all, when the CMS chat just uses ``asyncio.create_task``: that
works there because a held SSE connection keeps the Cloud Run instance's
request in flight. A webhook returns 200 immediately and holds nothing, so the
instance is idle-eligible the moment it answers. A durable row survives being
reaped; a bare background task does not.

``FOR UPDATE SKIP LOCKED`` is what makes concurrent workers safe: the row one
worker is claiming is invisible to the others for the duration of the
statement. The guarantee lives in the database, so it holds across Cloud Run
instances too.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text, update

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.whatsapp.constants import DIRECTION_IN, MSG_QUEUED, MSG_RUNNING
from app.whatsapp.models import WhatsAppMessage

logger = logging.getLogger(__name__)

_tasks: list[asyncio.Task] = []

# One statement, so the claim is atomic without an explicit transaction dance.
_CLAIM_PG = text(
    """
    UPDATE whatsapp_messages
       SET status = :running, claimed_at = :now, attempts = attempts + 1
     WHERE id = (SELECT id FROM whatsapp_messages
                  WHERE status = :queued AND direction = :inbound
                  ORDER BY received_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1)
 RETURNING id
    """
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; Postgres hands back aware ones."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def claim_one(db) -> WhatsAppMessage | None:
    """Atomically take the oldest queued inbound message, or return None."""
    dialect = db.bind.dialect.name if db.bind is not None else "postgresql"

    if dialect == "postgresql":
        claimed_id = (await db.execute(_CLAIM_PG, {
            "running": MSG_RUNNING, "queued": MSG_QUEUED,
            "inbound": DIRECTION_IN, "now": _now(),
        })).scalar()
        await db.commit()
    else:
        # SQLite (tests, and any non-Postgres dev setup). No SKIP LOCKED, but
        # the test suite is single-writer so a plain select-then-update is safe.
        row = (await db.execute(
            select(WhatsAppMessage)
            .where(
                WhatsAppMessage.status == MSG_QUEUED,
                WhatsAppMessage.direction == DIRECTION_IN,
            )
            .order_by(WhatsAppMessage.received_at.asc())
            .limit(1)
        )).scalar_one_or_none()
        if row is None:
            return None
        row.status = MSG_RUNNING
        row.claimed_at = _now()
        row.attempts = (row.attempts or 0) + 1
        await db.commit()
        claimed_id = row.id

    if claimed_id is None:
        return None
    return (await db.execute(
        select(WhatsAppMessage).where(WhatsAppMessage.id == claimed_id)
    )).scalar_one_or_none()


async def reclaim_stale(db) -> int:
    """Re-queue rows whose worker died mid-flight.

    This is the crash story for a Cloud Run instance reaped between the 200 and
    the reply: the row is still `running` with an old `claimed_at`, so it comes
    back rather than vanishing.
    """
    cutoff = _now() - timedelta(minutes=settings.WHATSAPP_CLAIM_TIMEOUT_MINUTES)
    result = await db.execute(
        update(WhatsAppMessage)
        .where(
            WhatsAppMessage.status == MSG_RUNNING,
            WhatsAppMessage.claimed_at.is_not(None),
            WhatsAppMessage.claimed_at < cutoff,
        )
        .values(status=MSG_QUEUED, claimed_at=None)
    )
    await db.commit()
    return int(result.rowcount or 0)


async def _run_one(index: int) -> bool:
    """Claim and process one message. Returns True if there was work."""
    from app.whatsapp import inbound  # imported here to avoid a circular import

    async with AsyncSessionLocal() as db:
        row = await claim_one(db)
        if row is None:
            return False
        try:
            await inbound.handle(db, row)
        except Exception:
            logger.exception("[whatsapp] worker %s failed on %s", index, row.wamid)
            await inbound.mark_failed(db, row, "internal error")
        return True


async def worker_loop(index: int) -> None:
    """Poll for work forever, backing off when idle."""
    # Stagger so N workers do not all wake on the same tick.
    await asyncio.sleep(0.25 * index)
    idle_ticks = 0
    while True:
        try:
            did_work = await _run_one(index)
            if did_work:
                idle_ticks = 0
                continue
            idle_ticks += 1
            if idle_ticks % 20 == 0:
                async with AsyncSessionLocal() as db:
                    n = await reclaim_stale(db)
                    if n:
                        logger.warning("[whatsapp] reclaimed %s stale message(s)", n)
            await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[whatsapp] worker %s loop error", index)
            await asyncio.sleep(5.0)


def start_workers() -> list[asyncio.Task]:
    """Start the pool. WHATSAPP_WORKERS=0 disables it on this instance."""
    global _tasks
    count = max(0, int(settings.WHATSAPP_WORKERS))
    if count == 0 or not settings.WHATSAPP_ENABLED:
        logger.info("[whatsapp] worker pool disabled")
        return []
    _tasks = [asyncio.create_task(worker_loop(i)) for i in range(count)]
    logger.info("[whatsapp] started %s worker(s)", count)
    return _tasks


async def stop_workers() -> None:
    global _tasks
    for task in _tasks:
        task.cancel()
    for task in _tasks:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    _tasks = []
```

- [ ] **Step 4: Agent verification gate**

```bash
poetry run ruff check app/whatsapp/worker.py
poetry run python -c "from app.whatsapp.worker import start_workers; print('ok')"
```

- [ ] **Step 5: Hand over the test command**

`poetry run pytest tests/test_whatsapp_worker.py -v` — expected: 6 passed.

- [ ] **Step 6: Stage and propose a commit**

```bash
git add app/whatsapp/worker.py tests/test_whatsapp_worker.py
git commit -m "feat(whatsapp): Postgres-as-queue worker pool with stale reclaim"
```

---

## Task 8: Media ingestion and the inbound orchestrator

**Files:**
- Create: `app/whatsapp/media.py`, `app/whatsapp/inbound.py`
- Test: `tests/test_whatsapp_inbound.py`

**Interfaces:**
- Consumes: Tasks 1–7, plus `app.ai.agent.run_turn`, `app.ai.service`, `app.ai.confirm_service`, `app.core.gcs_service.upload_to_gcs`, `app.core.images.image_dimensions`.
- Produces: `async handle(db, row: WhatsAppMessage) -> None`, `async mark_failed(db, row, reason: str) -> None`, `async resolve_session(db, link, user) -> str`, `async ingest_media(db, turn_id, user_id, media_ref) -> AiChatMedia | None`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_whatsapp_inbound.py`:

```python
from datetime import datetime, timedelta, timezone

import pytest

from app.whatsapp import inbound
from app.whatsapp.models import WhatsAppLink, WhatsAppMessage


@pytest.mark.asyncio
async def test_unlinked_number_gets_one_line_and_is_ignored(db_session):
    row = WhatsAppMessage(
        wamid="wamid.x", direction="in", phone_e164="+910000000000",
        kind="text", body="hello", status="running",
    )
    db_session.add(row)
    await db_session.commit()

    await inbound.handle(db_session, row)
    assert row.status == "ignored"


@pytest.mark.asyncio
async def test_stale_message_is_failed_not_answered(db_session, cms_user):
    """Answering a six-hour-old 'book it' is worse than not answering."""
    old = datetime.now(timezone.utc) - timedelta(hours=48)
    db_session.add(WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+919999999999"))
    row = WhatsAppMessage(
        wamid="wamid.old", direction="in", phone_e164="+919999999999",
        kind="text", body="book it", status="running", received_at=old,
    )
    db_session.add(row)
    await db_session.commit()

    await inbound.handle(db_session, row)
    assert row.status == "failed"


@pytest.mark.asyncio
async def test_session_is_reused_inside_the_idle_window(db_session, cms_user):
    link = WhatsAppLink(
        cms_user_id=cms_user.id, phone_e164="+919999999999",
        session_id="sess-1", last_message_at=datetime.now(timezone.utc),
    )
    db_session.add(link)
    await db_session.commit()

    assert await inbound.resolve_session(db_session, link, cms_user) == "sess-1"


@pytest.mark.asyncio
async def test_session_rolls_after_the_idle_window(db_session, cms_user):
    """A stale booking draft from yesterday must not answer 'book it' today."""
    link = WhatsAppLink(
        cms_user_id=cms_user.id, phone_e164="+919999999999",
        session_id="sess-1",
        last_message_at=datetime.now(timezone.utc) - timedelta(hours=48),
    )
    db_session.add(link)
    await db_session.commit()

    assert await inbound.resolve_session(db_session, link, cms_user) != "sess-1"
```

- [ ] **Step 2: Run to verify it fails**

User command: `poetry run pytest tests/test_whatsapp_inbound.py -v`
Expected: `ModuleNotFoundError: No module named 'app.whatsapp.inbound'`

- [ ] **Step 3: Implement `app/whatsapp/media.py`**

Mirrors `_store_upload` in `app/ai/router.py:237` so WhatsApp media becomes the same `ai_chat_media` row a browser upload produces.

```python
"""WhatsApp media -> GCS -> ai_chat_media.

Meta's caps are the constraint we cannot argue with: image 5 MB, video 16 MB,
document 100 MB. Worse than the caps, a phone recompresses photos and videos
picked from the gallery BEFORE upload, so a 4K creative sent "as a video"
arrives downscaled. Sending it as a Document avoids both. We surface that once
rather than silently accepting a degraded creative — these play on premium
physical panels.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from typing import Optional

from app.ai import service as ai_service
from app.core.config import settings
from app.core.gcs_service import upload_to_gcs
from app.core.images import image_dimensions
from app.whatsapp.client import fetch_media
from app.whatsapp.constants import KIND_IMAGE, KIND_VIDEO

logger = logging.getLogger(__name__)

# Meta's own per-type caps. Anything larger never reaches us, but a document
# can carry 100 MB, so the check is real.
MAX_BYTES = 100 * 1024 * 1024

COMPRESSED_KINDS = (KIND_IMAGE, KIND_VIDEO)

COMPRESSION_NOTE = (
    "⚠️ WhatsApp compressed that file. For the real creative, send it as a "
    "*Document* (📎 → Document) or upload it in the CMS — otherwise it plays "
    "downscaled on the screen."
)


async def ingest_media(db, turn_id: str, user_id: str, media_ref: dict) -> Optional[object]:
    """Fetch WhatsApp media and record it against the turn. None on failure."""
    media_id = (media_ref or {}).get("media_id")
    if not media_id:
        return None
    try:
        data, mime, filename = await fetch_media(media_id)
    except Exception:
        logger.exception("WhatsApp media fetch failed for %s", media_id)
        return None

    if len(data) > MAX_BYTES:
        logger.warning("WhatsApp media %s over cap (%s bytes)", media_id, len(data))
        return None

    checksum = hashlib.sha256(data).hexdigest()
    media_type = "video" if mime.startswith("video/") else "image"
    ext = filename.rsplit(".", 1)[-1] if "." in filename else (
        "mp4" if media_type == "video" else "jpg"
    )
    blob_name = f"chat/{turn_id}/{uuid.uuid4()}.{ext}"
    try:
        file_url = upload_to_gcs(data, blob_name, content_type=mime)
    except Exception:
        logger.exception("WhatsApp media upload to GCS failed for %s", media_id)
        return None

    width = height = None
    if media_type == "image":
        width, height = image_dimensions(data)

    return await ai_service.add_media(
        db, turn_id,
        uploaded_by=user_id,
        gcs_bucket=settings.GCP_BUCKET_NAME or "",
        gcs_key=blob_name,
        file_url=file_url,
        filename=filename,
        type=media_type,
        mime_type=mime,
        size_bytes=len(data),
        width=width,
        height=height,
        checksum=checksum,
    )
```

- [ ] **Step 4: Implement `app/whatsapp/inbound.py`**

```python
"""One inbound WhatsApp message, end to end.

The important line in this file is ``await run_turn(...)``. Everything above it
is translation; everything below is presentation. The agent, its tools, its
role scoping and its booking draft are untouched — which is the whole reason a
screenowner on WhatsApp reaches exactly their own screens and not one more.

``run_turn`` is awaited rather than fired-and-forgotten because WhatsApp wants
one finished message, not a token stream. It already wraps itself in
``locks.session_turn_lock``, so three messages sent in four seconds serialize
correctly with no extra machinery here.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select

from app.ai import confirm_service, service as ai_service
from app.ai.agent import run_turn
from app.ai.models import AiChatSession
from app.cms_users.models import CmsUser
from app.core.config import settings
from app.whatsapp import client, link_service, render
from app.whatsapp.constants import (
    BTN_CANCEL_PREFIX,
    BTN_CONFIRM_ALL_PREFIX,
    BTN_CONFIRM_PREFIX,
    BTN_REVIEW_PREFIX,
    KIND_BUTTON,
    MEDIA_KINDS,
    MSG_DONE,
    MSG_FAILED,
    MSG_IGNORED,
)
from app.whatsapp.media import COMPRESSED_KINDS, COMPRESSION_NOTE, ingest_media
from app.whatsapp.models import WhatsAppMessage

logger = logging.getLogger(__name__)

UNLINKED_REPLY = (
    "This number isn't linked to a Mark AI account. Open your CMS profile and "
    "tap *Link WhatsApp* to connect it."
)
LINKED_REPLY = (
    "✅ Linked to {email}.\n\nAsk me anything you'd ask the co-pilot in the CMS — "
    "try _what's playing on my screens right now?_"
)
UNSUPPORTED_REPLY = "I can't read that kind of message yet — send text or an image."
ERROR_REPLY = "Something went wrong on my side. Try again in a moment."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def mark_failed(db, row: WhatsAppMessage, reason: str) -> None:
    row.status = MSG_FAILED
    row.error = reason[:2000]
    await db.commit()


async def _finish(db, row: WhatsAppMessage, status: str) -> None:
    row.status = status
    await db.commit()


async def resolve_session(db, link, user: CmsUser) -> str:
    """The session this message belongs to, rolling a fresh one when idle.

    Rolling matters: the booking draft lives on the session, so without it a
    half-finished campaign from yesterday would still be 'active' when the
    operator says 'book it' today.
    """
    last = _as_aware(link.last_message_at)
    idle_cutoff = _now() - timedelta(hours=settings.WHATSAPP_SESSION_IDLE_HOURS)

    if link.session_id and last is not None and last > idle_cutoff:
        exists = (await db.execute(
            select(AiChatSession).where(AiChatSession.id == link.session_id)
        )).scalar_one_or_none()
        if exists is not None:
            return link.session_id

    session = await ai_service.create_session(db, user.id, title="WhatsApp")
    link.session_id = session.id
    await db.commit()
    return session.id


async def _handle_button(db, row: WhatsAppMessage, user: CmsUser, link) -> None:
    """A tapped reply button maps to exactly one persisted proposal."""
    payload = row.body or ""

    if payload.startswith(BTN_CANCEL_PREFIX):
        await client.send(db, row.phone_e164, {"kind": "text", "body": "Cancelled 👍"},
                          cms_user_id=user.id)
        await _finish(db, row, MSG_DONE)
        return

    if payload.startswith(BTN_REVIEW_PREFIX):
        await client.send(db, row.phone_e164,
                          {"kind": "text", "body": "Sure — what should I change?"},
                          cms_user_id=user.id)
        await _finish(db, row, MSG_DONE)
        return

    if payload.startswith(BTN_CONFIRM_ALL_PREFIX):
        turn_id, action_id = payload[len(BTN_CONFIRM_ALL_PREFIX):], None
    elif payload.startswith(BTN_CONFIRM_PREFIX):
        rest = payload[len(BTN_CONFIRM_PREFIX):]
        turn_id, _, action_id = rest.partition(":")
        action_id = action_id or None
    else:
        await client.send(db, row.phone_e164,
                          {"kind": "text", "body": UNSUPPORTED_REPLY},
                          cms_user_id=user.id)
        await _finish(db, row, MSG_DONE)
        return

    turn = await ai_service.get_turn(db, turn_id)
    if turn is None:
        await client.send(db, row.phone_e164,
                          {"kind": "text", "body": "I can't find that request any more."},
                          cms_user_id=user.id)
        await _finish(db, row, MSG_DONE)
        return

    try:
        outcome = await confirm_service.execute_actions(
            db, user, turn.session_id, turn_id, action_id=action_id
        )
        body = "✅ Done: " + "; ".join(outcome["summaries"])
    except confirm_service.ConfirmError as exc:
        # 409 means already executed or dismissed. Tapping a stale button must
        # read as reassurance, not as an error.
        body = ("That one's already done ✅" if exc.status_code == 409
                else f"I couldn't do that: {exc.detail}")

    await client.send(db, row.phone_e164, {"kind": "text", "body": body},
                      cms_user_id=user.id, session_id=turn.session_id, turn_id=turn_id)
    await _finish(db, row, MSG_DONE)


async def handle(db, row: WhatsAppMessage) -> None:
    """Process one claimed inbound message."""
    phone = row.phone_e164

    # 1. Staleness bound — never answer an ancient request.
    received = _as_aware(row.received_at) or _now()
    if received < _now() - timedelta(minutes=settings.WHATSAPP_MAX_MESSAGE_AGE_MINUTES):
        await mark_failed(db, row, "message too old to answer")
        return

    # 2. Linking message? Bind before resolving, so a first-ever message works.
    profile_name = (row.media_ref or {}).get("profile_name") if row.media_ref else None
    bound = await link_service.try_bind(db, phone, row.body, profile_name)
    if bound is not None:
        await client.send(db, phone,
                          {"kind": "text", "body": LINKED_REPLY.format(email=bound.email)},
                          cms_user_id=bound.id)
        await _finish(db, row, MSG_DONE)
        return

    # 3. Resolve the operator. is_active is re-checked here on every message.
    resolved = await link_service.resolve_operator(db, phone)
    if resolved is None:
        await client.send(db, phone, {"kind": "text", "body": UNLINKED_REPLY})
        await _finish(db, row, MSG_IGNORED)
        return
    link, user = resolved
    row.cms_user_id = user.id

    # 4. Button taps bypass the agent entirely — they map to a stored proposal.
    if row.kind == KIND_BUTTON:
        await _handle_button(db, row, user, link)
        return

    if not settings.ai_enabled:
        await client.send(db, phone,
                          {"kind": "text", "body": "The co-pilot is unavailable right now."},
                          cms_user_id=user.id)
        await _finish(db, row, MSG_DONE)
        return

    # 5. Session + turn.
    session_id = await resolve_session(db, link, user)
    user_message = row.body or ""
    if row.kind in MEDIA_KINDS and not user_message:
        user_message = "(sent a file)"
    turn = await ai_service.create_turn(db, session_id, user_message)
    row.session_id, row.turn_id = session_id, turn.id
    await db.commit()

    # 6. Media rides the same ai_chat_media path a browser upload takes.
    if row.kind in MEDIA_KINDS and row.media_ref:
        await ingest_media(db, turn.id, user.id, row.media_ref)

    # 7. THE AGENT — unchanged. Awaited, because WhatsApp wants one finished
    #    answer, and because run_turn already serializes per session.
    await run_turn(user.id, session_id, turn.id)

    # 8. Read the finished turn and render it.
    finished = await ai_service.get_turn(db, turn.id)
    await db.refresh(finished)
    messages = render.render_turn(
        finished.final_response, finished.card, turn.id
    ) if finished else [{"kind": "text", "body": ERROR_REPLY}]

    if row.kind in COMPRESSED_KINDS:
        messages.append({"kind": "text", "body": COMPRESSION_NOTE})

    await client.send_all(db, phone, messages,
                          cms_user_id=user.id, session_id=session_id, turn_id=turn.id)

    link.last_message_at = _now()
    await _finish(db, row, MSG_DONE)
```

- [ ] **Step 5: Agent verification gate**

```bash
poetry run ruff check app/whatsapp/inbound.py app/whatsapp/media.py
poetry run python -c "import app.whatsapp.inbound; print('ok')"
```
A circular-import error here means `worker.py`'s deferred `from app.whatsapp import inbound` was moved to module level — put it back inside `_run_one`.

- [ ] **Step 6: Hand over the test command**

`poetry run pytest tests/test_whatsapp_inbound.py -v` — expected: 4 passed.

- [ ] **Step 7: Stage and propose a commit**

```bash
git add app/whatsapp/inbound.py app/whatsapp/media.py tests/test_whatsapp_inbound.py
git commit -m "feat(whatsapp): inbound orchestrator wiring messages to the co-pilot"
```

---

## Task 9: Webhook, routers and the local simulator

**Files:**
- Create: `app/whatsapp/webhook.py`, `app/whatsapp/schemas.py`, `app/whatsapp/router.py`
- Modify: `app/api/routers/routers.py`
- Test: `tests/test_whatsapp_webhook.py`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: `verify_signature(raw: bytes, header: str | None) -> bool`, `parse_webhook(payload: dict) -> list[dict]`, `public_router` (prefix `/whatsapp`), `cms_router` (prefix `/cms/whatsapp`).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_whatsapp_webhook.py`:

```python
import hashlib
import hmac
import json

import pytest

from app.whatsapp import webhook


def _sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class TestSignature:
    def test_valid_signature_passes(self, monkeypatch):
        monkeypatch.setattr(webhook.settings, "WHATSAPP_APP_SECRET", "s3cr3t")
        body = b'{"a":1}'
        assert webhook.verify_signature(body, _sign(body, "s3cr3t")) is True

    def test_tampered_body_fails(self, monkeypatch):
        monkeypatch.setattr(webhook.settings, "WHATSAPP_APP_SECRET", "s3cr3t")
        assert webhook.verify_signature(b'{"a":2}', _sign(b'{"a":1}', "s3cr3t")) is False

    def test_wrong_secret_fails(self, monkeypatch):
        monkeypatch.setattr(webhook.settings, "WHATSAPP_APP_SECRET", "s3cr3t")
        body = b'{"a":1}'
        assert webhook.verify_signature(body, _sign(body, "other")) is False

    def test_missing_header_fails(self, monkeypatch):
        monkeypatch.setattr(webhook.settings, "WHATSAPP_APP_SECRET", "s3cr3t")
        assert webhook.verify_signature(b'{"a":1}', None) is False

    def test_unconfigured_rejects(self, monkeypatch):
        """No secret must mean 'reject', never 'allow anything'."""
        monkeypatch.setattr(webhook.settings, "WHATSAPP_APP_SECRET", None)
        assert webhook.verify_signature(b'{"a":1}', "sha256=whatever") is False


class TestParse:
    def _envelope(self, message: dict) -> dict:
        return {"entry": [{"changes": [{"value": {
            "contacts": [{"profile": {"name": "Akshat"}, "wa_id": "919999999999"}],
            "messages": [message],
        }}]}]}

    def test_text_message(self):
        out = webhook.parse_webhook(self._envelope({
            "from": "919999999999", "id": "wamid.A",
            "timestamp": "1754000000", "type": "text", "text": {"body": "hello"},
        }))
        assert len(out) == 1
        assert out[0]["wamid"] == "wamid.A"
        assert out[0]["phone_e164"] == "+919999999999"
        assert out[0]["kind"] == "text"
        assert out[0]["body"] == "hello"

    def test_image_message_carries_media_ref(self):
        out = webhook.parse_webhook(self._envelope({
            "from": "919999999999", "id": "wamid.B",
            "timestamp": "1754000000", "type": "image",
            "image": {"id": "media-1", "mime_type": "image/jpeg", "caption": "our ad"},
        }))
        assert out[0]["kind"] == "image"
        assert out[0]["media_ref"]["media_id"] == "media-1"
        assert out[0]["body"] == "our ad"

    def test_button_reply(self):
        out = webhook.parse_webhook(self._envelope({
            "from": "919999999999", "id": "wamid.C",
            "timestamp": "1754000000", "type": "interactive",
            "interactive": {"type": "button_reply",
                            "button_reply": {"id": "cfm:t1:a1", "title": "Confirm"}},
        }))
        assert out[0]["kind"] == "button"
        assert out[0]["body"] == "cfm:t1:a1"

    def test_status_callback_yields_nothing(self):
        """Delivery receipts are not messages — they must not enqueue work."""
        assert webhook.parse_webhook(
            {"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.D"}]}}]}]}
        ) == []

    def test_unknown_type_is_marked_unsupported(self):
        out = webhook.parse_webhook(self._envelope({
            "from": "919999999999", "id": "wamid.E",
            "timestamp": "1754000000", "type": "location",
            "location": {"latitude": 1, "longitude": 2},
        }))
        assert out[0]["kind"] == "unsupported"

    def test_empty_payload_is_safe(self):
        assert webhook.parse_webhook({}) == []
```

- [ ] **Step 2: Run to verify it fails**

User command: `poetry run pytest tests/test_whatsapp_webhook.py -v`
Expected: `ModuleNotFoundError: No module named 'app.whatsapp.webhook'`

- [ ] **Step 3: Implement `app/whatsapp/webhook.py`**

```python
"""Signature verification and payload parsing for Meta's webhook.

Both functions are pure so they can be tested without a request. That matters
here more than usual: this is the one public, unauthenticated endpoint in the
service, and the signature is the *only* thing proving Meta sent the payload.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.whatsapp.constants import (
    KIND_AUDIO,
    KIND_BUTTON,
    KIND_DOCUMENT,
    KIND_IMAGE,
    KIND_TEXT,
    KIND_UNSUPPORTED,
    KIND_VIDEO,
)

logger = logging.getLogger(__name__)

_MEDIA_TYPES = {
    "image": KIND_IMAGE,
    "video": KIND_VIDEO,
    "document": KIND_DOCUMENT,
    "audio": KIND_AUDIO,
}


def verify_signature(raw_body: bytes, header: str | None) -> bool:
    """HMAC-SHA256 over the RAW body, compared in constant time.

    Must run on the exact bytes Meta sent, before any JSON parse — re-encoding
    a parsed dict changes key order and whitespace and the digest no longer
    matches. With no configured secret this returns False: an endpoint that
    cannot verify must reject, never wave everything through.
    """
    secret = settings.WHATSAPP_APP_SECRET
    if not secret or not header:
        return False
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header)


def _phone(raw: str) -> str:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    return f"+{digits}" if digits else ""


def _received_at(ts: Any) -> datetime:
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def parse_webhook(payload: dict) -> list[dict]:
    """Flatten Meta's envelope into inbound message dicts.

    Returns rows shaped for WhatsAppMessage. Status callbacks (delivery
    receipts) yield nothing — they are not messages and must not enqueue work.
    """
    out: list[dict] = []
    for entry in (payload or {}).get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            value = change.get("value") or {}
            contacts = value.get("contacts") or []
            profile_name = (
                (contacts[0].get("profile") or {}).get("name") if contacts else None
            )

            for msg in value.get("messages", []) or []:
                wamid = msg.get("id")
                if not wamid:
                    continue
                mtype = msg.get("type")
                row: dict[str, Any] = {
                    "wamid": wamid,
                    "phone_e164": _phone(msg.get("from", "")),
                    "received_at": _received_at(msg.get("timestamp")),
                    "kind": KIND_UNSUPPORTED,
                    "body": None,
                    "media_ref": {"profile_name": profile_name} if profile_name else None,
                }

                if mtype == "text":
                    row["kind"] = KIND_TEXT
                    row["body"] = (msg.get("text") or {}).get("body")
                elif mtype in _MEDIA_TYPES:
                    blob = msg.get(mtype) or {}
                    row["kind"] = _MEDIA_TYPES[mtype]
                    row["body"] = blob.get("caption")
                    row["media_ref"] = {
                        **(row["media_ref"] or {}),
                        "media_id": blob.get("id"),
                        "mime_type": blob.get("mime_type"),
                        "sha256": blob.get("sha256"),
                        "filename": blob.get("filename"),
                    }
                elif mtype == "interactive":
                    inter = msg.get("interactive") or {}
                    reply = inter.get("button_reply") or inter.get("list_reply") or {}
                    if reply.get("id"):
                        row["kind"] = KIND_BUTTON
                        row["body"] = reply.get("id")
                elif mtype == "button":
                    # Template quick-reply shape; different from `interactive`.
                    row["kind"] = KIND_BUTTON
                    row["body"] = (msg.get("button") or {}).get("payload")

                out.append(row)
    return out
```

- [ ] **Step 4: Implement `app/whatsapp/schemas.py`**

```python
"""Request/response models for the CMS-facing WhatsApp routes."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class LinkStatusResponse(BaseModel):
    linked: bool
    phone_e164: Optional[str] = None
    wa_profile_name: Optional[str] = None
    linked_at: Optional[datetime] = None
    configured: bool = Field(
        description="False when the backend has no Meta credentials (dry-run)."
    )
    business_number: Optional[str] = None


class LinkTokenResponse(BaseModel):
    deep_link: str
    expires_at: datetime


class SimulateRequest(BaseModel):
    phone: str
    text: str


class SimulateResponse(BaseModel):
    wamid: str
    status: str
    replies: list[str]
```

- [ ] **Step 5: Implement `app/whatsapp/router.py`**

```python
"""WhatsApp routers.

Two routers, deliberately split:

* ``public_router`` (/api/whatsapp) — Meta calls this directly, so it must NOT
  sit under /api/cms/*. It is unauthenticated by nature; the HMAC signature is
  its only proof of origin.
* ``cms_router`` (/api/cms/whatsapp) — operator-facing. It MUST stay under
  /api/cms/* or the CMS's same-origin proxy will not forward it and the browser
  gets Next.js's own 404.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.cms_users.deps import get_current_cms_user
from app.cms_users.models import CmsUser
from app.core.config import settings
from app.core.database import get_db
from app.whatsapp import link_service, webhook as wh
from app.whatsapp.constants import DIRECTION_IN, DIRECTION_OUT, MSG_QUEUED
from app.whatsapp.models import WhatsAppLink, WhatsAppMessage
from app.whatsapp.schemas import (
    LinkStatusResponse,
    LinkTokenResponse,
    SimulateRequest,
    SimulateResponse,
)

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
cms_router = APIRouter(prefix="/cms/whatsapp", tags=["whatsapp"])


async def _enqueue(db: AsyncSession, rows: list[dict]) -> int:
    """Insert inbound rows, skipping any wamid we have already seen.

    The UNIQUE(wamid) violation IS the dedup guard — Meta retries a failed
    delivery with decreasing frequency for up to 7 days, and without this a
    retried "book it" would run the agent twice.
    """
    accepted = 0
    for row in rows:
        try:
            db.add(WhatsAppMessage(
                wamid=row["wamid"],
                direction=DIRECTION_IN,
                phone_e164=row["phone_e164"],
                kind=row["kind"],
                body=row.get("body"),
                media_ref=row.get("media_ref"),
                received_at=row["received_at"],
                status=MSG_QUEUED,
            ))
            await db.commit()
            accepted += 1
        except IntegrityError:
            await db.rollback()
            logger.info("[whatsapp] duplicate delivery ignored: %s", row["wamid"])
    return accepted


@public_router.get("/webhook")
async def verify_webhook(request: Request) -> Response:
    """Meta's one-time subscription handshake — echo hub.challenge as text."""
    params = request.query_params
    if (params.get("hub.mode") == "subscribe"
            and settings.WHATSAPP_VERIFY_TOKEN
            and params.get("hub.verify_token") == settings.WHATSAPP_VERIFY_TOKEN):
        return Response(content=params.get("hub.challenge", ""), media_type="text/plain")
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verification failed")


@public_router.post("/webhook")
async def receive_webhook(
    request: Request, db: AsyncSession = Depends(get_db)
) -> Response:
    """Verify, enqueue, and 200 fast. All real work happens in the worker."""
    if not settings.WHATSAPP_ENABLED:
        raise HTTPException(status_code=503, detail="WhatsApp is disabled")

    raw = await request.body()
    if not wh.verify_signature(raw, request.headers.get("X-Hub-Signature-256")):
        logger.warning("[whatsapp] rejected a payload with a bad signature")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bad signature")

    try:
        payload = await request.json()
    except Exception:
        # Never 4xx a malformed body — Meta would retry it for 7 days.
        return Response(status_code=200)

    await _enqueue(db, wh.parse_webhook(payload))
    return Response(status_code=200)


@cms_router.get("/status", response_model=LinkStatusResponse)
async def link_status(
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
):
    link = (await db.execute(
        select(WhatsAppLink).where(WhatsAppLink.cms_user_id == user.id)
    )).scalar_one_or_none()
    return LinkStatusResponse(
        linked=link is not None,
        phone_e164=link.phone_e164 if link else None,
        wa_profile_name=link.wa_profile_name if link else None,
        linked_at=link.linked_at if link else None,
        configured=settings.whatsapp_configured,
        business_number=settings.WHATSAPP_BUSINESS_NUMBER,
    )


@cms_router.post("/link-token", response_model=LinkTokenResponse)
async def create_link_token(
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.WHATSAPP_BUSINESS_NUMBER:
        raise HTTPException(status_code=503, detail="WhatsApp is not configured yet.")
    deep_link, expires_at = await link_service.mint_link_token(db, user)
    return LinkTokenResponse(deep_link=deep_link, expires_at=expires_at)


@cms_router.delete("/link", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
):
    await link_service.unlink(db, user)


@cms_router.post("/simulate", response_model=SimulateResponse)
async def simulate(
    payload: SimulateRequest,
    user: CmsUser = Depends(get_current_cms_user),
    db: AsyncSession = Depends(get_db),
):
    """Inject a message as if Meta had delivered it. Local development only.

    Gated on ENVIRONMENT alone — never on a magic value in the request body.
    The Gmail mock inbox originally also triggered on a literal code, which
    meant anyone in production could hand-post it and get a fake inbox.
    """
    if settings.ENVIRONMENT == "production":
        raise HTTPException(status_code=404, detail="Not found")

    import uuid
    from datetime import datetime, timezone

    wamid = f"sim-in:{uuid.uuid4()}"
    phone = link_service.normalize_phone(payload.phone)
    await _enqueue(db, [{
        "wamid": wamid,
        "phone_e164": phone,
        "kind": "text",
        "body": payload.text,
        "media_ref": None,
        "received_at": datetime.now(timezone.utc),
    }])

    # Poll briefly so a single call returns the replies — this is the localhost
    # test loop, and making the caller poll twice would make it useless.
    row = None
    for _ in range(120):
        await asyncio.sleep(0.5)
        db.expire_all()
        row = (await db.execute(
            select(WhatsAppMessage).where(WhatsAppMessage.wamid == wamid)
        )).scalar_one_or_none()
        if row is not None and row.status in ("done", "failed", "ignored"):
            break

    replies = (await db.execute(
        select(WhatsAppMessage)
        .where(
            WhatsAppMessage.direction == DIRECTION_OUT,
            WhatsAppMessage.phone_e164 == phone,
        )
        .order_by(WhatsAppMessage.created_at.desc())
        .limit(10)
    )).scalars().all()

    return SimulateResponse(
        wamid=wamid,
        status=row.status if row else "queued",
        replies=[r.body or "" for r in reversed(replies)],
    )
```

- [ ] **Step 6: Register the routers**

In `app/api/routers/routers.py`, add the imports next to the existing ones:

```python
from app.whatsapp.router import (
    cms_router as cms_whatsapp_router,
    public_router as whatsapp_public_router,
)
```

Then register — `cms_whatsapp_router` **with** the CMS group, `whatsapp_public_router` with the device-facing/public group:

```python
api_router.include_router(cms_whatsapp_router)
api_router.include_router(whatsapp_public_router)
```

- [ ] **Step 7: Verify the routes exist at the right prefixes**

```bash
poetry run python -c "
from app.main import app
for r in app.routes:
    p = getattr(r, 'path', '')
    if 'whatsapp' in p:
        print(sorted(getattr(r, 'methods', [])), p)
"
```
Expected — note the public webhook is **not** under `/api/cms`:
```
['GET'] /api/whatsapp/webhook
['POST'] /api/whatsapp/webhook
['GET'] /api/cms/whatsapp/status
['POST'] /api/cms/whatsapp/link-token
['DELETE'] /api/cms/whatsapp/link
['POST'] /api/cms/whatsapp/simulate
```

- [ ] **Step 8: Agent verification gate**

```bash
poetry run ruff check app/whatsapp/ app/api/routers/routers.py
```

- [ ] **Step 9: Hand over the test command**

`poetry run pytest tests/test_whatsapp_webhook.py -v` — expected: 11 passed.

- [ ] **Step 10: Stage and propose a commit**

```bash
git add app/whatsapp/webhook.py app/whatsapp/schemas.py app/whatsapp/router.py app/api/routers/routers.py tests/test_whatsapp_webhook.py
git commit -m "feat(whatsapp): signed webhook, CMS link routes and a local simulator"
```

---

## Task 10: Start the workers — first end-to-end localhost test

**Files:**
- Modify: `app/main.py`

**Interfaces:**
- Consumes: Task 7's `start_workers` / `stop_workers`.
- Produces: a running pipeline.

- [ ] **Step 1: Read how creative_fit does it**

```bash
sed -n '70,95p' app/main.py
```

- [ ] **Step 2: Start the pool in `lifespan`**

Beside the existing `start_workers()` call for creative_fit, matching its guard style:

```python
        from app.whatsapp.worker import start_workers as start_whatsapp_workers

        start_whatsapp_workers()
```

And in the shutdown half, beside creative_fit's:

```python
            from app.whatsapp.worker import stop_workers as stop_whatsapp_workers

            await stop_whatsapp_workers()
```

- [ ] **Step 3: Boot the stack**

```bash
./dev_start.sh
```
Expected in the log: `[whatsapp] started 2 worker(s)`.

- [ ] **Step 4: 🎯 Run the first end-to-end test on localhost**

No Meta account, no phone number, no tunnel. Three curls.

`dev_start.sh` serves the API on **8095**, and the seeded superadmin comes from
`SEED_SUPERADMIN_EMAIL`/`SEED_SUPERADMIN_PASSWORD` in `.env` — which on this machine is
`danish_ashraf@mark-ai.tech` / `danish@123`, not the `admin@mark-ai.tech` default.

```bash
# 1. Log in as the seeded superadmin and keep the token
TOKEN=$(curl -s -X POST http://localhost:8095/api/cms/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"danish_ashraf@mark-ai.tech","password":"danish@123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "${TOKEN:0:20}..."
```

```bash
# 2. Mint a link token. Needs WHATSAPP_BUSINESS_NUMBER set in .env —
#    any placeholder works in dry-run, e.g. WHATSAPP_BUSINESS_NUMBER=919999999999
curl -s -X POST http://localhost:8095/api/cms/whatsapp/link-token \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected: `{"deep_link": "https://wa.me/919999999999?text=Link%20my%20Mark%20AI%20account%3A%20<TOKEN>", "expires_at": "..."}`

```bash
# 3. Simulate the operator sending that exact text, then a real question.
#    `/simulate` only accepts the CALLER's own number, so the first call (before
#    any link exists) may name a free number and every call after it must reuse
#    the one that link bound.
curl -s -X POST http://localhost:8095/api/cms/whatsapp/simulate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"phone":"+919876543210","text":"Link my Mark AI account: <PASTE_RAW_TOKEN>"}' \
  | python3 -m json.tool

curl -s -X POST http://localhost:8095/api/cms/whatsapp/simulate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"phone":"+919876543210","text":"how many screens do I have?"}' \
  | python3 -m json.tool
```

Expected: the first returns `"replies": ["✅ Linked to danish_ashraf@mark-ai.tech...]`; the second returns the co-pilot's real answer, in WhatsApp markup, with `"status": "done"`.

```bash
# 4. Tap a Confirm button. A reply that offers buttons returns their ids in
#    `buttons`; feed one back as `button_id` and the confirm path runs for real.
curl -s -X POST http://localhost:8095/api/cms/whatsapp/simulate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"phone":"+919876543210","button_id":"cfm:<TURN_ID>:<ACTION_ID>"}' \
  | python3 -m json.tool
```
Expected: `"replies": ["✅ Done: …"]`. Tapping the same id again returns
`"That one's already done ✅"` and books nothing.

**If the second reply is empty**, check in this order: `GEMINI_API_KEY` is set (`settings.ai_enabled`); the worker log shows a claim; `whatsapp_messages.error` for that `wamid`.

- [ ] **Step 5: Verify dedup by hand**

```bash
poetry run python -c "
import asyncio, json
from app.core.database import AsyncSessionLocal
from app.whatsapp.router import _enqueue
from datetime import datetime, timezone

async def main():
    row = {'wamid':'dup-test-1','phone_e164':'+919876543210','kind':'text',
           'body':'hi','media_ref':None,'received_at':datetime.now(timezone.utc)}
    async with AsyncSessionLocal() as db:
        print('first :', await _enqueue(db, [row]))
        print('second:', await _enqueue(db, [row]))
asyncio.run(main())
"
```
Expected: `first : 1` then `second: 0` — the retry guard working.

- [ ] **Step 6: Stage and propose a commit**

```bash
git add app/main.py
git commit -m "feat(whatsapp): start the worker pool with the app lifespan"
```

---

## Task 11: CMS profile panel

**Files:**
- Create: `markai-Web-cms/src/components/whatsapp/LinkPanel.tsx`
- Modify: `markai-Web-cms/src/lib/api.ts`
- Modify: the operator profile page (find it with the command in Step 1)

**Interfaces:**
- Consumes: Task 9's three CMS endpoints.
- Produces: `fetchWhatsAppStatus()`, `createWhatsAppLinkToken()`, `deleteWhatsAppLink()` in `api.ts`; `<WhatsAppLinkPanel />`.

- [ ] **Step 1: Find the profile page and the api.ts conventions**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
grep -rln "enrollment_key\|enrollmentKey" src/app src/components | head
grep -n "export async function fetchGmailStatus\|gmail/status" src/lib/api.ts
```
The enrollment-key panel is the closest precedent — a per-operator secret shown on their own profile. Put the WhatsApp panel beside it and copy its visual conventions.

- [ ] **Step 2: Add the API functions**

In `src/lib/api.ts`, matching the file's existing style exactly (copy the shape of the Gmail functions found in Step 1):

```ts
export interface WhatsAppStatus {
  linked: boolean;
  phone_e164: string | null;
  wa_profile_name: string | null;
  linked_at: string | null;
  configured: boolean;
  business_number: string | null;
}

export async function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  return apiGet<WhatsAppStatus>("/cms/whatsapp/status");
}

export async function createWhatsAppLinkToken(): Promise<{
  deep_link: string;
  expires_at: string;
}> {
  return apiPost("/cms/whatsapp/link-token", {});
}

export async function deleteWhatsAppLink(): Promise<void> {
  return apiDelete("/cms/whatsapp/link");
}
```

Replace `apiGet` / `apiPost` / `apiDelete` with whatever helpers the file actually uses — check first, do not assume.

- [ ] **Step 3: Build the panel**

Create `src/components/whatsapp/LinkPanel.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  createWhatsAppLinkToken,
  deleteWhatsAppLink,
  fetchWhatsAppStatus,
  type WhatsAppStatus,
} from "@/lib/api";

export function WhatsAppLinkPanel() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    fetchWhatsAppStatus().then(setStatus).catch((e) => setError(String(e)));

  useEffect(() => {
    void reload();
  }, []);

  if (!status) return null;

  if (!status.configured && !status.linked) {
    return (
      <section className="rounded-lg border p-4">
        <h3 className="font-medium">WhatsApp</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Not configured yet. An administrator needs to connect the Mark AI
          WhatsApp Business number before operators can link their phones.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-4">
      <h3 className="font-medium">WhatsApp</h3>

      {status.linked ? (
        <>
          <p className="mt-1 text-sm">
            Linked to <span className="font-mono">{status.phone_e164}</span>
            {status.wa_profile_name ? ` (${status.wa_profile_name})` : ""}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Message the Mark AI number to talk to the co-pilot from your phone.
          </p>
          <button
            className="mt-3 text-sm text-red-600 hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deleteWhatsAppLink();
                setDeepLink(null);
                await reload();
              } finally {
                setBusy(false);
              }
            }}
          >
            Unlink this number
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Link your phone to use the co-pilot from WhatsApp. You&apos;ll get the
            same screens and permissions you have here.
          </p>
          <button
            className="mt-3 rounded bg-green-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const { deep_link } = await createWhatsAppLinkToken();
                setDeepLink(deep_link);
                window.open(deep_link, "_blank", "noopener,noreferrer");
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Link WhatsApp
          </button>

          {deepLink && (
            <p className="mt-3 text-sm">
              WhatsApp should have opened with a message ready to send — just hit
              send. If it didn&apos;t,{" "}
              <a
                className="underline"
                href={deepLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                open it here
              </a>
              . The link expires in 15 minutes.
            </p>
          )}
        </>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
```

Match the surrounding files' styling system — if the codebase uses shadcn `Button`/`Card`, use those instead of raw Tailwind classes.

- [ ] **Step 4: Mount it on the profile page**

Add `<WhatsAppLinkPanel />` beside the enrollment-key panel found in Step 1.

- [ ] **Step 5: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run lint && npx tsc --noEmit
npm run dev
```
Open http://localhost:5120, log in, go to the profile page. Expected: the panel renders; **Link WhatsApp** produces a `wa.me` URL.

- [ ] **Step 6: Stage and propose a commit**

```bash
git add src/components/whatsapp/LinkPanel.tsx src/lib/api.ts
git commit -m "feat(whatsapp): link panel on the operator profile"
```

---

## Task 12: Documentation

**Files:**
- Modify: `markai-signage-api/CLAUDE.md`
- Modify: `/Users/akshat/projects/MarkAi/CLAUDE.md`

- [ ] **Step 1: Add a section to the backend CLAUDE.md**

After the Gmail section, matching its tone (state the invariant and the failure it prevents):

```markdown
## WhatsApp is a second door onto the co-pilot, not a second co-pilot

`app/whatsapp/` is a transport adapter. It converts an inbound WhatsApp message
into an `ai_chat_turn`, `await`s the **unchanged** `app/ai/agent.run_turn`, and
renders the finished turn back out. There is no second agent, no second set of
tools, and — critically — no second copy of the permission model: a screenowner
on WhatsApp reaches exactly their assigned screens because
`assert_can_manage_screen` lives in the tools, not the transport.

- **`whatsapp_messages.wamid` is UNIQUE, and that uniqueness is the dedup guard.**
  Meta retries a failed delivery with decreasing frequency **for up to 7 days**.
  Without the constraint, one retried "book it" runs the agent twice.
- **The same table is the work queue.** The webhook verifies, inserts, and 200s;
  `app/whatsapp/worker.py` claims rows with `FOR UPDATE SKIP LOCKED`, exactly as
  `app/creative_fit/worker.py` does. A bare `asyncio.create_task` is NOT safe
  here: the CMS chat survives it only because a held SSE connection keeps the
  Cloud Run request in flight, and a webhook holds nothing.
- **`POST /api/whatsapp/webhook` is deliberately OUTSIDE `/api/cms/*`** — Meta
  calls it directly. Every operator-facing route (`status`, `link-token`,
  `link`, `simulate`) must stay INSIDE that prefix or the CMS proxy will not
  forward it.
- **`X-Hub-Signature-256` is verified over the RAW body**, before any JSON parse.
  Re-encoding a parsed dict changes key order and the digest stops matching.
  No configured secret ⇒ reject, never allow.
- **Confirm has exactly one implementation.** `app/ai/confirm_service.py` is
  called by both `POST /cms/ai/sessions/{id}/confirm` and a tapped WhatsApp
  button. A second copy of its executed-flag guard would drift, and what it
  guards is booking a real screen twice.
- **Unconfigured is dry-run, not broken.** With no `WHATSAPP_ACCESS_TOKEN` the
  client logs instead of sending and still records the outbound row, so the
  whole pipeline runs on a laptop via `POST /api/cms/whatsapp/simulate`
  (non-production only, gated on `ENVIRONMENT` alone — never on a magic value
  in the request body).
- **Sessions roll after `WHATSAPP_SESSION_IDLE_HOURS` (12).** The booking draft
  lives on the session; without the roll, yesterday's half-finished campaign
  answers today's "book it".
- ⚠️ **Meta caps media** at image 5 MB / video 16 MB / document 100 MB, and
  phones recompress gallery photos and videos *before* upload. A 4K creative
  sent "as a video" arrives downscaled. We say so rather than silently booking
  a degraded creative.
```

- [ ] **Step 2: Update the root CLAUDE.md**

Add to the API surface list: `/api/cms/whatsapp/{status,link-token,link,simulate}` and the public `/api/whatsapp/webhook`.

- [ ] **Step 3: Stage and propose a commit**

```bash
git add markai-signage-api/CLAUDE.md CLAUDE.md
git commit -m "docs(whatsapp): record the transport-adapter invariants"
```

---

## Post-implementation: going live with Meta

Only after Tasks 1–12 pass on localhost. None of this blocks development.

1. **Meta Business Manager** → create/verify the business.
2. **developers.facebook.com** → create a **Business** app → add the **WhatsApp** product.
3. **Add a phone number** — it must **not** already be on the consumer WhatsApp app.
4. **⚠️ Business Settings → System Users → generate a token** with
   `whatsapp_business_messaging` + `whatsapp_business_management`, set to never expire.
   **The dashboard's default token expires in 24 hours** and this is the most common way
   the integration silently dies overnight looking like an unrelated auth bug.
5. **Configuration → Callback URL** `https://<cms-back-host>/api/whatsapp/webhook`,
   Verify token = `WHATSAPP_VERIFY_TOKEN`. Subscribe to the **`messages`** field.
6. **App Settings → Basic → App Secret** → `WHATSAPP_APP_SECRET`.
7. Put all secrets in Secret Manager and reference them from
   `gcp-env/services/cms-back.yaml`, matching `DATABASE_URL` / `REDIS_URL`.
8. **Test MP4-as-document** (spec §11, open decision 1). If Meta rejects it, video always
   routes to the CMS upload link and `media.py`'s cap branch is the only change needed.

---

## Self-review

**Spec coverage:** §4 architecture → Tasks 8–10. §5 background execution → Task 7. §6 data
model → Task 1. §7 linking → Tasks 5, 9, 11. §8 inbound pipeline → Tasks 8, 9. §9 confirm →
Tasks 6, 8. §10 rendering → Task 3. §11 media → Task 8. §12 security → Tasks 5, 9. §13 failure
modes → distributed across 5, 7, 8, 9. §14 config → Task 2. §15 Meta setup → post-implementation.
§16 local dev → Tasks 4, 9, 10. §17 order → task order. §18 tests → per task.

**Known gaps, stated rather than hidden:**

- **The 20 failure modes in spec §13 are not all individually tested.** Tasks 5, 7, 8 and 9
  cover the ones with real branching logic (dedup, stale reclaim, staleness bound, inactive
  operator, expired token, already-executed button). The rest — Redis down, token expiry,
  send failure — are handled in code but verified by inspection, not by a test.
- **Per-number rate limiting (spec §8) is not implemented.** `app/screens/enrollment_ratelimit.py`
  is the pattern to copy. It should be added before the number is publicised; it is not needed
  while the webhook is unregistered. Track it as a follow-up.
- **Outbound media (sending a creative back to the operator) is out of scope**, as declared in
  spec §2.

**Type consistency:** `render_turn` / `card_to_messages` return the same message dict shape
`client.build_payload` consumes (`kind`, `body`, `buttons`, `rows`) — checked across Tasks 3, 4, 8.
`execute_actions` returns `{"executed", "results", "summaries"}` and both callers (Task 6 route,
Task 8 button handler) use exactly those keys. `resolve_operator` returns
`tuple[WhatsAppLink, CmsUser] | None` and Task 8 unpacks it as such.
