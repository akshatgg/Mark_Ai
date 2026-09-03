# Manual screens and owner-supplied proof

**Date:** 2026-09-02
**Scope:** Let a superadmin create a screen by hand in the CMS (no player box, no
heartbeat), have it behave as full bookable inventory across the CMS and the
storefront, replace the advertiser's live proof-of-play report with a proof pack
the screenowner uploads and shares, and re-shell the operator console on a
CMS-style sidebar.
**Out of scope:** Any change to the APK ↔ backend contract, to the enrollment-key
registration flow, or to how bookings are scheduled onto a real player.

---

## 0. Already done (not part of the plan)

`markai-backend-new/.env` carried a dead CMS partner key — every call to the CMS
ext API answered `401`, so the storefront's browse-screens page was empty. The
new local key (`mak_396b57867e04e3fc`) is in place and the service restarted;
`GET localhost:8096/api/screens` now returns all 15 CMS screens. The secret lives
only in `.env`, which is gitignored. Previous file kept as `.env.bak.*`.

Unrelated papercut noticed while restarting: `.env` line 76 is
`INVOICE_SELLER_NAME=Mark AI` — unquoted, so it breaks under `zsh` sourcing
(harmless under `dev_start.sh`, which uses bash). Worth quoting in `.env` and
`.env.example`.

---

## 1. What already exists

This matters more than what's missing: most of what was asked for is built. Verified
by reading the code, not assumed.

**The booking approval loop is complete, for connected screens.**

| Step | Where |
|---|---|
| Advertiser books → `approval_status='pending'`, no CMS twin yet | `backend-new/app/bookings/models.py` |
| Screenowner emailed | `backend-new/app/notifications/service.py:66` `notify_screen_owners` |
| Owner decides in their console | `frontend-new/app/console/approvals` |
| Approve → creates the CMS booking, which schedules onto the player | `backend-new/app/approvals/service.py:359` → `cms_client.create_booking` |
| Reject, with a reason | `backend-new/app/approvals/service.py:402` |
| Advertiser sees the live report | `frontend-new/app/dashboard/campaigns/[id]/page.tsx` |
| "Capture now" screenshot | `POST /approvals/{booking_id}/screenshot-request` |

**Superadmin already assigns screens to a screenowner.** `PATCH /api/cms/users/{id}`
with `screen_ids` (replace-set semantics, `app/cms_users/schemas.py:64`, diffed in
`app/cms_users/service.py:160-183`). The enrollment key also auto-assigns on register.

**A screen can never exist without its slot grid.** `register_screen`
(`signage-api/app/screens/service.py:~500`) calls `slots.seed_for_new_screen` in the
same transaction. Any new creation path that reuses it inherits the 9 × 10s loop,
the 09:00–17:00 default hours, and everything downstream.

**What is genuinely missing:** a way to create a screen without a device. There is
no `POST /api/cms/screens`. Screens exist only via `POST /api/screens/register`,
which requires a real `device_uid`.

---

## 2. Decisions taken

Recorded because they shape everything below, and two of them are removals.

1. **A manual screen is full, bookable inventory.** It appears on the public
   storefront, advertisers book slots on it exactly as they do a real screen.
2. **The proof pack applies to every screen, connected or manual.** The advertiser
   is never shown raw telemetry again — only what a screenowner chooses to share.
   The telemetry itself does not disappear: it stays fully visible to the
   **screenowner**, for connected screens, presented the way the CMS presents it.
   See the visibility matrix in §5.
3. **The screenowner uploads and shares directly.** No Mark AI review gate.
4. Manual and player screens are separate populations — a manual screen is not
   later "claimed" by a player box (question deferred; see Open questions).
5. **A manual screen exists for sales reasons.** It lets Mark AI list and sell
   inventory it does not yet run a box on. That is the whole point of the feature,
   and it is why a manual screen must look complete on the storefront (§3) while
   being honest about having no telemetry everywhere an operator looks.

**Accepted consequences, stated plainly:**

