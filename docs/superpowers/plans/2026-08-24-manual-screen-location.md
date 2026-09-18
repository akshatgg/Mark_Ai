# Manual screen location: the operator's typed address becomes the screen's real location

**Date:** 2026-08-24
**Repos touched:** `markai-signage-api` (core), `markai-Web-cms` (display). **No APK change, no migration.**

## What the user asked for (in their words, distilled)

1. When the operator types an address into **Screen settings → Name & location**, the
   **Location card** must show that as the screen's actual location — address, pin
   code, city, latitude, longitude — as a *manual*, precise fix (no more
   "Approximate" badge, no dash for Address).
2. **Milestone/on-demand screenshots** must stamp the location from this manual
   field — and must **stop hitting the Google Geolocation API** when a manual
   location exists. (Observed today: every screenshot burned a `geolocate_wifi`
   call that 404'd, because Google doesn't know the venue's routers.)
3. The WiFi/IP auto-detection stays as the fallback for screens nobody has typed an
   address for.

## What exists today (verified in code)

- `screens.location` is a free-text column, stored by `update_screen()`
  (`app/screens/service.py:728`) and rendered only in the Screen-settings header.
  It never touches `latitude/longitude/address/postal_code/city/location_source`.
- `PRECISE_LOCATION_SOURCES = {"device", "wifi", "manual"}` — `manual` is already
  a recognized precise source (`service.py:55`); nothing ever writes it.
- The register-time ladder (`service.py:331`) only runs WiFi geolocation when the
  stored source is NOT precise — so once a screen is `manual`, registration and
  re-scan already cost **zero** Google calls. No change needed there.
- `_apply_location` (`service.py:68`) lifts a device-reported fix into the row
  unconditionally — it could clobber a manual fix. (Low risk on AndBoxes — they
  have no on-device provider — but must be guarded on principle.)
- `_resolve_overlay_location` (`app/screenshots/service.py:1302`) resolves the
  screenshot stamp LIVE: device fix → `geolocate_wifi(wifi_aps)` → stored row.
  This is the path that keeps calling the Geolocation key today.

## Design

### A. Backend — typing an address creates a manual fix

`update_screen()`: when `location` is provided **and actually changed**:

1. Forward-geocode the text (see *Geocoder choice* below) →
   `(lat, lng, postal_code, city)`.
2. On success, write the full manual fix:
   - `latitude`/`longitude` ← geocoded coords
   - `address` ← the operator's text verbatim (their words are the truth; the
     geocoder only supplies numbers)
   - `postal_code`/`city` ← parsed from the geocoder result (fall back to
     regex-parsing a 6-digit pin from the text)
   - `location_source = "manual"`, `location_accuracy_m = NULL`,
     `location_updated_at = now()`
3. On geocoder failure (unknown address, service down): store the text as today,
   leave the fix untouched, and return a flag the CMS can toast
   ("Saved, but couldn't resolve coordinates — the Location card keeps the
   auto-detected fix"). Never write `manual` without coordinates: the precise
   badge must never decorate stale IP coords.
4. Guard `_apply_location`: a device-reported fix no longer overwrites a
   `manual` source — except on the operator re-scan path (`forceLocationRefresh`
   → register with `location_refresh_requested_at` pending), where pressing
   Re-scan IS the operator explicitly asking to re-detect.

New helper `forward_geocode(text)` lives next to `reverse_geocode` in
`app/screens/geolocation.py`, same no-key-configured → no-op convention.

### B. Backend — screenshots use the stored manual fix, free of charge

`_resolve_overlay_location` gains a **tier 0**: load the screen row first; if
`location_source == "manual"`, return the stored
`(city, address, postal_code, lat, lng, precise=True)` immediately — **before**
the device-fix and `geolocate_wifi` tiers, so a manual screen's milestones make
zero Google calls and always stamp the operator's address. The existing three
tiers remain unchanged for non-manual screens. (The satellite-map inset keeps
working — it gets real coords now.)

### C. CMS — the Location card tells the truth

- Badge: `location_source === "manual"` → green/neutral **Manual** badge instead
  of amber "Approximate" (`location_is_precise` already drives the amber path).
- The explanatory amber paragraph is replaced for manual fixes with one quiet
  line: "Set by the operator from Screen settings."
- After saving Screen settings, the page refetches (it already does) — plus a
  toast when the backend reports the geocoder couldn't resolve the address.
- Re-scan button stays available (it's the explicit "go back to auto" gesture).

### Geocoder choice (decision needed)

Address text → coordinates needs a *forward geocoder*. Options:

| Option | Cost | Indian-address quality | Note |
|---|---|---|---|
| Google **Geocoding** API | ~$5/1000 calls; one call per manual edit, human-triggered | excellent | Same key the backend already uses for `reverse_geocode` on every WiFi fix. This is NOT the Geolocation (WiFi) API that was failing/burning today. |
| Nominatim (OpenStreetMap) | free | patchy for shop-level Indian addresses ("Favara Baby World, Varthur Main Rd" will likely miss or land on the street centroid) | 1 req/s etiquette, needs User-Agent |

Recommendation: **Google Geocoding**, because a manual edit happens a handful of
times per screen *ever*, and a wrong pin on billing evidence costs more than
half a cent. Nominatim as the no-key fallback keeps dev environments working.

## Out of scope (explicitly)

- No APK release — the player is untouched; the backend decides everything.
- No new columns/migrations — every field already exists.
- No lat/lng input boxes in the CMS — the operator types an address; numbers come
  from the geocoder. (Can be added later if ever needed.)

## Execution order & verification

1. `forward_geocode` helper + unit-free syntax check (`python -c "import ..."`,
   no pytest per project convention).
2. `update_screen` manual-fix logic + `_apply_location` guard.
3. `_resolve_overlay_location` tier 0.
4. CMS badge/copy/toast; `npx tsc --noEmit` + `npm test`.
5. Live verification: PATCH the Favara Baby World screen's location via the CMS,
   confirm the Location card flips to Manual with real Whitefield coords, then
   trigger a "Capture now" screenshot and confirm (a) the overlay shows the
   typed address and (b) the GCP logs show **no** `geolocate_wifi` call.
