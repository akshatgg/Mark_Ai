# Gmail ingestion → the Mark AI platform

**Date:** 2026-09-03
**Repos:** `markai-signage-api` (source), `markai-backend-new` + `markai-frontend-new` (target)
**Decision:** Plan B — full copy, chosen after both options were put to the user.
**Status:** implemented and verified 2026-09-03; one manual step outstanding (Google Console redirect URI)

## What is being copied

`markai-signage-api/app/gmail/` — 13 files, 4,761 lines — plus 412 lines of
helper modules it depends on that the target does not have.

| File | Lines | Job |
|---|---|---|
| `service.py` | 1013 | OAuth, refresh, Gmail API, MIME walk, mock inbox |
| `import_service.py` | 740 | draft → screens → bookings pipeline |
| `mail_html.py` | 436 | HTML mail sanitising |
| `validate.py` | 435 | draft validation, issue list |
| `drive.py` | 377 | Drive-link creatives |
| `router.py` | 376 | 14 endpoints |
| `attachments.py` | 352 | attachment staging to GCS |
| `extract.py` | 310 | pydantic-ai / Gemini reads the booking out of the mail |
| `models.py`, `schemas.py`, `draft_state.py`, `mail_text.py`, `__init__.py` | 722 | |

Helpers to port alongside: `screens/resolve.py` (342), `core/images.py` (57),
`content/constants.py` (13).

Frontend: `gmail/page.tsx` (963), `ImportPanel.tsx` (987), `lib/gmail.ts` (202),
`lib/gmail-import.ts` (308) = 2,460 lines, plus ~110 lines of API surface.

Migrations `0040_gmail_credentials`, `0041_gmail_booking_drafts`, re-headed onto
backend-new's alembic chain.

## Why this is a rewrite and not a copy

The user was told this before choosing. Recording it so the diff makes sense
later: the module's data layer is CMS-internal, and the target owns different
tables. Five call sites do not survive a copy.

| `markai-signage-api` | `markai-backend-new` | Action |
|---|---|---|
| `cms_users.deps.get_current_cms_user` | `core.security.require_operator` | swap |
| `cms_users.models.CmsUser` | `core.security.Operator` | swap |
| `cms_users.deps.assert_can_manage_screen` | `approvals.service.resolve_scope` | rewrite the guard |
| `screens.models.Screen` | `screens.models.CmsScreen` | swap — the mirror carries every column the search reads |
| `bookings.service.create_booking(db, payload, booked_by, api_key, actor)` | `(db, user: User, payload, commit)` | **rewrite** — see below |
| `content_service.find_media_by_checksum` / `create_media` | absent; only `upload_media` | **rewrite** |
| `screenshots.service.toggle_screenshot` | module absent | drop, or reach it over ext |
| `core.security.create_oauth_state_token` / `decode_oauth_state_token` | absent; local `create_state_token` carries no subject | port both |
| `core.gcs_service`, `bookings.hours`, `content.schemas`, `bookings.schemas` | present | reuse |

The booking gap is the substantial one. In the CMS an operator creates a booking
directly, `booked_by` naming them. In backend-new `create_booking` takes a
platform advertiser `User` row and mints a CMS twin through
`cms_client`. A Gmail draft is an operator acting on behalf of an advertiser who
may have no platform account at all, so the confirm path has to decide who owns
the resulting booking rather than inherit an answer.

## Decisions taken

- **Home is `/console/gmail`, not the dashboard.** This is operator work —
  reading an advertiser's request mail and turning it into a booking.
  Screenowners get it too, matching the existing permission rule where a
  screenowner is a superadmin scoped to their own screens.
- **Gemini runs in backend-new.** Confirmed with the user, against the standing
  instruction to ask before anything makes real Gemini calls. This adds
  `pydantic-ai-slim[google]`, `GEMINI_API_KEY` and `AI_MODEL` to a backend that
  has no AI today, and makes it a second service billing Gemini.
- **Secrets are copied, not shared.** `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`
  / `GMAIL_REDIRECT_URI` and the `GMAIL_EXTRACT_*` keys move into
  backend-new's `.env` and `.env.example` (names only in the example).

## The step only the user can do

The OAuth client is one client. Copying the id and secret takes seconds; what
gates the feature is the **redirect URI**. `http://localhost:3100/console/gmail`
and the production equivalent must be registered as Authorized redirect URIs on
that client in Google Console project `markai-499512`. Until that is done, the
live path returns `redirect_uri_mismatch` and only the mock inbox works.

## Order of work

1. Helpers: `core/images.py`, `content/constants.py`, `screens/resolve.py`,
   the two OAuth state-token functions.
2. `app/gmail/*` copied, then the swap table above applied.
3. Migrations re-headed; `alembic upgrade head`.
4. `pyproject.toml` + config keys + `.env`.
5. Router mounted at `/api/console/gmail/*`, gated by `require_operator`.
6. Frontend port to `/console/gmail`, CMS UI kit mapped onto frontend-new's.
7. Rail row + ⌘K entry via `NavGroup.extraItems`.

## Verification — what was actually run

No pytest; the user runs tests. What was checked:

- Every ported module imports (`python -c "import app.gmail.<mod>"`).
- App boots: 130 routes, 14 of them `/api/console/gmail/*`.
- `alembic upgrade head` → `440262c6a750`; both tables confirmed present in the
  dev database with 8 and 17 columns.
- `ruff check app/` clean for everything this port touched. Three failures
  remain in the repo (`approvals/service.py`, `bookings/router.py`,
  `users/router.py`) — confirmed pre-existing by stashing.
- Unauthenticated probes of all four top-level endpoints return 401, not 404:
  the routes are mounted and `require_operator` gates them.
- Authenticated smoke test with a locally minted operator token:
  `/status` → `{"connected":false,"configured":true}` (the copied secrets load),
  `/connect` → a real Google consent URL carrying the right client id and the
  new redirect URI, `/drafts` → `[]`.
- Frontend: `tsc --noEmit` clean, `npm run build` exit 0, 28 pages,
  `/console/gmail` at 19.3 kB.

**No live Gemini call was made.** The smoke test deliberately stopped at
`/status`, `/connect` and `/drafts`, none of which touch the extractor. The
first real extraction will happen the first time an operator imports a mail.

## Two things the port changed that the CMS did not have to

**Attachments cannot be rendered by URL.** The CMS points `<img src>` and
`<a href>` straight at its endpoint because it proxies same-origin with a
cookie. This platform authenticates with `Authorization: Bearer`, which an
`<img>` cannot send — ported verbatim, every thumbnail would 401 and render
broken with nothing explaining why. `components/console/gmail/Attachment.tsx`
fetches with the header and hands the DOM an object URL, revoking it on unmount.

**There was no in-page toast.** `FlashToast` queues one message for the *next*
page, which cannot report "couldn't save that change" while you are still on
the form. `components/ui/Toast.tsx` is a provider with the CMS's exact call
shape (`toast(message, variant)`), so the ported components needed no edits.