- Decision 2 is a **removal**. Today the advertiser's campaign page renders plays,
  seconds, per-day breakdown and milestone screenshots as they happen. After this
  change it renders nothing until the venue shares a pack. The stated reason is
  sound — an honest live feed showing a screen was off makes an advertiser angry
  before anyone can explain — but the advertiser loses live visibility, and a
  campaign with an inattentive screenowner shows the advertiser nothing at all.
  Mitigation: the console nags the owner, and the advertiser page says *why* it
  is empty rather than looking broken.
- Decision 3 means **nothing stands between a venue and a paying customer.**
  Whatever PDF the owner uploads is what the advertiser sees, including a wrong
  or flattering one. The schema below records `created_by_email` and `shared_at` on
  every pack so this is at least auditable after the fact.

---

## 3. Sub-project A — Manual screens

### The one real design decision: `device_uid`

`screens.device_uid` is `String(255) NOT NULL UNIQUE`. A hand-made screen has no
device. Three ways out:

**A1 — Synthetic uid + an `is_manual` flag. ← recommended.**
`device_uid = "manual:<uuid4>"`, plus a new `is_manual BOOLEAN NOT NULL DEFAULT false`
column. Every existing query, join, foreign key and deletion path keeps working
untouched. The flag carries the meaning; the uid just satisfies the constraint.
Register must reject any incoming `device_uid` starting with `manual:`, so a real
device can never collide with or hijack a manual row.

**A2 — Make `device_uid` nullable.** No extra column, but it drops a constraint that
currently protects the register path's idempotency, and every consumer that joins
or looks up by `device_uid` has to learn about NULL. More blast radius for less.

**A3 — A separate `manual_screens` table.** Cleanest separation on paper, but the
storefront, bookings, slots, assignments, reports, deletion and the ext API would
all have to union two tables. Rejected.

Going with **A1**.

### Status

A manual screen never heartbeats, so today's logic would derive `offline` forever —
which on a storefront where it is meant to look bookable reads as a fault. Add a
fifth status, `manual`, short-circuited before any freshness check.

Two sites derive status and both must change:
- `compute_status()` — `signage-api/app/screens/service.py:318` (single screen, Python)
- `_live_status_expr()` — `signage-api/app/screens/service.py:678` (fleet listing, SQL `CASE`)

Plus the places that enumerate the status vocabulary: the counters at
`service.py:757-759`, the filter validation at `:796`, and the list at `:1044-1046`.

### The create form — the superadmin types everything

A manual screen must reach the platform **as complete as a device-registered one**.
On a real screen these fields are filled by the APK (GPS fix, reverse geocode,
`device_info` extract) or by defaults at registration; with no device, the
superadmin supplies each one by hand. `ExtScreen` (`app/api_keys/ext_router.py:63`)
is the authoritative list, because it is exactly what crosses into the platform.

| Field reaching the platform | On a device screen | On a manual screen |
|---|---|---|
| `name` | device model, then renamed | **typed** — required |
| `location` | operator | **typed** — the venue, e.g. "Counter, ground floor" |
| `city` / `address` / `postal_code` | reverse-geocoded from the GPS fix | **typed** — required for the storefront's city filter to work |
| `latitude` / `longitude` | platform `LocationManager` fix | **typed / map pin** — drives proximity ranking |
| `location_is_precise` | derived from `location_source` | **`true`** — set `location_source='manual'`, which the model already treats as precise |
| `location_accuracy_m` | GPS accuracy radius | `null` |
| `resolution` | lifted from `device_info` | **typed / picked** — required in practice (see below) |
| `slot_duration_seconds` | default 10 | **set**, default 10 |
| `total_slots` | seeded to 9 | **set**, default 9 |
| `loop_duration_seconds` | mirror of the slot grid | derived — never typed, it is the SUM of the slots |
| `on_start_minute` / `on_end_minute` | default 09:00–17:00 | **set**, default 09:00–17:00, or "All day" → both null |
| `status` | derived from heartbeat freshness | derived → `manual` |
| `last_seen_at` | every heartbeat | `null`, permanently |

