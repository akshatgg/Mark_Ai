# WhatsApp multi-number + screenowner milestone routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one CMS account link several WhatsApp numbers (each a full co-pilot peer), and send every milestone proof shot to the screenowner(s) of the screen it played on — all their numbers — instead of to the booker.

**Architecture:** `whatsapp_links` becomes one-row-per-number (drop the unique on `cms_user_id`, keep `phone_e164` unique; each row keeps its own session / 24h window / welcome state). `link_service` gains list semantics (`links_for_user`, add-not-replace `set_number`/`try_bind_hash`, per-phone `unlink`). `notify.send_milestone` resolves recipients through `screen_assignments` → screenowners → all links, builds the image derivative once, sends per number, stamps the job guard on ≥1 success. CMS routes/schemas expose a `numbers` list; the superadmin user-edit path takes `whatsapp_phones: list[str]` with replace semantics; the two CMS panels become list editors.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic (Postgres, SQLite in tests), pytest-asyncio (user runs pytest — Claude only does import/syntax checks), Next.js 15 + React Query + vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-whatsapp-multi-number-screenowner-milestones-design.md`

## Global Constraints

- New config: `WHATSAPP_MAX_NUMBERS_PER_USER: int = 5` in `app/core/config.py`.
- Migration id `0053_whatsapp_multi_number`, `down_revision = "0052_creative_fit_deliver"` (verify the actual revision string in `alembic/versions/0052_creative_fit_deliver.py`).
- The booker (`booking.booked_by`) is NOT a milestone recipient anymore.
- One number → one account stays enforced (`phone_e164` UNIQUE). Cross-account claim via CMS → 409; via deep-link bind → the number moves.
- Backwards-compat fields kept for one release: `LinkStatusResponse.linked/phone_e164/wa_profile_name/linked_at` (= first number), `CmsUserPublic.whatsapp_phone` (= first number), `Create/UpdateUserRequest.whatsapp_phone` (mapped to a one-element list; `""` clears all).
- Never commit unless asked. No Claude Co-Authored-By trailers.
- No pytest runs by Claude — verify with `poetry run python -c "import app.main"` and `poetry run ruff check app tests`; the user runs the test suite.

---

### Task 1: Migration + model + config

**Files:**
- Create: `markai-signage-api/alembic/versions/0053_whatsapp_multi_number.py`
- Modify: `markai-signage-api/app/whatsapp/models.py` (class `WhatsAppLink`)
- Modify: `markai-signage-api/app/core/config.py:169` (after `WHATSAPP_TEMPLATE_LANG`)
- Test: `markai-signage-api/tests/test_whatsapp_models.py`

**Interfaces:**
- Produces: `WhatsAppLink.added_by: str | None`, `WhatsAppLink.label: str | None`; `settings.WHATSAPP_MAX_NUMBERS_PER_USER`.

- [x] **Step 1: Failing test — two links for one user coexist**

```python
# tests/test_whatsapp_models.py (append)
@pytest.mark.asyncio
async def test_one_user_can_hold_two_numbers(db_session, cms_user):
    db_session.add_all([
        WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+911111111111"),
        WhatsAppLink(cms_user_id=cms_user.id, phone_e164="+912222222222", label="Shop"),
    ])
    await db_session.commit()
    rows = (await db_session.execute(
        select(WhatsAppLink).where(WhatsAppLink.cms_user_id == cms_user.id)
    )).scalars().all()
    assert {r.phone_e164 for r in rows} == {"+911111111111", "+912222222222"}
```

- [x] **Step 2: Model change**

In `app/whatsapp/models.py`, `WhatsAppLink.cms_user_id`: remove `unique=True` (keep `index=True`). Add after `wa_profile_name`:

```python
    # Who linked this number — the operator themself or a superadmin on the user
    # page. Informational; never used for authority.
    added_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("cms_users.id", ondelete="SET NULL"), nullable=True
    )
    # Optional free text ("Manager", "Shop phone") so a list of numbers reads.
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
```
Update the module docstring: one operator → many numbers; one number → one operator (the `phone_e164` unique is what stays load-bearing).

- [x] **Step 3: Migration**

```python
"""whatsapp_links: many numbers per operator (drop unique on cms_user_id), add added_by + label."""
from alembic import op
import sqlalchemy as sa

