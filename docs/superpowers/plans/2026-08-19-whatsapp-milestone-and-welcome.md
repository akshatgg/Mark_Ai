# WhatsApp Milestone Proof Shots + Welcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a milestone screenshot lands, WhatsApp the photo to the operator who booked the campaign (CMS- or WhatsApp-made alike); and send one welcome message the first time a number is linked (by message or by typing it in the CMS).

**Architecture:** A pure `window.py` decides free-form vs template (24h rule); `client.build_payload` learns the `template` kind; a new `notify.py` owns the two business-initiated sends (recipient, guards, window/template choice, best-effort). Hooks: `ingest_screenshot` (milestone frames), `inbound.py` bind branch and `PUT /cms/whatsapp/link` (welcome). One migration adds `cms_users.whatsapp_milestones` and `whatsapp_links.welcomed_at`. A CMS toggle.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic, pytest (aiosqlite in-memory fixtures), Next.js CMS.

**Spec:** `docs/superpowers/specs/2026-08-19-whatsapp-milestone-and-welcome-design.md`

## Global Constraints

- Repo `markai-signage-api/`; branch `feat/whatsapp-milestone-welcome` off `origin/main` (or off `feat/whatsapp-structured-slips` if that is not yet merged — it does not touch these files, either base works). **No `Co-Authored-By` trailer. Do not push unless asked.**
- Python for tests: `/Users/akshat/Library/Caches/pypoetry/virtualenvs/markai-signage-api-_FuBdvt1-py3.12/bin/python -m pytest <files> -q` and `-m ruff check`. Test DB is in-memory SQLite (`tests/conftest.py`); if `create_all` fails with `near "DEFERRABLE"`, cherry-pick commit `bb06d51` (conftest shim) from `feat/whatsapp-structured-slips`.
- Business-initiated sends: **free-form only when `window_open(link.last_message_at)`; otherwise template; template name unset → log + skip.** Never raise out of `notify.*`.
- Template names default: `WHATSAPP_MILESTONE_TEMPLATE="milestone_proof"`, `WHATSAPP_WELCOME_TEMPLATE="cms_welcome"`, `WHATSAPP_TEMPLATE_LANG="en"` — all `Optional[str]`/`str` in `app/core/config.py` following the existing WhatsApp block (line ~135).
- Meta template payload shape (exact): `{"messaging_product":"whatsapp","to":"<digits>","type":"template","template":{"name":<name>,"language":{"code":<lang>},"components":[...]}}`. Header image component: `{"type":"header","parameters":[{"type":"image","image":{"link":<url>}}]}`. Body component: `{"type":"body","parameters":[{"type":"text","text":<str>}, ...]}`.
- Guards: `ScreenshotJob.delivered_to_chat_at` (milestone, already exists) and `WhatsAppLink.welcomed_at` (new) are stamped only after a successful send.
- Caption / template copy (verbatim):
  - milestone caption: `📸 {booking} on {screen} just hit its {milestone} milestone. Here's the proof shot, captured {HH:MM DD Mon} IST. Open the CMS for the full report.` — `{milestone}` ∈ `start|mid|end`; time via `app.core.timezone.to_local(record.captured_at).strftime("%H:%M %d %b")`.
  - welcome text: `👋 Welcome to Mark AI CMS on WhatsApp, {name}. This number is now linked to your account — milestone proof shots and alerts arrive here, and you can message me anything you'd ask the co-pilot. Try: _what's playing on my screens right now?_` — `{name}` = email local part (before `@`).

---

### Task 1: Migration + models + config

**Files:**
- Create: `alembic/versions/0050_whatsapp_milestone_welcome.py`
- Modify: `app/cms_users/models.py` (CmsUser), `app/whatsapp/models.py` (WhatsAppLink), `app/core/config.py` (WhatsApp block)
- Test: `tests/test_whatsapp_models.py` (append)

