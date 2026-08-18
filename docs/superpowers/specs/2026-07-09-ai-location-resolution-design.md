# AI Location Resolution — misspelled place names + nearest-screen fallback

Status: **implemented** on branch `feat/ai-location-resolution` in both repos.
Scope: `markai-signage-api` (core), `markai-Web-cms` (follow-up phase)

> **Two design changes were forced by live verification. See "What changed during
> implementation" at the bottom — the scorer's rule and the geocode query both differ
> from what is described below.**

## Problem

An operator tells the AI co-pilot "book this on Banagatta road". The assistant cannot
find the screen and replies that no such screen exists — even though a screen sits on
Bannerghatta Road, 650 m from what the operator meant.

## Root cause

`app/ai/tools.py:163`:

```python
def _matches(needle: str, *haystacks: Optional[str]) -> bool:
    n = (needle or "").strip().lower()
    if not n:
        return True
    return any(n in (h or "").lower() for h in haystacks)   # substring containment
```

Used by `search_screens` (line 237) and `list_media` (line 261). It has two independent
failure modes:

1. **Typo.** `"banagatta" in "bannerghatta road"` is `False`.
2. **Directional.** The check fails when the query is *longer* than any single column,
   so a correctly spelled phrase like `"Bannerghatta Road, Bengaluru"` also returns
   nothing — no single column contains the whole string.

Measured against the only real row in `screens`:

```
name     = "Xiaomi 2201116PI"          # a device model, not a place
location = NULL                         # the manual field was never filled
city     = "Bengaluru"
address  = "Varaha, 2nd, We Work, Salarpuria Symboisis, Bannerghatta Rd,
            Venugopal Reddy Layout, Arekere, Bengaluru, Karnataka 560076, India"
lat,lon  = 12.8870856, 77.5974545
```

```
'Bannerghatta Road' -> False    # correctly spelled, still fails: the DB abbreviates to "Rd"
'Bannerghatta Rd'   -> True
'Banagatta'         -> False
```

`search_screens` therefore returns `[]`. Nothing in `app/ai/` supplies a fallback, and
prompt rule 2 ("SCREEN FIRST") requires a resolved screen before a booking can be
proposed, so the model's only honest reply is that the screen does not exist.

Underneath the spelling bug is a structural one: **the text columns are not a reliable
place index.** `location` is empty and `name` is a device model number, so the only
place-text is Google's auto-generated `address`. The reliable signal is the pair of
coordinates every screen already self-reports (migration `0008`).

## Desired behavior

- A misspelled place name resolves, and screens come back ranked by real-world distance.
- The result is **never an empty list**.
- The assistant names the screen by **name + area + distance**, never a raw UUID.
- Distance governs what the assistant is allowed to do (the banding table below).

## Design

### Principle

Text matching is free, works offline, and knows our fleet's own vocabulary (a screen an
owner named "Cafe Bannerghatta"). Geocoding is authoritative about the real world and
tolerant of spelling. **Try text first; fall back to geocoding.** Return one ranked list
where every entry carries a distance and a reason.

### 1. `forward_geocode()` — added to `app/screens/geolocation.py`

The module already calls Google's Geocoding API for `reverse_geocode`, with
`GOOGLE_GEOLOCATION_API_KEY` configured. This adds the forward direction.

