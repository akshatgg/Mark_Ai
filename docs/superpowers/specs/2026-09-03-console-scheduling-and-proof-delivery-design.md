# Console chrome, scheduling, and proof delivery — combined plan

Date: 2026-09-03
Repos touched: `markai-frontend-new`, `markai-backend-new`, `markai-signage-api`

## 0. Two words I had to interpret

Both came through a voice transcript. If either reading is wrong, the section
built on it is wrong:

- **"shift holding"** → **slot holding**. For a manual screen we show which slot
  of the loop the campaign occupies, not a live schedule.
- **"chatouline"** → **Timeline**. Rename the Approvals *History* page to
  *Timeline*.

## 1. What is already built (scope is much smaller than it looks)

Before planning new work, the honest inventory. `app/console/approvals/[id]`
already renders, today:

| Piece | Component |
|---|---|
| Milestone tiles (Start / Mid / End, captured·pending·missed) | `MilestoneTile` |
| Raw play log | `PlayLog` |
| Per-day delivery chart | `PerDayChart` |
| Capture now | `OnDemandCapture` |
| Schedule summary | `ScheduleSummary` |
| Frozen billing record | `FinalRecord` |
| Proof pack upload + share | `ProofPackUploader` |

And on the backend, `proof.service.share_pack` **already emails the advertiser**
on the first share, via `notifications.notify_advertiser_proof_shared`.

So the CMS-parity campaign UI exists. It is in the wrong place (buried in an
approval, which is a decision that ends) and it has no home for a campaign whose
approval was decided weeks ago. The work is to **promote and extend it**, not to
build it.

## 2. Console chrome — a top bar

**Today:** the platform console has a sidebar only (`SidebarShell`), with the
profile link sitting in `footerItems`. There is no top bar and no search.

**Target** (mirroring `markai-Web-cms/src/components/layout/Topbar.tsx`):

```
┌──────────────────────────────────────────────────────────────────────┐
│ [logo] Mark AI          ⌘K  Search or ask…            ☀  (AC) Profile ▾│
│        Signage Control  ⟨⟩                                            │
└──────────────────────────────────────────────────────────────────────┘
```

- **Left** — logo, wordmark + subtitle, rail collapse toggle. The collapse
  control moves out of the rail into the bar, as the CMS does it.
- **Centre** — command bar trigger. Port `CommandBar.tsx` (213 lines) from the
  CMS; it is self-contained and already keyboard-driven.
- **Right** — theme toggle, then an avatar + name dropdown holding Profile and
  Sign out.
- **Profile leaves the sidebar.** Remove it from `ConsoleNav.footerItems`; the
  dropdown becomes its only home, so there is one place to sign out instead of
  two.
- The dropdown must **not** be a DOM descendant of a `backdrop-blur` header —
  the CMS hit exactly this and documented it: blur makes the header the
  containing block for `position: fixed`, which pins any nested dialog to the
  header. Portal it, or hold the dialog state above the header.

Applies to the **console** shell. The advertiser dashboard keeps its own shell;
the marketing site keeps the floating navbar, unchanged.

**Rename:** `/console/approvals/history`, labelled "History" in `ConsoleNav`,
becomes **Timeline**. Route path changes with it, with a redirect from the old
one so existing links survive.

## 3. Scheduling — a new section, two different pages behind it

New nav item **Scheduling** (`/console/scheduling`), between Approvals and
Screens. A schedule is created automatically the moment an approval is approved
— the operator never assembles one by hand.

The list reads `bookings.status_cache` (already synced), so it stays fast and
still renders when the CMS is unreachable. It shows every approved campaign with
its screen, its window, and a **Kind** column: *Connected* or *Manual*.

Clicking a row opens `/console/scheduling/[id]` — an in-app route, not a browser
tab, so the operator keeps the rail and the URL stays shareable. The page has
two modes, chosen by the screen's kind.

### 3a. Connected screens (CMS) — full parity with the CMS campaign page