**Interfaces (produces):** `CmsUser.whatsapp_milestones: bool` (default True); `WhatsAppLink.welcomed_at: datetime | None`; `settings.WHATSAPP_MILESTONE_TEMPLATE`, `settings.WHATSAPP_WELCOME_TEMPLATE`, `settings.WHATSAPP_TEMPLATE_LANG`.

- [ ] **Step 1: Failing test** — append to `tests/test_whatsapp_models.py`:
```python
async def test_new_columns_have_defaults(db_session, cms_user):
    from app.whatsapp.models import WhatsAppLink
    assert cms_user.whatsapp_milestones is True
    link = WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+919999999999")
    db_session.add(link)
    await db_session.commit()
    await db_session.refresh(link)
    assert link.welcomed_at is None
```
Run: `… -m pytest tests/test_whatsapp_models.py -q -k new_columns` → FAIL (`AttributeError: whatsapp_milestones`).

- [ ] **Step 2: Models.** In `app/cms_users/models.py` after `is_active`:
```python
    # Opt-out for the automatic milestone proof shot on WhatsApp. Default on: the
    # photograph is the point of the feature; an operator who finds it noisy flips it.
    whatsapp_milestones: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=sa.true(), nullable=False
    )
```
(import `sqlalchemy as sa` if not present). In `app/whatsapp/models.py` `WhatsAppLink` after `linked_at`:
```python
    # When the one-time welcome went out for THIS number. Reset on re-link (set_number
    # already clears session/last_message_at when the number changes — clear this too).
    welcomed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
```
In `link_service.set_number`, in the `elif link.phone_e164 != phone:` branch add `link.welcomed_at = None`.

- [ ] **Step 3: Migration** `alembic/versions/0050_whatsapp_milestone_welcome.py` (revision `0050_whatsapp_milestone_welcome`, down_revision `0049_review_flags` — confirm with `poetry run alembic heads` first):
```python
"""whatsapp: milestone opt-out on users, welcomed_at on links"""
from alembic import op
import sqlalchemy as sa

revision = "0050_whatsapp_milestone_welcome"
down_revision = "0049_review_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cms_users", sa.Column(
        "whatsapp_milestones", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("whatsapp_links", sa.Column(
        "welcomed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("whatsapp_links", "welcomed_at")
    op.drop_column("cms_users", "whatsapp_milestones")
```

- [ ] **Step 4: Config.** In the WhatsApp block of `app/core/config.py` add:
```python
    # Business-initiated messages (outside the 24h window) need APPROVED utility
    # templates. Unset → the closed-window path logs and skips.
    WHATSAPP_MILESTONE_TEMPLATE: Optional[str] = "milestone_proof"
    WHATSAPP_WELCOME_TEMPLATE: Optional[str] = "cms_welcome"
    WHATSAPP_TEMPLATE_LANG: str = "en"
```
and the three lines to `.env.example` under the WhatsApp section.

- [ ] **Step 5: Verify** — `-m pytest tests/test_whatsapp_models.py -q` → pass; `-m ruff check` the files; `poetry run alembic upgrade head` against local Postgres (5433) if it is running, then `alembic downgrade -1` and `upgrade head` again.
- [ ] **Step 6: Commit** `feat(whatsapp): milestone opt-out + welcomed_at columns, template config`.

---

### Task 2: `window.py` + template payload in `client.py`

**Files:** Create `app/whatsapp/window.py`; modify `app/whatsapp/client.py:40-100` (`build_payload`); tests `tests/test_whatsapp_window.py` (new), `tests/test_whatsapp_client.py` (append).

**Interfaces (produces):** `window_open(last_message_at: datetime | None, now: datetime | None = None) -> bool`; message kind `{"kind": "template", "name": str, "lang": str, "components": list[dict], "body": str}` (`body` = human-readable copy, stored on the outbound row / dry-run log).