- `components=country:IN` restricts results to India.
- `bounds` = bounding box of fleet screens that have coordinates, which *biases* ranking
  within that restriction. Two degenerate cases must be handled: with a single screen
  (today's reality) the box collapses to a point, and with zero geolocated screens there
  is no box at all. Pad the box to a minimum of roughly ±25 km around its centre, and
  omit `bounds` entirely when no screen has coordinates.
- Returns `None` when `settings.google_geolocation_configured` is false, matching the
  module's existing no-op-without-a-key contract.
- Cached in Redis under `geo:fwd:<normalized-query>`, TTL 30 days. Places do not move.
  Redis down means skip the cache and call the API — the same graceful degradation
  `bus.py` and `locks.py` already use.
- Returns `{lat, lon, formatted_address}`.

Verified against the live key and the real screen:

| Query | Google resolves to | km from the screen |
|---|---|---|
| `Banagatta road bangalore` | Bannerghatta Rd, Bengaluru | 0.65 |
| `bannergatta rd blr` | Bannergatta Rd, Hulimavu | 0.99 |
| `Indranagar bangalore` | Indiranagar | 11.19 |
| `Banagatta` *(no city)* | **Bannerughatta** — a different village | **8.45** |

That last row is why the bounds bias is mandatory, not optional: a bare token
confidently resolves to a real but wrong place 8.45 km away.

### 2. `haversine_km()` — new `app/screens/geo.py`

Pure function over stdlib `math`. Roughly six lines. No dependency.

### 3. `text_score()` — new `app/ai/matching.py`

Pure function. No database, no network. Replaces the boolean `_matches`.

Three signals, taking the best:
- Token-wise similarity, with generic tokens (`road`, `street`, `cafe`, `mall`, `main`)
  down-weighted so they cannot carry a match alone.
- Whole-string comparison with spaces stripped, which repairs split or merged words
  (`"banner ghatta"`).
- Best single distinctive token, so one strong signal survives a noisy phrase.

An abbreviation map (`rd`↔`road`, `st`↔`street`, `blr`/`bangalore`↔`bengaluru`) is what
fixes the `"Bannerghatta Road"` vs stored `"Bannerghatta Rd"` case.

Built on stdlib `difflib`. Measured on a 16-case set (the misspellings above plus
negatives — `Mumbai`, `Whitefield`, `Koramangala`): **16/16 correct** at a floor of
`0.72`. Worst true positive scored `0.842`, best false positive `0.600`, so the floor
sits in open space rather than on a knife-edge.

### 4. `resolve_location()` — new `app/screens/resolve.py`

The only component that knows about both text and geography.

```python
async def resolve_location(db, user, phrase, geocoder=forward_geocode) -> list[ScreenMatch]
```

```python
ScreenMatch = {
    "screen": ScreenSummary,
    "distance_km": float | None,
    "band": "near" | "offer" | "far" | "unknown",
    "match_reason": str,           # "name match" | "0.65 km from Bannerghatta Rd"
    "matched_place": str | None,   # Google's formatted_address for what it understood
}
```

1. Load `list_screens_for_user(db, user)` — the existing call, so screenowner scoping is
   preserved unchanged (owners still only see assigned screens).
2. Score every screen by text. If the best clears `AI_TEXT_MATCH_FLOOR`, return those with
   `match_reason="name match"`, `distance_km=None`, and `band="near"` — the screen's own
   record says it *is* at that place, so no distance is needed to trust it. **No API call,
   no cost.**
3. Otherwise geocode the phrase, compute `haversine_km` to every screen that has
   coordinates, sort ascending, and band each by distance.
4. If both paths come up dry, return the top text candidates with `band="unknown"`.

**Never return `[]` when the user can see at least one screen.** (A screenowner with no
assigned screens correctly gets an empty list — there is genuinely nothing to rank.)

`geocoder` is a parameter so tests inject a fake and never touch the network.

### 5. Banding — what the assistant may do

| Band | When | Assistant's authority |
|---|---|---|
| `near` | under 2 km, **or** a confident text match | Treat as "at that location"; propose the booking |
| `offer` | 2–10 km | Present as the nearest; require explicit confirmation |
| `far` | over 10 km | State that no screen is nearby; **do not** propose a booking |
| `unknown` | no coordinates, or geocoding unavailable | Present with "location not reported"; require confirmation |

The rationale is commercial, not technical: an advertiser buys footfall *at a place*. A
screen 11 km away is not a substitute for one on Bannerghatta Road, and the assistant
must never quietly book the wrong neighbourhood.

### 6. `search_screens` — `app/ai/tools.py`

Becomes a thin wrapper over `resolve_location`, returning ranked dicts that carry
`distance_km`, `band`, and `matched_place`. Its docstring tells the model results are
ranked, may be near-misses, and that the band governs what it may propose.

`list_media` also drops `_matches` for `text_score`, keeping items that clear the same
`AI_TEXT_MATCH_FLOOR` and ranking them by score. Creative names get the same typo
tolerance. There is no geo path for media — distance is meaningless for a creative.

### 7. Prompt rule — `app/ai/prompts.py`

One new rule, LOCATION & NEAREST SCREEN:

- Always state **name + area**, and **distance whenever it is known**, e.g. *"No screen on
  Bannerghatta Road itself. The nearest is Xiaomi 2201116PI at Arekere, Bengaluru —
  0.65 km away."* A confident text match carries no distance; name the screen and its area
  and say nothing about distance rather than inventing one.
- `near` → propose. `offer` → present and ask for explicit confirmation before proposing.
  `far` → say nothing is nearby and do not propose.
- Never show a raw UUID (already rule 2).
- When the top candidates are nearly tied, ask which one — rule 2 already allows exactly
  this one clarification.

### Data flow

```
"book on Banagatta road"
  → search_screens(location="Banagatta road")
      → resolve_location
          text_score over name/location/city/address     (free, offline)
              confident? → done, match_reason="name match"
          else forward_geocode + haversine_km            (Google, cached)
      → [{screen: "Xiaomi 2201116PI", distance_km: 0.65, band: "near",
          matched_place: "Bannerghatta Rd, Bengaluru"}]
  → model: name + area + distance, proposes the booking
```

## Edge cases

- **Screen has NULL lat/lon** (no location permission, or an indoor box with no fix):
  cannot be distance-ranked. Include it via the text path with `distance_km=null` and
  `band="unknown"`; the assistant says its location is not reported.
- **No Google key, API error, or timeout:** geocoding is skipped, the text path stands
  alone, band is `unknown`. Fails open — a turn must never break. This mirrors the scope
  guardrail's existing fail-open behavior.
- **Redis down:** skip the cache, call the API directly.
- **Geocode resolves outside India or absurdly far:** treated as `far`.
- **Empty phrase:** return all visible screens, as today.
- **User types a screen name rather than a place:** the text pass catches it; no API call.
- **User types a UUID:** unchanged, handled by `get_screen`.
- **Two screens tie** (both merely "in Bengaluru"): the ranked list exposes the small
  score gap, and the model asks which one.

## Non-goals

- No `pg_trgm` or PostGIS. The fleet is already loaded into memory per user; haversine
  over it is trivial. Revisit at thousands of screens.
- No `rapidfuzz` dependency. `difflib` measured sufficient at 16/16. Revisit if profiling
  shows it matters.
- No change to the APK or the player REST contract.
- The CMS frontend's `.includes()` searches are Phase 3, not this phase.

## Configurable knobs (`app/core/config.py`)

| Setting | Default |
|---|---|
| `AI_LOCATION_NEAR_KM` | `2.0` |
| `AI_LOCATION_MAX_KM` | `10.0` |
| `AI_TEXT_MATCH_FLOOR` | `0.72` |
| `AI_GEOCODE_CACHE_TTL_SECONDS` | `2592000` (30 days) |

Tunable per city without a redeploy.

## Testing

pytest + aiosqlite, no network — following the fakes-and-monkeypatch pattern already used
by `tests/test_ai_guardrail.py`.

- `tests/test_ai_matching.py` — pure `text_score`. The Banagatta table, `"Bannerghatta
  Road"` against a stored `"Bannerghatta Rd"`, and negatives (`Mumbai`, `Whitefield`,
  `Koramangala`). Asserts the floor separates true from false positives.
- `tests/test_geo.py` — `haversine_km` against known distances.
- `tests/test_ai_location_resolve.py` — `resolve_location` with a fake geocoder injected:
  0.65 km lands in `near`; 3 km in `offer`; 11.19 km in `far`; a geocoder returning `None`
  yields `band="unknown"` and a still-non-empty list; a screen with NULL lat/lon yields
  `distance_km=None`; a confident text match yields `band="near"` with `distance_km=None`
  and makes no geocoder call at all; a screenowner sees only assigned screens.
- Regression: `search_screens("Banagatta")` returns the Bannerghatta screen rather than
  `[]`, and a screenowner with zero assigned screens still gets `[]`.

## Data-quality follow-up

`location` is `NULL` on the real screen, which is why the free text path has so little to
work with. Backfilling `location` from `address` when empty (and surfacing it in the CMS
edit modal) would improve text matching and cut geocode calls. Cheap, and independent of
this design.

## Phases

1. **Backend core.** `geo.py`, `matching.py`, `forward_geocode`, `resolve.py`, plus their
   tests. No change to the API surface — pure addition.
2. **Wire it up.** `search_screens` delegates to `resolve_location`; add the prompt rule;
   `list_media` switches to `text_score`. This is the phase that fixes the reported bug.
3. **CMS frontend follow-up.** `screens/page.tsx:81`, `solution/page.tsx:366`, and
   `users/page.tsx:381` all use the same `.includes()` containment. Have the search box
   call the backend's ranked search rather than reimplementing the scorer in TypeScript —
   two implementations would drift. Optionally surface `distance_km` on the assistant's
   `screen_grid` card.

---

## What changed during implementation

Three findings from running the code against the real screen and the live geocoder
overrode the design above. Each is covered by a regression test.

### 1. The scorer takes a MINIMUM over query tokens, not a weighted average

The design specified token-wise similarity with generic words (`road`, `cafe`)
down-weighted. That is wrong, and three successive patches failed to fix it — the
signature of a bad design rather than a bad constant. A weighted average lets a word
the whole fleet shares carry a match on its own: `"Indiranagar Bengaluru"` scored
**0.95** against the screen on Bannerghatta Road and would have been banded `near` and
proposed as if it sat in Indiranagar.

The rule is now: **every word the user typed must find a partner in the field** — a
minimum, which is ordinary fuzzy AND-of-terms search semantics. `"indiranagar"` finds
no partner, so the whole match fails. The `GENERIC` weighting and the single-token
signal were both deleted; neither was load-bearing (golden table still 16/16).

`resolve_location` also stopped scoring the `city` column. One token shared by every
screen in a city cannot distinguish them, and Google's `address` already contains it.

### 2. The geocode phrase is sent unmodified — no city hint

An earlier version appended the fleet's city, because a bare `"Banagatta"` geocodes to
Banaghatta, Karnataka — **108 km away** — even with `components=country:IN` and the
25 km bounds bias (bounds only *bias* ranking; they do not restrict). Appending the
city brought it to 4.81 km.

Measured live, that is a trap: `"Mumbai, Bengaluru"` and `"Delhi, Bengaluru"` **both**
collapse to the same Bengaluru centroid 8.70 km from our screen, because Google discards
the token it cannot place. "Book in Mumbai" became a nearby-screen offer. Unmodified,
they return 845 km and 1759 km and band correctly as `far`.

The hint was solving a problem that no longer exists: a misspelled *local* place never
reaches the geocoder, because the text pass catches `"Banagatta"` at 0.842. And every
phrase that does reach the geo path (Whitefield, Koramangala, Indiranagar) resolves
identically with or without the hint.

### 3. The CMS ports the scorer rather than calling a backend ranked search

The design's Phase 3 said the dashboard should call a backend ranked search. It does
not. `screens/page.tsx` computes its status-tab counts from the full in-memory list, so
moving search server-side would break those counts and add a round-trip per keystroke
for a fleet of a few screens.

`markai-Web-cms/src/lib/matching.ts` reimplements the algorithm, including Python
`difflib`'s Ratcliff-Obershelp ratio. Drift is prevented by copying the golden table
verbatim into `matching.test.ts` and asserting exact numeric parity with Python
(`0.842` / `1.000` / `0.333` on the real fleet row).

## Verified end-to-end (live geocoder, real screen)

| Operator types | Path | Band | Distance | Assistant |
|---|---|---|---|---|
| `Banagatta` | text | near | — | proposes the screen |
| `Banagatta road` | text | near | — | proposes the screen |
| `bannergatta rd` | text | near | — | proposes the screen |
| `Bannerghatta Road` | text | near | — | proposes the screen |
| `banner ghatta` | geo | offer | 8.45 km | offers nearest, asks to confirm |
| `Koramangala` | geo | offer | 6.11 km | offers nearest, asks to confirm |
| `Whitefield` | geo | far | 18.92 km | refuses to propose |
| `Indiranagar` | geo | far | 11.19 km | refuses to propose |
| `Mumbai` | geo | far | 845.63 km | refuses to propose |
| `Delhi` | geo | far | 1759.52 km | refuses to propose |

Backend: 181 tests pass. CMS: 32 tests, `typecheck` and `build` pass.
