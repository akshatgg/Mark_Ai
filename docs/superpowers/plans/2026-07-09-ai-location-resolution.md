# AI Location Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CMS AI co-pilot resolve misspelled location names ("Banagatta" → Bannerghatta Road) and return screens ranked by real-world distance, never an empty list.

**Architecture:** A pure text scorer (stdlib `difflib`, Ratcliff-Obershelp) runs first and for free. When it finds nothing confident, the phrase is forward-geocoded via the Google Maps key already configured for `reverse_geocode`, and screens are ranked by haversine distance from the resolved point. Each result carries a `band` (`near`/`offer`/`far`/`unknown`) that governs what the model may propose.

**Tech Stack:** Python 3.12 · FastAPI · async SQLAlchemy · pytest + aiosqlite · pydantic-ai · Next.js 15 · React 19 · TypeScript · vitest (new devDependency)

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-ai-location-resolution-design.md`.
- Branch in **both** repos: `feat/ai-location-resolution` (already created from `origin/main`).
- **Never commit** `markai-signage-api/cloudbuild.yaml` or `markai-Web-cms/scripts/` — pre-existing uncommitted user work. Always `git add` explicit paths, never `git add -A` or `.`.
- No new backend runtime dependency. `difflib` and `math` are stdlib; `httpx` and `redis` are already present.
- Fail open everywhere: a geocoding or Redis failure must never break an AI turn, matching `app/ai/guardrails/` and `app/ai/bus.py`.
- `resolve_location` never returns `[]` when the user can see at least one screen. A screenowner with zero assigned screens correctly gets `[]`.
- Role scoping is preserved by reusing `screens_service.list_screens_for_user`.
- Backend tests must not touch the network. Inject fakes, per `tests/test_ai_guardrail.py`.
- Thresholds live in `app/core/config.py`, never hardcoded.
- `matching.py` goes in `app/core/`, not `app/ai/` — `app/screens/resolve.py` consumes it, and screens must not import from ai.

## The golden table

This 16-case table is the shared contract between the Python scorer and the TypeScript
port. Both must produce identical verdicts. It appears verbatim in both test files.

Screen rows used as the corpus:

| key | name | location | city | address |
|---|---|---|---|---|
| `bannerghatta` | Cafe Bannerghatta | Bannerghatta Road | Bengaluru | 12 Bannerghatta Main Rd, Bengaluru 560076 |
| `indiranagar` | Cafe Indiranagar | Indiranagar | Bengaluru | 100ft Rd, Indiranagar |
| `mgroad` | Phoenix Mall MG Road | MG Road | Bengaluru | 1 MG Rd, Bengaluru |
| `koramangala` | Koramangala Hub | Koramangala | Bengaluru | 80ft Rd, Koramangala |

| query | expected top hit (or `None`) |
|---|---|
| `Bannerghatta Road` | `bannerghatta` |
| `Banagatta` | `bannerghatta` |
| `Banagatta road` | `bannerghatta` |
| `bannergatta` | `bannerghatta` |
| `Bannerghata` | `bannerghatta` |
| `banerghatta rd` | `bannerghatta` |
| `bannerghatta road bengaluru` | `bannerghatta` |
| `banner ghatta` | `bannerghatta` |
| `Bannergatta Rd Bangalore` | `bannerghatta` |
| `MG Road` | `mgroad` |
| `mg rd` | `mgroad` |
| `Indranagar` | `indiranagar` |
| `indranager` | `indiranagar` |
| `koramangla` | `koramangala` |
| `Whitefield` | `None` |
| `Mumbai` | `None` |

"Top hit" means: score the query against all four rows, take the highest; if that highest
score is below `AI_TEXT_MATCH_FLOOR` (0.72), the expected result is `None`.

---

## File Structure

**`markai-signage-api`**

| File | Responsibility |
|---|---|
| `app/core/matching.py` *(create)* | Pure text similarity. No DB, no network. |
| `app/screens/geo.py` *(create)* | Pure geometry: haversine, padded bounding box. |
| `app/screens/geolocation.py` *(modify)* | Adds `forward_geocode` beside `reverse_geocode`. |
| `app/screens/resolve.py` *(create)* | Orchestrates text → geo → banded `ScreenMatch` list. |
| `app/core/config.py` *(modify)* | Four tunable knobs. |
| `app/ai/tools.py` *(modify)* | `search_screens` delegates; `list_media` uses `text_score`. |
| `app/ai/prompts.py` *(modify)* | Rule 9: LOCATION & NEAREST SCREEN. |
| `tests/test_matching.py` *(create)* | Golden table against `text_score`. |
| `tests/test_geo.py` *(create)* | Haversine + bounding box. |
| `tests/test_location_resolve.py` *(create)* | Banding, fail-open, role scoping, never-empty. |

**`markai-Web-cms`**

| File | Responsibility |
|---|---|
| `src/lib/matching.ts` *(create)* | TS port of `text_score`, same algorithm. |
| `src/lib/matching.test.ts` *(create)* | The same golden table. |
| `package.json` *(modify)* | `vitest` devDependency + `test` script. |
| `src/app/(dashboard)/screens/page.tsx` *(modify:74-83)* | Fuzzy search box. |
| `src/app/(dashboard)/solution/page.tsx` *(modify:365-367)* | Fuzzy media picker. |
| `src/app/(dashboard)/users/page.tsx` *(modify:386-390)* | Fuzzy screen picker. |

---

## Task 1: Pure text scorer (`app/core/matching.py`)

**Files:**
- Create: `markai-signage-api/app/core/matching.py`
- Test: `markai-signage-api/tests/test_matching.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `text_score(query: str, *fields: str | None) -> float` returning `0.0..1.0`; `1.0` for an empty/blank query. Also exports `SYNONYMS: dict[str, str]` and `GENERIC: frozenset[str]`.

- [ ] **Step 1: Write the failing test**

Create `markai-signage-api/tests/test_matching.py`:

```python
"""Fuzzy text matching (app/core/matching.py).

The golden table below is the shared contract with the CMS's TypeScript port
(markai-Web-cms/src/lib/matching.test.ts). Both must produce identical verdicts,
or the AI and the manual search box will disagree about what the operator meant.
"""

import pytest

from app.core.matching import text_score

FLOOR = 0.72

ROWS = {
    "bannerghatta": ("Cafe Bannerghatta", "Bannerghatta Road", "Bengaluru",
                     "12 Bannerghatta Main Rd, Bengaluru 560076"),
    "indiranagar": ("Cafe Indiranagar", "Indiranagar", "Bengaluru",
                    "100ft Rd, Indiranagar"),
    "mgroad": ("Phoenix Mall MG Road", "MG Road", "Bengaluru", "1 MG Rd, Bengaluru"),
    "koramangala": ("Koramangala Hub", "Koramangala", "Bengaluru", "80ft Rd, Koramangala"),
}

GOLDEN = [
    ("Bannerghatta Road", "bannerghatta"),
    ("Banagatta", "bannerghatta"),
    ("Banagatta road", "bannerghatta"),
    ("bannergatta", "bannerghatta"),
    ("Bannerghata", "bannerghatta"),
    ("banerghatta rd", "bannerghatta"),
    ("bannerghatta road bengaluru", "bannerghatta"),
    ("banner ghatta", "bannerghatta"),
    ("Bannergatta Rd Bangalore", "bannerghatta"),
    ("MG Road", "mgroad"),
    ("mg rd", "mgroad"),
    ("Indranagar", "indiranagar"),
    ("indranager", "indiranagar"),
    ("koramangla", "koramangala"),
    ("Whitefield", None),
    ("Mumbai", None),
]


def _top_hit(query: str) -> str | None:
    ranked = sorted(
        ((text_score(query, *fields), key) for key, fields in ROWS.items()),
        reverse=True,
    )
    best_score, best_key = ranked[0]
    return best_key if best_score >= FLOOR else None


@pytest.mark.parametrize("query,expected", GOLDEN)
def test_golden_table(query, expected):
    assert _top_hit(query) == expected


def test_blank_query_matches_everything():
    assert text_score("", "anything") == 1.0
    assert text_score("   ", None) == 1.0


def test_abbreviation_synonyms():
    # The real DB row stores "Bannerghatta Rd"; the operator types "Road".
    assert text_score("Bannerghatta Road", "Bannerghatta Rd, Bengaluru") >= FLOOR
    assert text_score("bengaluru", "Bangalore") >= FLOOR


def test_generic_tokens_alone_do_not_match():
    # "road" appears in every address; it must not carry a match by itself.
    assert text_score("road", "Bannerghatta Road") < FLOOR


def test_score_is_bounded():
    for q in ("Banagatta", "", "zzz"):
        assert 0.0 <= text_score(q, "Bannerghatta Road") <= 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_matching.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.matching'`

- [ ] **Step 3: Write the implementation**

Create `markai-signage-api/app/core/matching.py`:

```python
"""Typo-tolerant text matching for user-typed names and places.

Replaces the old case-insensitive substring check, which failed two ways: a
misspelling ("Banagatta") had no substring in "Bannerghatta Road", and a query
LONGER than the stored column ("Bannerghatta Road, Bengaluru") never matched at
all because containment is directional.

Scores in 0.0..1.0. Pure stdlib (difflib's Ratcliff-Obershelp ratio) — no new
dependency, and small enough to port to TypeScript for the CMS search boxes.
The golden table in tests/test_matching.py is the shared contract with that port.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

# Abbreviations seen in Google-formatted addresses vs how operators type them.
# This is what makes a typed "Bannerghatta Road" match a stored "Bannerghatta Rd".
SYNONYMS: dict[str, str] = {
    "rd": "road",
    "st": "street",
    "blr": "bengaluru",
    "bangalore": "bengaluru",
}

# Words too common across the fleet to carry a match on their own. "road" appears
# in nearly every address, so a bare "road" must not select an arbitrary screen.
GENERIC: frozenset[str] = frozenset(
    {"road", "street", "main", "cafe", "mall", "hub", "cross", "layout"}
)

_STOP: frozenset[str] = frozenset({"the", "near", "at", "in"})

_GENERIC_WEIGHT = 0.25
_PREFIX_BONUS = 0.08
_SINGLE_TOKEN_DISCOUNT = 0.95


def normalize_tokens(value: str | None) -> list[str]:
    """Lowercase, split on non-alphanumerics, expand abbreviations, drop stopwords."""
    raw = re.findall(r"[a-z0-9]+", (value or "").lower())
    return [SYNONYMS.get(tok, tok) for tok in raw if tok not in _STOP]


def _ratio(a: str, b: str) -> float:
    """Ratcliff-Obershelp similarity, with a small bonus for a shared prefix.

    Typos overwhelmingly preserve the first characters ("bannerghatta" ->
    "bannergatta"), so a shared 3-char prefix is real evidence.
    """
    if a == b:
        return 1.0
    score = SequenceMatcher(None, a, b).ratio()
    if len(a) >= 3 and len(b) >= 3 and a[:3] == b[:3]:
        score = min(1.0, score + _PREFIX_BONUS)
    return score


def text_score(query: str, *fields: str | None) -> float:
    """How well `query` matches the best of `fields`. 1.0 for a blank query."""
    q_tokens = normalize_tokens(query)
    if not q_tokens:
        return 1.0

    q_joined = "".join(q_tokens)
    distinctive = [t for t in q_tokens if t not in GENERIC]
    best = 0.0

    for field in fields:
        f_tokens = normalize_tokens(field)
        if not f_tokens:
            continue

        # (a) Every query token against its best field token, weighting
        #     distinctive words far above generic ones.
        numerator = denominator = 0.0
        for q_tok in q_tokens:
            weight = _GENERIC_WEIGHT if q_tok in GENERIC else 1.0
            numerator += weight * max(_ratio(q_tok, f_tok) for f_tok in f_tokens)
            denominator += weight
        token_wise = numerator / denominator if denominator else 0.0

        # (b) Whole strings, spaces removed — repairs split or merged words
        #     ("banner ghatta" vs "bannerghatta").
        joined = _ratio(q_joined, "".join(f_tokens))

        # (c) The single strongest distinctive token, so one good signal
        #     survives an otherwise noisy phrase. Slightly discounted because
        #     it ignores the rest of the query.
        single = max(
            (max(_ratio(q_tok, f_tok) for f_tok in f_tokens) for q_tok in distinctive),
            default=0.0,
        )

        best = max(best, token_wise, joined, single * _SINGLE_TOKEN_DISCOUNT)

    return best
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd markai-signage-api && poetry run pytest tests/test_matching.py -q`
Expected: PASS — 21 passed (16 golden + 5 unit)

- [ ] **Step 5: Commit**

```bash
cd markai-signage-api
git add app/core/matching.py tests/test_matching.py
git commit -m "feat(matching): typo-tolerant text scorer to replace substring match"
```

---

## Task 2: Pure geometry (`app/screens/geo.py`)

**Files:**
- Create: `markai-signage-api/app/screens/geo.py`
- Test: `markai-signage-api/tests/test_geo.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float`
  - `bounding_box(points: list[tuple[float, float]], min_pad_km: float = 25.0) -> tuple[float, float, float, float] | None` returning `(south, west, north, east)`, or `None` for an empty list.

- [ ] **Step 1: Write the failing test**

Create `markai-signage-api/tests/test_geo.py`:

```python
"""Pure geometry helpers (app/screens/geo.py)."""

import pytest

from app.screens.geo import bounding_box, haversine_km

# The one real screen in the fleet, and places geocoded near it.
SCREEN = (12.8870856, 77.5974545)          # Bannerghatta Rd, Arekere, Bengaluru
BANNERGHATTA_RD = (12.8928, 77.5989)       # "Banagatta road bangalore"
INDIRANAGAR = (12.9784, 77.6408)           # "Indranagar bangalore"


def test_zero_distance_to_self():
    assert haversine_km(*SCREEN, *SCREEN) == pytest.approx(0.0, abs=1e-9)


def test_known_short_distance():
    # Verified against the live geocoder: ~0.65 km.
    assert haversine_km(*SCREEN, *BANNERGHATTA_RD) == pytest.approx(0.65, abs=0.05)


def test_known_long_distance():
    # Verified against the live geocoder: ~11.19 km.
    assert haversine_km(*SCREEN, *INDIRANAGAR) == pytest.approx(11.19, abs=0.05)


def test_distance_is_symmetric():
    a = haversine_km(*SCREEN, *INDIRANAGAR)
    b = haversine_km(*INDIRANAGAR, *SCREEN)
    assert a == pytest.approx(b, abs=1e-9)


def test_bounding_box_is_none_when_no_points():
    assert bounding_box([]) is None


def test_single_point_box_is_padded_not_degenerate():
    """A one-screen fleet is today's reality. Google needs a rectangle, not a point."""
    south, west, north, east = bounding_box([SCREEN], min_pad_km=25.0)
    assert north > south and east > west
    # The padded box must reach at least ~25 km north of the point.
    assert haversine_km(SCREEN[0], SCREEN[1], north, SCREEN[1]) == pytest.approx(25.0, abs=1.0)


def test_box_contains_all_points():
    south, west, north, east = bounding_box([SCREEN, INDIRANAGAR])
    for lat, lon in (SCREEN, INDIRANAGAR):
        assert south <= lat <= north
        assert west <= lon <= east
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_geo.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.screens.geo'`

- [ ] **Step 3: Write the implementation**

Create `markai-signage-api/app/screens/geo.py`:

```python
"""Great-circle distance and a padded fleet bounding box. Pure stdlib math."""

from __future__ import annotations

from math import asin, cos, degrees, radians, sin, sqrt

_EARTH_RADIUS_KM = 6371.0088
_KM_PER_DEGREE_LAT = 110.574


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS-84 points, in kilometres."""
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    h = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_KM * asin(sqrt(h))


def bounding_box(
    points: list[tuple[float, float]], min_pad_km: float = 25.0
) -> tuple[float, float, float, float] | None:
    """(south, west, north, east) around `points`, padded by at least `min_pad_km`.

    Google's Geocoding API wants a rectangle to bias toward. A fleet of one screen
    would otherwise collapse the box to a single point, which is not a viewport.
    Returns None when there is nothing to bias with.
    """
    if not points:
        return None

    lats = [lat for lat, _ in points]
    lons = [lon for _, lon in points]
    south, north = min(lats), max(lats)
    west, east = min(lons), max(lons)

    pad_lat = min_pad_km / _KM_PER_DEGREE_LAT
    # A degree of longitude shrinks toward the poles; pad at the box's widest latitude.
    widest = max(abs(south), abs(north))
    km_per_degree_lon = max(_KM_PER_DEGREE_LAT * cos(radians(widest)), 1e-6)
    pad_lon = min_pad_km / km_per_degree_lon

    return (
        max(south - pad_lat, -90.0),
        max(west - pad_lon, -180.0),
        min(north + pad_lat, 90.0),
        min(east + pad_lon, 180.0),
    )
```

Note: `degrees` is imported but unused — remove it before committing if `ruff` flags it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd markai-signage-api && poetry run pytest tests/test_geo.py -q`
Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
cd markai-signage-api
git add app/screens/geo.py tests/test_geo.py
git commit -m "feat(geo): haversine distance and padded fleet bounding box"
```

---

## Task 3: Config knobs + `forward_geocode`

**Files:**
- Modify: `markai-signage-api/app/core/config.py` (beside `GOOGLE_GEOLOCATION_API_KEY`, ~line 179)
- Modify: `markai-signage-api/app/screens/geolocation.py` (append)

**Interfaces:**
- Consumes: `bounding_box` from Task 2.
- Produces:
  - `settings.AI_LOCATION_NEAR_KM: float`, `settings.AI_LOCATION_MAX_KM: float`, `settings.AI_TEXT_MATCH_FLOOR: float`, `settings.AI_GEOCODE_CACHE_TTL_SECONDS: int`
  - `async forward_geocode(query: str, bounds: tuple[float,float,float,float] | None = None) -> dict | None` returning `{"lat": float, "lon": float, "formatted_address": str}` or `None`.

- [ ] **Step 1: Add the config knobs**

In `markai-signage-api/app/core/config.py`, immediately after the
`google_geolocation_configured` property, insert:

```python
    # --- AI location resolution (app/screens/resolve.py) -------------------
    # A screen within NEAR_KM of the place the operator named is treated as being
    # "at" that place and can be proposed directly. Between NEAR_KM and MAX_KM it
    # is offered as the nearest and needs explicit confirmation. Beyond MAX_KM we
    # refuse to propose it: an advertiser buys footfall AT a place, and a screen
    # 11 km away is not a substitute.
    AI_LOCATION_NEAR_KM: float = 2.0
    AI_LOCATION_MAX_KM: float = 10.0
    # Minimum text-similarity score (app/core/matching.py) to count as a hit.
    # Measured: worst true positive 0.842, best false positive 0.600.
    AI_TEXT_MATCH_FLOOR: float = 0.72
    # Geocoded places do not move; cache them for a month.
    AI_GEOCODE_CACHE_TTL_SECONDS: int = 2_592_000
```

- [ ] **Step 2: Write the failing test**

Append to `markai-signage-api/tests/test_geo.py`:

```python
import app.screens.geolocation as geolocation
from app.core.config import settings


async def test_forward_geocode_noop_without_api_key(monkeypatch):
    """No key configured -> None, never an exception. Matches reverse_geocode."""
    monkeypatch.setattr(settings, "GOOGLE_GEOLOCATION_API_KEY", None)
    assert await geolocation.forward_geocode("Bannerghatta Road") is None


async def test_forward_geocode_returns_none_on_blank_query(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_GEOLOCATION_API_KEY", "test-key")
    assert await geolocation.forward_geocode("   ") is None
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_geo.py -q -k forward_geocode`
Expected: FAIL — `AttributeError: module 'app.screens.geolocation' has no attribute 'forward_geocode'`

- [ ] **Step 4: Implement `forward_geocode`**

Append to `markai-signage-api/app/screens/geolocation.py`:

```python
async def _cache_get(key: str) -> Optional[str]:
    """Best-effort Redis read. Redis down -> None, same as bus.py/locks.py."""
    try:
        import redis.asyncio as redis

        client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        return await client.get(key)
    except Exception:
        return None


async def _cache_set(key: str, value: str) -> None:
    try:
        import redis.asyncio as redis

        client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        await client.set(key, value, ex=settings.AI_GEOCODE_CACHE_TTL_SECONDS)
    except Exception:
        pass


async def forward_geocode(
    query: str, bounds: Optional[Tuple[float, float, float, float]] = None
) -> Optional[dict]:
    """Resolve a (possibly misspelled) place name to {lat, lon, formatted_address}.

    Google's geocoder is already typo-tolerant — "Banagatta road bangalore" resolves
    to Bannerghatta Rd — so we do not try to out-spell it. We only constrain WHERE it
    looks: `components=country:IN` restricts to India, and `bounds` (the padded fleet
    box) biases ranking. Without that bias a bare "Banagatta" resolves to Bannerughatta,
    a real but different village 8.45 km from our screen.

    Returns None (never raises) when unconfigured, blank, or on any API failure.
    """
    import json

    normalized = " ".join((query or "").lower().split())
    if not normalized:
        return None
    if not settings.google_geolocation_configured:
        return None

    cache_key = f"geo:fwd:{normalized}|{bounds}"
    cached = await _cache_get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except ValueError:
            pass

    params = {
        "address": normalized,
        "components": "country:IN",
        "key": settings.GOOGLE_GEOLOCATION_API_KEY,
    }
    if bounds:
        south, west, north, east = bounds
        params["bounds"] = f"{south},{west}|{north},{east}"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_GEOCODE_URL, params=params)
        if resp.status_code != 200:
            logger.warning("Forward geocode %s: %s", resp.status_code, resp.text[:200])
            return None
        results = (resp.json() or {}).get("results") or []
        if not results:
            return None
        loc = results[0]["geometry"]["location"]
        out = {
            "lat": float(loc["lat"]),
            "lon": float(loc["lng"]),
            "formatted_address": results[0].get("formatted_address") or normalized,
        }
    except Exception as e:
        logger.warning("Forward geocode failed for %r: %s", normalized, e)
        return None

    await _cache_set(cache_key, json.dumps(out))
    return out
```

Also widen the module's typing import at the top of `geolocation.py`:

```python
from typing import List, Optional, Tuple
```