- [ ] **Step 1: Failing tests**
```python
# tests/test_whatsapp_window.py
from datetime import datetime, timedelta, timezone
from app.whatsapp.window import window_open, WINDOW

NOW = datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc)

def test_none_is_closed():
    assert window_open(None, NOW) is False

def test_inside_is_open():
    assert window_open(NOW - timedelta(hours=23, minutes=59), NOW) is True

def test_exactly_24h_is_closed():
    assert window_open(NOW - WINDOW, NOW) is False

def test_naive_datetime_is_treated_as_utc():
    assert window_open(NOW.replace(tzinfo=None) - timedelta(hours=1), NOW) is True
```
Append to `tests/test_whatsapp_client.py`:
```python
def test_template_payload_shape():
    from app.whatsapp.client import build_payload
    msg = {"kind": "template", "name": "milestone_proof", "lang": "en",
           "components": [
               {"type": "header", "parameters": [{"type": "image", "image": {"link": "https://x/y.jpg"}}]},
               {"type": "body", "parameters": [{"type": "text", "text": "A"}]}],
           "body": "ignored by Meta"}
    p = build_payload("+919876543210", msg)
    assert p["type"] == "template"
    assert p["template"] == {"name": "milestone_proof", "language": {"code": "en"},
                             "components": msg["components"]}
    assert p["to"] == "919876543210" and "text" not in p
```
Run both → FAIL.

- [ ] **Step 2: Implement** `app/whatsapp/window.py`:
```python
"""The 24-hour customer-service window.

Meta lets a business send free-form messages only within 24 hours of the
customer's last inbound message; outside it, only an approved template goes
through. Every business-initiated send in this package asks this one question.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

WINDOW = timedelta(hours=24)


def window_open(last_message_at: datetime | None, now: datetime | None = None) -> bool:
    if last_message_at is None:
        return False
    if last_message_at.tzinfo is None:
        last_message_at = last_message_at.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return (now - last_message_at) < WINDOW
```
In `client.build_payload`, before the final text return:
```python
    if kind == "template":
        # Business-initiated (outside the 24h window): only an APPROVED template
        # goes through. `components` is passed verbatim — the caller owns the shape.
        return {
            **base,
            "type": "template",
            "template": {
                "name": message["name"],
                "language": {"code": message.get("lang") or "en"},
                "components": message.get("components") or [],
            },
        }
```
- [ ] **Step 3: Verify** both test files pass; ruff. **Step 4: Commit** `feat(whatsapp): 24h window helper and template send payload`.

---

### Task 3: `notify.py` — welcome + milestone senders

**Files:** Create `app/whatsapp/notify.py`; test `tests/test_whatsapp_notify.py` (new).

**Interfaces (consumes):** Task 1 columns/config, Task 2 `window_open` + template kind, `client.send(db, phone, message, *, cms_user_id, session_id, turn_id)`, `app.core.gcs_service.signed_url_for`, `app.ai.delivery.whatsapp_image_url`, `app.core.timezone.to_local`.
**Produces:** `async send_welcome(db, link: WhatsAppLink, user: CmsUser) -> bool`; `async send_milestone(db, record: ScreenshotRecord, job: ScreenshotJob | None) -> bool`; `WELCOME_TEXT`, `milestone_caption(booking_name, screen_name, milestone, captured_at) -> str`.