Same layout, same cards, same order as `cms.mark-ai.tech/bookings/{id}`. Every
control on that page appears here. Everything is fetched live through
`/api/ext`; nothing operational is stored.

**Header** — back link, campaign name, schedule-type subtitle, status pill, and
the action row: Activity · Rename campaign · Edit schedule · Preview ad.

**Schedule card** — schedule type, status, starts, ends, daily window, days of
week, target plays/day, play duration ("Set by screen (slot duration)"), screen
ID, media ID; the airtime-splitting note; Add an alternate creative · Change ad;
the Change status dropdown; Cancel campaign.

**Today's report** — plays today.

**Play timeline** — day picker, plays that day, which ad played in which hour
(IST) and how many times.

**Screenshot verification** — refresh, the Per-play on/off toggle, the
explanatory copy, and the Start · Midpoint · End milestone tiles with their
captured image, capture time, download button, or the pending-from date.

**On-demand captures** — the capture button with its live gate (it reads
"Outside play hours" when there is no play to photograph), the 24-hour deletion
warning, and the list of captures taken.

#### What ext can drive today, and what it cannot

Mapped against the nine API calls the CMS page actually makes:

| Control | ext route | Status |
|---|---|---|
| Schedule card fields, Preview ad | `GET /ext/bookings/{id}` (carries `media_url`, `media_type`) | ready |
| Change status (active/paused) | `PATCH /ext/bookings/{id}/status` | ready |
| Cancel campaign | `POST /ext/bookings/{id}/cancel` | ready |
| Today's report, milestone tiles + downloads | `GET /ext/bookings/{id}/report` | ready |
| Play timeline | `GET /ext/bookings/{id}/plays` — rows carry `played_at`, so bucket by hour on our side | ready |
| On-demand captures | `GET /ondemand`, `POST /screenshot-request`, `DELETE` | ready |
| Activity | `GET /ext/bookings/{id}/events` | ready |
| Upload a creative | `POST /ext/content/upload-session` + `/commit` | ready |
| **Rename campaign, Edit schedule** | — | **missing** |
| **Per-play screenshot toggle** | — | **missing** |
| **Add alternate / Change ad / Remove / Reorder** | — | **missing** |
| **Download report (PDF)** | — | **missing** |

So roughly three-quarters of the page is buildable against the ext API as it
stands. The rest needs the routes in §7.

### 3b. Manual screens — slot holding, and a schedule we own

A manual screen has no player and no CMS record, so there is nothing live to
fetch. This page shows:

- **Everything we know about the schedule**, in the same Schedule card layout as
  §3a so the two pages read alike: schedule type, starts, ends, daily window,
  days of week, target plays/day, screen, advertiser, campaign status.
- **Which slot of the loop this campaign holds** — the screen's grid
  (`platform_screens.slot_count × slot_duration_seconds`) with the campaign's
  slot marked.
- The proof pack (see §4), because uploading is how a manual screen reports.

**Everything CMS-derived is simply absent** — no Play timeline, no Screenshot
verification, no On-demand captures, no Activity trail, no per-play toggle.
Absent, not disabled and not erroring: there is no player, so there is nothing
to report and nothing to photograph.

**One new piece of data.** Everything else already exists on `bookings` and
`platform_screens`; what is missing is which slot the campaign occupies. Add
`slot_index` to the booking (nullable — null for connected screens, where the
CMS owns slotting). Assigned when a manual booking is approved, editable by the
owner. That is the whole of "create a scheduling thing" for manual screens.

## 4. Proof pack stays in Approvals, and the share emails the advertiser

Per your instruction, the upload stays where it is — in the approval — rather
than moving to Scheduling. The Scheduling page **links to it** rather than
duplicating the uploader, so there is one upload surface, not two.

Three changes to the share:

1. **Show the recipient.** The share confirmation names the advertiser's email
   address, so the operator sees exactly who is about to receive it before
   clicking. Today the UI says only "they are emailed immediately".
