# Operator (screen owner / administrator) password reset on the marketing frontend

**Date:** 2026-07-27
**Repos touched:** `markai-frontend-new`, `markai-backend-new`, `markai-signage-api`

## Context

The unified marketing/advertiser site (`markai-frontend-new`, port 3100) offers an
operator login: on `/auth` you tick **"I'm a screen owner or administrator"**, and the
credential is sent to the CMS (`markai-signage-api`) rather than the advertiser table —
`backend-new` proxies it via its API-key `/api/ext` surface (`login` with
`as_operator: true` → `cms_client.verify_operator`).

That operator login has **no "Forgot password?"** option. Advertisers on the same page
already have a full forgot/reset flow; operators do not. So an admin or screen owner who
forgets their password has no recovery path from this site.

The CMS already owns everything needed to reset an operator's password — a
production-grade flow with single-use hashed tokens, TTL, session invalidation and a
branded email (`app/cms_users/password_reset.py`, table `cms_password_reset_tokens`,
migration `0034`). The CMS dashboard (`markai-Web-cms`, port 5120) already uses it.

**Goal:** operators can reset their password entirely on `markai-frontend-new` (same look
and feel as the rest of that site), while the backend connects to the CMS exactly the way
operator sign-in already does. No new token machinery, **no database migration** — the
CMS reset table and `token_version` already exist.

## Non-goals

- No change to the advertiser forgot/reset flow.
- No change to the CMS dashboard's own reset flow (`markai-Web-cms`).
- No "change password while logged in" (current → new) endpoint.
- No new database table or column.

## Flow

```
frontend-new /auth  (operator box checked)
  │  "Forgot password?"  → POST /api/auth/forgot-password { email, as_operator:true }
  ▼
backend-new ── cms_client ──▶ CMS  POST /api/ext/operators/password-reset
  │                                 { email, reset_link_base:
  │                                   "http://localhost:3100/reset-password?flow=operator" }
  │                             CMS mails: {frontend}/reset-password?flow=operator&token=…
  ▼
frontend-new /reset-password?flow=operator&token=…   (its own page, same look)
  │  new password  → POST /api/auth/reset-password { token, password, as_operator:true }
  ▼
backend-new ── cms_client ──▶ CMS  POST /api/ext/operators/password-reset/confirm
                                    CMS sets password, bumps token_version
  ◀── no session token (operators sign in again) → frontend redirects to /auth?reset=1
```

All CMS ↔ backend-new traffic stays on the API-key `/api/ext` surface, mirroring the
operator sign-in path. The UI stays entirely on frontend-new; operator identity and
passwords stay in the CMS.

## Changes by repo

### CMS — `markai-signage-api`

**`app/cms_users/password_reset.py`**
- `reset_url_for(raw_token, link_base=None)`: when `link_base` is provided, append the
  token to it choosing the separator by whether it already contains `?`
  (`&token=` vs `?token=`); otherwise unchanged — `{CMS_BASE_URL}/reset-password?token=…`.
  Keep the existing 500-when-`CMS_BASE_URL`-unset guard for the default path only.
- `request_reset(db, email, link_base=None)`: thread `link_base` into `reset_url_for`.
  Everything else (enumeration-safety, strand-older-tokens, TTL, email) is unchanged.