- [ ] **Step 1: Failing tests** (`client.send` monkeypatched to capture; DB fixtures from conftest: `db_session`, `cms_user`; build Booking/Screen/MediaAsset/ScreenshotRecord/ScreenshotJob rows the way `tests/test_screenshot_chat_delivery.py` does — copy its helpers):
```python
# tests/test_whatsapp_notify.py
import pytest
from datetime import datetime, timedelta, timezone
from app.whatsapp import notify
from app.whatsapp.models import WhatsAppLink

@pytest.fixture
def sent(monkeypatch):
    calls = []
    async def fake_send(db, phone, message, **kw):
        calls.append((phone, message, kw)); return "wamid.1"
    monkeypatch.setattr(notify.client, "send", fake_send)
    return calls

async def test_welcome_freeform_inside_window(db_session, cms_user, sent):
    link = WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+919999999999",
                        last_message_at=datetime.now(timezone.utc))
    db_session.add(link); await db_session.commit()
    assert await notify.send_welcome(db_session, link, cms_user) is True
    phone, msg, kw = sent[0]
    assert msg["kind"] == "text" and "Welcome to Mark AI CMS" in msg["body"]
    assert kw["cms_user_id"] == cms_user.id
    await db_session.refresh(link); assert link.welcomed_at is not None

async def test_welcome_template_outside_window(db_session, cms_user, sent):
    link = WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+919999999999")
    db_session.add(link); await db_session.commit()
    assert await notify.send_welcome(db_session, link, cms_user) is True
    _, msg, _ = sent[0]
    assert msg["kind"] == "template" and msg["name"] == "cms_welcome"
    assert msg["components"][0]["parameters"][0]["text"] == cms_user.email.split("@")[0]

async def test_welcome_sent_once(db_session, cms_user, sent):
    link = WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+919999999999",
                        welcomed_at=datetime.now(timezone.utc))
    db_session.add(link); await db_session.commit()
    assert await notify.send_welcome(db_session, link, cms_user) is False
    assert sent == []

async def test_welcome_skips_when_template_unset_and_window_closed(db_session, cms_user, sent, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "WHATSAPP_WELCOME_TEMPLATE", None)
    link = WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+919999999999")
    db_session.add(link); await db_session.commit()
    assert await notify.send_welcome(db_session, link, cms_user) is False
    assert sent == [] and link.welcomed_at is None

async def test_welcome_send_failure_is_swallowed(db_session, cms_user, monkeypatch):
    from app.whatsapp.client import WhatsAppSendError
    async def boom(*a, **k): raise WhatsAppSendError("400: nope")
    monkeypatch.setattr(notify.client, "send", boom)
    link = WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+919999999999",
                        last_message_at=datetime.now(timezone.utc))
    db_session.add(link); await db_session.commit()
    assert await notify.send_welcome(db_session, link, cms_user) is False
    assert link.welcomed_at is None

# --- milestone ---
async def _milestone_fixture(db_session, cms_user, *, linked=True, window=True, pref=True):
    """Booking booked_by cms_user on a screen, one milestone_start record + its job."""
    ...  # copy the row-building helpers from tests/test_screenshot_chat_delivery.py

async def test_milestone_image_inside_window(db_session, cms_user, sent):
    record, job = await _milestone_fixture(db_session, cms_user)
    assert await notify.send_milestone(db_session, record, job) is True
    phone, msg, kw = sent[0]
    assert msg["kind"] == "image" and msg["link"]
    assert "just hit its start milestone" in msg["caption"]
    assert msg["media_ref"] == {"url": record.cloudinary_url, "screenshot_record_id": record.id}
    await db_session.refresh(job); assert job.delivered_to_chat_at is not None

async def test_milestone_template_outside_window(db_session, cms_user, sent):
    record, job = await _milestone_fixture(db_session, cms_user, window=False)
    assert await notify.send_milestone(db_session, record, job) is True
    _, msg, _ = sent[0]
    assert msg["kind"] == "template" and msg["name"] == "milestone_proof"
    header, body = msg["components"]
    assert header["parameters"][0]["image"]["link"]
    assert [p["type"] for p in body["parameters"]] == ["text"] * 4
    assert body["parameters"][2]["text"] == "start"

async def test_milestone_respects_opt_out(db_session, cms_user, sent):
    record, job = await _milestone_fixture(db_session, cms_user, pref=False)
    assert await notify.send_milestone(db_session, record, job) is False and sent == []

async def test_milestone_skips_unlinked_booker(db_session, cms_user, sent):
    record, job = await _milestone_fixture(db_session, cms_user, linked=False)
    assert await notify.send_milestone(db_session, record, job) is False and sent == []

async def test_milestone_not_sent_twice(db_session, cms_user, sent):
    record, job = await _milestone_fixture(db_session, cms_user)
    job.delivered_to_chat_at = datetime.now(timezone.utc); await db_session.commit()
    assert await notify.send_milestone(db_session, record, job) is False and sent == []

def test_caption_wording():
    cap = notify.milestone_caption("Zomato", "Cafe MG Road", "mid",
                                   datetime(2026, 8, 19, 6, 30, tzinfo=timezone.utc))
    assert cap == ("📸 Zomato on Cafe MG Road just hit its mid milestone. Here's the proof "
                   "shot, captured 12:00 19 Aug IST. Open the CMS for the full report.")
```
Run → FAIL (`ModuleNotFoundError: app.whatsapp.notify`).

