# Mark AI Platform — advertiser self-serve on top of the CMS (design)

Date: 2026-07-16 · Repos touched: `markai-signage-api`, `markai-backend-new`,
`markai-frontend-new` (+ `markai-Web-cms` branch reserved, no changes expected)
· Branch everywhere: `feature/markai-platform` (no pushes).

## What we're building

The public Mark AI platform (markai-frontend-new + markai-backend-new) becomes an
advertiser storefront on top of the CMS stack. **The CMS is treated as a third-party
SaaS**: the platform talks to it ONLY through `/api/ext/*` with the API key minted in
the CMS UI (key id + secret live in `markai-backend-new/.env`, surfaced via
`Settings` — no magic strings anywhere in code).

Explicitly out of scope now: payments/billing, the AI chat system.

```
advertiser browser ──► markai-frontend-new (:3100)
                          │ NEXT_PUBLIC_API_URL
                          ▼
                    markai-backend-new (:8096)  ← platform DB (users, content,
                          │ X-Api-Key-Id/-Secret     bookings, solutions) + own GCS bucket
                          ▼
                    markai-signage-api (:8095)  /api/ext/*   ← source of truth for
                                                             screens, playback, proof
```

**Data ownership rule (user decision):** screens are NEVER stored in the platform DB —
always fetched live from the CMS. The platform DB stores only what belongs to *us*:
the user, their uploaded content (bytes in OUR GCS bucket), their bookings (user_id →
cms_booking_id mapping + a snapshot of what was booked), and their solutions/layouts.
Proof-of-play and milestone screenshots are fetched from the CMS per booking, never
copied.

## 1) CMS backend (markai-signage-api) — close the ext-API gaps

All additive, in `app/api_keys/ext_router.py` (+ bookings/screenshots services).
No new migration needed — migration 0031 already added `booked_via_api_key_id`,
`external_user_id/-name`, `external_order_id` + indexes.

1. **Richer screens.** Extend `ExtScreen` (id, name, location, status) with:
   `city, address, latitude, longitude, resolution, slot_duration_seconds,
   loop_duration_seconds, total_slots, on_start_minute, on_end_minute, last_seen_at`.
   Add `GET /api/ext/screens/{id}`. (Additive → non-breaking.)