2. **Attach the documents.** `core.email_service.send_email` builds a
   `MIMEMultipart("alternative")` with text + html and has **no attachment
   support**. It needs an `attachments` parameter.
3. **Budget the attachments — this cannot be "attach everything".** A pack
   allows 20 files × 25 MB = 500 MB; most inboxes reject above 25 MB. Rule:

   - PDFs attach first (they are the report, and they are small).
   - Screenshots attach in size order until a **10 MB total budget** is spent.
   - Everything past the budget becomes a link in the body.
   - The mail always links to the advertiser's campaign page as well.

   **Why the page link matters:** `PROOF_SIGNED_URL_TTL_MINUTES` is 60. A mail
   whose links are signed URLs is broken an hour after it arrives. The campaign
   page re-signs on every load, so the link in the mail must point at the page,
   never at the blob.

Re-sharing stays a no-op that sends no second mail — that behaviour is already
deliberate and documented in `share_pack`, and the attachment work must not
break it.

## 5. Who owns which fact

The rule the whole design rests on:

| Fact | Owner | Storage |
|---|---|---|
| Play counts, screenshots, activity trail, live schedule state | CMS | **Fetched live, never stored** |
| Advertiser, price, approval decision, `cms_booking_id`, proof pack, `slot_index` | Platform | Our DB |
| What a screen *is* (name, resolution, city) | CMS | Nightly mirror (`cms_screens`) |

**Lists read the cache; detail pages read live.** A 40-row list cannot make 40
CMS calls, and a proof-of-play number must never be a copy — if the CMS later
corrects a count and we render a stored one, we have handed a paying customer a
wrong figure under our name.

**Degrade honestly.** When the CMS is unreachable the tab must say so. A zero
play count caused by a failed fetch is the worst bug this page can ship.

## 6. Permissions

| | Advertiser | Screenowner | Superadmin |
|---|---|---|---|
| Scheduling section | no | own screens | all |
| Proof of play detail | no | own screens | all |
| Capture now | no | own screens (CMS-backed only) | all |
| Proof pack — upload/share | no | own screens | all |
| Proof pack — read | shared only | own screens | all |

Scope is enforced **on our backend** in `resolve_scope`, not by the CMS: our ext
key is one key for the whole platform and carries no operator identity. The
operator-scoped ext routes (which take a `cms_user_id`) are defence in depth, not
the primary control.

Platform-native (`plat:`) operators have no CMS user id, so Capture now is
unavailable to them — correct, since their screens have no player.

## 7. Blockers in the CMS ext API

Five routes are missing. Four of them are the difference between "most of the
CMS page" and "every option on the CMS page"; the fifth decides whether a
superadmin can see campaigns booked in the CMS directly.

1. **`PATCH /ext/bookings/{id}` — rename + edit schedule.** The smallest of the
   five and the highest value: the CMS's `UpdateBookingRequest` already accepts
   name, status and schedule together, and already re-validates the merged
   result exactly as a create would (`normalize_booking_fields` plus the
   operating-hours clamp), and already refuses to reschedule a cancelled or
   completed campaign. Ext exposes only `ExtStatusUpdate`, which is status
   alone. This is exposing an existing service, not writing one.
2. **Creative management — add alternate, change ad, remove, reorder.** Four
   routes over `addBookingCreatives`, `changeBookingCreative`,
   `removeBookingCreative`, `reorderBookingCreatives`. Uploading is already
   possible on ext; only the attach/detach half is missing.
3. **Per-play screenshot toggle.** One route over `toggleScreenshot`.
4. **Report PDF.** `/ext/bookings/{id}/report` returns JSON; the CMS button
   calls a CMS-internal route. Add an ext route that proxies the CMS's own
   generator — a second generator on our side would drift from the CMS's within
   a release.
5. **`_assert_key_owns` blocks CMS-native campaigns.** Every ext campaign read
   only returns campaigns *our key created*. A campaign booked directly in the
   CMS is unreadable by id — deliberately, and documented as such. So
   "superadmin sees everything from our platform" is not achievable today. Fix:
   operator-scoped twins of those reads, scoped by `cms_user_id`, following the
   precedent already set by `/ext/operators/{id}/screens/{id}/detail`.