- [ ] **Step 2: Implement** `app/whatsapp/notify.py`:
```python
"""Business-initiated WhatsApp messages: the welcome on first link and the
milestone proof shot.

Everything else this package sends is a reply inside the 24-hour window. These two
are not — a milestone lands days after the operator last wrote, and a number typed
into the CMS never wrote at all — so each picks free-form (window open, free) or an
approved utility template (window closed, paid) via `window.window_open`, and is
best-effort: nothing here may fail the screenshot upload or the link request.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.delivery import whatsapp_image_url
from app.bookings.models import Booking
from app.cms_users.models import CmsUser
from app.core.config import settings
from app.core.gcs_service import signed_url_for
from app.core.timezone import to_local
from app.screens.models import Screen
from app.screenshots.models import ScreenshotJob, ScreenshotRecord
from app.whatsapp import client
from app.whatsapp.client import WhatsAppSendError
from app.whatsapp.models import WhatsAppLink
from app.whatsapp.window import window_open

logger = logging.getLogger(__name__)

WELCOME_TEXT = (
    "👋 Welcome to Mark AI CMS on WhatsApp, {name}. This number is now linked to your "
    "account — milestone proof shots and alerts arrive here, and you can message me "
    "anything you'd ask the co-pilot. Try: _what's playing on my screens right now?_"
)
MILESTONE_CAPTION = (
    "📸 {booking} on {screen} just hit its {milestone} milestone. Here's the proof shot, "
    "captured {when} IST. Open the CMS for the full report."
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _display_name(user: CmsUser) -> str:
    return (user.email or "").split("@", 1)[0] or "there"


def milestone_caption(booking_name: str, screen_name: str, milestone: str, captured_at: datetime) -> str:
    return MILESTONE_CAPTION.format(
        booking=booking_name, screen=screen_name, milestone=milestone,
        when=to_local(captured_at).strftime("%H:%M %d %b"),
    )


def _template(name: str, components: list[dict], body: str) -> dict:
    return {"kind": "template", "name": name, "lang": settings.WHATSAPP_TEMPLATE_LANG,
            "components": components, "body": body}


async def send_welcome(db: AsyncSession, link: WhatsAppLink, user: CmsUser) -> bool:
    """One welcome per linked number. True when a message went out."""
    if link.welcomed_at is not None:
        return False
    text = WELCOME_TEXT.format(name=_display_name(user))
    if window_open(link.last_message_at):
        message = {"kind": "text", "body": text}
    elif settings.WHATSAPP_WELCOME_TEMPLATE:
        message = _template(settings.WHATSAPP_WELCOME_TEMPLATE, [
            {"type": "body", "parameters": [{"type": "text", "text": _display_name(user)}]},
        ], text)
    else:
        logger.info("whatsapp welcome skipped for %s: window closed, no template", link.phone_e164)
        return False
    try:
        await client.send(db, link.phone_e164, message, cms_user_id=user.id)
    except WhatsAppSendError:
        logger.exception("whatsapp welcome failed for %s", link.phone_e164)
        return False
    link.welcomed_at = _now()
    await db.commit()
    return True


async def send_milestone(db: AsyncSession, record: ScreenshotRecord, job: Optional[ScreenshotJob]) -> bool:
    """The proof shot to whoever booked the campaign. True when a message went out."""
    if job is not None and job.delivered_to_chat_at is not None:
        return False
    if not record.shot_type.startswith("milestone_"):
        return False
    booking = (await db.execute(select(Booking).where(Booking.id == record.booking_id))).scalar_one_or_none()
    if booking is None or not booking.booked_by:
        return False
    user = (await db.execute(select(CmsUser).where(CmsUser.id == booking.booked_by))).scalar_one_or_none()
    if user is None or not user.is_active or not user.whatsapp_milestones:
        return False
    link = (await db.execute(select(WhatsAppLink).where(WhatsAppLink.cms_user_id == user.id))).scalar_one_or_none()
    if link is None:
        return False
    screen = (await db.execute(select(Screen).where(Screen.id == record.screen_id))).scalar_one_or_none()
    screen_name = (screen.name if screen is not None and screen.name else "your screen")
    milestone = record.shot_type[len("milestone_"):]
    caption = milestone_caption(booking.name or "Your campaign", screen_name, milestone, record.captured_at)
    url = whatsapp_image_url(signed_url_for(record.cloudinary_url) or record.cloudinary_url)
    media_ref = {"url": record.cloudinary_url, "screenshot_record_id": record.id}
    if window_open(link.last_message_at):
        message = {"kind": "image", "link": url, "caption": caption, "body": caption, "media_ref": media_ref}
    elif settings.WHATSAPP_MILESTONE_TEMPLATE:
        message = _template(settings.WHATSAPP_MILESTONE_TEMPLATE, [
            {"type": "header", "parameters": [{"type": "image", "image": {"link": url}}]},
            {"type": "body", "parameters": [
                {"type": "text", "text": booking.name or "Your campaign"},
                {"type": "text", "text": screen_name},
                {"type": "text", "text": milestone},
                {"type": "text", "text": to_local(record.captured_at).strftime("%H:%M %d %b")},
            ]},
        ], caption)
        message["media_ref"] = media_ref
    else:
        logger.info("whatsapp milestone skipped for booking %s: window closed, no template", booking.id)
        return False
    try:
        await client.send(db, link.phone_e164, message, cms_user_id=user.id)
    except WhatsAppSendError:
        logger.exception("whatsapp milestone send failed for booking %s", booking.id)
        return False
    if job is not None:
        job.delivered_to_chat_at = _now()
    await db.commit()
    return True
```
Check `client.send` copies `message.get("media_ref")` onto the outbound row (it does at `client.py:173-176`); if `signed_url_for` raises on a non-GCS URL, guard with `try/except` → plain URL.

