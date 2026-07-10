# Mark AI — Project Guide (root)

This file orients any Claude session working in this repo. Read it first, then the
`CLAUDE.md` in whichever sub-folder you're touching.

## What Mark AI is
Mark AI is a **DOOH (Digital Out-Of-Home) advertising platform** — advertisers book
ad slots that play on physical Android signage screens in cafés/venues. A partner
called **ScreenOx** owns the physical screens and installs our Android player APK on
them. We control everything from our own backend + CMS (we do **not** integrate with
ScreenOx's own Xibo CMS — that path was explicitly dropped).

### Why we're building this (the two pieces)
- **The APK (`markai-player-apk`)** exists because ads have to actually *play on real
  screens*. ScreenOx owns the physical Android screens and installs our APK on them, so
  the APK is how Mark AI takes control of each screen — it self-registers, pulls the
  booked schedule, plays it fullscreen 24/7, and reports proof-of-play for billing.
- **The CMS (`markai-Web-cms`)** exists because a human needs to *run the business* —
  book ad campaigns onto screens, watch the live fleet, manage users/API keys, and read
  proof-of-play reports. It's Mark AI's own signage control panel.

### Future direction
Today the CMS is a standalone operator dashboard. The plan is to **connect the main Mark
AI product (`markai-frontend`) to this same backend/CMS** so advertiser bookings made on
the public site flow into the same screens / bookings / proof-of-play. Keep
`markai-signage-api` as the single source of truth so that integration stays clean.

The live system has three parts we built and one piece of context:

```
ScreenOx installs our APK on each screen   (their job; their devices)
        │
markai-player-apk  (Kotlin Android player — silent fullscreen, 24/7)
        │  REST only: register · heartbeat · fetch schedule · proof-of-play
        │  (heartbeat carries reload_needed + now_playing + due milestone screenshots)
        ▼
markai-signage-api  (FastAPI + Postgres — the brain / source of truth)
        ▲
markai-Web-cms  (Next.js dashboard — book ads, manage screens/users/API keys, reports)
```

## Folders
| Folder | What it is | Status |
|--------|-----------|--------|
| `markai-signage-api/` | **NEW** FastAPI + Postgres backend. The brain. Serves the APK *and* the CMS. | Active, built & tested |
| `markai-player-apk/` | **NEW** Kotlin Android signage player. Installed on ScreenOx screens. | Active, runs on emulator |
| `markai-Web-cms/` | **NEW** Next.js admin CMS. Connects to `markai-signage-api`. | Active, built & runs |
| `markai-frontend/` | Pre-existing public **marketing website** (Next.js). Source of the brand logo. | Legacy / separate |
| `markai-backend/` | Pre-existing **MongoDB** backend (FastAPI + pymongo). NOT used by the new system. | Legacy / separate |

⚠️ **Do not confuse `markai-backend` (old, Mongo) with `markai-signage-api` (new, Postgres).**
The new signage system is `markai-signage-api` + `markai-player-apk` + `markai-Web-cms`.

## How to run the new system locally
1. **Backend** (needs Docker + Poetry):
   ```bash
   cd markai-signage-api && cp .env.example .env && ./dev_start.sh   # Postgres :5433, API :8000
   ```
   Postgres host port is **5433** (5432 is taken on this machine).
2. **CMS**:
   ```bash
   cd markai-Web-cms && npm install && npm run dev                   # :5120
   ```
   Log in at http://localhost:5120/login with **`superadmin` / `Admin@123`** (seeded).
3. **APK**: open `markai-player-apk` in Android Studio → run on an emulator/device.
   `BASE_URL` defaults to `http://10.0.2.2:8095` (emulator → host).

## The contract that ties it together (don't break shapes)
The APK ↔ backend contract is **REST-only** (the WebSocket was removed — see below):
- `POST /api/screens/register` (idempotent on `device_uid`)
- `POST /api/playback/heartbeat` → returns `reload_needed` + `pending_screenshots[]`
- `GET /api/screens/me/schedule` (returns `schedule_updated_at`)
- `POST /api/playback/proof`

**The heartbeat is the single live channel (no WebSocket).** Any CMS change bumps the
screen's `schedule_updated_at`; the screen echoes its last-known value on each
heartbeat and the backend replies `reload_needed=true` when it's behind (→ the screen
re-fetches the full schedule). Milestone screenshots and `now_playing` also ride the
heartbeat. There is **no** `/ws/screen/...` endpoint, no `play_now`, and no live push —
edits reach the screen within one `HEARTBEAT_INTERVAL_MS` (APK `Constants`, now 60s).
This makes the system stateless/horizontally scalable (no held sockets at fleet scale).