Items 1–4 are additive routes over services that already exist, so each is small
and none changes CMS behaviour. Item 5 is a new scoping path and deserves its
own review.

## 8. Honesty note on the screenshots

Milestone screenshots are a `PixelCopy` of our own player's buffer. They prove
our software rendered the ad; they can never show a dead panel. The wording on a
page that feeds an advertiser's proof should not imply otherwise. (Separately
still open: the campaign PDF promises milestone screenshots on screens that
cannot produce them.)

## 9. Build order

1. Top bar + CommandBar port + profile out of the sidebar; History → Timeline.
2. Scheduling section: list from `status_cache`, Kind column, both detail modes.
3. `slot_index` migration + manual slot-holding view.
4. Email attachments: `send_email(attachments=…)`, budget rule, recipient shown
   in the share UI, mail links to the page not the blob.
5. The five ext routes (§7) — gated on your decision. Route 1 (rename + edit
   schedule) is worth doing first; it is the smallest and it removes the most
   visible hole in the page.

Steps 1–4 are independent of the CMS and can ship without step 5.

## 10. Decisions needed

- **The five ext routes** — build them, or ship without? Without them the page
  is read-mostly: status, cancel, captures and every report work; rename, edit
  schedule, creative changes, the per-play toggle and the PDF link out to the
  CMS.
- **Attachment budget** — is 10 MB, PDFs-first, the right cut?
- **Timeline** and **slot holding** — confirm both readings from §0.

---

# Appendix A — Binding contracts

Parallel workstreams build against these. **Do not deviate**; if a shape must
change, change it here first and say so.

## A1. New ext routes (`markai-signage-api`)

**REVISED 2026-09-03 after the user's correction:** the platform shows ONLY
campaigns booked through the Mark AI platform. Campaigns booked inside the CMS
must never appear. That removes the hardest and most security-sensitive part of
the original design.

Consequences:

- **`_assert_key_owns` is correct and stays.** Every campaign we display was
  created by our own API key, so the existing key-scoping already admits exactly
  the right set. The operator-scoped `/ext/operators/{id}/bookings/...` prefix
  that this appendix previously specified is **cancelled** — do not build it. No
  new scoping path, no new way to reach another partner's data.
- Reads keep the existing pattern exactly: `require_api_key` + `_assert_key_owns`
  under `/api/ext/bookings/{booking_id}/...`.
- **Mutations additionally carry a human actor.** Use the pattern the on-demand
  routes already establish — `require_operator_verification_key` plus the
  existing `_actor_operator` dependency (the `X-Actor-Id` header) — AND still
  assert the calling key owns the booking. The actor is passed into the existing
  CMS service so the booking activity trail records the human who made the
  change, not "partner key: …". Attribution is a requirement: an edit made from
  the platform must be indistinguishable in the audit trail from one made in the
  CMS.

Routes to add under `/api/ext/bookings/{booking_id}`, each reusing the CMS
internal route's own service and response model verbatim:

| Method | Path | Body | Response | Actor |
|---|---|---|---|---|
| PATCH | `` | `UpdateBookingRequest` | `BookingResponse` | yes |
| GET | `/report.pdf` | — | PDF stream | no |
| GET | `/plays/hourly` | `day` | `BookingHourlyPlaysResponse` | no |
| POST | `/creatives` | `AddCreativesRequest` | `BookingDetailResponse` | yes |
| PATCH | `/creatives/{media_id}` | `ChangeCreativeRequest` | `BookingDetailResponse` | yes |
| DELETE | `/creatives/{media_id}` | — | `BookingDetailResponse` | yes |
| PUT | `/creatives/order` | `ReorderCreativesRequest` | `BookingDetailResponse` | yes |
| POST | `/toggle-screenshot` | `ToggleScreenshotRequest` | `ToggleScreenshotResponse` | yes |