- [ ] **Step 3: Verify** `-m pytest tests/test_whatsapp_notify.py -q` → pass; ruff. Import-cycle check: `-c "import app.main"`. **Step 4: Commit** `feat(whatsapp): notify — welcome on first link, milestone proof shot`.

---

### Task 4: Hook the welcome (bind path + CMS set-number) and the preference API

**Files:** `app/whatsapp/inbound.py:283-290`, `app/whatsapp/router.py` (`set_link_number`, `link_status`, new `PATCH /preferences`), `app/whatsapp/schemas.py` (`LinkStatusResponse.milestone_photos: bool = True`, new `PreferencesRequest`), tests `tests/test_whatsapp_inbound.py`, `tests/test_whatsapp_link.py`.

- [ ] **Step 1: Failing tests** — in `tests/test_whatsapp_inbound.py` add next to the existing linking test: a bind via message sends ONE outbound whose body contains `"Welcome to Mark AI CMS"` and `link.welcomed_at` is set; in `tests/test_whatsapp_link.py` (HTTP `client` fixture): `PUT /api/cms/whatsapp/link` with a phone → `notify.send_welcome` called (monkeypatch `app.whatsapp.router.notify.send_welcome` to record) and response has `milestone_photos: true`; `PATCH /api/cms/whatsapp/preferences {"milestone_photos": false}` → 200, `GET /status` shows false.
- [ ] **Step 2: Implement.** `inbound.py`: replace the `client.send(... LINKED_REPLY ...)` in the bind branch with
```python
        link = await link_service.link_for_user(db, bound.id)   # add this small getter to link_service if absent
        if link is not None:
            await notify.send_welcome(db, link, bound)
```
(`from app.whatsapp import notify`; keep `LINKED_REPLY` constant only if something else uses it — otherwise delete it.) In `router.py` `set_link_number`: after `set_number` → `await notify.send_welcome(db, link, user)` (best-effort; it never raises). Add:
```python
class PreferencesRequest(BaseModel):
    milestone_photos: bool

@cms_router.patch("/preferences", response_model=LinkStatusResponse)
async def set_preferences(payload: PreferencesRequest, user=Depends(get_current_cms_user), db=Depends(get_db)):
    user.whatsapp_milestones = payload.milestone_photos
    await db.commit()
    return await link_status(user=user, db=db)   # or rebuild the response the same way link_status does
```
and `milestone_photos=user.whatsapp_milestones` in every `LinkStatusResponse(...)` construction.
- [ ] **Step 3: Verify** the two test files + `tests/test_whatsapp_notify.py`; ruff. **Step 4: Commit** `feat(whatsapp): welcome on link (message or CMS), milestone-photo preference`.