**`resolution` is not optional in practice.** Creative Fit rebuilds every ad to the
target screen's resolution; a screen with a null resolution can't be targeted. The
form should require it (a picker of common panel sizes — 1920×1080, 1080×1920
portrait, 3840×2160 — plus free entry) rather than let a superadmin create dead
inventory.

**Operator-only extras**, not in `ExtScreen` but on the model and worth capturing
for the CMS's own screen page: `model`, `manufacturer`. Optional free text — for a
manual screen they describe the panel, not an Android device.

**Fields the form must hide, not merely leave blank.** They are meaningless without
a device and showing them invites a superadmin to fill in fiction: `tailscale_ip`
(nothing to reach), `public_key` / `pop_seq` / `pop_chain_head` (no signing key, so
no cryptographic proof chain — worth stating out loud, since it means a manual
screen's plays can never carry the tamper evidence a real screen's do),
`device_info`, `app_version_name` / `app_version_code`, `display_on`,
`player_foreground`, and the "Re-scan location" action.

### Changes

**`markai-signage-api`**
- Migration: `screens.is_manual BOOLEAN NOT NULL DEFAULT false`.
- Extract the shared row-creation + slot-seeding out of `register_screen` so the
  manual path and the device path cannot drift apart.
- `POST /api/cms/screens`, `require_superadmin` — the full create form below, plus
  an optional `owner_cms_user_id` that writes the `ScreenAssignment` in the same
  transaction. Mints the `manual:` uid, sets `is_manual=true`, seeds the grid.
- Guard `POST /api/screens/register` against a `manual:`-prefixed `device_uid`.
- `ExtScreen` gains `is_manual`; `status` may now be `"manual"`.

**`markai-Web-cms`** — "Add screen" on `src/app/(dashboard)/screens/page.tsx`
(superadmin only), a create form, and a badge on the screen row/detail so an
operator can tell at a glance that a screen has no player behind it.

**`markai-backend-new`** — passthrough only. `app/screens/service.py` returns the
CMS card unchanged, so `is_manual` and the new status arrive for free once the
CMS emits them. No migration.

**`markai-frontend-new`** — `lib/platform.ts` `Screen.status` union gains `"manual"`;
`components/screens/StatusBadge.tsx` and the browse filter on `app/screens/page.tsx`
get a label that reads as available inventory (e.g. "Partner venue"), never as a
fault. `app/console/screens` shows the owner which of their screens report manually.

### What deliberately does not change

Booking a manual screen goes through the *existing* path end to end: pending →
email → owner approves → `cms_client.create_booking` writes the CMS twin. The twin
is worth creating even with no player: it holds the slot so the screen can't be
oversold, and it keeps one booking model instead of two. Nothing is delivered
because no device ever fetches that screen's schedule. No code needed for this —
it is what already happens.

---

## 4. Sub-project B — folded into C

B was originally "stop showing an advertiser 0 plays on a manual screen". Decision 2
makes it moot: the advertiser stops seeing live telemetry on *every* screen, so
there is no 0 to explain. What survives is one line of work, carried into C: the
CMS and the owner console must mark a manual screen as *telemetry-free*, so the
owner knows proof is on them and so fleet health doesn't count a manual screen's
silence as a fault.

---

## 5. Sub-project C — The proof pack

### Who sees what

The rule, which differs by role *and* by whether the screen has a player behind it:

| | Connected screen | Manual screen |
|---|---|---|
| **Screenowner** (console) | The whole scheduling picture — slot map, campaigns due to play, plays, proof-of-play, screenshots — presented as the CMS presents it | Nothing to show. The same panel is replaced by the upload: "this screen reports manually" |
| **Advertiser** (dashboard) | Only the shared pack | Only the shared pack |
| **Superadmin** | Everything, on both — *and* the advertiser's side of it (§7) | Everything, on both |

So the pack is **optional** on a connected screen (real data exists behind it; the
owner curates from it) and **the only channel** on a manual one. The upload control
is identical in both cases — what changes is what sits beside it.

