# WhatsApp: many numbers per account + milestone shots to the screen's owner — design

**Date:** 2026-08-19 · **Repos:** `markai-signage-api` (main), `markai-Web-cms` (UI)
**Builds on:** `2026-08-12-whatsapp-copilot-design.md`, `2026-08-19-whatsapp-milestone-and-welcome-design.md`

## 1. What we are building

Two linked changes, decided with the user:

1. **Many WhatsApp numbers per CMS account.** A CMS account (identified by its email) can
   have several handsets linked. Each number still belongs to exactly one account. Every
   linked number is a **full peer**: it receives milestone photos *and* can chat with the
   co-pilot (book, ask status, …) with that account's authority. Numbers can be added/removed
   by the account's own operator (CMS settings or the WhatsApp deep-link) **and** by a
   superadmin on the user-management page.
2. **Milestone photos go to the screen's owner(s), not the booker.** When a booking's
   milestone screenshot (start / mid / end) lands from screen X, the photo is sent to every
   **screenowner assigned to screen X** (`screen_assignments`), on **all** of their linked
   numbers. The booker gets nothing — a superadmin who books on a screenowner's screen is
   not a recipient. If a screen has several assigned screenowners, all of them receive it
   (no new "one owner per screen" rule).

## 2. Approach chosen

