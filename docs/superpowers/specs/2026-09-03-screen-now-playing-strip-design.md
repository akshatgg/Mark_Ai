# Screen "What's playing" strip — design

**Date:** 2026-09-03
**Surface:** `markai-frontend-new` → `/screens/[id]` (public screen detail page, port 3100)
**Backends touched:** `markai-backend-new` (new public route), `markai-signage-api` (new ext route)

## Problem

The public screen page tells an advertiser what a screen *is* — resolution, loop
math, operating hours, how many slots are free. It never shows what the screen is
actually *doing*. A buyer looking at a café screen cannot see a single ad that has
ever run on it, which makes the inventory feel theoretical.

Add a strip at the bottom of the page showing the creatives that have played on
that screen: the one on the glass right now, then the ones before it, scrolling
left to right.

## The honesty rule (governing constraint)

**Every tile in the strip must be an ad that really ran on that screen.**

No borrowing creatives from other screens in the fleet to pad the strip, no
illustrative filler, no synthetic examples. A screen with no history shows an
empty state saying so. The target count of 6–7 tiles is a **cap, not a floor**.

This rule exists because the strip sits directly above a "Book this screen"
button. A padded strip would be a claim about delivery on a page where the buyer
is deciding to pay, and the same page already refuses to show a `status` badge
for exactly this reason (see the module docstring on
`markai-backend-new/app/screens/router.py`).

### Policy change this represents

`/api/screens/{id}/detail` today anonymizes other advertisers' campaigns to "a
taken slot". This strip deliberately reverses that for *played* creatives: it
shows the creative image and its name. The justification is that a DOOH ad is
displayed in a public venue — it is already public by the nature of the medium,
unlike a campaign's schedule, budget, or booking id, which stay hidden.

What the strip exposes: creative thumbnail, creative/brand name, when it last
played. What it still hides: booking ids, advertiser account identity, schedule
shape, spend, and every campaign that has been booked but has not yet played.

## Data sources

### CMS-connected screens (`source: "cms"`)

`markai-signage-api` holds the truth:

* `screens.now_playing_media_id` — written on every heartbeat.
* `screens.last_seen_at` — how fresh that value is.
* `proof_of_play (screen_id, media_id, played_at, booking_id)` — the play log.
* `media_assets (id, name, brand_name, type, file_url, width, height)`.

### Platform screens (`source: "platform"`, "partner venue")

No player, no heartbeat, no play log — the venue runs the loop by hand. The only
local evidence is `markai-backend-new`:

* `bookings (screen_id, content_id, name, start_at, end_at, daily_windows, days_of_week, approval_status, payment_status)`
* `media_assets (id, name, type, file_url)` via `bookings.content_id`

A platform screen therefore **never shows a LIVE tile** — we have no proof of
play, only proof of booking.

## API

### New public route — `markai-backend-new`

`GET /api/screens/{screen_id}/playing`

Public and unauthenticated, like the rest of the screen catalogue. Deliberately
**separate** from `/detail` rather than folded into it: the strip is below the
fold, so it loads after first paint and never delays the card, the slot map, or
the booking CTA.

Cached in-process for 60 seconds per screen id. The page is public and a popular
screen would otherwise put one CMS round trip on every anonymous page view.

```jsonc
{
  "kind": "cms" | "platform",
  "live": Item | null,
  "recent": [Item],      // newest first; live item excluded; live + recent <= 7
  "as_of": "2026-09-03T09:12:00Z"
}
```

```jsonc
Item = {
  "media_id":       "uuid",
  "name":           "Swiggy Monsoon 30s",   // creative name, may be null
  "brand_name":     "Swiggy",               // may be null
  "media_type":     "image" | "video",
  "thumb_url":      "https://…signed…",     // signed GCS URL
  "last_played_at": "2026-09-03T09:11:40Z", // CMS screens only; null on platform
  "plays":          412,                    // CMS screens only; null on platform
  "state":          "live" | "on_air" | "past"
}
```

`plays` is null-means-not-reported, never 0 as a stand-in — the same rule
`CmsCreative.plays` already follows in `lib/platform.ts`.

### New ext route — `markai-signage-api`

`GET /api/ext/screens/{screen_id}/now-playing?limit=7`

Follows the existing partner-API conventions in `app/api_keys/ext_router.py`
(API-key headers, `Ext*` response models).

* **live**: resolve `screens.now_playing_media_id` → `media_assets`, but only
  when `last_seen_at` is within `LIVE_FRESHNESS_SECONDS` (300s). Otherwise
  `null` — a screen that stopped checking in twenty minutes ago is not playing
  anything we can vouch for, and the strip must not say it is.