2. **Ext content upload** (confirmed missing): mirror the CMS direct-to-GCS pair as
   `POST /api/ext/content/upload-session` → `POST /api/ext/content/commit`, API-key
   authed, reusing the existing content service (uploaded_by = the key's label). The
   platform backend drives this server-to-server and gets back a CMS `media_id`.
3. **Bookings list**: `GET /api/ext/bookings?external_user_id=&order_id=&limit=&offset=`
   — always scoped `WHERE booked_via_api_key_id == <calling key>.id` so one partner can
   never read another's campaigns. Returns `{bookings: [BookingResponse], total}`.
4. **One-shape report**: `GET /api/ext/bookings/{id}/report` (ownership-checked, 404 on
   foreign key id):
   - `source: "live" | "frozen"` — frozen once `rolled_up_at` is set (serve the
     ProofSummary verbatim); live otherwise (per-day counts computed with the same
     `owns_play_clause`/`play_intervals` narrowing the dashboard uses, grouped by IST day).
   - Common shape both ways: `total_plays, total_seconds, first_play_at, last_play_at,
     per_day{}, plays_today, target_plays_per_day, report_url?`.
   - `milestones: [{milestone: start|mid|end, status: captured|pending|missed,
     scheduled_at, captured_at, url}]` — from `get_booking_screenshots`, URLs passed
     through `signed_url_for` (bucket is private).
5. **Tighten** existing `GET /api/ext/bookings/{id}` with the same ownership check.

## 2) Platform backend (markai-backend-new)

Existing: users/auth (JWT, Google, reset) — untouched. New Settings (env-driven):
`CMS_EXT_BASE_URL`, `CMS_EXT_API_KEY_ID`, `CMS_EXT_API_SECRET`, header names
`CMS_EXT_KEY_ID_HEADER`/`CMS_EXT_SECRET_HEADER`, timeouts, screen-cache TTL.

- `app/cms/client.py` — one httpx.AsyncClient wrapper for every CMS call; raises a
  mapped 502/4xx `HTTPException` with the CMS detail passed through.
- `app/screens/` — public catalog: `GET /api/screens` (short in-memory TTL cache),
  `GET /api/screens/{id}`. Pure proxy, no DB.
- `app/content/` — JWT-authed library. `POST /api/content/upload` (multipart):
  store bytes in OUR bucket (`content/{user_id}/{uuid}-{name}`) **and** register the
  same bytes with the CMS (ext upload-session → PUT → commit) to obtain
  `cms_media_id`. Table `media_assets`: id, user_id, name, type, size_bytes,
  width/height/duration_seconds, file_url (our bucket), cms_media_id, created_at.
  `GET /api/content` (own rows only), `DELETE /api/content/{id}` (blocked while used
  by an active booking).
- `app/bookings/` — JWT-authed. `POST /api/bookings` validates against the live
  screen (operating hours pre-check like the CMS form; backend 422 is the backstop),
  then creates the CMS booking with
  `external_ref = {user_id: <our user id>, name: <user's name>, order_id: <our booking id>}`
  and stores the mapping row. Table `bookings`: id (= order_id), user_id,
  cms_booking_id, screen_id, screen_name snapshot, content_id, solution_id?, name,
  schedule_type, start_at/end_at, daily_windows JSON, days_of_week, target_plays_per_day,
  layout JSON?, status_cache, created_at. Reads merge live CMS status.
  `GET /api/bookings` (mine), `GET /api/bookings/{id}`,
  `GET /api/bookings/{id}/report` → proxies the ext report (counts + milestone photos).
- `app/solutions/` — JWT-authed, platform-only storage (CMS has no ext solutions):
  CRUD on `solutions` (id, user_id, name, screen_id, layout JSON with zones →
  our content ids + cms media ids). Booking a solution sends the CMS booking with
  `layout` + zone cms_media_ids, exactly like the CMS's own ScheduleModal does.
- Migration `0003_platform_domains` creates media_assets, bookings, solutions.

## 3) Platform frontend (markai-frontend-new)

Design language: reuse `app/theme.css` tokens (glass panels, `bg-cta-gradient`,
Playfair display headings, Montserrat body, framer-motion reveals). The 3D city stays
on landing/auth; app pages are clean glass over the dark bg for performance.

Routes (all client-fetch via a new `lib/platform.ts` sibling of `lib/auth.ts`,
same `NEXT_PUBLIC_API_URL`, same `markai_token` bearer):
- `/screens` — public browse grid: status pulse, name, city, resolution badge,
  "your ad plays {slot}s every {loop}", operating-hours chip; search + city/status
  filters. Navbar "Browse screens" now points here.
- `/screens/[id]` — detail: hero panel (aspect-true screen mock), location + map
  link, live status (online / off-hours copy), loop math, operating hours, and the
  primary CTA **Book this screen** (→ /auth if signed out).
- `/screens/[id]/book` — 3-step wizard: ① creative (upload new → progress bar, or
  pick from My Library) ② schedule (the 4 CMS types as friendly cards: Run daily /
  Specific times / Target plays per day / Custom; date range, repeatable HH:MM
  windows, day-of-week pills, target input; operating-hours hint + client pre-check)
  ③ review & confirm (no payment — "free while in beta" note).
- `/dashboard` — My campaigns: cards with status, screen, plays today vs target,
  quick links; My content tab (library grid + upload).
- `/dashboard/campaigns/[id]` — the proof page: totals, per-day bar chart (live or
  frozen — same shape), 3 milestone photo tiles (start/mid/end with captured/pending/
  missed states), schedule recap.
- Split-screen (solutions): inside the wizard's creative step, "Split this screen"
  opens a simple template picker (full / top-bottom / left-right / wide-narrow /
  banner-main) with per-zone content assignment; saved as a platform Solution and
  booked with `layout`.

## Error handling / gotchas honored
- All CMS times are IST; the wizard pins `+05:30` offsets exactly like the CMS form.
- Play duration is screen-owned — the wizard states it, never asks for it.
- Booking windows must sit inside the screen's operating hours (client hint + CMS 422
  surfaced verbatim).
- Schedule immutable after create (platform offers cancel/pause via… **not in v1**;
  v1 is create + observe. Status changes stay CMS-side).
- CMS unreachable → 502 with a friendly "screens are momentarily unavailable" on the
  frontend; browse cache softens blips.
- Secrets: CMS key/secret only in backend `.env`; frontend never sees them.

## Testing
- signage-api: pytest for the new ext endpoints (scoping: foreign key → 404; live vs
  frozen report shapes; milestone URLs present).
- backend-new: pytest for booking create (mocked CMS client), content upload (emulator).
- End-to-end manual: signup → browse → upload → book → report, against local stack
  (8095 + 8096 + 3100 + both emulators).
