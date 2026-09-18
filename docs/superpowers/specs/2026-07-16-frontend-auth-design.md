# Unified Auth for markai-frontend-new — Design

**Date:** 2026-07-16
**Repos:** `markai-backend-new` (FastAPI/Postgres, :8096) + `markai-frontend-new` (Next.js 15, :3100)

## Goal

One auth surface for the public Mark AI site. There is **no separate login vs
signup page** — a single page asks for the email first, the system detects
whether the account exists, and the flow branches:

- **Email unknown** → ask first name, last name, new password + confirm → account created, logged in.
- **Email known, has password** → ask password → logged in.
- **Email known, Google-only** (signed up via "Continue with Google", never set
  a password) → tell the user: continue with Google again, *or* use **Forgot
  password** to create a password (they never had one, so "forgot" is the
  set-password path).
- **Continue with Google** button on the first step, always available.

Plus **forgot password** and **reset password** pages, with real email
delivery over SMTP from `no-reply@mark-ai.tech`.

UI must match the landing page's identity: dark 3D scene, Playfair/Montserrat,
the `--grad2` blue→teal CTA language, glass panels, framer-motion steps.

## Decisions

- **Google flow = server-side authorization-code flow.** Frontend never sees a
  client secret (CLAUDE.md rule: secrets are never `NEXT_PUBLIC_*`).
  `GET /api/auth/google/start` redirects to Google's consent screen;
  `GET /api/auth/google/callback` exchanges the code, upserts the user, issues
  our JWT and redirects to `FRONTEND_URL/auth/callback#token=...`.
  The credentials the user supplied (labeled `XIBO_*`, not Google-shaped) are
  stored backend-side as `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; if Google
  rejects them, mint a real OAuth client in GCP project `markai-499512` and
  swap the env values — no code change.
- **Email-first identify endpoint** powers the single-page flow:
  `POST /api/auth/identify {email}` → `{exists, has_password, google_linked}`.
  Deliberate product choice: the page openly says whether an account exists.
- **Password reset doubles as password creation** for Google-only accounts.
  Tokens are single-use, stored hashed (sha256), expire in 30 minutes.
- **SMTP via aiosmtplib**, config-driven (`SMTP_HOST/PORT/USER/PASSWORD`,
  `SMTP_FROM=no-reply@mark-ai.tech`). When SMTP is not configured (local dev)
  the mail — including the reset link — is logged to the backend console so
  the flow is fully testable without creds.
- **Passwords:** bcrypt (the `bcrypt` package directly), min 8 chars.
  `users.password_hash` is nullable — null means Google-only.
- **Session:** backend-issued HS256 JWT (existing `JWT_SECRET` config),
  stored in `localStorage` by the frontend; `GET /api/auth/me` validates.

## Backend (`markai-backend-new`)

New domain `app/users/` mirroring signage-api conventions
(`models.py` / `schemas.py` / `service.py` / `router.py`), plus
`app/core/security.py` (bcrypt + JWT helpers, current-user dependency) and
`app/core/email_service.py` (SMTP send + branded HTML template).

### Tables (migration 0002)

- `users`: `id uuid pk`, `email citext-like unique lowercase`, `first_name`,
  `last_name`, `password_hash nullable`, `google_sub nullable unique`,
  `avatar_url nullable`, `is_active bool`, `created_at`, `updated_at`,
  `last_login_at nullable`.
- `password_reset_tokens`: `id uuid pk`, `user_id fk`, `token_hash unique`,
  `expires_at`, `used_at nullable`, `created_at`.

### Endpoints (`/api/auth`)

| Route | Behaviour |
|---|---|
| `POST /identify` | `{email}` → `{exists, has_password, google_linked, first_name?}` |
| `POST /signup` | `{email, first_name, last_name, password}` → 409 if exists; else create + JWT |
| `POST /login` | `{email, password}` → JWT; **409 `google_account`** if the account is Google-only; 401 bad password; 404 unknown email |
| `GET /google/start` | 302 → Google consent (scope `openid email profile`, `state` CSRF nonce) |
| `GET /google/callback` | code→token→userinfo; upsert user (link `google_sub` to existing email); JWT; 302 → `FRONTEND_URL/auth/callback#token=…` (errors → `…/auth?error=…`) |
| `POST /forgot-password` | `{email}` → always 200; if user exists, create token + send reset mail |
| `POST /reset-password` | `{token, password}` → validate token (unused, unexpired), set hash, mark used |
| `GET /me` | JWT → user profile |

### Config additions

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRONTEND_URL`, `BACKEND_URL`
(builds the redirect URI), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM`, `RESET_TOKEN_TTL_MINUTES=30`.
Deps added: `bcrypt`, `httpx`, `aiosmtplib`, `email-validator`.

### Tests

Pytest (aiosqlite, httpx ASGI client) covering: identify unknown/known/google-only;
signup + duplicate 409; login ok / wrong password / google-only 409;
forgot→reset→login-with-new-password round trip; expired + reused token
rejection; `/me` with and without JWT.

## Frontend (`markai-frontend-new`)

- **`/auth`** — the single page. Full-viewport dedicated three.js scene
  (`lib/three/auth-scene.ts`, theme-aware like CityScene but lightweight and
  not scroll-driven) behind a centered glass card. Steps animate with
  framer-motion: **email → (details | password | google-notice)**. Card
  contains logo, "Continue with Google" (official G mark), divider, email
  input, Continue. Google-only accounts get the exact coaching message and
  two buttons (Google / Forgot password).
- **`/auth/callback`** — reads `#token`, stores it, redirects home.
- **`/forgot-password`** — email → "check your inbox" state (same scene/card).
- **`/reset-password?token=…`** — new password + confirm → success → `/auth`.
- **`lib/auth.ts`** — API client (`NEXT_PUBLIC_API_URL=http://localhost:8096/api`),
  token storage, `useAuth()` hook.
- **Navbar** — "Sign up" pill now links to `/auth`; when logged in it becomes
  the user's first name with a sign-out menu. Mobile dropdown CTA too.

## Out of scope

Email verification on signup, rate limiting, account deletion, profile
editing, refresh tokens, linking the CMS roles — this is the public-site
account system only.