Everything else the page needs already exists on ext today: `GET /bookings/{id}`,
`/report`, `/plays`, `/events`, `/ondemand`, `/screenshot-request`,
`/cancel`, `PATCH /status`.

`confirm: false` on the creative routes keeps its meaning — a 409 carrying the
operator-facing warning, re-sent with `true` once a human has read it. The
platform surfaces that warning; it must never auto-confirm.

## A2. Platform API (`markai-backend-new`)

Mounted at `/api/scheduling`, operator-only (`require_operator`), scope through
`resolve_scope`. Superadmin sees all; screenowner sees their screens only.

```
GET    /api/scheduling                       → { items: [SchedulingRow] }   (status_cache)
       ^ platform-booked campaigns ONLY — see A1. This is automatic: the list
         reads our own `bookings` table, which by construction holds only what
         this platform booked. Never widen it to enumerate CMS campaigns.
GET    /api/scheduling/{id}                  → SchedulingDetail             (live)
PATCH  /api/scheduling/{id}                  → rename + reschedule
POST   /api/scheduling/{id}/status           → { status: active|paused }
POST   /api/scheduling/{id}/cancel
GET    /api/scheduling/{id}/report
GET    /api/scheduling/{id}/report.pdf
GET    /api/scheduling/{id}/plays            → limit, offset
GET    /api/scheduling/{id}/plays/hourly     → day
GET    /api/scheduling/{id}/events           → limit, cursor
POST   /api/scheduling/{id}/toggle-screenshot
GET    /api/scheduling/{id}/ondemand
POST   /api/scheduling/{id}/screenshot-request
DELETE /api/scheduling/{id}/screenshot-request
POST   /api/scheduling/{id}/creatives
PATCH  /api/scheduling/{id}/creatives/{media_id}
DELETE /api/scheduling/{id}/creatives/{media_id}
PUT    /api/scheduling/{id}/creatives/order
PATCH  /api/scheduling/{id}/slot             → { slot_index }   MANUAL ONLY
```

```ts
type SchedulingRow = {
  id: string; name: string;
  screen_id: string; screen_name: string | null;
  screen_kind: "cms" | "platform";        // drives the Kind column AND the detail mode
  status: string; schedule_type: string;
  start_at: string; end_at: string;
  advertiser_email: string | null;
  proof_pack_status: "none" | "draft" | "shared";
};

type SchedulingDetail = SchedulingRow & {
  // Populated for screen_kind === "cms". Null for manual.
  cms: BookingDetailResponse | null;
  // Populated for screen_kind === "platform". Null for CMS screens.
  manual: { slot_index: number | null; slot_count: number; slot_duration_seconds: number } | null;
  // True when the CMS could not be reached. The UI MUST say so rather than
  // rendering zeros — see §5.
  cms_unreachable: boolean;
};
```

Every CMS-backed route returns **503 with a plain-language message** when the
CMS is unreachable. Never a zero, never an empty list.

## A3. File ownership (no two agents touch the same file)

| Stream | Owns |
|---|---|
| A — ext routes | `markai-signage-api/**` only |
| B — platform scheduling | `markai-backend-new`: `app/scheduling/**`, `app/cms/client.py`, `app/bookings/models.py`+`schemas.py`, `migrations/**` |
| C — email | `markai-backend-new`: `app/core/email_service.py`, `app/notifications/**`, `app/proof/**` |
| D — console chrome | `markai-frontend-new`: `components/layout/**`, `components/patterns/**`, `components/console/ConsoleNav.tsx`, `app/console/layout.tsx`, `app/console/approvals/history` → `timeline` |
| E — scheduling UI | `markai-frontend-new`: `app/console/scheduling/**`, `components/console/scheduling/**`, `lib/platform.ts` |

**D owns `ConsoleNav.tsx` outright** — it adds the Scheduling nav item, removes
Profile from the footer, and renames History → Timeline. E must not touch it.