revision = "0053_whatsapp_multi_number"
down_revision = "0052_creative_fit_deliver"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0046 created the column with unique=True → constraint name is the default
    # "whatsapp_links_cms_user_id_key" on Postgres; drop it and keep the index.
    op.drop_constraint("whatsapp_links_cms_user_id_key", "whatsapp_links", type_="unique")
    op.add_column("whatsapp_links", sa.Column("added_by", sa.String(36), nullable=True))
    op.add_column("whatsapp_links", sa.Column("label", sa.String(64), nullable=True))
    op.create_foreign_key(
        "fk_whatsapp_links_added_by", "whatsapp_links", "cms_users",
        ["added_by"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_whatsapp_links_added_by", "whatsapp_links", type_="foreignkey")
    op.drop_column("whatsapp_links", "label")
    op.drop_column("whatsapp_links", "added_by")
    op.create_unique_constraint("whatsapp_links_cms_user_id_key", "whatsapp_links", ["cms_user_id"])
```
Check the original migration that created `whatsapp_links` for the real constraint name (`grep -n "whatsapp_links" alembic/versions/*.py`) and adjust.

- [x] **Step 4: Config** — add `WHATSAPP_MAX_NUMBERS_PER_USER: int = 5` under the template settings.
- [x] **Step 5: Verify** `poetry run python -c "import app.main"`; `poetry run ruff check app`.

---

### Task 2: `link_service` list semantics

**Files:**
- Modify: `markai-signage-api/app/whatsapp/link_service.py`
- Test: `markai-signage-api/tests/test_whatsapp_link.py`

**Interfaces (Produces):**
- `class TooManyNumbers(Exception)`
- `async def links_for_user(db, cms_user_id) -> list[WhatsAppLink]` (ordered `linked_at` asc)
- `async def link_for_user(db, cms_user_id) -> Optional[WhatsAppLink]` — first of the above (compat)
- `async def set_number(db, user, raw_phone, *, label=None, added_by=None) -> WhatsAppLink` — ADD
- `async def try_bind_hash(...)` — ADD a row for the handset
- `async def unlink(db, user, phone=None) -> bool` — one number if given, else all
- `async def unlink_all(db, user) -> int`

- [x] **Step 1: Failing tests**

```python
@pytest.mark.asyncio
async def test_set_number_adds_a_second_number(db_session, cms_user):
    a = await link_service.set_number(db_session, cms_user, "+911111111111")
    b = await link_service.set_number(db_session, cms_user, "+912222222222", label="Shop")
    links = await link_service.links_for_user(db_session, cms_user.id)
    assert [l.phone_e164 for l in links] == [a.phone_e164, b.phone_e164]
    assert links[1].label == "Shop"

@pytest.mark.asyncio
async def test_set_number_same_number_is_noop(db_session, cms_user):
    a = await link_service.set_number(db_session, cms_user, "+911111111111")
    a.last_message_at = datetime.now(timezone.utc); await db_session.commit()
    again = await link_service.set_number(db_session, cms_user, "+91 11111 11111")
    assert again.id == a.id and again.last_message_at is not None
    assert len(await link_service.links_for_user(db_session, cms_user.id)) == 1

@pytest.mark.asyncio
async def test_set_number_respects_cap(db_session, cms_user, monkeypatch):
    monkeypatch.setattr(link_service.settings, "WHATSAPP_MAX_NUMBERS_PER_USER", 2)
    await link_service.set_number(db_session, cms_user, "+911111111111")
    await link_service.set_number(db_session, cms_user, "+912222222222")
    with pytest.raises(link_service.TooManyNumbers):
        await link_service.set_number(db_session, cms_user, "+913333333333")

@pytest.mark.asyncio
async def test_bind_appends_and_keeps_existing(db_session, cms_user):
    await link_service.set_number(db_session, cms_user, "+911111111111")
    deep_link, _ = await link_service.mint_link_token(db_session, cms_user)
    raw = deep_link.split("account%3A%20")[-1].split("&")[0]
    assert await link_service.try_bind(db_session, PHONE, f"Link my Mark AI account: {raw}")
    phones = {l.phone_e164 for l in await link_service.links_for_user(db_session, cms_user.id)}
    assert phones == {"+911111111111", PHONE}

@pytest.mark.asyncio
async def test_unlink_one_number_leaves_the_rest(db_session, cms_user):
    await link_service.set_number(db_session, cms_user, "+911111111111")
    await link_service.set_number(db_session, cms_user, "+912222222222")
    assert await link_service.unlink(db_session, cms_user, "+911111111111")
    phones = [l.phone_e164 for l in await link_service.links_for_user(db_session, cms_user.id)]
    assert phones == ["+912222222222"]
```
Keep the existing `PhoneInUse` cross-account test — still 409 via CMS. Delete/adjust any existing test asserting "set_number replaces the old number" or "bind replaces".

- [x] **Step 2: Implement** — rewrite `set_number`, `try_bind_hash` (remove the `existing`-replace block; just ensure the phone isn't on another account → move it; then `db.add(WhatsAppLink(cms_user_id=user.id, phone_e164=..., wa_profile_name=..., added_by=user.id))` if the user doesn't already have that phone, else touch `wa_profile_name`), `links_for_user`, `link_for_user`, `unlink`, `unlink_all`. Cap check: `len(links_for_user) >= settings.WHATSAPP_MAX_NUMBERS_PER_USER` → `TooManyNumbers(f"This account already has {n} WhatsApp numbers. Remove one first.")`. Update the module docstring (the "no type-your-number path" paragraph is already stale — fix).
- [x] **Step 3: Verify** imports + ruff.

---

### Task 3: All `WhatsAppLink` consumers stop assuming one row

**Files:**
- Modify: `app/whatsapp/inbound.py:282` — replace `link_for_user(db, bound.id)` with `link_for_phone`: select by `phone_e164 == phone` (the row that was just bound).
- Modify: `app/whatsapp/router.py:139-155` (`link_status`), `:172-200` (`set_link_number`), `:217-222` (`delete_link`), `:301-330` (`_simulated_phone`).
- Modify: `app/whatsapp/schemas.py` — add `LinkedNumber`, extend `LinkStatusResponse`, `SetNumberRequest.label`.
- Modify: `app/review/service.py:684-691` — `_link_for_user` → `.order_by(WhatsAppLink.linked_at).limit(1)` + `.scalars().first()` (first/oldest number; multi-number review view is out of scope).
- Modify: `app/cms_users/service.py:47-75` `whatsapp_phones_for` → `dict[str, list[str]]`; `to_public` gains `whatsapp_phones`; callers at `:135`, `:262`.
- Modify: `app/cms_users/schemas.py` — `CmsUserPublic.whatsapp_phones: List[str]`; `CreateUserRequest/UpdateUserRequest.whatsapp_phones: Optional[List[str]]` (keep `whatsapp_phone`).
- Modify: `app/cms_users/service.py:283-315` `_apply_whatsapp_phone` → `_apply_whatsapp_phones(db, user, phones: Optional[List[str]], legacy: Optional[str], actor)`.
- Test: `tests/test_whatsapp_link.py` (router), `tests/test_cms.py` or new `tests/test_cms_users_whatsapp.py`.

**Schemas:**
```python
class LinkedNumber(BaseModel):
    phone_e164: str
    wa_profile_name: Optional[str] = None
    label: Optional[str] = None
    linked_at: Optional[datetime] = None
    welcomed: bool = False
    added_by: Optional[str] = None

class LinkStatusResponse(BaseModel):
    linked: bool                       # = len(numbers) > 0
    phone_e164: Optional[str] = None   # first number (compat)
    wa_profile_name: Optional[str] = None
    linked_at: Optional[datetime] = None
    numbers: list[LinkedNumber] = Field(default_factory=list)
    max_numbers: int = 5
    configured: bool
    business_number: Optional[str] = None
    milestone_photos: bool = True

class SetNumberRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=24)
    label: Optional[str] = Field(default=None, max_length=64)
```
Router: a helper `async def _status(db, user) -> LinkStatusResponse` built from `links_for_user`; `PUT /link` → `set_number(..., label, added_by=user.id)` → `send_welcome` → `_status`; new `DELETE /link/{phone}` → `unlink(db, user, phone)` (404 if not theirs); `DELETE /link` → `unlink_all`. `TooManyNumbers` → 422. `_simulated_phone`: if the caller has links, accept any of *their* phones (default first); else as today.

`_apply_whatsapp_phones` replace-diff:
```python
async def _apply_whatsapp_phones(db, user, phones, legacy, actor):
    if phones is None:
        if legacy is None: return
        phones = [] if not legacy.strip() else [legacy]
    from app.whatsapp import link_service
    wanted = []
    for p in phones:
        try: n = link_service.normalize_phone(p)
        except Exception: n = ""
        if n and n not in wanted: wanted.append(n)
    current = {l.phone_e164: l for l in await link_service.links_for_user(db, user.id)}
    for phone in list(current):
        if phone not in wanted:
            await link_service.unlink(db, user, phone)
    for raw in wanted:
        if raw in current: continue
        try:
            link = await link_service.set_number(db, user, raw, added_by=actor.id)
        except link_service.InvalidPhone as exc: raise HTTPException(422, str(exc))
        except link_service.PhoneInUse as exc: raise HTTPException(409, str(exc))
        except link_service.TooManyNumbers as exc: raise HTTPException(422, str(exc))
        from app.whatsapp import notify
        await notify.send_welcome(db, link, user)
```
Tests: `PATCH /api/cms/users/{id}` with `whatsapp_phones: [a, b]` → `GET` shows both; then `[b]` → only b; legacy `whatsapp_phone: ""` clears all.

- [x] Verify imports + ruff.

---

### Task 4: `notify.send_milestone` → screenowners × all numbers

**Files:**
- Modify: `app/whatsapp/notify.py:169-260`
- Test: `tests/test_whatsapp_notify.py` — rework `_milestone_fixture` to take `owners: list[tuple[CmsUser, list[phone]]]` and assign the screen to them; booker is `cms_user` (superadmin) and may or may not be linked.

**New recipient query:**
```python
owners = (await db.execute(
    select(CmsUser)
    .join(ScreenAssignment, ScreenAssignment.cms_user_id == CmsUser.id)
    .where(
        ScreenAssignment.screen_id == record.screen_id,
        CmsUser.is_active.is_(True),
        CmsUser.whatsapp_milestones.is_(True),
    )
)).scalars().all()
recipients: list[tuple[CmsUser, WhatsAppLink]] = []
seen: set[str] = set()
for owner in owners:
    for link in await link_service.links_for_user(db, owner.id):
        if link.phone_e164 not in seen:
            seen.add(link.phone_e164); recipients.append((owner, link))
if not recipients:
    logger.info("whatsapp milestone skipped for booking %s: no linked screenowner on screen %s", ...)
    return False
```
Then: caption once; `url = None` lazily (`_whatsapp_image_url(record)` on first need); loop — per link choose free-form vs template (template unset + window closed → log + continue); `client.send` in try/except; `sent += 1`. After the loop: `if sent == 0: return False`; stamp + commit; return True.

Tests (replace the booker-based ones): owner with 2 numbers → 2 sends, booker linked gets 0; two owners → union; owner opt-out skipped; inactive owner skipped; no owner → False, stamp unset; mixed windows → one image + one template; all fail → stamp None; one ok → stamp set; derivative built once (count `_whatsapp_image_url` calls).

- [x] Verify imports + ruff.

---

### Task 5: CMS — types, api, LinkPanel, AccountPanel, users page

**Files:**
- Modify: `markai-Web-cms/src/lib/types.ts` — `WhatsAppLinkedNumber`, `WhatsAppStatus.numbers/max_numbers`, `CmsUser.whatsapp_phones: string[]`, `CreateUserPayload/UpdateUserPayload.whatsapp_phones?: string[]`.
- Modify: `markai-Web-cms/src/lib/api.ts:1143-1185` — `setNumber(phone, label?)`, `deleteNumber(phone)` → `DELETE /cms/whatsapp/link/${encodeURIComponent(phone)}`, keep `deleteLink()`.
- Modify: `markai-Web-cms/src/components/whatsapp/LinkPanel.tsx` — `RegisteredNumber` → `NumbersList` (one row per number: formatted phone, label, profile name, since; per-row Remove with inline confirm); the add form always available below the list until `numbers.length >= max_numbers`; label input optional; milestone toggle once at the account level with copy "Send each campaign's start, mid and end proof shot for **your screens** to every number here." Menu row summary: `1 number` / `N numbers`.
- Modify: `markai-Web-cms/src/components/users/AccountPanel.tsx:190-230, 380-440` — list of current numbers with remove (× per row) + add field; save sends `whatsapp_phones: [...]` (replace). 
- Modify: `markai-Web-cms/src/app/(dashboard)/users/page.tsx:130,241,320` — create form sends `whatsapp_phones: [x]` when given; table cell shows first number + `+N`.
- Test: `markai-Web-cms/src/lib/whatsapp.test.ts` — add `summarizeNumbers(numbers)` helper test if a helper is introduced.

- [x] `npm run lint && npm run build && npm test` in `markai-Web-cms`.

---

### Task 6: Docs

- Modify: `markai-signage-api/app/whatsapp/__init__.py` docstring (many numbers per operator).
- Modify: root `CLAUDE.md` → in the WhatsApp bullets (if present) note: milestone photos go to the screen's owner(s), all numbers; an account may link up to 5 numbers.

---

## Self-review
- Spec §3 → Task 1; §4 link_service → Task 2; §4 consumers/router/schemas/cms_users → Task 3; §5 → Task 4; §4 CMS → Task 5; §8 tests spread across tasks. No placeholders; names consistent (`links_for_user`, `set_number(label=, added_by=)`, `unlink(user, phone)`, `unlink_all`, `TooManyNumbers`, `whatsapp_phones`, `LinkedNumber`, `numbers`, `max_numbers`).