**The owner-side scheduling view is mostly surfacing data that already crosses the
ext API**, not new backend work:

- `ExtScreenDetail` (`app/api_keys/ext_router.py:198`) already returns `loop_now`
  (the slot map), `total_slots` / `occupied_now` / `free_now`, and
  `active_bookings` — the whole slot picture in one call, by design.
- `GET /ext/bookings/{id}/report` returns the same live-or-frozen report shape the
  CMS renders, and `/ext/bookings/{id}/plays` the raw play log with the hash-chain
  tamper-evidence fields.
- `GET /ext/operators/{cms_user_id}/screens/{screen_id}` (`:836`) already answers
  404 for anything outside that operator's scope, so ownership is enforced in the
  CMS rather than re-implemented in the console.

What the console lacks today is the *rendering*: `app/console/screens/[id]` shows
the screen card and its operating hours, but not the loop lineup or proof-of-play.
`components/console/ScheduleSummary.tsx` is about a booking *request*, not the
screen's live loop, so it is not the component to extend.

On a manual screen every one of those reads returns an empty or zeroed shape.
The console must branch on `is_manual` and say so plainly, rather than render an
empty slot map that looks like a fault.

### Model

Lives in `markai-backend-new` (the advertiser and the booking live there; the CMS
never needs to own these files). Migration `0007`.

**`proof_packs`** — one per booking.
`id`, `booking_id` (FK → `bookings`, cascade), `note` (owner's covering text),
`status` (`draft` | `shared`), `shared_at`, `created_at`, `created_by_email`,
`created_by_role`.

**`proof_pack_files`** — many per pack.
`id`, `pack_id` (FK, cascade), `kind` (`proof_of_play` | `report` | `screenshot`),
`object_name`, `filename`, `content_type`, `size_bytes`, `created_at`.

A pack, not loose documents: the owner assembles proof-of-play PDF + report PDF +
screenshots, then shares **once**. Sharing is a single irreversible-ish transition
with a timestamp, which is what makes it auditable given decision 3.

### Storage

Reuse `app/core/gcs_service.py` and the pattern already in `app/content` (which
uploads to GCS and hands back a URL). Files are read back through **signed URLs** —
the GCP org policy forbids public buckets. Accept `application/pdf` plus images;
cap size per file and count per pack.

### Endpoints

Owner side — `require_operator`, and the operator must own the booking's screen
(the same check `app/approvals/service.py` already applies):
- `GET /api/approvals/{booking_id}/proof` — the pack, draft or shared
- `POST /api/approvals/{booking_id}/proof/files` — multipart upload
- `DELETE /api/approvals/{booking_id}/proof/files/{file_id}` — while still draft
- `POST /api/approvals/{booking_id}/proof/share` — flip to `shared`, stamp
  `shared_at`, email the advertiser

Advertiser side — `require_user`, must own the booking:
- `GET /api/bookings/{booking_id}/proof` — **shared packs only**; a draft is
  invisible. Returns signed URLs.

### Frontend

**Owner — the scheduling view** (`frontend-new/app/console/screens/[id]`). New, and
the thing the matrix above asks for: on a connected screen, render the slot map and
campaigns due to play from `ExtScreenDetail`, and proof-of-play from the booking
report — the picture the CMS already gives an operator. On a manual screen this
whole region is replaced by a single honest statement and the upload.

**Owner — the uploader** (`frontend-new/app/console/approvals/[id]`) — a
`ProofPackUploader` alongside the existing `OnDemandCapture`: drop PDFs in, see
what's staged, remove a file, then one **Share with advertiser** button with a
confirmation that says this is what the customer will see. Present on both screen
kinds; on a connected screen it sits *beside* the real data the owner is curating
from, on a manual screen it stands alone.

**Advertiser** (`frontend-new/app/dashboard/campaigns/[id]`) — `ReportBody`'s live
report is replaced by the shared pack: the owner's note, the PDFs (inline viewer +
download), the screenshots. Before anything is shared it must explain itself —
"the venue will publish your proof of play here" — not render as an error or an
empty report.

