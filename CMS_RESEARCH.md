# Mark AI — CMS Research & Architecture Decision Log
> Written: June 2026 | Purpose: Reference for future development

---

## What Are We Building?

A **fully owned CMS (Content Management System)** for digital signage screens.

No dependency on ScreenOx API or Xibo API. We build everything ourselves.

Two parts:
1. **Mark AI CMS Web Dashboard** — operators log in here to manage screens, upload content, set schedules
2. **Mark AI CMS APK** — Android app pushed to every ScreenOx screen via ScreenOx CMS

---

## The Problem We Are Solving

ScreenOx boxes (Android media player devices) are plugged into physical screens at venues like cafes, malls, restaurants etc.

Previously we were fetching screen data from ScreenOx/Xibo API. Danish (manager) said to stop that. We now build our own system completely.

---

## How the System Works (Simple Version)

```
Mark AI Cloud Backend
        ↕ WebSocket (permanent connection)
Mark AI CMS APK (installed on ScreenOx Android box)
        ↕ HDMI cable
Physical Screen / TV at venue
```

The ScreenOx box is just Android hardware. Our APK runs on top of it and only talks to our own backend via WebSocket.

---

## How APK Gets to Every Screen

ScreenOx has their own CMS which controls all their screen devices.

```
ScreenOx CMS already has all screens registered:
SOX-001 → XCafe Screen
SOX-002 → ABC Restaurant
SOX-003 → Phoenix Mall

ScreenOx admin uploads Mark AI APK into ScreenOx CMS ONCE
        ↓
ScreenOx CMS automatically pushes APK to ALL screens
        ↓
Every screen installs Mark AI APK automatically
        ↓
Every screen connects to Mark AI backend
        ↓
All screens appear in Mark AI CMS instantly
```

No manual installation. No pairing code. No device token. Fully automatic.

---

## The Common Key — ScreenOx Screen ID

Every screen already has a ScreenOx Screen ID (e.g. SOX-001). This is the permanent identity of each screen in our system.

```
screens table:
screenox_id   → "SOX-001"        ← from ScreenOx, permanent
screen_name   → "XCafe Screen"
operator_id   → "op-456"
status        → "online"
last_heartbeat → timestamp
```

---

## Connection — WebSocket (Decided)

We use **WebSocket** instead of polling every 5 minutes.

```
APK connects to Mark AI backend once:
wss://api.mark-ai.tech/ws/SOX-001
        ↓
Stays connected permanently
        ↓
Operator uploads new ad on CMS
        ↓
Backend instantly pushes to screen:
{ action: "play", content_url: "new_ad.mp4" }
        ↓
Screen plays it immediately
```

**Why WebSocket over polling:**
- Instant content updates — no delay
- Real time online/offline status
- No wasted API calls every 5 minutes
- Cost is almost nothing (each connection uses ~50KB memory)
- 1000 screens = 50MB — negligible for any modern server

**Fallback:** If WebSocket disconnects, APK reconnects automatically and syncs latest playlist.

---

## What the APK Does (Complete List)

1. **Read ScreenOx Screen ID** — reads SOX ID already stored on device on first boot
2. **Register with Mark AI** — POST /api/cms/register with ScreenOx ID (first boot only)
3. **Connect via WebSocket** — wss://api.mark-ai.tech/ws/{screenox_id}
4. **Listen for instructions** — backend pushes content changes instantly
5. **Download content** — saves video/image files locally
6. **Play content fullscreen** — videos (MP4), images (JPG/PNG) in loop
7. **Send heartbeat** — every 60 seconds: online status, CPU, storage
8. **Offline handling** — keeps playing last downloaded content if internet drops

**What APK does NOT have:**
- ❌ No UI for operators — everything controlled from web dashboard
- ❌ No login screen
- ❌ No settings screen
- ❌ No pairing code screen

The APK is a silent background player. No UI. Just plays content and talks to our backend.

---

## Scheduling / Playlist

Operator sets schedule from CMS web dashboard:

```
9am  - 12pm  → Morning Ad (image)
12pm - 3pm   → Lunch Offer (video)
3pm  - 6pm   → Brand Campaign (image)
6pm  - 11pm  → Evening Promo (video)
```

This schedule is stored in our database. Backend pushes updates to screen via WebSocket instantly when operator makes any change.

---

## Backend APIs to Build

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/cms/register` | APK first boot — sends ScreenOx ID, creates screen record |
| WebSocket | `/ws/{screenox_id}` | Persistent connection — push content/commands to screen |
| POST | `/api/cms/heartbeat` | APK sends health data every 60 seconds |
| GET | `/api/cms/screens` | Web dashboard fetches all screens for operator |
| POST | `/api/cms/schedule` | Operator sets time-based content schedule |
| POST | `/api/cms/content/upload` | Upload image/video content |

---

## Web Dashboard Pages to Build

| Page | Purpose |
|---|---|
| `/cms` | Main dashboard — all screens, online/offline status |
| `/cms/screens` | List of all screens with health indicators |
| `/cms/screens/[id]` | Individual screen — schedule editor, content manager |
| `/cms/content` | Upload and manage images/videos |
| `/cms/analytics` | Play logs, uptime, revenue per screen |

---

## Tech Stack

- **APK:** Kotlin or React Native (depending on team skills)
- **Connection:** WebSocket — wss://api.mark-ai.tech/ws/{screenox_id}
- **Backend:** FastAPI (Python) — already exists, add CMS routes + WebSocket
- **Database:** PostgreSQL — already exists, add screens/schedules/content tables
- **Web Dashboard:** Next.js — already exists, add /cms routes
- **Content Storage:** GCS (Google Cloud Storage) — already integrated

---

## What We Removed / Decided Against

- ❌ ScreenOx/Xibo API integration (`xibo_routes.py` and `xiboService.ts`) — Danish said remove
- ❌ Fetching screens from ScreenOx — screens register via APK using ScreenOx ID
- ❌ Pairing code — not needed, ScreenOx CMS handles deployment to all screens
- ❌ Our own device token — ScreenOx Screen ID is the identifier
- ❌ Polling every 5 minutes — replaced by WebSocket for instant updates
- ❌ Electron app — going with Android APK (ScreenOx boxes are Android)

---

## Key Questions Still Open

1. **Can ScreenOx CMS push third party APKs?** — Must confirm with ScreenOx before building
2. **APK language:** Kotlin (native, best performance) or React Native (JS team can build it)?
3. **Content formats:** What video/image formats do ScreenOx boxes support? (Likely MP4, JPG, PNG)
4. **How does APK read ScreenOx Screen ID?** — Confirm with ScreenOx where they store it on device

---

## Simple Mental Model

> ScreenOx CMS uploads Mark AI APK once → pushes to all screens automatically → every screen connects to Mark AI backend via WebSocket → we control everything from Mark AI CMS. ScreenOx is just the hardware.