**`app/api_keys/ext_router.py`**
- `ExtOperatorResetRequest`: add `reset_link_base: Optional[str] = None`. Validate it
  starts with `http://` or `https://` (the value comes from an authenticated partner, but
  reject anything that isn't a web URL). Pass it into `request_reset`.
- **New** `POST /api/ext/operators/password-reset/confirm`, guarded by the existing
  `require_operator_verification_key`. Body `{token: str, password: str}` (mirror the CMS
  reset password rules). Calls the existing `cms_password_reset.reset_password(db, token,
  password)` — which consumes the token and bumps `token_version` — and returns
  `{"ok": True}`. The existing `400 "invalid or expired"` propagates unchanged.

No new schema, no migration. Reuses `reset_password` verbatim.

### backend-new — `markai-backend-new`

**`app/cms/client.py`**
- `request_operator_password_reset(email, reset_link_base=None)`: include
  `reset_link_base` in the JSON body when provided.
- **New** `confirm_operator_reset(token, password)` → `POST
  /operators/password-reset/confirm`.

**`app/users/schemas.py`**
- `ForgotPasswordRequest`: add `as_operator: bool = False`.
- `ResetPasswordRequest`: add `as_operator: bool = False`.
- **New** `ResetPasswordResponse` with `signed_in: bool` plus optional session fields
  (`access_token`, `role`, `user`) — advertiser resets return a session, operator resets
  do not. (Keeps `access_token` at top level so the advertiser reset page keeps working.)

**`app/users/service.py` + `app/users/router.py`**
- `forgot_password(db, email, as_operator=False)`: when `as_operator`, call
  `cms_client.request_operator_password_reset(email,
  reset_link_base=f"{settings.FRONTEND_URL}/reset-password?flow=operator")` and return.
  Always 200 (enumeration-safe), matching the advertiser path. Router passes
  `body.as_operator`.
- Reset endpoint: when `body.as_operator`, call `cms_client.confirm_operator_reset(token,
  password)` and return `ResetPasswordResponse(signed_in=False)` — **no session**.
  Advertiser path unchanged (returns a session, still signs the user in).

`settings.FRONTEND_URL` already exists (used by `send_password_reset_email`).

### frontend-new — `markai-frontend-new`

**`lib/auth.ts`**
- `forgotPassword(email, asOperator = false)` and `resetPassword(token, password,
  asOperator = false)`: send `as_operator` in the body.

**`components/auth/AuthCard.tsx`**
- On the operator path (`asOperator` true), add a **"Forgot password?"** link. It uses
  the email currently typed in the form; if the email field is empty, show an inline hint
  to enter the email first. On click, call `forgotPassword(email, true)` and show the
  existing `reset-sent` ("check your email") panel — no new panel.

**`app/reset-password/page.tsx`**
- Read `flow` from the query string. When `flow === "operator"`, call the operator reset
  (`resetPassword(token, password, true)`); on success redirect to `/auth?reset=1` — the
  operator signs in again (no auto-session). The advertiser path (`storeSession` →
  redirect `/`) is unchanged. The existing missing/invalid-token fallback ("request a new
  link") is reused for the operator error case.

## Edge cases (all reuse existing CMS behavior)

- **Enumeration-safe:** unknown email → still 200, no mail. Preserved end-to-end
  (`request_reset` and the backend-new forgot endpoint both already do this).
- **Expired / used / invalid token:** the CMS `reset_password` returns `400 "This reset
  link is invalid or has expired"`; surfaced on the reset page with the existing
  request-a-new-link fallback.
- **Session invalidation:** operator reset bumps `token_version`; every CMS/operator JWT
  carries the version it was minted at, so old sessions are rejected and the user must
  sign in with the new password.
- **No SMTP locally:** the CMS mailer logs the full link (including the token) instead of
  sending when `SMTP_HOST` is unset, so the whole flow is testable with no mail creds.

## Verification (end-to-end, local)

1. Run CMS (`markai-signage-api`), `markai-backend-new` (`:8096`), `markai-frontend-new`
   (`:3100`).
2. On `/auth`, tick "I'm a screen owner or administrator", enter the seeded
   `admin@mark-ai.tech`, click **Forgot password?** → confirm the "check your email"
   panel appears.
3. Read the reset link from the CMS server log (no SMTP locally) — confirm it is
   `http://localhost:3100/reset-password?flow=operator&token=…`.
4. Open the link, set a new password → redirected to `/auth?reset=1`.
5. Sign in as operator with the new password → success. Confirm the old password now
   fails (session invalidation).
6. Submit an unknown email through Forgot password? → same "check your email" panel (no
   enumeration).
7. Confirm advertiser forgot/reset is unaffected (unchecked box still works and
   auto-signs-in on reset).

## Testing

No automated tests for this change (per the user). Verification is via
import/syntax checks (`py_compile` + module import on both backends, `tsc --noEmit`
on the frontend) and the manual end-to-end walkthrough above.