* **recent**: `proof_of_play` for the screen, `DISTINCT ON (media_id)` keeping
  the newest `played_at`, ordered `played_at DESC`, limited to `limit`. The live
  media id is excluded so the same creative never appears twice.
* `thumb_url` uses the existing `signed_url_for` (cached signer), and the whole
  page's URLs are pre-warmed with `prewarm_signed_urls` so signing does not
  block the event loop.

## Platform-screen resolution (backend-new, local only)

No CMS call. From `bookings` where `screen_id` matches, `approval_status =
'approved'` and `payment_status = 'paid'`, joined to local `media_assets` via
`content_id`:

* A booking whose date range **and** daily window covers now → `state: "on_air"`.
  Reuses the in-window logic already in `app/screens/platform.py`
  (`_position_holders`) so the strip and the slot map cannot disagree about what
  is running.
* Everything else that has already run (`end_at` in the past, or start in the
  past) → `state: "past"`, ordered newest first.
* Bookings that have not started yet are excluded — nothing has played.
* `last_played_at` and `plays` are `null`: there is no play log to read.

The badge wording differs from a CMS screen on purpose. `LIVE` asserts a player
reported this creative on the glass. `ON AIR` asserts only that the venue is
scheduled to be running it now.

## Frontend

New component: `markai-frontend-new/components/screens/NowPlayingStrip.tsx`,
rendered in `app/screens/[id]/page.tsx` as a full-bleed section between the CTA
block and the `Footer`. Fetched from a `useEffect` after the detail call
resolves, so a slow or failing strip never blocks the page.

### Motion

* Track duplicated once; `@keyframes mk-marquee` translating `-50%`, added to
  `app/globals.css` alongside the existing `mk-*` keyframes.
* Duration scales with tile count so speed stays constant regardless of how many
  ads a screen has.
* Pauses on hover and on keyboard focus within the track.
* `prefers-reduced-motion` → animation off, the track becomes a horizontal
  scroll-snap row. This mirrors the existing reduced-motion blocks in
  `globals.css`.
* Fewer than 4 tiles → no marquee at all, a static centered row. A two-item
  marquee reads as a rendering bug.

### Tile

* Aspect ratio taken from the screen's own `resolution` (via the existing
  `parseResolution` helper), so a portrait café screen shows portrait tiles.
* Badge, top-left: `LIVE` with a pulsing dot (reuse `mk-pulse`), `ON AIR`, or
  `PAST`.
* Creative name and relative last-played time below the thumbnail.
* **Image creative** → `<img>`.
* **Video creative** → `<video muted loop playsinline>` that actually plays.
  Guard rails, because seven simultaneous decodes would ruin the page:
  * `preload="metadata"` until the tile enters the viewport.
  * An `IntersectionObserver` calls `play()` on entry and `pause()` on exit, so
    only visible tiles decode.
  * Under `prefers-reduced-motion` the video stays paused on its first frame.

### Empty state

No live item and no history → a single panel: "No ads have played on this screen
yet." plus the existing "Book this screen" link. This is what the current test
screen `ccaefb5e-6d42-4134-8b25-31a294971e48` renders — a partner venue with
zero bookings.

### Failure state

The strip's fetch failing is not the page failing. On error the section renders
nothing at all rather than an error card: the buyer loses a nice-to-have, and an
error box above the booking button would read as the screen being broken.

## Testing

* **signage-api** — `pytest` is not run in this repo (project convention); verify
  by import/syntax check and by calling the new ext route against the local dev
  stack on `:8095` with a partner key. Confirm the freshness gate by ageing
  `last_seen_at` past 5 minutes and asserting `live` becomes `null`.
* **backend-new** — same convention. Verify both branches against the local DB
  on `:5434`: a CMS-mirrored screen id and the platform screen
  `ccaefb5e-…` (expected: `kind: "platform"`, `live: null`, `recent: []`).
* **frontend** — `npm run build` plus a manual pass at
  `http://localhost:3100/screens/ccaefb5e-6d42-4134-8b25-31a294971e48` for the
  empty state, and a CMS-backed screen for the populated strip. Check the
  reduced-motion path with the OS setting on.

## Out of scope

* Milestone screenshots (real photographs of the glass captured by the APK).
  Better evidence than the creative file, but they are operator-only material
  and scoped per booking — a separate decision about what a public page may show.
* Any live-status badge on the screen card itself. The page's existing rule that
  it shows no `status` is unchanged.
* Play counts or delivery figures for other advertisers. `plays` is returned so
  the tile *can* carry it, but the first cut does not render it.