(`Tuple` is already imported; confirm before editing.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd markai-signage-api && poetry run pytest tests/test_geo.py -q`
Expected: PASS — 9 passed

- [ ] **Step 6: Commit**

```bash
cd markai-signage-api
git add app/core/config.py app/screens/geolocation.py tests/test_geo.py
git commit -m "feat(geolocation): forward_geocode with India restriction and fleet bias"
```

---

## Task 4: `resolve_location` orchestrator

**Files:**
- Create: `markai-signage-api/app/screens/resolve.py`
- Test: `markai-signage-api/tests/test_location_resolve.py`

**Interfaces:**
- Consumes: `text_score` (Task 1); `haversine_km`, `bounding_box` (Task 2); `forward_geocode`, `settings.AI_*` (Task 3); `screens_service.list_screens_for_user`.
- Produces:
  - `@dataclass ScreenMatch` with fields `screen: ScreenSummary`, `distance_km: float | None`, `band: str`, `match_reason: str`, `matched_place: str | None`.
  - `async resolve_location(db, user, phrase: str | None, geocoder=None) -> list[ScreenMatch]`

- [ ] **Step 1: Write the failing test**

Create `markai-signage-api/tests/test_location_resolve.py`:

```python
"""resolve_location: text pass, geo fallback, banding, fail-open.

No network: the geocoder is injected. This mirrors tests/test_ai_guardrail.py,
which stubs the LLM rather than calling it.
"""

import pytest

from app.screens.resolve import ScreenMatch, resolve_location


class _Screen:
    """Stands in for ScreenSummary — resolve_location only reads these fields."""

    def __init__(self, screen_id, name, location=None, city=None, address=None,
                 latitude=None, longitude=None):
        self.screen_id = screen_id
        self.name = name
        self.location = location
        self.city = city
        self.address = address
        self.latitude = latitude
        self.longitude = longitude


# The real fleet: one screen on Bannerghatta Rd whose name is a device model
# and whose `location` was never filled in. Only `address` carries place text.
REAL = _Screen(
    "s1", "Xiaomi 2201116PI", None, "Bengaluru",
    "Varaha, We Work, Bannerghatta Rd, Arekere, Bengaluru, Karnataka 560076, India",
    12.8870856, 77.5974545,
)
NO_COORDS = _Screen("s2", "Lobby Panel", "Reception", "Bengaluru", None, None, None)


def _fleet(*screens):
    async def _list(db, user):
        return list(screens)
    return _list


def _geocoder(lat, lon, address="Bannerghatta Rd, Bengaluru"):
    async def _geo(query, bounds=None):
        return {"lat": lat, "lon": lon, "formatted_address": address}
    return _geo


async def _null_geocoder(query, bounds=None):
    return None


@pytest.fixture(autouse=True)
def _patch_fleet(monkeypatch):
    import app.screens.resolve as resolve_mod
    monkeypatch.setattr(resolve_mod.screens_service, "list_screens_for_user", _fleet(REAL))


async def test_text_match_needs_no_geocoder(monkeypatch):
    """'bannerghatta' is literally in the address -> free path, no API call."""
    calls = []

    async def _spy(query, bounds=None):
        calls.append(query)
        return None

    out = await resolve_location(None, None, "bannerghatta", geocoder=_spy)
    assert calls == []
    assert out[0].band == "near"
    assert out[0].distance_km is None
    assert out[0].match_reason == "name match"


async def test_misspelled_place_falls_back_to_geocoding():
    """The reported bug: 'Banagatta' has no substring in the address."""
    out = await resolve_location(None, None, "Banagatta",
                                 geocoder=_geocoder(12.8928, 77.5989))
    assert out, "must never return [] when the user can see a screen"
    assert out[0].screen.screen_id == "s1"
    assert out[0].distance_km == pytest.approx(0.65, abs=0.1)
    assert out[0].band == "near"
    assert out[0].matched_place == "Bannerghatta Rd, Bengaluru"


async def test_band_offer_between_near_and_max():
    # ~3 km north of the screen.
    out = await resolve_location(None, None, "somewhere",
                                 geocoder=_geocoder(12.9141, 77.5974545))
    assert out[0].band == "offer"
    assert 2.0 < out[0].distance_km < 10.0


async def test_band_far_beyond_max():
    out = await resolve_location(None, None, "Indranagar",
                                 geocoder=_geocoder(12.9784, 77.6408, "Indiranagar"))
    assert out[0].band == "far"
    assert out[0].distance_km == pytest.approx(11.19, abs=0.1)


async def test_geocoder_failure_fails_open():
    """No key, API down, or nothing found -> still a non-empty list, band unknown."""
    out = await resolve_location(None, None, "Banagatta", geocoder=_null_geocoder)
    assert out
    assert out[0].band == "unknown"
    assert out[0].distance_km is None


async def test_screen_without_coordinates_is_unknown(monkeypatch):
    import app.screens.resolve as resolve_mod
    monkeypatch.setattr(resolve_mod.screens_service, "list_screens_for_user",
                        _fleet(NO_COORDS))
    out = await resolve_location(None, None, "Banagatta",
                                 geocoder=_geocoder(12.8928, 77.5989))
    assert out
    assert out[0].distance_km is None
    assert out[0].band == "unknown"


async def test_blank_phrase_returns_whole_fleet():
    out = await resolve_location(None, None, None, geocoder=_null_geocoder)
    assert len(out) == 1
    assert out[0].screen.screen_id == "s1"


async def test_owner_with_no_screens_gets_empty_list(monkeypatch):
    """The one case where [] is correct — there is genuinely nothing to rank."""
    import app.screens.resolve as resolve_mod
    monkeypatch.setattr(resolve_mod.screens_service, "list_screens_for_user", _fleet())
    out = await resolve_location(None, None, "Banagatta",
                                 geocoder=_geocoder(12.8928, 77.5989))
    assert out == []


async def test_results_are_sorted_nearest_first():
    far = _Screen("s3", "Far Screen", None, "Bengaluru", None, 12.9784, 77.6408)
    import app.screens.resolve as resolve_mod
    resolve_mod.screens_service.list_screens_for_user = _fleet(far, REAL)
    out = await resolve_location(None, None, "Banagatta",
                                 geocoder=_geocoder(12.8928, 77.5989))
    assert [m.screen.screen_id for m in out] == ["s1", "s3"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_location_resolve.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.screens.resolve'`

- [ ] **Step 3: Write the implementation**

Create `markai-signage-api/app/screens/resolve.py`:

```python
"""Resolve an operator's location phrase to a ranked list of screens.

The old `search_screens` filtered on case-insensitive substring containment and
returned [] whenever the operator misspelled a place — leaving the model nothing
honest to say. This module ranks instead of filters, and never returns [] while
the user can see at least one screen.

Two paths:
  1. TEXT — free, offline, and it knows our own fleet's vocabulary (a screen an
     owner named "Cafe Bannerghatta"). Tried first.
  2. GEO — the phrase is forward-geocoded and screens are ranked by real distance.
     Only runs when the text pass finds nothing confident, so it costs nothing on
     the common path.

Each result carries a `band` that tells the agent what it is allowed to propose;
see AI_LOCATION_NEAR_KM / AI_LOCATION_MAX_KM in app/core/config.py.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from app.core.config import settings
from app.core.matching import text_score
from app.screens import service as screens_service
from app.screens.geo import bounding_box, haversine_km
from app.screens.geolocation import forward_geocode

logger = logging.getLogger(__name__)

BAND_NEAR = "near"
BAND_OFFER = "offer"
BAND_FAR = "far"
BAND_UNKNOWN = "unknown"

Geocoder = Callable[..., Awaitable[Optional[dict]]]


@dataclass
class ScreenMatch:
    screen: Any                      # ScreenSummary
    distance_km: Optional[float]
    band: str
    match_reason: str
    matched_place: Optional[str]


def _band_for(distance_km: Optional[float]) -> str:
    if distance_km is None:
        return BAND_UNKNOWN
    if distance_km <= settings.AI_LOCATION_NEAR_KM:
        return BAND_NEAR
    if distance_km <= settings.AI_LOCATION_MAX_KM:
        return BAND_OFFER
    return BAND_FAR


def _text_matches(phrase: str, screens: list) -> list[tuple[float, Any]]:
    """(score, screen) for every screen clearing the floor, best first."""
    scored = [
        (text_score(phrase, s.name, s.location, s.city, s.address), s) for s in screens
    ]
    hits = [(sc, s) for sc, s in scored if sc >= settings.AI_TEXT_MATCH_FLOOR]
    hits.sort(key=lambda pair: pair[0], reverse=True)
    return hits


async def resolve_location(
    db,
    user,
    phrase: Optional[str],
    geocoder: Optional[Geocoder] = None,
) -> list[ScreenMatch]:
    """Screens the user may see, ranked against `phrase`. Never [] unless they own none."""
    geocode = geocoder or forward_geocode
    screens = await screens_service.list_screens_for_user(db, user)
    if not screens:
        return []

    # No phrase: the whole visible fleet, unranked.
    if not (phrase or "").strip():
        return [
            ScreenMatch(s, None, BAND_UNKNOWN, "all screens", None) for s in screens
        ]

    # --- Path 1: text. Free, offline, and authoritative about our own names. ---
    hits = _text_matches(phrase, screens)
    if hits:
        return [
            ScreenMatch(s, None, BAND_NEAR, "name match", None) for _, s in hits
        ]

    # --- Path 2: geocode the phrase and rank by real-world distance. ---
    located = [s for s in screens if s.latitude is not None and s.longitude is not None]
    box = bounding_box([(s.latitude, s.longitude) for s in located])

    point = None
    try:
        point = await geocode(phrase, bounds=box)
    except Exception as e:  # fail open — a geocoder outage must not break a turn
        logger.warning("Geocode failed for %r: %s", phrase, e)

    if not point:
        # Nothing resolved. Return the fleet anyway so the agent can still offer
        # something rather than claiming the screen does not exist.
        return [
            ScreenMatch(s, None, BAND_UNKNOWN, "no location match", None)
            for s in screens
        ]

    place = point.get("formatted_address")
    matches: list[ScreenMatch] = []
    for s in screens:
        if s.latitude is None or s.longitude is None:
            matches.append(
                ScreenMatch(s, None, BAND_UNKNOWN, "location not reported", place)
            )
            continue
        km = haversine_km(point["lat"], point["lon"], s.latitude, s.longitude)
        matches.append(
            ScreenMatch(s, km, _band_for(km), f"{km:.2f} km from {place}", place)
        )

    # Nearest first; screens without coordinates sink to the bottom.
    matches.sort(key=lambda m: (m.distance_km is None, m.distance_km or 0.0))
    return matches
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd markai-signage-api && poetry run pytest tests/test_location_resolve.py -q`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
cd markai-signage-api
git add app/screens/resolve.py tests/test_location_resolve.py
git commit -m "feat(screens): resolve_location ranks screens by text then distance"
```

---

## Task 5: Wire the agent (`tools.py` + `prompts.py`)

**Files:**
- Modify: `markai-signage-api/app/ai/tools.py:163-167` (delete `_matches`), `:225-242` (`search_screens`), `:251-262` (`list_media`)
- Modify: `markai-signage-api/app/ai/prompts.py` (append rule 9)

**Interfaces:**
- Consumes: `resolve_location`, `ScreenMatch` (Task 4); `text_score` (Task 1).
- Produces: `search_screens` returns each `_screen_dict(...)` plus `distance_km`, `band`, `match_reason`, `matched_place`.

- [ ] **Step 1: Write the failing test**

Append to `markai-signage-api/tests/test_location_resolve.py`:

```python
async def test_search_screens_tool_exposes_band_and_distance(monkeypatch):
    """The agent must see distance + band, not just a filtered list."""
    from app.screens.resolve import BAND_NEAR, ScreenMatch

    async def _fake_resolve(db, user, phrase, geocoder=None):
        return [ScreenMatch(REAL, 0.65, BAND_NEAR, "0.65 km from Bannerghatta Rd",
                            "Bannerghatta Rd, Bengaluru")]

    import app.ai.tools as tools
    monkeypatch.setattr(tools, "resolve_location", _fake_resolve)

    rows = await tools.search_screens_impl(None, None, "Banagatta")
    assert rows[0]["distance_km"] == 0.65
    assert rows[0]["band"] == "near"
    assert rows[0]["matched_place"] == "Bannerghatta Rd, Bengaluru"
    assert "screen_id" in rows[0]
```

Note: this requires `search_screens` to delegate to a module-level, testable
`search_screens_impl`, because the `@agent.tool`-decorated closure inside
`_register_tools` is not reachable from a test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd markai-signage-api && poetry run pytest tests/test_location_resolve.py -q -k search_screens_tool`
Expected: FAIL — `AttributeError: module 'app.ai.tools' has no attribute 'search_screens_impl'`

- [ ] **Step 3: Delete `_matches` and add the impl**

In `markai-signage-api/app/ai/tools.py`, **delete** lines 163-167 entirely:

```python
def _matches(needle: str, *haystacks: Optional[str]) -> bool:
    n = (needle or "").strip().lower()
    if not n:
        return True
    return any(n in (h or "").lower() for h in haystacks)
```

Add to the import block at the top:

```python
from app.core.matching import text_score
from app.screens.resolve import resolve_location
```

Add a module-level function just above `_register_tools`:

```python
async def search_screens_impl(db, user, phrase: Optional[str]) -> list[dict]:
    """Ranked screens for a location phrase. Module-level so it is unit-testable."""
    matches = await resolve_location(db, user, phrase)
    return [
        {
            **_screen_dict(m.screen),
            "distance_km": round(m.distance_km, 2) if m.distance_km is not None else None,
            "band": m.band,
            "match_reason": m.match_reason,
            "matched_place": m.matched_place,
        }
        for m in matches
    ]
```

- [ ] **Step 4: Rewrite `search_screens` (was lines 225-242)**

```python
    @agent.tool
    async def search_screens(
        ctx: RunContext[AiDeps],
        location: Optional[str] = None,
        query: Optional[str] = None,
    ) -> list[dict]:
        """Find signage screens for a place or a name. Call this FIRST when a booking
        targets a location.

        Results are RANKED, not filtered — a misspelled place ("Banagatta" for
        Bannerghatta Road) still resolves, and the list is never empty while the user
        has screens. Each row carries:
          - `distance_km`: how far the screen is from the place you named (null when
            the screen matched by name, or has no reported coordinates).
          - `matched_place`: the real place we understood the phrase to mean.
          - `band`: what you may do with this screen —
              "near"    -> it IS at that place; propose the booking.
              "offer"   -> it is the NEAREST but 2-10 km away; present it with its
                           distance and get explicit confirmation before proposing.
              "far"     -> over 10 km; tell the user no screen is near that place and
                           do NOT propose a booking on it.
              "unknown" -> location not reported; confirm with the user first.
        Never invent a distance that is null. Never show the raw screen UUID.
        """
        return await search_screens_impl(ctx.deps.db, ctx.deps.user, location or query)
```

- [ ] **Step 5: Rewrite `list_media`'s filter (was line 261)**

Replace:

```python
        if query:
            items = [m for m in items if _matches(query, m["name"], m["type"])]
```

with:

```python
        if query:
            # Same typo tolerance as screen search; no geo path — distance is
            # meaningless for a creative.
            scored = [(text_score(query, m["name"], m["type"]), m) for m in items]
            scored = [(s, m) for s, m in scored if s >= settings.AI_TEXT_MATCH_FLOOR]
            scored.sort(key=lambda pair: pair[0], reverse=True)
            items = [m for _, m in scored]
```

- [ ] **Step 6: Append rule 9 to the system prompt**

In `markai-signage-api/app/ai/prompts.py`, insert before the closing
`You can also answer questions about the CMS ...` paragraph:

```
9. LOCATION & NEAREST SCREEN: search_screens returns screens RANKED against the place
   the user named, never a bare "not found". Spelling is already handled — do not ask
   the user to re-type a place name. Always refer to a screen by its NAME and area
   (e.g. "Xiaomi 2201116PI at Arekere, Bengaluru"), and state its `distance_km` WHENEVER
   that field is non-null. If distance_km is null, say nothing about distance — never
   invent one. Obey the `band` on each row:
   - band="near": the screen is at that place. Propose the booking normally.
   - band="offer": there is NO screen at that place. Say so, name the nearest one with
     its distance ("the nearest is X at Y, 3.4 km away"), and ask the user to confirm
     before you propose anything.
   - band="far": there is no screen anywhere near that place. Say so, mention the closest
     one and how far it is, and do NOT propose a booking on it. An advertiser is paying
     for footfall at a place; a screen 11 km away is not a substitute.
   - band="unknown": the screen's location is not reported. Say that plainly and confirm
     with the user before proposing.
   If the top rows are nearly tied (e.g. several screens in the same city), ask which one
   — that is the one allowed clarification from rule 2.
```

- [ ] **Step 7: Run the whole backend suite**

Run: `cd markai-signage-api && poetry run pytest -q`
Expected: PASS — all pre-existing tests plus the new ones. Nothing references `_matches` any more; confirm with `grep -rn "_matches" app/` returning nothing.

- [ ] **Step 8: Commit**

```bash
cd markai-signage-api
git add app/ai/tools.py app/ai/prompts.py tests/test_location_resolve.py
git commit -m "feat(ai): rank screens by distance and teach the agent the bands"
```

---

## Task 6: CMS frontend — TS port + three search boxes

**Files:**
- Create: `markai-Web-cms/src/lib/matching.ts`
- Create: `markai-Web-cms/src/lib/matching.test.ts`
- Modify: `markai-Web-cms/package.json`
- Modify: `markai-Web-cms/src/app/(dashboard)/screens/page.tsx:74-83`
- Modify: `markai-Web-cms/src/app/(dashboard)/solution/page.tsx:365-367`
- Modify: `markai-Web-cms/src/app/(dashboard)/users/page.tsx:386-390`

**Interfaces:**
- Consumes: nothing from the backend at runtime. It re-implements the same algorithm so the search box and the AI agree about what the operator meant.
- Produces: `textScore(query, ...fields): number`, `fuzzyMatches(query, ...fields): boolean`, `TEXT_MATCH_FLOOR = 0.72`.

**Why a port and not an API call:** the spec originally proposed calling a backend ranked
search. `screens/page.tsx` computes its status-tab counts from the full in-memory list, so
moving search server-side would break those counts and add a round-trip per keystroke for
a fleet of a few screens. The port is ~60 lines of pure function. The golden table, shared
verbatim with `tests/test_matching.py`, is what prevents drift.

- [ ] **Step 1: Add vitest**

```bash
cd markai-Web-cms
npm install --save-dev vitest
```

Then add to `package.json` `"scripts"`:

```json
    "test": "vitest run",
```

- [ ] **Step 2: Write the failing test**

Create `markai-Web-cms/src/lib/matching.test.ts`:

```ts
/**
 * The golden table below is copied verbatim from the backend's
 * markai-signage-api/tests/test_matching.py. Both implementations must produce
 * identical verdicts — otherwise the AI co-pilot and this dashboard's search box
 * would disagree about what the operator meant.
 */
import { describe, expect, it } from "vitest";

import { TEXT_MATCH_FLOOR, textScore } from "./matching";

const ROWS: Record<string, (string | null)[]> = {
  bannerghatta: ["Cafe Bannerghatta", "Bannerghatta Road", "Bengaluru",
    "12 Bannerghatta Main Rd, Bengaluru 560076"],
  indiranagar: ["Cafe Indiranagar", "Indiranagar", "Bengaluru", "100ft Rd, Indiranagar"],
  mgroad: ["Phoenix Mall MG Road", "MG Road", "Bengaluru", "1 MG Rd, Bengaluru"],
  koramangala: ["Koramangala Hub", "Koramangala", "Bengaluru", "80ft Rd, Koramangala"],
};

const GOLDEN: [string, string | null][] = [
  ["Bannerghatta Road", "bannerghatta"],
  ["Banagatta", "bannerghatta"],
  ["Banagatta road", "bannerghatta"],
  ["bannergatta", "bannerghatta"],
  ["Bannerghata", "bannerghatta"],
  ["banerghatta rd", "bannerghatta"],
  ["bannerghatta road bengaluru", "bannerghatta"],
  ["banner ghatta", "bannerghatta"],
  ["Bannergatta Rd Bangalore", "bannerghatta"],
  ["MG Road", "mgroad"],
  ["mg rd", "mgroad"],
  ["Indranagar", "indiranagar"],
  ["indranager", "indiranagar"],
  ["koramangla", "koramangala"],
  ["Whitefield", null],
  ["Mumbai", null],
];

function topHit(query: string): string | null {
  let bestKey: string | null = null;
  let bestScore = -1;
  for (const [key, fields] of Object.entries(ROWS)) {
    const score = textScore(query, ...fields);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestScore >= TEXT_MATCH_FLOOR ? bestKey : null;
}

describe("textScore golden table (shared with the Python backend)", () => {
  it.each(GOLDEN)("%s -> %s", (query, expected) => {
    expect(topHit(query)).toBe(expected);
  });
});

describe("textScore edge cases", () => {
  it("treats a blank query as matching everything", () => {
    expect(textScore("", "anything")).toBe(1);
    expect(textScore("   ", null)).toBe(1);
  });

  it("matches an abbreviated stored address", () => {
    expect(textScore("Bannerghatta Road", "Bannerghatta Rd, Bengaluru"))
      .toBeGreaterThanOrEqual(TEXT_MATCH_FLOOR);
  });

  it("does not let a generic token match on its own", () => {
    expect(textScore("road", "Bannerghatta Road")).toBeLessThan(TEXT_MATCH_FLOOR);
  });

  it("stays within 0..1", () => {
    for (const q of ["Banagatta", "", "zzz"]) {
      const s = textScore(q, "Bannerghatta Road");
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd markai-Web-cms && npm test`
Expected: FAIL — cannot resolve `./matching`

- [ ] **Step 4: Write the implementation**

Create `markai-Web-cms/src/lib/matching.ts`:

```ts
/**
 * Typo-tolerant text matching for the dashboard's search boxes.
 *
 * This is a deliberate port of the backend's app/core/matching.py, algorithm for
 * algorithm — including Python difflib's Ratcliff-Obershelp ratio, which is NOT
 * edit distance. Keeping the algorithms identical means the AI co-pilot and the
 * search box agree about what the operator meant by "Banagatta".
 *
 * The golden table in matching.test.ts is copied verbatim from the backend's
 * tests/test_matching.py and is what catches drift between the two.
 */

export const TEXT_MATCH_FLOOR = 0.72;

const SYNONYMS: Record<string, string> = {
  rd: "road",
  st: "street",
  blr: "bengaluru",
  bangalore: "bengaluru",
};

const GENERIC = new Set(["road", "street", "main", "cafe", "mall", "hub", "cross", "layout"]);
const STOP = new Set(["the", "near", "at", "in"]);

const GENERIC_WEIGHT = 0.25;
const PREFIX_BONUS = 0.08;
const SINGLE_TOKEN_DISCOUNT = 0.95;

function normalizeTokens(value: string | null | undefined): string[] {
  const raw = (value ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return raw.filter((t) => !STOP.has(t)).map((t) => SYNONYMS[t] ?? t);
}

/**
 * Total size of the recursively-matched blocks, i.e. Python's
 * SequenceMatcher.get_matching_blocks() with no junk heuristic. Our strings are
 * far shorter than difflib's 200-char autojunk cutoff, so the results coincide.
 */
function matchedChars(a: string, b: string): number {
  if (!a.length || !b.length) return 0;

  // Longest common substring within [0,a.length) x [0,b.length).
  let bestI = 0;
  let bestJ = 0;
  let bestLen = 0;
  let prev = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > bestLen) {
          bestLen = curr[j];
          bestI = i - bestLen;
          bestJ = j - bestLen;
        }
      }
    }
    prev = curr;
  }

  if (bestLen === 0) return 0;
  return (
    bestLen +
    matchedChars(a.slice(0, bestI), b.slice(0, bestJ)) +
    matchedChars(a.slice(bestI + bestLen), b.slice(bestJ + bestLen))
  );
}

function ratio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length && !b.length) return 1;
  let score = (2 * matchedChars(a, b)) / (a.length + b.length);
  if (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3)) {
    score = Math.min(1, score + PREFIX_BONUS);
  }
  return score;
}

/** How well `query` matches the best of `fields`. Returns 1 for a blank query. */
export function textScore(query: string, ...fields: (string | null | undefined)[]): number {
  const qTokens = normalizeTokens(query);
  if (qTokens.length === 0) return 1;

  const qJoined = qTokens.join("");
  const distinctive = qTokens.filter((t) => !GENERIC.has(t));
  let best = 0;

  for (const field of fields) {
    const fTokens = normalizeTokens(field);
    if (fTokens.length === 0) continue;

    let numerator = 0;
    let denominator = 0;
    for (const qTok of qTokens) {
      const weight = GENERIC.has(qTok) ? GENERIC_WEIGHT : 1;
      numerator += weight * Math.max(...fTokens.map((f) => ratio(qTok, f)));
      denominator += weight;
    }
    const tokenWise = denominator ? numerator / denominator : 0;

    const joined = ratio(qJoined, fTokens.join(""));

    const single = distinctive.length
      ? Math.max(...distinctive.map((q) => Math.max(...fTokens.map((f) => ratio(q, f)))))
      : 0;

    best = Math.max(best, tokenWise, joined, single * SINGLE_TOKEN_DISCOUNT);
  }

  return best;
}

/** Convenience predicate for filtering a list client-side. */
export function fuzzyMatches(query: string, ...fields: (string | null | undefined)[]): boolean {
  return textScore(query, ...fields) >= TEXT_MATCH_FLOOR;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd markai-Web-cms && npm test`
Expected: PASS — 20 passed (16 golden + 4 edge cases)

- [ ] **Step 6: Commit the port**

```bash
cd markai-Web-cms
git add src/lib/matching.ts src/lib/matching.test.ts package.json package-lock.json
git commit -m "feat(cms): port the backend's fuzzy text scorer, guarded by a shared golden table"
```

- [ ] **Step 7: Wire the screens search box**

In `markai-Web-cms/src/app/(dashboard)/screens/page.tsx`, add the import:

```ts
import { fuzzyMatches } from "@/lib/matching";
```

Replace lines 74-83:

```ts
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return screens.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (!q) return true;
      return [s.name, s.model, s.manufacturer, s.city, s.location, s.screen_id]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [screens, query, filter]);
```

with:

```ts
  const shown = useMemo(() => {
    const q = query.trim();
    return screens.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (!q) return true;
      // A screen_id is a UUID — fuzzy-matching it would produce nonsense, so it
      // keeps the exact substring check.
      if (s.screen_id.toLowerCase().includes(q.toLowerCase())) return true;
      return fuzzyMatches(q, s.name, s.model, s.manufacturer, s.city, s.location);
    });
  }, [screens, query, filter]);
```

- [ ] **Step 8: Wire the media picker**

In `markai-Web-cms/src/app/(dashboard)/solution/page.tsx`, add the import:

```ts
import { fuzzyMatches } from "@/lib/matching";
```

Replace lines 365-367:

```ts
  const q = query.trim().toLowerCase();
  const filtered = q
    ? media.filter((m) => mediaDisplayName(m).toLowerCase().includes(q))
    : media;
```

with:

```ts
  const q = query.trim();
  const filtered = q ? media.filter((m) => fuzzyMatches(q, mediaDisplayName(m))) : media;
```

- [ ] **Step 9: Wire the screen-assignment picker**

In `markai-Web-cms/src/app/(dashboard)/users/page.tsx`, add the import:

```ts
import { fuzzyMatches } from "@/lib/matching";
```

Replace the search branch at lines 386-390:

```ts
        if (!q) return true;
        return `${s.name ?? ""} ${s.location ?? ""} ${s.city ?? ""}`
          .toLowerCase()
          .includes(q);
```

with:

```ts
        if (!q) return true;
        return fuzzyMatches(q, s.name, s.location, s.city);
```

and change the `q` binding at the top of that `useMemo` from
`const q = query.trim().toLowerCase();` to `const q = query.trim();`.

- [ ] **Step 10: Verify the whole CMS**

```bash
cd markai-Web-cms
npm test          # 20 passed
npm run typecheck # no errors
npm run build     # succeeds
```

- [ ] **Step 11: Commit**

```bash
cd markai-Web-cms
git add "src/app/(dashboard)/screens/page.tsx" "src/app/(dashboard)/solution/page.tsx" "src/app/(dashboard)/users/page.tsx"
git commit -m "feat(cms): typo-tolerant search in screens, media picker and user assignment"
```

---

## Task 7: Push and open PRs

- [ ] **Step 1: Confirm nothing unrelated is staged**

```bash
git -C markai-signage-api status --porcelain   # expect only ' M cloudbuild.yaml'
git -C markai-Web-cms status --porcelain       # expect only '?? scripts/'
```

Both must still be *uncommitted*. If either appears in `git log -1 --stat`, undo it.

- [ ] **Step 2: Push both branches**

```bash
git -C markai-signage-api push -u origin feat/ai-location-resolution
git -C markai-Web-cms     push -u origin feat/ai-location-resolution
```

- [ ] **Step 3: Switch the gh account**

`origin` is `git@github-alt:` → the `akshatgupta-alt` account. The default `akshatgg`
account cannot resolve `Adneuron/*`.

```bash
gh auth switch --user akshatgupta-alt
```

- [ ] **Step 4: Open both PRs, passing `--repo` explicitly**

```bash
gh pr create --repo Adneuron/CMS-Back --base main --head feat/ai-location-resolution \
  --title "feat: resolve misspelled locations and rank screens by distance" --body "..."

gh pr create --repo Adneuron/CMS-Web --base main --head feat/ai-location-resolution \
  --title "feat: typo-tolerant search across the dashboard" --body "..."
```

- [ ] **Step 5: Switch back**

```bash
gh auth switch --user akshatgg
```

---

## Self-review notes

- **Spec coverage:** `forward_geocode` → Task 3. `haversine_km` → Task 2. `text_score` →
  Task 1. `resolve_location` + banding → Task 4. `search_screens` + `list_media` + prompt
  rule → Task 5. Frontend → Task 6. Config knobs → Task 3. Every spec section maps to a task.
- **Deviation from spec, Phase 3:** the spec said the CMS should call a backend ranked
  search. Task 6 ports the scorer to TypeScript instead. Rationale is recorded in Task 6 and
  must be back-ported into the spec when the work lands.
- **Not done here:** the spec's "data-quality follow-up" (backfilling `screens.location`
  from `address`) is deliberately out of scope — it is an independent migration.
- **Type consistency:** `ScreenMatch` fields (`screen`, `distance_km`, `band`,
  `match_reason`, `matched_place`) are used identically in Tasks 4 and 5. `text_score` /
  `textScore` keep the same `(query, ...fields) -> float` shape in both languages.