**One row per number in `whatsapp_links`** (approach A). Drop the unique constraint on
`cms_user_id`; keep `phone_e164` unique. Each row keeps its own `session_id`,
`last_message_at`, `welcomed_at`, `linked_at` — each handset has its own chat session and
its own 24-hour free-form window (two phones on one account must not share a half-finished
booking draft, and Meta's window is per recipient anyway). Everything that today resolves
`link_for_user(...)` → one row becomes `links_for_user(...)` → list.

Rejected: a separate `whatsapp_numbers` child table under a per-account "link" row. The
per-handset state (session, window, welcome) would simply move into the child table; it
doubles the joins and buys nothing.

## 3. Data model — migration `0053_whatsapp_multi_number`

`whatsapp_links`:
- drop `UNIQUE(cms_user_id)`; keep the plain index on `cms_user_id`.
- `phone_e164` stays `UNIQUE` (one number → one account; what makes an inbound message
  unambiguous).
- add `added_by` `String(36)` nullable FK → `cms_users.id` (`ondelete SET NULL`): who linked
  this number (the operator themself, or a superadmin). Informational.
- add `label` `String(64)` nullable: optional free text ("Manager", "Shop phone").
- no data backfill needed — existing single rows remain valid.

Config: `WHATSAPP_MAX_NUMBERS_PER_USER: int = 5`.

Unchanged: `whatsapp_link_tokens` (a token still binds one new number to the account),
`cms_users.whatsapp_milestones` (account-level opt-out still applies to every number),
`screenshot_jobs.delivered_to_chat_at` (fast-path "already dispatched" guard).

## 4. Components

| Unit | Change |
|---|---|
| `app/whatsapp/models.py` | `WhatsAppLink`: `cms_user_id` no longer `unique=True`; add `added_by`, `label`. Docstring updated (one operator → many numbers; one number → one operator). |
| `app/whatsapp/link_service.py` | `links_for_user(db, user_id) -> list[WhatsAppLink]` (ordered by `linked_at`). `link_for_phone(db, phone)`. `set_number(db, user, phone, *, label=None, added_by=None) -> WhatsAppLink` **adds** a row: no-op returning the existing row if this account already has it; `PhoneInUse` (409) if another account owns it; new `TooManyNumbers` (422) at the cap. `try_bind_hash` **adds** a row for the handset (no longer replaces the account's other numbers; a number bound to a *different* account is still moved, as today). `unlink(db, user, phone) -> bool` removes one; `unlink_all(db, user)` removes every row (used on clear / account delete). `link_for_user` kept as a thin compat shim returning the first row, then removed once callers are migrated (grep: `inbound.py`, `router.py`, `notify.py`, `cms_users/service.py`, `ai/*`). |
| `app/whatsapp/inbound.py` | `resolve_operator(phone)` unchanged in meaning (phone unique → one account). Session/touch logic already operates on the row that matched the phone — verify nothing re-fetches "the" link by `cms_user_id`. |
| `app/whatsapp/notify.py` | `send_welcome(db, link, user)` unchanged (per row). `send_milestone(db, record, job)` re-targets: recipients = active screenowners assigned to `record.screen_id` with `whatsapp_milestones=True`, × all their links. See §5. |
| `app/whatsapp/router.py` | `GET /cms/whatsapp/link` → `numbers: [...]`; `PUT /cms/whatsapp/link {phone, label?}` adds; `DELETE /cms/whatsapp/link/{phone}` removes one; keep `DELETE /cms/whatsapp/link` as "remove all" for compat. `link-token`, `preferences`, `simulate` unchanged (simulate picks the caller's first link, or the `phone` given). |
| `app/whatsapp/schemas.py` | `LinkedNumber {phone_e164, wa_profile_name, label, linked_at, welcomed, added_by}`; `LinkStatusResponse` gains `numbers: list[LinkedNumber]`, `max_numbers`; keeps `linked`/`phone_e164`(= first number) for one release so the current CMS build does not break. `SetNumberRequest` gains optional `label`. |
| `app/cms_users/schemas.py` / `service.py` / `router.py` | `CmsUserPublic.whatsapp_phones: list[str]` (keep `whatsapp_phone` = first, deprecated). `CreateUserRequest`/`UpdateUserRequest`: `whatsapp_phones: Optional[list[str]]` — **replace semantics** (the list is the desired set; missing → untouched; `[]` → clear). `_apply_whatsapp_phones` diffs desired vs current: add missing via `set_number(added_by=actor)`, remove extras via `unlink`. Legacy `whatsapp_phone` string still accepted for one release and mapped to a one-element list. `whatsapp_phones_for` returns `dict[user_id, list[str]]`. |
| `app/screenshots/service.py` | call site unchanged (`notify.send_milestone(db, record, job)`). |
| `markai-Web-cms` `LinkPanel.tsx` | list of numbers with add (number + optional label) / remove; deep-link QR/button appends. Milestone toggle copy: "Send milestone photos of my screens to WhatsApp". |
| `markai-Web-cms` `AccountPanel.tsx` (users/[id]) | the single WhatsApp field becomes a list editor bound to `whatsapp_phones`; shows "added by" when set. |
| `markai-Web-cms` `lib/api.ts`, `lib/types.ts` | new shapes; `deleteNumber(phone)`. |

## 5. Milestone routing flow (`notify.send_milestone`)

1. `job is None` / `job.delivered_to_chat_at` set / not `milestone_*` → return False (unchanged).
2. Load `booking` (for the caption only) and `screen`.
3. **Recipients:** `SELECT cms_users.* FROM screen_assignments JOIN cms_users ON ... WHERE
   screen_id = record.screen_id AND is_active AND role='screenowner' AND whatsapp_milestones`.
   Then `links_for_user` for each. Flatten to a list of `(user, link)`; dedupe on
   `phone_e164`. Empty → log "no linked screenowner for screen …", return False.
4. Build the caption once (booking name, screen name, milestone word, captured IST).
   Build the image derivative (`_whatsapp_image_url`) **once**, lazily, before the first send.
5. For each `(user, link)`: `window_open(link.last_message_at)` → free-form image; else
   template `milestone_proof` (if configured; else log + skip that number). Call
   `client.send(db, link.phone_e164, message, cms_user_id=user.id)` — each send wrapped in
   its own try/except; failures logged per number, never raised.
6. If **at least one** send succeeded: stamp `job.delivered_to_chat_at = now`, commit, return
   True. If all failed: leave the stamp unset, return False (matches today's "one shot,
   best-effort" rule; no per-recipient retry table — out of scope).

The booker is deliberately **not** a recipient. `booking.booked_by` is no longer read for
routing.

## 6. Linking flows

- **Self, CMS:** `PUT /cms/whatsapp/link {phone,label?}` → `set_number(added_by=self)` →
  `send_welcome` for that row.
- **Self, deep-link:** operator taps the link → `try_bind_hash` adds a row for the sending
  handset → welcome (free-form, window open).
- **Superadmin, user page:** `PATCH /cms/users/{id} {whatsapp_phones:[...]}` → diff →
  `set_number(added_by=superadmin)` per added number → `send_welcome` for each new row
  (template path — closed window); `unlink` per removed number.
- **Cap:** `set_number` raises `TooManyNumbers` → 422 "This account already has 5 numbers."
- **Clash:** a number already on another account → 409 (unchanged). The deep-link bind still
  moves the number (the handset itself proved possession).
- **Removal** of a number deletes its row; its session/window state goes with it. Removing the
  last number leaves the account with zero links (co-pilot unreachable, photos skipped).

## 7. Error handling

- All sends best-effort; a failure never fails the upload, the link request, or the user edit.
- `_apply_whatsapp_phones` is transactional with the user edit: a 409/422 on any number
  rolls back the whole edit (same as the single-number behaviour today).
- `send_milestone` logs per-number failures with the Meta body; partial success stamps the
  guard (documented above).

## 8. Testing (tests written by Claude; run by the user — no pytest from Claude)

- `link_service`: `set_number` adds a second number; no-op on re-add; 409 on another account's
  number; 422 at cap; `try_bind_hash` appends and keeps existing numbers; moves a number from
  another account; `unlink(phone)` removes one and leaves the rest; `links_for_user` order.
- `notify.send_milestone`: screen with one screenowner with two numbers → two sends, booker
  (superadmin, linked) gets none; two screenowners → all their numbers; screenowner with
  `whatsapp_milestones=False` skipped; inactive screenowner skipped; screen with no owner →
  no send, no stamp; one number's window open and the other closed → one free-form + one
  template; all sends fail → stamp unset; one succeeds → stamp set; derivative built once.
- `cms_users`: `whatsapp_phones` replace-diff adds/removes; legacy `whatsapp_phone` still works;
  `CmsUserPublic.whatsapp_phones` lists all.
- `router`: `GET /cms/whatsapp/link` lists numbers; `DELETE /cms/whatsapp/link/{phone}`.
- Manual: link two numbers to a screenowner, superadmin books on that screen, fire a
  milestone via the simulate/dev path, both numbers get the photo, the superadmin's own
  number does not.

## 9. Out of scope

- Enforcing one screenowner per screen.
- Per-recipient retry of failed milestone sends.
- Per-number preferences (opt-out stays account-level).