---

### Task 5: Hook the milestone send into `ingest_screenshot`

**Files:** `app/screenshots/service.py` (~line 1580-1610, the post-commit delivery block), test `tests/test_screenshot_chat_delivery.py` (append).

- [ ] **Step 1: Failing test** — monkeypatch `app.screenshots.service` to capture a call to `notify.send_milestone` (import inside the function → patch `app.whatsapp.notify.send_milestone`); ingest a `milestone_start` frame the way an existing test in that file ingests an on-demand frame → assert called once with the new record and the (now closed) job; ingest an on-demand frame → not called.
- [ ] **Step 2: Implement** — after the existing on-demand delivery block in `ingest_screenshot`:
```python
    if shot_type.startswith("milestone_"):
        # The proof shot to whoever booked it — best-effort, strictly after the
        # commit, same contract as the on-demand delivery above.
        try:
            from app.whatsapp import notify  # local: app.whatsapp imports app.ai

            job = (await db.execute(
                select(ScreenshotJob).where(
                    ScreenshotJob.booking_id == booking_id,
                    ScreenshotJob.screen_id == screen_id,
                    ScreenshotJob.milestone == shot_type[len("milestone_"):],
                ).order_by(ScreenshotJob.created_at.desc())
            )).scalars().first()
            await notify.send_milestone(db, record, job)
        except Exception:  # noqa: BLE001
            logger.exception("Could not WhatsApp milestone %s for booking %s", shot_type, booking_id)
            await db.rollback()
```
- [ ] **Step 3: Verify** `tests/test_screenshot_chat_delivery.py tests/test_whatsapp_notify.py` pass; ruff; `-c "import app.main"`. **Step 4: Commit** `feat(screenshots): WhatsApp the milestone proof shot to the booker`.

---

### Task 6: CMS toggle + docs

**Files:** `markai-Web-cms/src/lib/api.ts` (`whatsapp.setPreferences`), `src/lib/types.ts` (`WhatsAppStatus.milestone_photos`), `src/components/whatsapp/LinkPanel.tsx` (switch row "Send milestone photos to WhatsApp" under the linked-number block); `docs/superpowers/specs/2026-08-12-whatsapp-copilot-design.md` §19 (template setup — the two templates' exact text + approval steps).

- [ ] Implement the toggle (optimistic update, error toast on failure, disabled while saving); `npm run typecheck`/`npm test`/`npm run build` pass. Commit in the CMS repo: `feat(whatsapp): milestone-photo toggle`. Append §19 to the design doc (umbrella repo, uncommitted per convention).

---

## Self-review
- Spec coverage: milestone (T3/T5), welcome both paths (T3/T4), template/window rule (T2/T3), preference (T1/T4/T6), guards (T3), docs (T6). ✔
- Type consistency: `send_welcome(db, link, user)`, `send_milestone(db, record, job)`, message kinds `text|image|template`, `LinkStatusResponse.milestone_photos` used in T4/T6. ✔