The CMS uses `/api/cms/*` (JWT login). External partners use `/api/ext/*` (API-key headers).

## Key product rules (decided with the user)
- **Self-registration:** each screen makes a permanent unique `device_uid` (UUID +
  ANDROID_ID) and registers itself. We store the **entire** device profile (`device_info` JSON).
- **Location is auto-detected by the APK** (added later) — the player reads a
  coordinate fix via the platform `LocationManager` (GPS/WiFi/cell; works on AOSP boxes
  without Google Play Services) and reverse-geocodes it with Android's built-in `Geocoder`
  (no API key) into address + pin code + city. These ride in the `device_info` map and the
  backend lifts them into `screens.latitude/longitude/address/postal_code/city`
  (migration `0008`). Needs `ACCESS_FINE_LOCATION` (foreground only) granted once at
  install/first-launch (or auto-granted via MDM). The manual `location` field remains as a
  fallback/override. (Earlier this was a manual-only field; a pairing-code flow was declined.)
- **Bookings are fully custom:** the schedule types in code are exactly
  `continuous`, `specific_time`, `times_per_day`, and `custom` (there is **no**
  "hourly" mode). Bookings are advertiser campaigns placed by superadmins.
- **Per-screen operating hours (screen ON window):** every screen has a declared
  daily window (`on_start_minute`/`on_end_minute`, IST minute-of-day; both null =
  24/7), default **09:00–17:00**, set on registration and editable by the superadmin
  (any screen) or the owning screenowner — one at a time or in bulk. Inside the
  window ads play; outside it the screen shows black (the APK gates playback and
  slows its heartbeat to a 15-min edge buffer). Advertisers can only book inside a
  screen's hours (rejected 422 otherwise; a windowless booking inherits the screen's
  hours). A silent screen outside hours reads `off_hours` (calm), not `offline`. We
  do NOT power the panel off — the venue/hardware does that.
- **The loop timing is OWNER-fixed, not client-set (important):** each screen has two
  owner/superadmin fields — `slot_duration_seconds` (how long EVERY ad plays) and
  `loop_duration_seconds` (when the loop restarts). Number of slots = loop ÷ slot. A client
  booking can NOT set play duration; every ad (image *and* video) plays for the screen's slot
  duration and repeats once per loop. (Earlier `min_display_seconds` on bookings was wrong and
  is now ignored.)
- **Roles, no signup:** **superadmin / screenowner** (the old admin/user roles were removed).
  - superadmin: full control; creates more superadmins and screenowners; assigns which
    screens each screenowner may manage; books campaigns; manages API keys. Seeded on startup.
  - screenowner: manages ONLY the screens a superadmin assigned to them (`screen_assignments`).
    They edit those screens' name/location and control each screen's **playback loop**.
- **Per-screen loop:** a screenowner builds an ordered playlist (`loop_items`) for their
  screen — each slot is a media item with a duration (images; videos play full length) and an
  optional daily time-window + days-of-week. The loop is merged into the same player schedule
  as bookings (player contract unchanged), so it plays on the screen and updates live.
- The user prefers **plain-language explanations** and wants things **built then verified**.

## Conventions
- Backend mirrors the `vm-api` project's structure (Poetry, `app.core.*`, per-domain
  `router.py`/`schemas.py`/`service.py`/`models.py`).
- Don't commit/push unless asked. Secrets stay backend-only (never `NEXT_PUBLIC_*`).
