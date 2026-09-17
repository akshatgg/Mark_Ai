# Mark AI CMS — Android app (markai-cms-apk)

**Date:** 2026-09-17 · **Status:** approved by the user ("the Claude Design is the design — go ahead")

## Why
The client wants the CMS as an Android app too. `markai-Web-cms` stays; this is a second
client of the same backend. No backend changes — every screen uses the existing
`markai-signage-api` `/api/cms/*` endpoints, exactly like the web CMS.

## Source of truth
- **UI:** Claude Design project "Mark AI Mobile App" — copied into
  `markai-cms-apk/design/` (`Mark AI Mobile App.dc.html`). Every screen reproduces that
  file's layout, tokens, fonts, spacing, copy and motion. Where the design shows mock
  data, the app shows the real field from the API.
- **API shapes:** backend pydantic schemas (`markai-signage-api/app/**/schemas.py`) and the
  web client `markai-Web-cms/src/lib/api.ts`.

## Stack
New Gradle project `markai-cms-apk/` (separate from `markai-player-apk`). Single `:app`
module, package `tech.markai.cms`. Kotlin 2.0.20, AGP 8.5.2, compileSdk/targetSdk 34,
minSdk 26, JVM 17. Jetpack Compose (BOM) + Navigation Compose, ViewModel + StateFlow,
Retrofit + OkHttp + kotlinx-serialization (same libs as the player), Coil (compose),
DataStore for the session. Manual DI (`AppContainer`) — no Hilt, matching the player.
Fonts bundled: Space Grotesk, Manrope, JetBrains Mono (OFL).

`BASE_URL`: debug `http://10.0.2.2:8095` (emulator), release `https://cms-api.mark-ai.tech`.

## Architecture
```
tech.markai.cms
  core/network    OkHttp (Bearer interceptor, 401 → logout), Retrofit, ApiResult, SSE reader
  core/session    SessionStore (DataStore: token + CmsUser), SessionManager (StateFlow)
  core/design     MarkTheme (dark/light tokens from the design), type, shapes,
                  components: GlassTabBar, AppHeader, Card, Chip, Badge, StatTile, Row,
                  SectionHead, SignalProgress, Toast host, BottomSheet, PushPage, icons
  core/ui         UiState<T>, formatting (IST times, durations, numbers)
  navigation      AppNavHost — login gate, 5 tabs, detail + page routes
  feature/<name>  data/<Name>Api.kt (Retrofit) + <Name>Repository + <Name>ViewModel + screens
```
Each feature owns its Retrofit interface, DTOs and screens, so features don't share files.

## Screens → endpoints
| Design screen | Endpoints |
|---|---|
| Login | `POST /cms/auth/login`, `GET /cms/auth/me`, `POST /cms/auth/forgot-password` |
| Home (control room) | `/cms/dashboard/stats`, `/cms/dashboard/overview`, `/cms/screens/page` |
| Screens list | `GET /cms/screens/page?q=&status=` |
| Screen detail | `GET /cms/screens/{id}`, `/screens/{id}/slots`, `/screens/{id}/proof-of-play` |
| Ad order & slots | `GET/PATCH/POST/DELETE /cms/screens/{id}/slots…`, `POST …/slots/move` |
| Scheduling list / campaign detail | `GET /cms/bookings`, `GET /cms/bookings/{id}`, `PATCH` status |
| New booking wizard | `GET /cms/screens`, `GET /cms/content`, `POST /cms/bookings` |
| Content library / creative / upload | `/cms/content…`, `upload-session` → PUT to GCS → `commit` |
| Reports / play log / exports | `/cms/reports/proof-of-play`, `.xlsx`, `/cms/bookings/{id}/report.pdf` |
| Proof frames / frame | `/cms/bookings/{id}/screenshots`, `…/captures/{id}/file`, `screenshot-request` |
| AI Co-Pilot | `/cms/ai/sessions`, `…/message` (multipart), `…/stream` (SSE via OkHttp) |
| Screen health | `/cms/screen-health`, `/{id}`, `/panels`, `/history`, `/brightness-history` |
| Users / user | `/cms/users…`, `screen-health-access`, enrollment key regen |
| API keys | `/cms/api-keys` |
| Gmail ingestion | `/cms/gmail/status`, `/drafts…`, `/drafts/{id}/confirm` |
| Creative Fit | `/cms/creative-fit/…` (superadmin only) |
| Solution | `/cms/solutions` |
| Player app | `/cms/users/{id}/apk`, enrollment key from `/me` |
| Notifications | no endpoint — derived client-side from offline / degraded screens |
| Profile sheet | `/me`; "Switch profile" lists nothing to switch to on a phone, so it shows the signed-in account only; Log out clears the session |

Exports (xlsx/pdf) and frame downloads go through Android `DownloadManager` with the
Bearer header. Auth-proxied capture thumbnails load through Coil with the shared
OkHttp client.

## Roles
Follows the real permission model, not the design's mock: superadmin sees everything;
screenowner sees only assigned screens and never Users, API keys or Creative Fit (those
rows are hidden). `can_manage_api_keys` / `has_health_access` gate their rows.

## Error handling
Every screen has loading (skeleton/shimmer), error (message + Retry) and empty states in
the design's style. 401 anywhere → session cleared → login. Network errors surface as the
design's toast. The token lasts 24 h with no refresh; the user logs in again after expiry.

## Testing / verification
Unit tests for DTO parsing and formatting helpers (JVM). Verification = `./gradlew
assembleDebug` + install on the `Pixel_7` emulator against the local backend (:8095),
logging in as the seeded operator and walking every tab and page.

## Build order
1. Foundation: project, theme/components, network/session, login, tab shell, profile sheet.
2. Features in parallel: Home+notifications · Screens+detail+slots · Scheduling+campaign+
   booking wizard · Reports+frames · Co-Pilot · Content+upload+creative · Health ·
   Users+keys+player · Gmail+Creative Fit+Solution.
3. Full debug build, emulator walk-through, fix-ups.