**CMS visibility.** Asked for ("it will automatically go to the CMS so it will see
it also"). No new work: `require_operator` in backend-new authenticates CMS
operators through `/api/ext/auth/verify`, and superadmins already see every screen
in the console. A superadmin therefore reads any pack in `/console` today. A
native view inside `markai-Web-cms` would mean a cross-service read and is
deliberately deferred.

### Email

`app/notifications/service.py` gains `notify_advertiser_proof_shared`, matching the
existing `notify_screen_owners` shape and template directory.

---

## 6. Sub-project D — Console sidebar

The operator console at `/console` is navigated by a floating translucent pill
(`frontend-new/components/console/ConsoleNav.tsx`) carrying four links — Overview,
Approvals, History, Screens — with Revenue, Users, Profile and Sign out buried in an
avatar dropdown. It should be a left sidebar, like the CMS.

### What "like the CMS" means

`markai-Web-cms/src/components/layout/Sidebar.tsx` is the reference. The parts worth
copying are structural, not cosmetic:

- **A fixed left rail**, `w-64` expanded / `w-[72px]` collapsed, with a
  `transition-[width]` that is disabled on first paint so the page doesn't slide on
  load (`animate` prop).
- **Labelled groups** (`Operate` / `Studio` / `Admin`) rather than a flat list; when
  collapsed each group label degrades to a short divider rule.
- **A collapse toggle** in the header beside the brand (`PanelLeftOpen` /
  `PanelLeftClose`).
- **An animated active pill** — `LayoutGroup` + `NavActivePill`, with `navId`
  isolating the desktop rail from the mobile drawer so the two don't fight over one
  shared layout animation.
- **Longest-prefix active matching** (`isActive`), so `/console/approvals/history`
  lights up *History* only, not History *and* Approvals. The console needs this
  today: `/console/approvals/[id]` must credit Approvals, and the current nav's
  `pathname === href` equality means a detail page currently lights up nothing.
- **Per-row role gating** via a `visible(user)` predicate on each item, instead of
  `user.role === "superadmin"` conditionals scattered through the markup.

### What it must NOT copy

The two apps have different design systems. The CMS speaks `--bg-subtle`,
`border-line`, `text-fg-muted`, `bg-panel-raised`, `text-accent`, `font-display`;
frontend-new speaks `bg-surface`, `border-nav-edge`, `bg-panel`, `bg-panel-strong`,
`text-muted`, `text-faint`, `bg-cta-gradient`, `shadow-nav-pill`. Port the
*structure* and re-skin it in frontend-new's own tokens — pasting CMS classes onto
the console's dark glass surface would render as unstyled or alien.

### Proposed groups

| Group | Rows |
|---|---|
| Operate | Overview, Approvals *(pending badge)*, History, Screens |
| Money | Revenue (`/console/earnings`) |
| Admin | Users (`/console/users`, superadmin only) |
| Footer | Avatar + name + role label, Profile, Sign out |

Revenue, Users and Profile are promoted out of the avatar dropdown — a sidebar has
room, and hiding a whole revenue page behind an avatar is the reason it is easy to
miss today. The **pending count stays a badge on Approvals**: it is the only thing
in the console that changes on its own, so it stays the only thing that draws the
eye.

### Carry over, don't lose

`app/console/layout.tsx` already owns the role gate and the pending count, including
the `markai:approvals-changed` window event pages fire after a decision. That logic
is unchanged — only its rendering moves. The layout goes from a centred column with
`pt-[104px]` pill clearance to a flex row: rail + `<main>`. The mobile drawer stays
(the rail collapses to a hamburger below `lg`).

### One bug to fix on the way, not port

`ConsoleNav.tsx` renders **"Users" twice** — the `user.role === "superadmin"` block
appears two times in the desktop `AccountMenu` and again two times in the mobile
dropdown, both linking `/console/users`. A superadmin currently sees a duplicated
row in both menus. The rewrite should collapse it to one, which the `visible(user)`
predicate does for free.

---

## 7. Sub-project E — Advertiser dashboard and superadmin reach

### What the advertiser dashboard is for

Commercial and lifecycle state, not telemetry: payment/invoice, past bookings,
approval status, completed status. Proof arrives only when a screenowner shares a
pack (§5). Most of this is built.

| Thing | Status |
|---|---|
| Campaign list with status filters — `pending_approval`, `rejected`, active, `completed` | exists (`app/dashboard/campaigns/page.tsx:25-31`) |
| Campaign detail | exists |
| Invoice detail | exists (`app/dashboard/invoices/[paymentId]/page.tsx`) |
| `GET /api/payments` + `listPayments()` client | exists (`app/payments/router.py:110`, `lib/platform.ts:575`) |
| **Invoice / billing index** | **missing** |

`app/dashboard/invoices/` holds only `[paymentId]/`, so **`/dashboard/invoices`
404s**. The only route to an invoice today is a link from one campaign's detail
page (`campaigns/[id]/page.tsx:330`) — a customer with five paid campaigns has no
page listing what they have paid. The API and the client both exist already; this
is one page, not a feature.

The campaign detail page's proof region is replaced by the shared pack under §5.
Nothing else on the advertiser side changes.

### Superadmin sees both sides

Asked for: a superadmin sees everything, advertiser side and screenowner side.
This is **not** a permission tweak — the two are different identities:

- An advertiser holds a token with `role: "advertiser"`, subject = a row in the
  platform's `users` table.
- An operator (screenowner or superadmin) holds a token minted by
  `create_operator_token(cms_user_id, email, role)` (`app/core/security.py:47`),
  subject = a **CMS** user id. There is no platform `users` row behind it.

So `require_user` rejects a superadmin outright today. Two ways to grant the reach:

**E1 — A read-only admin surface under `/console`. ← recommended.**
New superadmin-only console pages that read across advertisers (all campaigns, all
payments/invoices, any campaign's detail). They take an operator token and query
without a `user_id` filter. The advertiser endpoints stay strictly self-scoped and
are never touched.

**E2 — Accept operator tokens on the existing advertiser endpoints**, letting a
superadmin bypass the `user_id` filter in place. Fewer new pages, but every
advertiser endpoint then has to correctly distinguish "my data" from "any data",
and a single missed filter leaks one paying customer's campaigns or invoices to
another. The blast radius of one mistake is a billing-data breach between
customers.

Going with **E1**: the reach is worth having, the risk of getting it wrong on the
advertiser endpoints is not. Superadmin reach is **read-only** — a superadmin
inspects an advertiser's campaigns and invoices; they do not act as that
advertiser.

### What "everything" actually means

The ask: a superadmin sees every screen (manual and connected), every report,
everything an advertiser sees, every scheduling detail, all uploaded content and
who uploaded it, which campaign was decided by which screenowner, and an activity
trail — i.e. the same omniscience they have in the CMS. Item by item, against
what exists:

| # | What a superadmin must see | State |
|---|---|---|
| 1 | Every screen, manual and connected | **exists** — `console_screens` calls `cms_client.list_screens()`, the whole fleet; the CMS scopes screenowners and lets superadmins through |
| 2 | Every report / proof-of-play | data exists over ext; the *rendering* is the console work in §5 |
| 3 | Everything the advertiser sees (campaigns, invoices) | **new** — the E1 pages above |
| 4 | Every scheduling detail — which slot, which loop, whose campaign | data exists (`ExtScreenDetail.loop_now` + `active_bookings`); rendering is §5 |
| 5 | All content, and who uploaded it | attribution **exists in the data** (`media_assets.user_id`, plus `cms_media_id` mirroring it into the CMS); no cross-user view — **new page** |
| 6 | Which campaign was decided by which screenowner | **exists** — `bookings.decided_by_email` / `decided_by_role` / `decided_at` |
| 7 | Activity trail — who did what, when | **partly exists**; see below |

### Activity: half of it is already built, in the CMS

`booking_events` (`signage-api/app/bookings/models.py:232`) is an append-only
who/what/when record per campaign, deliberately written **in the same transaction
as the change it describes** — its docstring makes the argument that a log which
can disagree with reality is worse than no log. That is exactly the discipline an
activity feed needs, and it already runs.

Two gaps:

1. **It is not reachable from the platform.** It is served at
   `GET /api/cms/bookings/{id}/events` (CMS JWT) and has no `/api/ext` equivalent.
   Fix: add `GET /ext/bookings/{booking_id}/events` and render it in the superadmin
   campaign view. Cheap — an existing trail, exposed.
2. **Nothing outside campaigns has a trail at all.** Platform-side actions —
   an approval decided, a proof pack shared, content uploaded, a payment captured —
   are `logger.info` lines (e.g. `approvals/service.py:395`), not rows. A log line
   in Cloud Run is not an activity feed.

**Recommendation: do not try to unify the two into one table.** They live in
different databases owned by different services; a single log would mean one
service writing into the other's schema, and would break the same-transaction
guarantee that makes `booking_events` trustworthy. Instead: add a platform-side
`activity_events` table in backend-new following exactly the same rules
(append-only, same transaction as the action, actor email + role snapshotted),
and **merge the two streams in the UI** at read time. Two honest logs presented as
one feed beats one log that lies about half the system.

Scope note: this is the largest single item in §7 and the least like the rest of
the plan. It is a reasonable candidate to split into its own spec once A, C and D
land, rather than to build alongside them.

### Known gap this section depends on

`RAZORPAY_WEBHOOK_SECRET` is blank in `.env`, and `/payments/webhook` refuses every
delivery without it ("without a configured webhook secret every delivery is
refused"). That webhook is the reconciliation backstop: if a customer pays and
closes the tab before the browser callback reaches `/payments/verify`, nothing
else confirms the payment. Worth closing **before** the invoice index makes
payment history a customer-visible page, because an unreconciled payment then
shows up as a missing invoice to the person who paid.

(Unrelated but noted: the live Razorpay secret has been pasted into a chat
transcript twice now, as `.env`'s own comment warns. Rotate it in the Razorpay
dashboard. The test keys in use locally are fine.)

---

## 7b. Sub-project F — Platform-native screenowners (partner agents)

### Why

A manual screen is **partner inventory**: another agent's screen, which Mark AI
lists and sells. That partner will not connect anything to our CMS. But they must
still decide bookings — a booking lands, they approve or decline it, then they play
the ad on their own system by hand.

Today that is impossible. Every operator on this platform is a CMS user:
`Operator` is a frozen dataclass documented as *"Not a row in this database"*,
`require_operator` does **no** database lookup, the JWT `sub` is prefixed `cms:`,
login goes to the CMS's `/auth/verify` (`app/users/router.py:85-90` →
`cms/client.py:240`), and `resolve_scope` re-asks the CMS for the operator's
screens at decision time. Giving a partner an account therefore means giving them
a CMS identity — exactly what they do not want and we should not hand out.

### What

A **second operator source**, native to the platform, that never touches the CMS.

**`platform_operators`** — `id`, `email` (unique, lower-cased), `password_hash`,
`role` (fixed `screenowner`), `is_active`, `created_at`, `created_by_email`.

**`platform_screen_assignments`** — `id`, `operator_id` (FK, cascade), `screen_id`
(the CMS screen id, no FK — that table is another service's), `created_at`, unique
on `(operator_id, screen_id)`.

**Token**: `sub` prefix `plat:` beside the existing `cms:`. `Operator` gains a
`source` field (`"cms" | "platform"`); `operator_from_payload` accepts both.

**Login**: `login_operator` tries the CMS first, then the local table. A CMS
identity always wins, so an email existing in both can never be ambiguous.

**Scope**: `resolve_scope` branches on `source` — a CMS operator resolves against
the CMS as it does today; a platform operator resolves against
`platform_screen_assignments`, with no CMS call at all.

### The invariant that makes this safe

**A platform-native operator may only ever be assigned screens with
`is_manual = true`, and can never be a superadmin.**

`role` is fixed at `screenowner` in the column default and re-checked when the
token is minted, so `require_superadmin` can never admit one — that closes
`/api/admin/*` (every other advertiser's campaigns, payments and content) to a
partner. The manual-only assignment rule is what makes "they will not access our
CMS data" true by construction rather than by care: a manual screen has no player,
no proof-of-play, no device profile and no CMS-native campaigns, so there is
nothing of another operator's for them to reach. Enforce it at assignment time by
reading the screen's `is_manual` from the CMS screen card, and refuse otherwise.

### Superadmin surface

Create a partner account (email + invite), list them, deactivate, assign and
unassign manual screens. The invite is a set-password link reusing the existing
`password_reset_tokens` machinery rather than a second token system — and it means
**Mark AI never sets or sees the partner's password.**

### What does NOT change

The approval flow, the emails and the proof pack are all keyed on "the operator who
owns this screen" and do not care which table that operator came from. Once
`resolve_scope` answers for a platform operator, a partner gets the booking email,
the approvals queue, approve/decline with a reason, and the proof-pack uploader,
with no further work. That is the whole point of putting the seam at `resolve_scope`.

### Notification gap this also closes

`notify_screen_owners` (`app/notifications/service.py:66-90`) returns early when a
screen has no owner — logging *"no owner to notify… superadmins only"* and sending
nothing. A manual screen created without an owner therefore notifies **nobody**,
which silently breaks the partner flow's one requirement ("tell me a booking came").
Assigning a platform operator fixes it for real screens; a superadmin backstop email
for genuinely unowned screens should be added regardless, narrowly for the
no-owner case only — not a blanket superadmin notification, which is the noise the
current exclusion deliberately avoids.

---

## 8. Order of work

1. **D** — the console sidebar. Independent of everything else, and it goes first
   because C adds pages to this console; re-shelling afterwards would mean building
   the proof-pack screens twice.
2. **A** — manual screens. Self-contained, ships value immediately (superadmin can
   add inventory, assign it, and it appears on the storefront through the ext key).
3. **C** — the proof pack, backend first (model → storage → endpoints), then owner
   console, then the advertiser page last, since that step is the removal and
   should land only once there is something to replace the report with.
4. **E** — the invoice index (small, independent, ships on its own) and then the
   superadmin read-only surface, which is easiest to build once D's sidebar exists
   to hang it off.

A, C and D are independent of one another; C does not need A. Only the D-before-C
ordering is a real constraint, and it is about avoiding rework, not correctness.

---

## 9. Risks

- **The advertiser page goes quiet.** The riskiest single change in this plan.
  Ship it last, and consider a grace behaviour: if nothing is shared and the
  campaign has ended, the page should say who to chase, not just stay blank.
- **`compute_status` and `_live_status_expr` must agree.** They are two
  implementations of one rule in different languages; the fleet list and the
  screen detail will disagree if only one learns `manual`. Test both.
- **Reserved-prefix guard.** If register is not hardened against `manual:`, a
  crafted `device_uid` could bind a real device onto manual inventory.
- Migration `0007` in backend-new is additive; migration in signage-api adds a
  defaulted column. Note the known drift: `alembic check` on signage-api already
  fails with pre-existing diffs, so a clean check is not the gate here.

---

## 10. Open questions

- **A player is later installed at a manual venue.** Answered "not applicable for
  now", but it will happen. Under A1 the cheap answer exists: a superadmin action
  that rebinds a manual row's `device_uid` to a real device and clears `is_manual`,
  preserving name, location, slots, hours and booking history. Not in this plan.
- **Does a manual screen belong in fleet health / uptime dashboards?** Proposal:
  counted as inventory, excluded from uptime maths.
- **Verification.** Per project convention, no pytest run here — verified by
  import/syntax checks plus manual exercise against the local stack; the user runs
  the test suites.
