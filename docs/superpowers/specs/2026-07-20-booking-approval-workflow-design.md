# Booking approval workflow — screenowner / superadmin gate (design)

Date: 2026-07-20 · Repos touched: `markai-signage-api`, `markai-backend-new`,
`markai-frontend-new`, `markai-Web-cms`.
Branch everywhere: `feature/booking-approval`, cut from `main`.

## What we're building

Today an advertiser booking made on the Mark AI platform goes live immediately.
We add a human gate: the booking becomes a **request** that the screen's owner —
or any superadmin — must approve before it reaches the CMS.

Rejected requests never reach the CMS at all.

```
advertiser books on markai-frontend-new
        │
        ▼
markai-backend-new: bookings row
        approval_status = pending
        cms_booking_id  = NULL          ← the CMS knows nothing yet
        │
   approve │ reject
        │      └──► approval_status = rejected. CMS never called. Done.
        ▼
cms_client.create_booking()  ──►  markai-signage-api  POST /api/ext/bookings
        │                              status = "active" (unchanged behaviour)
        ▼
   cms_booking_id stored, approval_status = approved
   → screen.schedule_updated_at bumped → APK reloads on next heartbeat (≤60s)
```

### Why the pending state lives in the platform DB

`create_booking` in `markai-signage-api/app/bookings/service.py:491` sets
`status="active"` unconditionally, and `OPERATOR_STATUSES` has no pending value.
Introducing one would change CMS behaviour, which is explicitly out of scope
(decision below). Holding the request in `markai-backend-new` also delivers the
literal requirement — *if approved, push to the CMS; otherwise not* — since a
rejected request leaves no CMS row, no media reference and no audit noise.

## Decisions (all confirmed with the user)

1. **Approvals live on the Mark AI platform only.** The CMS gets no approvals UI.
2. **Either approver is sufficient.** A screenowner *or* any superadmin can decide.
   First decision wins; there is no two-party approval.
3. **Superadmin's queue is unfiltered** — every pending request, on every screen.
   Screenowners see only requests whose `screen_id` is assigned to them. A screen
   with no owner is therefore not a gap: its requests appear in the superadmin
   queue like any other. No request can be orphaned.
4. **CMS-originated bookings stay instant.** A superadmin booking inside
   `markai-Web-cms` goes live exactly as it does today. The gate applies only to
   bookings raised on the Mark AI platform.
5. **No expiry.** A pending request stays pending indefinitely. Approving one whose
   `start_at` has passed simply runs it for whatever remains of its window.
6. **No notifications.** No email, no push, no inbox. Owners are expected to check
   the platform every day or two, and are phoned if they don't. A badge count in
   the platform navbar is the only signal. (`cms_users` has no email column and we
   are deliberately not adding one.)
7. **Screenowners get an approvals console only** on the platform — no browsing,
   no booking wizard, no content library. They are supply side, not advertisers.
8. **Build for newly created users only.** Production data is wiped before launch,
   so no backfill, no data migration of existing sample rows.
9. **CMS operators are identified by email, not username** — one credential that
   works in both the CMS and the platform (section 0). The seeded superadmin login
   changes accordingly.
10. **A checkbox, not the identifier's shape, chooses the auth system** — because
    once operators have emails, one address can exist in both systems.

## 0) CMS operators are identified by email

Today a `CmsUser` has a `username` and no email at all
(`markai-signage-api/app/cms_users/models.py:37`). Operators need to sign into the
Mark AI platform with the same credential the superadmin issued them, and an email
is the identifier that platform already speaks. So **`username` becomes `email`**
across the CMS: one credential, one identifier, everywhere.

- `cms_users.username` → `cms_users.email`, `String(320)`, unique, indexed
  (migration `0032`, a straight rename — production is wiped before launch, so no
  backfill or dual-read period is needed).
- `POST /api/cms/auth/login` takes `{email, password}`.
- The seeded superadmin becomes `admin@mark-ai.tech` / `Admin@123`
  (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`). **This changes the
  credential used to sign into the CMS today** — a deliberate, accepted cost.
- `markai-Web-cms` asks for an email when creating a screenowner or superadmin,
  and on its own login page. The enrollment key, screen assignment and role
  controls are unchanged.

This also retires the `f"{username}@gmail.com"` placeholder in
`app/gmail/service.py:66` — there is a real address now.

## 1) Identity: how a CMS credential logs into the platform

The two systems hash differently and always will — CMS is **PBKDF2-HMAC-SHA256**
(`markai-signage-api/app/core/passwords.py:13`), platform is **bcrypt**
(`markai-backend-new/app/core/security.py:22`). Hashes can never be copied
between them, so a live verification call is the only correct bridge.

**The person tells us which system to ask, with a checkbox.** Once CMS operators
have emails, the same address can legitimately exist in both systems — a café owner
who also buys ads is one person with two roles — so nothing about the identifier's
*shape* can disambiguate them. An explicit declaration can:

```
/auth   ☐ I'm a screen owner or administrator
        │
   ticked ──► POST /api/auth/login {email, password, as_operator: true}
        │        └──► CMS, live over /api/ext/auth/verify   → screenowner | superadmin
        │
 unticked ──► POST /api/auth/login {email, password}
                 └──► platform `users` table (bcrypt)        → advertiser
```

The checkbox reads **"I'm a screen owner or administrator"**, not "superadmin":
a screenowner who reads the latter leaves it unticked and is told no account
exists, which is the likeliest support call this feature could generate. Which of
the two CMS roles they actually hold comes back from the CMS — they never declare it.

Consequences that fall out of this and are deliberate:

- Advertisers never incur a CMS round-trip on sign-in.
- The email-first `identify` step runs **only** for advertisers. With the box
  ticked the page asks for email and password together and goes straight to
  `login`, because `identify` cannot answer for an operator without a password and
  probing the CMS would leak which operator accounts exist.
- One email may hold both an advertiser account and a CMS account, with different
  passwords. The checkbox decides which one is being used. This is a feature, not
  a collision.

### New CMS endpoint — `POST /api/ext/auth/verify`

In `markai-signage-api/app/api_keys/ext_router.py`, API-key authed via the existing
`require_api_key` dependency.

```
→ { email, password }
← { id, email, role, screen_ids: [...], is_active }
  401 on bad credentials or inactive user
```

Implementation reuses `cms_users.service.authenticate`
(`app/cms_users/service.py:162`, already rejects inactive users) and joins
`screen_assignments` for `screen_ids`. Superadmins return `screen_ids: []` — their
authority comes from `role`, not from assignments.

Brute-force protection reuses the in-memory IP limiter pattern already proven for
enrollment (`app/screens/enrollment_ratelimit.py`): 10 failures per 60s per IP.

**No migration. No change to any existing endpoint.**

### New CMS endpoint — `GET /api/ext/operators/{cms_user_id}/scope`

```
← { id, email, role, screen_ids: [...], is_active }
  404 if unknown, 200 with is_active=false if deactivated
```

Called by the platform on every approvals read and every approve/reject, so
authority is resolved **live** rather than frozen into the JWT at login. This is
what makes re-enrollment and deactivation take effect immediately:

- Owner deactivated → loses their queue at once; requests remain in the superadmin queue.
- Screen re-enrolled to a different owner → the new owner picks the request up,
  the old one loses it.

Approvals are a low-traffic console, so the extra call is not a concern.

### Platform JWT

`create_access_token` gains `role`, and operator tokens carry the CMS `email`.
Two principal shapes share one token format:

| principal | `sub` | `role` |
|---|---|---|
| advertiser | platform user uuid | `advertiser` |
| CMS operator | `cms:<cms_user_id>` | `screenowner` \| `superadmin` |

`get_current_user` keeps loading a platform `User` row and so now **rejects
operators outright** — which is exactly what enforces decision 7: every existing
booking, content and solutions endpoint refuses an operator with no extra code.
A new `require_operator` dependency guards the approvals routes.

## 2) `markai-backend-new`

### Migration `0004_booking_approval`

On `bookings`:
- `cms_booking_id` → **nullable** (it is populated only on approval)
- `approval_status` str(16) not null default `pending` — `pending` \| `approved` \| `rejected`
- `decided_by_cms_user_id` str(36) null, `decided_by_email` str(320) null,
  `decided_by_role` str(32) null, `decided_at` timestamptz null
- `reject_reason` text null
- index on `(approval_status, screen_id)` — the query behind both queues

### Booking creation changes

`app/bookings/service.py` no longer calls the CMS at create time. It persists the
row with `approval_status="pending"`, `cms_booking_id=NULL`,
`status_cache="pending_approval"`.

**Operating-hours validation moves earlier.** Today the CMS returns 422 when a
booking falls outside a screen's `on_start_minute`/`on_end_minute`. Deferring the
CMS call to approval time would hide that error until an owner acts, days later.
So the platform validates against the live screen (already fetched and TTL-cached
by `app/screens/service.py`) at request time and rejects immediately, preserving
today's user experience. The CMS 422 remains the backstop at approval time.

### `/api/approvals`

| Route | Behaviour |
|---|---|
| `GET /api/approvals?status=pending` | Scope resolved live. superadmin → all; screenowner → `screen_id IN screen_ids`. Enriched with screen name and advertiser name. |
| `GET /api/approvals/count` | Badge count, same scoping. |
| `POST /api/approvals/{id}/approve` | Creates the CMS booking, then finalises. |
| `POST /api/approvals/{id}/reject` | `{ reason? }`. CMS is never called. |
| `GET /api/approvals?status=approved\|rejected` | Backs the history page, same scoping. |
| `GET /api/console/screens` | Operator screen list. Distinct from `/api/screens`, which re-scopes bookings to the signed-in *advertiser* (`app/screens/service.py:39-77`); operators need owner-scoped truth instead — screenowner sees their assigned screens, superadmin sees the fleet. |
| `GET /api/console/overview` | The overview page's counters in one call, so the landing page is a single round-trip. |

### Approve: ordering and race safety

Both an owner and a superadmin may click Approve at the same moment. The
transaction is:

1. `SELECT … FOR UPDATE` the booking row; 409 if `approval_status != "pending"`.
2. Re-resolve the operator's scope from the CMS; 403 if they don't own the screen
   and aren't superadmin.
3. Call `cms_client.create_booking(...)` — the same call the platform makes today,
   preserving the existing `external_ref` attribution contract
   (`user_id`, `name`, `order_id` = our booking uuid).
4. On success: store `cms_booking_id`, set `approved` + decider fields, commit.
5. On CMS failure: roll back. The request **stays pending** and the CMS error is
   surfaced verbatim (so an operating-hours 422 reads correctly). Nothing is lost.

The row lock is held across the CMS call. That is acceptable here — the CMS client
has a 30s timeout, approvals are rare, and unlike an optimistic `approving` claim
state it cannot strand a row if the process dies, because the lock dies with the
connection. The second approver simply gets "already decided".

Approve is effectively idempotent: `cms_booking_id` is written in the same
transaction that flips the status, so a booking can never be created twice.

## 3) `markai-frontend-new`

### Auth and shell

- **`lib/auth.ts`** — `login(email, password, asOperator)`; session stores `role`.
  `useAuth()` exposes it.
- **`components/auth/AuthCard.tsx`** — a checkbox, **"I'm a screen owner or
  administrator"**, sits under the email field on the first step. Ticked, the card
  shows email + password together and calls `login` directly, skipping `identify`
  and hiding the Google button (a CMS credential has nothing to do with Google).
  Unticked, the existing email-first advertiser flow is untouched. Post-login
  routing: operator → `/console`, advertiser → `/` (unchanged).
- **`app/console/layout.tsx`** — the operator shell, which does not exist today
  (there is no `app/dashboard/layout.tsx` either; the four advertiser pages each
  re-import Navbar/Backdrop/Footer). Operators get their own route namespace rather
  than being bolted onto the advertiser `/dashboard`, because decision 7 means the
  two audiences share no pages at all. The shell owns role-gating, the persistent
  sidebar, and one mounted 3D backdrop for the whole section.
- **Route guards** — an operator landing on `/screens/*` or `/dashboard/*` is
  redirected to `/console`; an advertiser hitting `/console/*` is redirected to
  `/dashboard`.
- **Advertiser side** — `/dashboard/campaigns` renders the new `pending_approval`
  and `rejected` states, showing the reject reason when present.

### The operator console — a real dashboard, not one list

Four pages, all built from data the ext API already exposes (`list_screens`,
`get_screen_detail`, `get_booking_report`), plus the new approvals routes.

| Route | Who | What |
|---|---|---|
| `/console` | both | Overview. Pending count, screens online/offline/off-hours, decisions made this week, an activity strip of recent decisions, and the two or three oldest waiting requests pulled forward with a direct Approve action. |
| `/console/approvals` | both | The queue. Primary page. |
| `/console/approvals/history` | both | Decided requests — approved and rejected, with decider, timestamp and reason. Filterable by screen and outcome. |
| `/console/screens` | both | Screenowner: my screens. Superadmin: all screens. Live status pulse, now playing, today's occupancy, operating-hours chip, slot/loop maths. |

Superadmin sees the same four pages with the scope filter removed, plus an owner
column on requests and screens so they can tell whose screen is whose. No separate
superadmin build.

### Visual direction

Reuse the established identity rather than inventing a second one: `app/theme.css`
tokens, glass panels over the dark ground, `bg-cta-gradient` (`--grad2` blue→teal)
for primary actions, Playfair display headings, Montserrat body, framer-motion
reveals — the same language as the landing page, `/auth` and the booking wizard.

3D, used with restraint and in service of the content:

- **One `three.js` backdrop mounted once in `app/console/layout.tsx`** — a slow,
  dark, depth-of-field field of screen planes drifting in space, theme-aware, in the
  spirit of `lib/three/CityScene` but far lighter and not scroll-driven. Mounting it
  in the layout means it persists across navigation instead of re-initialising on
  every page, which is both smoother and cheaper.
- **Approval cards as physical objects** — each request card renders the screen as a
  true-aspect 3D-tilted panel showing the actual creative, so an owner sees what will
  play on their screen before deciding. This is the one place the 3D is doing real
  work rather than decoration.
- **Depth through layering, not weight** — glass elevation, soft inner glow on the
  focused card, gradient hairline borders. Motion is short and eased; cards settle
  rather than bounce.
- **Approve/Reject are physical and irreversible-feeling** — approve animates the
  card away toward the screen panel and the count decrements; reject collapses it.
  Both are optimistic with rollback on server error.
- **Respects `prefers-reduced-motion`** — the 3D backdrop drops to a static gradient
  and card transitions become fades.

Empty and error states get first-class treatment, because a healthy queue is empty
most of the time. "Nothing waiting" is a designed state with the owner's screens
shown live beneath it, not a grey line of text.

## Error handling

- CMS unreachable during login → 502, "sign-in is momentarily unavailable".
  Advertiser login is unaffected, since it never touches the CMS.
- CMS unreachable during approvals read → 502 with a retry affordance; the queue is
  not cached, because showing a stale queue could mean approving something twice.
- CMS rejects the booking at approval (422 operating hours, 404 screen deleted) →
  request stays pending, CMS message shown verbatim to the operator.
- Screen deleted while a request is pending → approval fails with the CMS 404; the
  operator can reject it to clear the queue.
- Operator deactivated in the CMS mid-session → next approvals call returns 403 and
  the frontend signs them out.

## Testing

**`markai-signage-api`** (pytest): email login works end to end (create an operator
with an email, sign into `/api/cms/auth/login` with it); `/api/ext/auth/verify` —
valid credentials return role and `screen_ids`; wrong password 401; inactive user
401; missing API key 401; superadmin returns empty `screen_ids`; rate limiter trips
after 10 failures. `/api/ext/operators/{id}/scope` — reflects assignment changes and
deactivation. The existing suite must keep passing with `username` gone.

**`markai-Web-cms`**: its vitest suite covers pure logic in `src/lib/` only — there
is no component-testing setup, and adding one is out of scope. The gate is the
existing `npm test` plus `npm run build`; the changed login and user-create forms
are verified in the manual walkthrough below.

**`markai-backend-new`** (pytest, mocked `cms_client`): booking create leaves
`pending` and **never calls the CMS**; out-of-hours create 422s at request time;
owner approve calls the CMS once and stores `cms_booking_id`; non-owner screenowner
403; superadmin approve succeeds on any screen; ownerless screen appears in the
superadmin queue; double approve 409; reject never calls the CMS; CMS failure on
approve leaves the row pending; operator JWT rejected by `/api/bookings`.

**Manual end-to-end** against the local stack (8095 + 8096 + 5120 + 3100): sign into
the CMS as `admin@mark-ai.tech` → create screenowner `bs@cafe.com` with screens
assigned → advertiser books that screen → confirm no CMS booking exists → sign into
the platform with the checkbox ticked as `bs@cafe.com` → approve → confirm the CMS
booking appears and the screen reloads within one heartbeat. Repeat with reject and
confirm the CMS stays clean. Also confirm one email can hold both an advertiser and
an operator account, and that the checkbox picks the right one.

## Out of scope

Payments, notifications of any kind, two-party approval, approval of CMS-originated
bookings, editing a request before approving it, bulk approve, and any approvals UI
inside `markai-Web-cms`.
