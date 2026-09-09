# VNNOX Care Screen Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, in the Mark AI CMS, the same per-cabinet health VNNOX Care shows — which screens are healthy, which cabinets are dark or risky, their temperature and voltage — by polling NovaStar's cloud for the screens that have a NovaStar controller, and leaving every other screen untouched.

**Architecture:** A vendor adapter behind the screen-health subsystem that already exists (Phases A/B, stranded on `dev`). VNNOX JSON is translated into the existing `HealthReport` shape and handed to the existing `record_health()`, so tier derivation, fault diffing, tallies and the CMS views all keep working unchanged. A `screen_vnnox_link` row is the gate: no row, no call.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic (`markai-signage-api`), Next.js App Router + Tailwind (`markai-Web-cms`), Kotlin (`markai-player-apk`), Postgres.

## Global Constraints

- **Do not run `pytest`.** Project convention: the agent verifies with `ruff check` and import checks; the user runs the suite. Write the tests, never execute them.
- **Do not run `next build`** in any web project — it clobbers `.next` under the running dev server. Verify with `npx tsc --noEmit`.
- **Secrets stay backend-only.** `VNNOX_APP_KEY` / `VNNOX_APP_SECRET` are never `NEXT_PUBLIC_*` and never reach the browser.
- **Only `/v2/device-status-monitor/*` endpoints may be called.** VNNOX's player, program, real-time-control and scheduled-control APIs are out of bounds — our backend already owns scheduling and playback.
- **`POST /v2/device-status-monitor/all` is the only endpoint used on a polling cycle.** Rate limit is 5/sec and 1000/hour account-wide; per-endpoint polling caps the fleet at ~5 screens.
- **`unknown` is never rendered as `ok`.** A screen VNNOX did not answer for has grey cabinets, not green.
- **The gate is a KEYWORD, never a boolean and never inference.** `screens.player_kind` (`andbox`, `novastar`, …) selects a telemetry adapter from a registry. More media players are coming, each with its own API, so anything that reduces this to on/off is wrong. `andbox` is not special-cased — it simply has no registered adapter.
- **Only a person sets the keyword** — the installer at enrollment, or an operator in the CMS. Serial/vendor detection by the APK is a prefill suggestion and must never set it.
- Base URL `https://open-in.vnnox.com` (IN node).
- Backend mirrors the `vm-api` layout: per-domain `router.py` / `schemas.py` / `service.py` / `models.py`.

---

## File Structure

**`markai-signage-api`**

| Path | Responsibility |
|---|---|
| `app/health/vendors/__init__.py` | package marker |
| `app/health/vendors/vnnox/__init__.py` | package marker |
| `app/health/vendors/vnnox/position.py` | decode VNNOX `position` hex ↔ human string. Pure, no I/O. |
| `app/health/vendors/vnnox/client.py` | signed HTTP client, rate-limit pacing, `Retry-After` |
| `app/health/vendors/vnnox/adapter.py` | VNNOX JSON → `HealthReport` |
| `app/health/vendors/vnnox/sync.py` | select linked screens, batch by 10, call `/all`, persist |
| `app/health/link_models.py` | `ScreenVnnoxLink` ORM model |
| `app/health/link_service.py` | link CRUD + upsert-from-heartbeat |
| `app/health/router.py` | *(modify)* add link endpoints |
| `alembic/versions/0065_screen_vnnox_link.py` | the link table |
| `tests/fixtures/vnnox/*.json` | recorded payloads from the published examples |

**`markai-Web-cms`** — extends existing files under `src/components/screen-health/` and `src/app/(dashboard)/screen-health/`.

**`markai-player-apk`** — `health/DeviceInfo.kt` (modify), heartbeat model (modify).

---

## Task 1: Land the Phase A/B health work on `main`

The whole subsystem exists as one commit on a `dev` branch that is 49 commits behind `main`. Nothing else in this plan can start until it is on `main`'s lineage. Cherry-pick, do not rebase `dev` — `dev` carries unrelated drift.

**Files:**
- Modify: all three repos (`markai-signage-api`, `markai-Web-cms`, `markai-player-apk`)

**Interfaces:**
- Produces: `app/health/{capability,models,schemas,service,grid,overlay,router}.py`, `record_health(db, screen_id, report) -> None`, `HealthReport` / `ControllerReport` / `PanelStatusReport` schemas, migration `0038_panel_health`, CMS `src/lib/screen-health.ts` and `src/components/screen-health/*`.

- [ ] **Step 1: Create the working branch in the backend and cherry-pick**

```bash
cd markai-signage-api
git fetch --all
git checkout -b feat/vnnox-care-health origin/main
git cherry-pick f393d4c
```

- [ ] **Step 2: Confirm the migration slot is still free**

```bash
ls alembic/versions | grep ^0038
```
Expected: exactly `0038_panel_health.py` and nothing else. If another `0038_*` appears, rename the file and its `revision` string to the next free number and set `down_revision` to the current head from `poetry run alembic heads`.

- [ ] **Step 3: Verify it imports and lints**

```bash
poetry run python -c "import app.health.service, app.health.router, app.health.capability"
poetry run ruff check app/health
```
Expected: no output from either.

- [ ] **Step 4: Cherry-pick the CMS and APK halves**

```bash
cd ../markai-Web-cms && git checkout -b feat/vnnox-care-health origin/main && git cherry-pick <cms health commit>
cd ../markai-player-apk && git checkout -b feat/vnnox-care-health origin/main && git cherry-pick <apk health commit>
```
Find each commit with `git log --oneline main..dev` in that repo. Resolve conflicts in favour of `main` for anything outside `health/` or `screen-health/`.

- [ ] **Step 5: Verify the CMS typechecks**

```bash
cd ../markai-Web-cms && npx tsc --noEmit
```
Expected: no errors. Do **not** run `next build`.

- [ ] **Step 6: Commit**

Cherry-picks are already commits. If conflicts were resolved:
```bash
git commit -am "chore: resolve health cherry-pick against main"
```

---

## Task 2: `position.py` — decode VNNOX cabinet addresses

`position` is the join key between topology, readings and alarms. It is a pure function with no dependencies, so it goes first and is fully testable offline.

**Files:**
- Create: `app/health/vendors/__init__.py`, `app/health/vendors/vnnox/__init__.py`, `app/health/vendors/vnnox/position.py`
- Test: `tests/test_vnnox_position.py`

**Interfaces:**
- Produces:
  - `parse_position(raw: str) -> list[tuple[int, int]]` — pairs of `(type_code, index)`, index 0-based as VNNOX stores it.
  - `describe_position(raw: str) -> str` — the human string, indexes rendered 1-based.
  - `cabinet_key(raw: str) -> str` — the position truncated at the receiving card, used as `cabinet_id` so an alarm on a cabinet's *voltage* maps to the same cabinet as its working status.
  - `DEVICE_TYPES: dict[int, str]`, `QUANTITY_TYPES: dict[int, str]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_vnnox_position.py
"""VNNOX `position` decoding.

The format is documented on the API docs' "Notes" page: 4 hex digits per group,
(device type, index), outermost first. Index is 0-based in the wire format and
1-based in every VNNOX UI string, which is the single easiest thing to get wrong.
"""

import pytest

from app.health.vendors.vnnox.position import (
    cabinet_key,
    describe_position,
    parse_position,
)


def test_parse_splits_into_type_index_pairs():
    # screen 1 / sending card 1 / ethernet port 1 / receiving card 1
    assert parse_position("0100020003000500") == [(1, 0), (2, 0), (3, 0), (5, 0)]


def test_parse_reads_the_second_byte_as_the_index():
    # receiving card No:2 → index 1
    assert parse_position("0100020003000501")[-1] == (5, 1)


def test_describe_matches_the_vnnox_alarm_history_column():
    assert describe_position("0100020003000501") == (
        "Screen(No:1)–Sending card(No:1)–Ethernet port(No:1)–Receiving card(No:2)"
    )


def test_describe_renders_a_trailing_physical_quantity():
    # …receiving card 1 + voltage 1
    assert describe_position("01000200030005000000").endswith("–Voltage(No:1)")


def test_cabinet_key_truncates_at_the_receiving_card():
    """An alarm on a cabinet's voltage and its working status must land on the
    SAME cabinet, or one wall would appear to have twice as many cabinets."""
    assert cabinet_key("01000200030005000000") == "0100020003000500"
    assert cabinet_key("0100020003000500") == "0100020003000500"


def test_cabinet_key_keeps_monitor_card_positions_on_their_cabinet():
    # …receiving card 1 / monitor card 1 / voltage 1
    assert cabinet_key("010002000300050006000000") == "0100020003000500"


def test_odd_length_is_rejected_rather_than_silently_truncated():
    with pytest.raises(ValueError):
        parse_position("010002000300050")


def test_empty_position_is_rejected():
    with pytest.raises(ValueError):
        parse_position("")
```

- [ ] **Step 2: Verify the test file is syntactically valid**

```bash
poetry run python -m py_compile tests/test_vnnox_position.py
poetry run ruff check tests/test_vnnox_position.py
```
Expected: no output. Do not run pytest — the user runs the suite.

- [ ] **Step 3: Write the implementation**

```python
# app/health/vendors/vnnox/position.py
"""Decoding VNNOX's `position` string.

Every monitoring and alarm row VNNOX returns is addressed by an opaque-looking
hex string like "0100020003000501". It is not opaque: the API docs' Notes page
documents it as 4 hex digits per group, (device type code, index), ordered
outermost first — screen, then sending card, then Ethernet port, then receiving
card, then optionally a monitor card or smart module, then optionally the
physical quantity the alarm is about.

Two things make this worth its own module:

1. It is the ONLY join key between the three endpoints. Topology says where a
   cabinet is, monitor says whether it is working, alarm says what went wrong —
   and they share nothing else.
2. The index is 0-based on the wire and 1-based in every string VNNOX renders.
   `0501` is "Receiving card(No:2)". Getting this backwards produces a display
   that is wrong by exactly one cabinet, which is the kind of bug that survives
   review and gets someone sent to replace the wrong tile.
"""

from __future__ import annotations

# Device type codes, from the Notes page's first enumeration table.
DEVICE_TYPES: dict[int, str] = {
    0x01: "Screen",
    0x02: "Sending card",
    0x03: "Ethernet port",
    0x05: "Receiving card",
    0x06: "Monitor card",
    0x0C: "Smart module",
    0x0D: "Smart module column",
    0x0E: "Smart module row",
}

# The SECOND enumeration table. These codes share numeric space with the device
# types above and are told apart only by position: they can appear solely as the
# final group of an alarm position.
QUANTITY_TYPES: dict[int, str] = {
    0x00: "Voltage",
    0x01: "Temperature",
    0x04: "Fan speed",
    0x05: "Smoke",
    0x06: "Working status",
    0x07: "Input source status",
    0x09: "Cabinet door status",
    0x0B: "Flat cable status",
    0x0C: "Ethernet port redundancy status",
    0x0E: "Hardware connection status",
}

# Where a cabinet's address stops. Anything at or beyond a monitor card / smart
# module / physical quantity describes something *inside* a cabinet.
_RECEIVING_CARD = 0x05


def parse_position(raw: str) -> list[tuple[int, int]]:
    """Split a position into ``(type_code, index)`` pairs, index 0-based.

    Raises ValueError rather than truncating a malformed string: a silently
    shortened position would map a reading onto the wrong cabinet, which is
    worse than dropping the row.
    """
    if not raw:
        raise ValueError("empty position")
    text = raw.strip()
    if len(text) % 4:
        raise ValueError(f"position {raw!r} is not a whole number of 4-hex groups")
    try:
        return [
            (int(text[i : i + 2], 16), int(text[i + 2 : i + 4], 16))
            for i in range(0, len(text), 4)
        ]
    except ValueError as exc:  # non-hex characters
        raise ValueError(f"position {raw!r} is not hexadecimal") from exc


def cabinet_key(raw: str) -> str:
    """The cabinet a position belongs to, as a position string.

    Truncates after the receiving card, so an alarm about a cabinet's voltage
    and a reading about its working status resolve to one cabinet rather than
    two. This is what `PanelStatusReport.cabinet_id` carries.
    """
    pairs = parse_position(raw)
    kept: list[tuple[int, int]] = []
    for type_code, index in pairs:
        kept.append((type_code, index))
        if type_code == _RECEIVING_CARD:
            break
    return "".join(f"{t:02X}{i:02X}" for t, i in kept)


def describe_position(raw: str) -> str:
    """Render a position the way VNNOX's own Alarm History column does.

    ``0100020003000501`` →
    ``Screen(No:1)–Sending card(No:1)–Ethernet port(No:1)–Receiving card(No:2)``

    The separator is an en dash, matching their UI.
    """
    pairs = parse_position(raw)
    parts: list[str] = []
    for position, (type_code, index) in enumerate(pairs):
        is_last = position == len(pairs) - 1
        # A trailing group is a physical quantity when it cannot be a device.
        if is_last and type_code not in DEVICE_TYPES and type_code in QUANTITY_TYPES:
            name = QUANTITY_TYPES[type_code]
        elif is_last and type_code in QUANTITY_TYPES and position >= 4:
            name = QUANTITY_TYPES[type_code]
        else:
            name = DEVICE_TYPES.get(type_code, f"Unknown(0x{type_code:02X})")
        parts.append(f"{name}(No:{index + 1})")
    return "–".join(parts)
```

- [ ] **Step 4: Verify**

```bash
poetry run python -c "
from app.health.vendors.vnnox.position import describe_position, cabinet_key
print(describe_position('0100020003000501'))
print(cabinet_key('010002000300050006000000'))
"
poetry run ruff check app/health/vendors
```
Expected:
```
Screen(No:1)–Sending card(No:1)–Ethernet port(No:1)–Receiving card(No:2)
0100020003000500
```

- [ ] **Step 5: Commit**

```bash
git add app/health/vendors tests/test_vnnox_position.py
git commit -m "feat(health): decode VNNOX cabinet position strings"
```

---

## Task 3: `client.py` — the signed VNNOX client

**Files:**
- Create: `app/health/vendors/vnnox/client.py`
- Modify: `app/core/config.py` (append settings near the other integration keys)
- Test: `tests/test_vnnox_client.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `class VnnoxError(Exception)` with `.status: int` and `.code: str | None`
  - `class VnnoxClient` with `async def get(self, path: str, params: dict | None = None) -> Any` and `async def post(self, path: str, body: dict) -> Any`
  - `def sign(secret: str, nonce: str, cur_time: str) -> str`
  - `def build_headers(key: str, secret: str) -> dict[str, str]`

- [ ] **Step 1: Add settings**

In `app/core/config.py`, alongside the other optional integration keys:

```python
    # ── VNNOX Care (NovaStar cloud) ──────────────────────────────────────────
    # Read-only device-status monitoring. Never used for scheduling or playback:
    # our own backend owns those and two sources of truth would drift.
    VNNOX_BASE_URL: str = "https://open-in.vnnox.com"
    VNNOX_APP_KEY: Optional[str] = None
    VNNOX_APP_SECRET: Optional[str] = None
    VNNOX_ENABLED: bool = True
    # Their published ceiling is 5/sec and 1000/hour, account-wide. We pace well
    # under the per-second wall; the hourly budget is protected by only ever
    # polling through the bulk endpoint.
    VNNOX_MAX_REQUESTS_PER_SECOND: float = 3.0
    VNNOX_TIMEOUT_SECONDS: float = 30.0
    VNNOX_MAX_RETRIES: int = 3
```

- [ ] **Step 2: Write the failing test**

```python
# tests/test_vnnox_client.py
"""VNNOX request signing and error translation.

No network here — signing is a pure function and the error mapping is what we
actually need to be sure of, since a 406 ("screen not exist") must be handled
completely differently from a 403 (no permission) or a 429 (backoff).
"""

import hashlib

from app.health.vendors.vnnox.client import VnnoxError, build_headers, sign


def test_sign_is_sha256_of_secret_nonce_curtime():
    expected = hashlib.sha256(b"secretNONCE123").hexdigest()
    assert sign("secret", "NONCE", "123") == expected


def test_build_headers_carries_all_four_public_parameters():
    headers = build_headers("key", "secret")
    assert set(headers) >= {"AppKey", "Nonce", "CurTime", "CheckSum"}
    assert headers["AppKey"] == "key"
    assert headers["CheckSum"] == sign(
        "secret", headers["Nonce"], headers["CurTime"]
    )


def test_nonce_is_alphanumeric_and_within_the_documented_length():
    for _ in range(20):
        nonce = build_headers("k", "s")["Nonce"]
        assert nonce.isalnum()
        assert 8 <= len(nonce) <= 64


def test_nonce_differs_between_requests():
    assert build_headers("k", "s")["Nonce"] != build_headers("k", "s")["Nonce"]


def test_error_exposes_status_and_vendor_code():
    err = VnnoxError("screen not exist", status=406, code="ERROR-100002")
    assert err.status == 406
    assert err.code == "ERROR-100002"
    assert err.is_unknown_screen is True


def test_permission_error_is_distinguishable():
    err = VnnoxError("no permission", status=403, code="INSUFFICIENT_PERMISSIONS")
    assert err.is_unknown_screen is False
    assert err.is_rate_limited is False


def test_rate_limit_error_is_distinguishable():
    assert VnnoxError("slow down", status=429).is_rate_limited is True
```

- [ ] **Step 3: Verify the test is valid**

```bash
poetry run python -m py_compile tests/test_vnnox_client.py && poetry run ruff check tests/test_vnnox_client.py
```
Expected: no output.

- [ ] **Step 4: Write the implementation**

```python
# app/health/vendors/vnnox/client.py
"""Signed HTTP client for the NovaCloud (VNNOX) Open Platform.

Authentication is four headers and no token exchange:

    AppKey, Nonce (8–64 alphanumeric), CurTime (unix seconds),
    CheckSum = SHA256(AppSecret + Nonce + CurTime)

Server clock skew must stay within 5 minutes, so a host with a drifting clock
fails every call with a signature error — worth knowing before debugging the
signature itself.

Rate limiting is real and undocumented in their guide, but every response
carries it:

    X-RateLimit-Limit-Second: 5      X-RateLimit-Limit-Hour: 1000

Account-wide, shared across all endpoints. We pace under the per-second wall and
honour `Retry-After` on a 429 instead of guessing a backoff.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import string
import time
from typing import Any, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_NONCE_ALPHABET = string.ascii_letters + string.digits


class VnnoxError(Exception):
    """A VNNOX call that did not return data.

    The distinction between causes matters to the caller: an unknown screen is a
    per-screen fact to record, a rate limit is retryable, and a permission error
    means the whole integration is misconfigured and retrying is pointless.
    """

    def __init__(self, message: str, *, status: int, code: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code

    @property
    def is_unknown_screen(self) -> bool:
        """The SN is not a device on this account. Expected during rollout, and
        the correct response is to mark that one screen unreachable, not to fail
        the whole sync."""
        return self.status == 406 or self.code == "ERROR-100002"

    @property
    def is_rate_limited(self) -> bool:
        return self.status == 429

    @property
    def is_forbidden(self) -> bool:
        """Enterprise authentication or scope problem — configuration, not data."""
        return self.status == 403


def sign(secret: str, nonce: str, cur_time: str) -> str:
    return hashlib.sha256(f"{secret}{nonce}{cur_time}".encode()).hexdigest()


def build_headers(key: str, secret: str) -> dict[str, str]:
    nonce = "".join(secrets.choice(_NONCE_ALPHABET) for _ in range(16))
    cur_time = str(int(time.time()))
    return {
        "AppKey": key,
        "Nonce": nonce,
        "CurTime": cur_time,
        "CheckSum": sign(secret, nonce, cur_time),
    }


class VnnoxClient:
    """One client per sync run. Serialises requests behind a lock so the
    per-second ceiling is respected without any caller having to think about it."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        app_key: Optional[str] = None,
        app_secret: Optional[str] = None,
    ):
        self.base_url = (base_url or settings.VNNOX_BASE_URL).rstrip("/")
        self.app_key = app_key or settings.VNNOX_APP_KEY
        self.app_secret = app_secret or settings.VNNOX_APP_SECRET
        self._lock = asyncio.Lock()
        self._last_request_at = 0.0
        self._min_gap = 1.0 / max(settings.VNNOX_MAX_REQUESTS_PER_SECOND, 0.1)

    @property
    def configured(self) -> bool:
        return bool(self.app_key and self.app_secret)

    async def get(self, path: str, params: Optional[dict] = None) -> Any:
        return await self._request("GET", path, params=params)

    async def post(self, path: str, body: dict) -> Any:
        return await self._request("POST", path, json=body)

    async def _pace(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self._min_gap:
            await asyncio.sleep(self._min_gap - elapsed)
        self._last_request_at = time.monotonic()

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        if not self.configured:
            raise VnnoxError("VNNOX credentials are not configured", status=0)

        attempt = 0
        while True:
            attempt += 1
            async with self._lock:
                await self._pace()
                headers = build_headers(self.app_key, self.app_secret)
                try:
                    async with httpx.AsyncClient(
                        timeout=settings.VNNOX_TIMEOUT_SECONDS
                    ) as http:
                        response = await http.request(
                            method,
                            f"{self.base_url}{path}",
                            headers=headers,
                            **kwargs,
                        )
                except httpx.HTTPError as exc:
                    raise VnnoxError(f"VNNOX transport error: {exc}", status=0) from exc

            if response.status_code == 429 and attempt <= settings.VNNOX_MAX_RETRIES:
                # Their own header says how long to wait. Guessing is worse.
                delay = float(response.headers.get("Retry-After", "1") or 1)
                logger.warning("vnnox rate limited, retrying in %ss", delay)
                await asyncio.sleep(delay)
                continue

            if response.status_code >= 400:
                code = None
                message = response.text[:300]
                try:
                    payload = response.json()
                    error = payload.get("error") if isinstance(payload, dict) else None
                    if isinstance(error, dict):
                        code = error.get("code")
                        message = error.get("message") or message
                except ValueError:
                    pass
                raise VnnoxError(message, status=response.status_code, code=code)

            try:
                return response.json()
            except ValueError as exc:
                raise VnnoxError(
                    "VNNOX returned a non-JSON body", status=response.status_code
                ) from exc
```

- [ ] **Step 5: Verify**

```bash
poetry run python -c "
from app.health.vendors.vnnox.client import build_headers, sign
h = build_headers('k','s')
assert h['CheckSum'] == sign('s', h['Nonce'], h['CurTime'])
print('signing ok', len(h['Nonce']))
"
poetry run ruff check app/health/vendors app/core/config.py
```
Expected: `signing ok 16`, no ruff output.

- [ ] **Step 6: Commit**

```bash
git add app/health/vendors/vnnox/client.py app/core/config.py tests/test_vnnox_client.py
git commit -m "feat(health): signed VNNOX client with rate-limit pacing"
```

---

## Task 4: `player_kind` keyword + the NovaStar adapter's config table

**Files:**
- Create: `app/health/link_models.py`, `alembic/versions/0065_screen_vnnox_link.py`
- Modify: `app/models.py` (import the model so Alembic and `create_all` see it)
- Test: `tests/test_vnnox_link.py`

**Interfaces:**
- Produces: `screens.player_kind` (the gate keyword, default `andbox`), `screens.controller_serial`, `screens.controller_vendor`; `ScreenVnnoxLink` with `id, screen_id, vnnox_sn, vnnox_sid, last_sync_at, last_error, created_at, updated_at`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_vnnox_link.py
"""The link row is the gate: no row, no VNNOX call.

The row exists only because an operator chose "NovaStar + VNNOX Care" on the
screen form. Detection never creates one — substring-matching build properties
for "nova" can be wrong, and a false positive would poll VNNOX for a screen that
has none, which is the exact failure this table exists to prevent.

Kept as a table rather than columns on `screens` because `screens` already
carries 60+ columns, and because the sync bookkeeping (last_sync_at, last_error)
belongs with the link rather than with the screen.
"""

from app.health.link_models import ScreenVnnoxLink


def test_a_link_with_an_sn_is_pollable():
    assert ScreenVnnoxLink(screen_id="s1", vnnox_sn="VNNOX456").pollable is True


def test_a_link_without_an_sn_is_not_pollable():
    """An operator can tick the box before knowing the serial. That screen is
    linked but not yet addressable, and must not be put in a batch."""
    assert ScreenVnnoxLink(screen_id="s1").pollable is False


def test_blank_sn_is_not_pollable():
    assert ScreenVnnoxLink(screen_id="s1", vnnox_sn="   ").pollable is False


def test_effective_sn_is_stripped():
    link = ScreenVnnoxLink(screen_id="s1", vnnox_sn="  VNNOX456 ")
    assert link.effective_sn == "VNNOX456"
```

- [ ] **Step 2: Verify the test is valid**

```bash
poetry run python -m py_compile tests/test_vnnox_link.py && poetry run ruff check tests/test_vnnox_link.py
```

- [ ] **Step 3: Write the model**

```python
# app/health/link_models.py
"""The NovaStar adapter's per-screen configuration.

This is NOT the gate — `screens.player_kind` is. This table holds what the VNNOX
Care adapter specifically needs in order to poll: the serial number VNNOX indexes
the device by, and the bookkeeping from the last sync.

Kept as its own table rather than columns on `screens` because it is vendor
private. A second integration (Colorlight, Linsn, …) has no `vnnox_sn` and gets
its own table, instead of widening this one into a sheet of mostly-null columns
where each vendor ignores the others' fields.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db_base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class ScreenVnnoxLink(Base):
    """One screen's binding to its VNNOX Care device."""

    __tablename__ = "screen_vnnox_link"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    screen_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("screens.id", ondelete="CASCADE"), unique=True,
        nullable=False, index=True,
    )
    vendor: Mapped[str] = mapped_column(String(32), default="novastar", nullable=False)

    # The SN we poll. Typed or confirmed by the operator, prefilled from
    # `screens.controller_serial` — we do not yet know that a Taurus's Android
    # serial and the SN VNNOX indexes it by are the same string.
    vnnox_sn: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # VNNOX's own numeric screen id, cached from screen/list. Needed by the
    # camera endpoints, which address screens by sid rather than sn.
    vnnox_sid: Mapped[int | None] = mapped_column(Integer, nullable=True)

    last_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Surfaced in the CMS. An operator seeing "screen not exist" can fix it
    # themselves; a silent failure sends them to us.
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )

    @property
    def effective_sn(self) -> str | None:
        """The SN to poll, or None if the operator has not supplied one yet."""
        return (self.vnnox_sn or "").strip() or None

    @property
    def pollable(self) -> bool:
        """Linked AND addressable. An operator may tick the box before they know
        the serial; that screen must not go into a batch as an empty string."""
        return self.effective_sn is not None

    def touch_success(self) -> None:
        self.last_sync_at = datetime.now(timezone.utc)
        self.last_error = None

    def touch_error(self, message: str) -> None:
        self.last_error = message[:500]
```

- [ ] **Step 4: Register the model**

In `app/models.py`, next to the other model imports, add:

```python
from app.health.link_models import ScreenVnnoxLink  # noqa: F401
```

- [ ] **Step 5: Write the migration**

First find the current head:
```bash
poetry run alembic heads
```
Use that value as `down_revision` below (shown as `<HEAD>`).

```python
# alembic/versions/0065_screen_vnnox_link.py
"""screen_vnnox_link — bind a screen to its VNNOX Care device

Revision ID: 0065_screen_vnnox_link
Revises: <HEAD>
"""

import sqlalchemy as sa
from alembic import op

revision = "0065_screen_vnnox_link"
down_revision = "<HEAD>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "screen_vnnox_link",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "screen_id",
            sa.String(36),
            sa.ForeignKey("screens.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("vendor", sa.String(32), nullable=False, server_default="novastar"),
        sa.Column("vnnox_sn", sa.String(128), nullable=True),
        sa.Column("vnnox_sid", sa.Integer(), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # One link per screen — the gate must be unambiguous.
    op.create_unique_constraint(
        "uq_screen_vnnox_link_screen", "screen_vnnox_link", ["screen_id"]
    )
    # The sync selects by "has an SN", so index the column it filters on.
    op.create_index(
        "ix_screen_vnnox_link_sn", "screen_vnnox_link", ["vnnox_sn"]
    )

    # THE GATE. A keyword rather than a boolean because each future media player
    # brings its own telemetry API, so the question is "which adapter" and never
    # "on or off". Existing rows default to `andbox`, which has no adapter and is
    # therefore never polled — the safe direction for a backfill.
    op.add_column(
        "screens",
        sa.Column(
            "player_kind", sa.String(32), nullable=False, server_default="andbox"
        ),
    )
    op.create_index("ix_screens_player_kind", "screens", ["player_kind"])

    # Detection output, never a gate: what the APK saw on the box it runs on.
    # Used only to prefill the screen form and to suggest a keyword.
    op.add_column(
        "screens", sa.Column("controller_serial", sa.String(128), nullable=True)
    )
    op.add_column(
        "screens", sa.Column("controller_vendor", sa.String(32), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("screens", "controller_vendor")
    op.drop_column("screens", "controller_serial")
    op.drop_index("ix_screens_player_kind", table_name="screens")
    op.drop_column("screens", "player_kind")
    op.drop_index("ix_screen_vnnox_link_sn", table_name="screen_vnnox_link")
    op.drop_constraint(
        "uq_screen_vnnox_link_screen", "screen_vnnox_link", type_="unique"
    )
    op.drop_table("screen_vnnox_link")
```

- [ ] **Step 6: Add the detection columns to the `Screen` model**

In `app/screens/models.py`, beside the other device-profile columns (`model`, `manufacturer`, `android_version` around line 86):

```python
    # THE GATE: which telemetry adapter this screen uses. "andbox" (our own media
    # player) has no adapter registered, so it is never polled. See
    # app/health/vendors/registry.py.
    player_kind: Mapped[str] = mapped_column(
        String(32), default="andbox", server_default="andbox", nullable=False
    )

    # What the APK detected about the box it runs on. Informational ONLY — a
    # screen can carry both of these and never be polled, because detection does
    # not set player_kind. A person does.
    controller_serial: Mapped[str | None] = mapped_column(String(128), nullable=True)
    controller_vendor: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

- [ ] **Step 7: Verify**

```bash
poetry run python -c "
from app.health.link_models import ScreenVnnoxLink as L
print(L(screen_id='s', vnnox_sn='  A ').effective_sn, L(screen_id='s').pollable)
"
poetry run ruff check app/health/link_models.py app/screens/models.py alembic/versions/0065_screen_vnnox_link.py
poetry run alembic upgrade head && poetry run alembic downgrade -1 && poetry run alembic upgrade head
```
Expected: prints `A False`; no ruff output; migration applies, reverses and reapplies cleanly.

- [ ] **Step 8: Commit**

```bash
git add app/health/link_models.py app/models.py app/screens/models.py alembic/versions/0065_screen_vnnox_link.py tests/test_vnnox_link.py
git commit -m "feat(health): screen_vnnox_link table gates VNNOX polling"
```

---

## Task 5: Fixtures — recorded VNNOX payloads

The account has no bound devices, so every later task is tested against payloads built from the published response examples. Without this task, Tasks 6 onward have nothing to assert on.

**Files:**
- Create: `tests/fixtures/vnnox/all_one_screen.json`, `tests/fixtures/vnnox/all_dark_cabinet.json`, `tests/fixtures/vnnox/screen_list.json`

**Interfaces:**
- Produces: three JSON files matching the documented `POST /all` and `screen/list` response schemas.

- [ ] **Step 1: Write the healthy fixture**

```json
{
  "value": [
    {
      "identifier": "LED 16",
      "sid": 4685,
      "mac": "00FF5C24E412",
      "screen": {
        "monitor": {
          "displayDevice": "LED",
          "brightness": 65,
          "envBrightness": 10000,
          "width": 1920,
          "height": 3840,
          "sn": "2YHA23C12A3A10080149"
        }
      },
      "masterControl": {
        "basics": {
          "status": true,
          "networkPortsNum": 1,
          "version": "4.7.7.1601",
          "timeZone": "UTC+05:30",
          "reportTime": "2026-09-09 17:32:32"
        },
        "alarm": [],
        "running": {
          "basic": {
            "cpuUsageRate": 21,
            "availableMemory": 512,
            "availableStorageSpace": 9001,
            "screenStatus": "OPEN"
          }
        }
      },
      "receivingCard": {
        "topology": {
          "topologys": [
            {"com": "COM1", "senderIndex": 0, "portIndex": 0, "connectIndex": 0,
             "groupIndex": 0, "x": 0, "y": 0, "width": 128, "height": 128,
             "physicalDataKey": "0100020003000500"},
            {"com": "COM1", "senderIndex": 0, "portIndex": 0, "connectIndex": 1,
             "groupIndex": 0, "x": 128, "y": 0, "width": 128, "height": 128,
             "physicalDataKey": "0100020003000501"},
            {"com": "COM1", "senderIndex": 0, "portIndex": 0, "connectIndex": 2,
             "groupIndex": 0, "x": 0, "y": 128, "width": 128, "height": 128,
             "physicalDataKey": "0100020003000502"},
            {"com": "COM1", "senderIndex": 0, "portIndex": 0, "connectIndex": 3,
             "groupIndex": 0, "x": 128, "y": 128, "width": 128, "height": 128,
             "physicalDataKey": "0100020003000503"}
          ],
          "senders": [
            {"com": "COM1", "senderIndex": 0, "senderName": "T1-4G",
             "senderType": "T1-4G", "senderFirmwareVersion": "4.7.7.1601",
             "senderConnectedStatus": 1, "senderWorkStatus": 1,
             "senderPortsNumber": 1, "senderRate": 60}
          ],
          "redus": []
        },
        "basics": [
          {"position": "0100020003000500", "fpgaVersion": "1.2.3", "mcuVersion": "2.1", "modelType": "A8s"},
          {"position": "0100020003000501", "fpgaVersion": "1.2.3", "mcuVersion": "2.1", "modelType": "A8s"},
          {"position": "0100020003000502", "fpgaVersion": "1.2.3", "mcuVersion": "2.1", "modelType": "A8s"},
          {"position": "0100020003000503", "fpgaVersion": "1.2.3", "mcuVersion": "2.1", "modelType": "A8s"}
        ],
        "monitor": [
          {"position": "0100020003000500", "status": true, "temperature": "38.2", "voltage": "3.82"},
          {"position": "0100020003000501", "status": true, "temperature": "41.0", "voltage": "3.79"},
          {"position": "0100020003000502", "status": true, "temperature": "39.7", "voltage": "3.81"},
          {"position": "0100020003000503", "status": true, "temperature": "37.9", "voltage": "3.80"}
        ],
        "alarm": []
      },
      "monitorCard": {"monitor": []},
      "module": {"monitor": []},
      "smartModule": {"monitor": [], "alarm": []},
      "inputSource": {"monitor": {"cpu": 12, "memTotal": "1024", "memUsed": "512", "memSurplus": "512"}}
    }
  ]
}
```

- [ ] **Step 2: Write the faulty fixture**

Copy `all_one_screen.json` to `all_dark_cabinet.json` and make three changes, which together cover all three ways a cabinet goes bad:

1. In `receivingCard.monitor`, **delete** the entry for `0100020003000501` entirely — this is the case where a dead card drops out of the list rather than reporting false.
2. Change `0100020003000502`'s `"status"` to `false`.
3. Set `receivingCard.alarm` to:

```json
[
  {"position": "01000200030005010600", "alarmType": "Receiving card working status",
   "alarmValue": 0, "level": 4, "createAt": 1784300020000,
   "alarmFrom": "Receiving card", "alarmTime": "2026-07-16 18:53:40"},
  {"position": "01000200030005030100", "alarmType": "Temperature",
   "alarmValue": 68, "level": 3, "createAt": 1784300020000,
   "alarmFrom": "Receiving card", "alarmTime": "2026-07-16 18:53:40"}
]
```

Expected interpretation: cabinet `…0500` ok, `…0501` dark (absent + level 4), `…0502` dark (`status: false`), `…0503` degraded (level 3 temperature alarm).

- [ ] **Step 3: Write the screen list fixture**

```json
{
  "total": 1,
  "items": [
    {"sid": 4685, "name": "LED 16", "mac": "00FF5C24E412",
     "sn": "2YHA23C12A3A10080149", "address": "INDIA",
     "longitude": 77.6, "latitude": 12.93, "status": 1,
     "camera": 0, "brightness": 65, "envBrightness": 10000}
  ]
}
```

- [ ] **Step 4: Verify all three parse**

```bash
poetry run python -c "
import json, pathlib
for p in pathlib.Path('tests/fixtures/vnnox').glob('*.json'):
    json.loads(p.read_text()); print('ok', p.name)
"
```
Expected: three `ok` lines.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/vnnox
git commit -m "test(health): recorded VNNOX payloads for offline adapter tests"
```

---

## Task 6: `adapter.py` — VNNOX JSON → `HealthReport`

The heart of the plan. Everything downstream — tier derivation, fault open/close diffing, fleet tallies, the CMS — already exists and is driven by `record_health(db, screen_id, report)`. This task's only job is to produce a correct `HealthReport`.

**Files:**
- Create: `app/health/vendors/vnnox/adapter.py`
- Test: `tests/test_vnnox_adapter.py`

**Interfaces:**
- Consumes: `cabinet_key`, `describe_position` (Task 2); `HealthReport`, `ControllerReport`, `DisplayReport`, `PanelStatusReport` from `app.health.schemas`.
- Produces:
  - `def build_health_report(entry: dict) -> HealthReport`
  - `def screen_entries(payload: dict) -> dict[str, dict]` — maps SN → entry from a `/all` response
  - `NO_SENSOR = -255`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_vnnox_adapter.py
"""Translating a VNNOX /all entry into our HealthReport.

The three-state cabinet colour VNNOX shows is NOT a field any endpoint returns —
`status` is a boolean. VNNOX composes it from monitor + alarm + topology, and so
must we, or our CMS would disagree with their console about the same wall.
"""

import json
import pathlib

from app.health.vendors.vnnox.adapter import build_health_report, screen_entries

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "vnnox"


def _entry(name: str) -> dict:
    payload = json.loads((FIXTURES / name).read_text())
    return payload["value"][0]


def test_healthy_wall_reports_four_ok_cabinets():
    report = build_health_report(_entry("all_one_screen.json"))
    states = {p.cabinet_id: p.state for p in report.controller.panels}
    assert states == {
        "0100020003000500": "ok",
        "0100020003000501": "ok",
        "0100020003000502": "ok",
        "0100020003000503": "ok",
    }


def test_controller_identity_comes_from_master_control_and_topology():
    report = build_health_report(_entry("all_one_screen.json"))
    assert report.controller.reachable is True
    assert report.controller.brand == "novastar"
    assert report.controller.model == "T1-4G"
    assert report.controller.firmware == "4.7.7.1601"
    assert report.controller.brightness_percent == 65


def test_cabinet_absent_from_monitor_is_dark_not_missing():
    """A dead receiving card may vanish from `monitor` rather than report false.
    Read alone, that makes a broken wall look like a smaller healthy one."""
    report = build_health_report(_entry("all_dark_cabinet.json"))
    states = {p.cabinet_id: p.state for p in report.controller.panels}
    assert states["0100020003000501"] == "dark"


def test_status_false_is_dark():
    report = build_health_report(_entry("all_dark_cabinet.json"))
    states = {p.cabinet_id: p.state for p in report.controller.panels}
    assert states["0100020003000502"] == "dark"


def test_level_three_alarm_is_degraded_not_dark():
    """A hot cabinet is still lighting up. Calling it dark would make
    proof-of-play discount ads that really played."""
    report = build_health_report(_entry("all_dark_cabinet.json"))
    states = {p.cabinet_id: p.state for p in report.controller.panels}
    assert states["0100020003000503"] == "degraded"


def test_every_topology_cabinet_appears_even_when_unreported():
    report = build_health_report(_entry("all_dark_cabinet.json"))
    assert len(report.controller.panels) == 4


def test_readings_are_carried_through():
    report = build_health_report(_entry("all_one_screen.json"))
    first = next(
        p for p in report.controller.panels if p.cabinet_id == "0100020003000500"
    )
    assert first.temperature_c == 38.2
    assert first.voltages == {"main": 3.82}


def test_no_monitoring_cards_means_tier_stays_controller():
    report = build_health_report(_entry("all_one_screen.json"))
    assert report.controller.has_monitoring_cards is False


def test_minus_255_is_dropped_rather_than_stored():
    """-255 is VNNOX's 'no sensor fitted' sentinel across fansSpeed and voltage.
    Stored as a number it would render a healthy wall as -255V faults."""
    entry = _entry("all_one_screen.json")
    entry["monitorCard"] = {
        "monitor": [
            {
                "position": "010002000300050006000000",
                "status": True,
                "fansSpeed": {"0": 2400, "1": -255},
                "voltage": {"0": 3.8, "1": -255},
                "smokeStatus": False,
                "cabinDoorStatus": False,
            }
        ]
    }
    report = build_health_report(entry)
    panel = next(
        p for p in report.controller.panels if p.cabinet_id == "0100020003000500"
    )
    assert panel.fan_rpm == 2400
    assert "1" not in (panel.voltages or {})
    assert report.controller.has_monitoring_cards is True


def test_observed_at_uses_vnnox_report_time_not_now():
    """Their console warns of a sync lag. Stamping our poll time would overstate
    freshness on a page an operator uses to decide whether to send an engineer."""
    report = build_health_report(_entry("all_one_screen.json"))
    assert report.observed_at is not None
    assert report.observed_at.year == 2026
    assert report.observed_at.month == 9


def test_screen_entries_keys_by_serial_number():
    payload = json.loads((FIXTURES / "all_one_screen.json").read_text())
    entries = screen_entries(payload)
    assert list(entries) == ["2YHA23C12A3A10080149"]
```

- [ ] **Step 2: Verify the test is valid**

```bash
poetry run python -m py_compile tests/test_vnnox_adapter.py && poetry run ruff check tests/test_vnnox_adapter.py
```

- [ ] **Step 3: Write the implementation**

```python
# app/health/vendors/vnnox/adapter.py
"""Translate a VNNOX Care `/all` entry into our own HealthReport.

This module is deliberately the only place that knows VNNOX's JSON shape.
Everything downstream — capability tiers, fault interval diffing, fleet tallies,
every CMS view — is driven by `HealthReport` and does not change when a vendor
is added.

The core problem it solves: **VNNOX does not return the cabinet status it
displays.** Their console paints Normal / Faulty / Risky per cabinet, but the
only per-cabinet field is a boolean `status`. They compose the three states from
three endpoints, and so do we:

    topology  the cabinets that SHOULD exist, and where they sit
    monitor   the cabinets that ANSWERED, with temperature and voltage
    alarm     what is wrong, addressed by the same `position` key

A cabinet present in topology but absent from monitor is the case that matters
most: a receiving card that has genuinely died may simply drop out of the list
rather than report `status: false`. Read from `monitor` alone, a wall with a
dead tile looks like a smaller, perfectly healthy wall.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.health.schemas import (
    ControllerReport,
    DisplayReport,
    HealthReport,
    PanelStatusReport,
)
from app.health.vendors.vnnox.position import cabinet_key, describe_position

logger = logging.getLogger(__name__)

# VNNOX writes this into fansSpeed{0..8} and voltage{0..8} for a channel with no
# sensor fitted. It is a sentinel, not a measurement.
NO_SENSOR = -255

# Alarm levels, from the documented enum on every */alarm endpoint.
LEVEL_RISK = 3
LEVEL_FAULT = 4

# Alarm types that mean the cabinet has stopped lighting up, as opposed to
# running badly. Matched case-insensitively on a substring because VNNOX's
# wording varies between firmware versions.
_DARK_ALARM_HINTS = ("working status", "disconnect", "hardware connection")


def _f(value: Any) -> Optional[float]:
    """Parse a VNNOX numeric that may arrive as a string, and drop the sentinel."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if number == NO_SENSOR else number


def _channels(raw: Any) -> dict[str, float]:
    """VNNOX's 9-channel maps are keyed "0".."8" — nine sensor channels on ONE
    card, not nine cabinets. Sentinel channels are omitted entirely."""
    out: dict[str, float] = {}
    if isinstance(raw, dict):
        items = raw.items()
    elif isinstance(raw, list):
        items = ((str(i), v) for i, v in enumerate(raw))
    else:
        return out
    for key, value in items:
        parsed = _f(value)
        if parsed is not None:
            out[str(key)] = parsed
    return out


def _report_time(entry: dict) -> Optional[datetime]:
    """VNNOX's own synchronisation timestamp. Their console shows this rather
    than a fetch time, and warns of a lag; we do the same."""
    raw = (
        entry.get("masterControl", {}).get("basics", {}).get("reportTime")
        or None
    )
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def screen_entries(payload: dict) -> dict[str, dict]:
    """Index a `/all` response by the SN we asked for.

    The SN lives on the nested screen monitor block rather than the top level,
    so a caller cannot simply zip the request and response arrays.
    """
    out: dict[str, dict] = {}
    for entry in payload.get("value") or []:
        sn = (entry.get("screen") or {}).get("monitor", {}).get("sn")
        if not sn:
            sn = entry.get("sn") or entry.get("identifier")
        if sn:
            out[str(sn)] = entry
    return out


def build_health_report(entry: dict) -> HealthReport:
    """One screen's VNNOX entry → the report `record_health` consumes."""
    receiving = entry.get("receivingCard") or {}
    topology = (receiving.get("topology") or {}).get("topologys") or []
    senders = (receiving.get("topology") or {}).get("senders") or []
    monitors = receiving.get("monitor") or []
    screen_monitor = (entry.get("screen") or {}).get("monitor") or {}
    basics = (entry.get("masterControl") or {}).get("basics") or {}

    # ── monitor rows, indexed by cabinet ─────────────────────────────────────
    by_cabinet: dict[str, dict] = {}
    for row in monitors:
        position = row.get("position")
        if not position:
            continue
        try:
            by_cabinet[cabinet_key(position)] = row
        except ValueError:
            logger.warning("vnnox: unparseable monitor position %r", position)

    # ── card basics (FPGA/MCU/model), indexed by cabinet ─────────────────────
    basics_by_cabinet: dict[str, dict] = {}
    for row in receiving.get("basics") or []:
        position = row.get("position")
        if not position:
            continue
        try:
            basics_by_cabinet[cabinet_key(position)] = row
        except ValueError:
            continue

    # ── monitoring-card rows, indexed by cabinet ─────────────────────────────
    card_by_cabinet: dict[str, dict] = {}
    for row in (entry.get("monitorCard") or {}).get("monitor") or []:
        position = row.get("position")
        if not position:
            continue
        try:
            card_by_cabinet[cabinet_key(position)] = row
        except ValueError:
            continue

    # ── alarms, grouped by cabinet ───────────────────────────────────────────
    alarms_by_cabinet: dict[str, list[dict]] = {}
    for source in (receiving.get("alarm"), (entry.get("monitorCard") or {}).get("alarm")):
        for row in source or []:
            position = row.get("position")
            if not position:
                continue
            try:
                key = cabinet_key(position)
            except ValueError:
                continue
            alarms_by_cabinet.setdefault(key, []).append(row)

    # ── build one PanelStatusReport per cabinet in TOPOLOGY ──────────────────
    # Topology is the authority on which cabinets exist. Iterating `monitor`
    # instead would silently shrink the wall when a card dies.
    panels: list[PanelStatusReport] = []
    for cell in topology:
        position = cell.get("physicalDataKey")
        if not position:
            continue
        try:
            key = cabinet_key(position)
        except ValueError:
            continue

        row = by_cabinet.get(key)
        alarms = alarms_by_cabinet.get(key, [])
        card = card_by_cabinet.get(key)

        state = _cabinet_state(row=row, alarms=alarms)

        voltages: dict[str, float] = {}
        if row is not None:
            main = _f(row.get("voltage"))
            if main is not None:
                voltages["main"] = main
        if card is not None:
            voltages.update(_channels(card.get("voltage")))

        fans = _channels(card.get("fansSpeed")) if card else {}

        detail: dict[str, Any] = {
            "position": position,
            "location": describe_position(position),
            "x": cell.get("x"),
            "y": cell.get("y"),
            "width": cell.get("width"),
            "height": cell.get("height"),
            "sender_index": cell.get("senderIndex"),
            "port_index": cell.get("portIndex"),
            "connect_index": cell.get("connectIndex"),
        }
        card_basics = basics_by_cabinet.get(key)
        if card_basics:
            detail["fpga_version"] = card_basics.get("fpgaVersion")
            detail["mcu_version"] = card_basics.get("mcuVersion")
            detail["model_type"] = card_basics.get("modelType")
        if alarms:
            detail["alarms"] = [
                {
                    "type": a.get("alarmType"),
                    "level": a.get("level"),
                    "value": a.get("alarmValue"),
                    "location": _safe_describe(a.get("position")),
                    "at": a.get("alarmTime") or a.get("alarmStart"),
                }
                for a in alarms
            ]

        panels.append(
            PanelStatusReport(
                cabinet_id=key,
                state=state,
                temperature_c=_f(row.get("temperature")) if row else None,
                fan_rpm=int(max(fans.values())) if fans else None,
                voltages=voltages or None,
                door_open=_bool(card.get("cabinDoorStatus")) if card else None,
                smoke_alarm=_bool(card.get("smokeStatus")) if card else None,
                flat_cable_ok=_flat_cable(card) if card else None,
                detail=detail,
            )
        )

    sender = senders[0] if senders else {}
    controller = ControllerReport(
        reachable=bool(basics.get("status", True)),
        brand="novastar",
        model=sender.get("senderType") or sender.get("senderName"),
        firmware=basics.get("version") or sender.get("senderFirmwareVersion"),
        has_monitoring_cards=bool(card_by_cabinet),
        brightness_percent=_f(screen_monitor.get("brightness")),
        input_width=_int(screen_monitor.get("width")),
        input_height=_int(screen_monitor.get("height")),
        panels=panels,
    )

    display = DisplayReport(
        connected=True,
        manufacturer="NovaStar",
        model=screen_monitor.get("displayDevice"),
        native_width=_int(screen_monitor.get("width")),
        native_height=_int(screen_monitor.get("height")),
    )

    return HealthReport(
        display=display, controller=controller, observed_at=_report_time(entry)
    )


def _cabinet_state(*, row: Optional[dict], alarms: list[dict]) -> str:
    """Compose the state VNNOX displays but does not return.

    Order matters: dark wins over degraded, because a cabinet that is both hot
    and disconnected is a black tile, and that is the fact an operator acts on.
    """
    # Absent from monitor entirely — the card did not answer.
    if row is None:
        return "dark"

    status = row.get("status")
    if status is None:
        status = row.get("deviceWorkState")  # standalone endpoint's name
    if status is False:
        return "dark"

    fault = [a for a in alarms if a.get("level") == LEVEL_FAULT]
    if fault:
        text = " ".join(str(a.get("alarmType") or "") for a in fault).lower()
        if any(hint in text for hint in _DARK_ALARM_HINTS):
            return "dark"
        return "degraded"

    if any(a.get("level") == LEVEL_RISK for a in alarms):
        return "degraded"

    if status is True:
        return "ok"
    return "unknown"


def _safe_describe(position: Any) -> Optional[str]:
    if not position:
        return None
    try:
        return describe_position(str(position))
    except ValueError:
        return None


def _bool(value: Any) -> Optional[bool]:
    return None if value is None else bool(value)


def _int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _flat_cable(card: dict) -> Optional[bool]:
    raw = card.get("socketCableStatus")
    if raw is None or raw == []:
        return None
    if isinstance(raw, list):
        return all(bool(v) for v in raw)
    return bool(raw)
```

- [ ] **Step 4: Verify against the fixtures**

```bash
poetry run python -c "
import json, pathlib
from app.health.vendors.vnnox.adapter import build_health_report
for name in ('all_one_screen.json','all_dark_cabinet.json'):
    e = json.loads(pathlib.Path('tests/fixtures/vnnox/'+name).read_text())['value'][0]
    r = build_health_report(e)
    print(name, {p.cabinet_id[-4:]: p.state for p in r.controller.panels})
"
poetry run ruff check app/health/vendors/vnnox/adapter.py
```
Expected:
```
all_one_screen.json {'0500': 'ok', '0501': 'ok', '0502': 'ok', '0503': 'ok'}
all_dark_cabinet.json {'0500': 'ok', '0501': 'dark', '0502': 'dark', '0503': 'degraded'}
```

- [ ] **Step 5: Commit**

```bash
git add app/health/vendors/vnnox/adapter.py tests/test_vnnox_adapter.py
git commit -m "feat(health): map VNNOX Care payloads onto HealthReport"
```

---

## Task 6b: The adapter registry

The keyword is only useful if something dispatches on it. This is the seam every future media-player integration plugs into, so it exists from the start with one entry rather than being retrofitted when the second vendor arrives.

**Files:**
- Create: `app/health/vendors/registry.py`
- Test: `tests/test_health_vendor_registry.py`

**Interfaces:**
- Produces:
  - `class HealthVendor(Protocol)` with `key: str` and `async def poll(db, links) -> VendorSummary`
  - `def vendor_for(player_kind: str | None) -> HealthVendor | None`
  - `def monitored_kinds() -> list[str]`
  - `HEALTH_ADAPTERS: dict[str, HealthVendor]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_health_vendor_registry.py
"""Keyword → telemetry adapter.

The registry exists because `player_kind` is a keyword rather than a boolean:
more media players are planned and each has its own API, so the question a screen
answers is "which vendor do I call", not "am I monitored".
"""

from app.health.vendors.registry import monitored_kinds, vendor_for


def test_novastar_resolves_to_an_adapter():
    assert vendor_for("novastar") is not None


def test_andbox_has_no_adapter():
    """Our own media player is not special-cased anywhere. It simply has no
    entry, which is why nothing is ever called for it."""
    assert vendor_for("andbox") is None


def test_an_unknown_keyword_resolves_to_nothing():
    """A keyword from a newer APK than this backend must be inert, not a crash.
    Rolling the APK out ahead of the backend has to be safe."""
    assert vendor_for("colorlight") is None


def test_none_and_empty_resolve_to_nothing():
    assert vendor_for(None) is None
    assert vendor_for("") is None


def test_lookup_is_case_insensitive():
    assert vendor_for("NovaStar") is not None


def test_monitored_kinds_lists_only_keywords_with_adapters():
    kinds = monitored_kinds()
    assert "novastar" in kinds
    assert "andbox" not in kinds
```

- [ ] **Step 2: Verify the test is valid**

```bash
poetry run python -m py_compile tests/test_health_vendor_registry.py && poetry run ruff check tests/test_health_vendor_registry.py
```

- [ ] **Step 3: Write the registry**

```python
# app/health/vendors/registry.py
"""Which telemetry adapter serves which player keyword.

`screens.player_kind` is a keyword, not a boolean, because every media player we
integrate brings its own telemetry API. A screen therefore answers "which vendor
do I call", and this module is where that question is resolved.

Adding an integration is: write an adapter, add one line below. Nothing that
already works changes, and no screen is touched.

Our own media player (`andbox`) is deliberately absent rather than mapped to a
null adapter. "Not in the registry" is the same code path as "a keyword this
backend has never heard of", which is what makes it safe to roll an APK that
sends a new keyword out ahead of the backend that understands it.
"""

from __future__ import annotations

from typing import Optional, Protocol, Sequence

from sqlalchemy.ext.asyncio import AsyncSession


class HealthVendor(Protocol):
    """One vendor's panel telemetry."""

    key: str

    async def poll(self, db: AsyncSession, links: Sequence[object]) -> object:
        """Fetch and persist health for the given screens."""
        ...


def _build_registry() -> dict[str, HealthVendor]:
    # Imported here rather than at module scope so the registry can be read by
    # config/tooling without pulling in httpx and the whole client stack.
    from app.health.vendors.vnnox.vendor import VnnoxCareVendor

    return {"novastar": VnnoxCareVendor()}


HEALTH_ADAPTERS: dict[str, HealthVendor] = _build_registry()


def vendor_for(player_kind: Optional[str]) -> Optional[HealthVendor]:
    """The adapter for a keyword, or None if there is none.

    None is a normal answer, not an error: it covers our own media player and any
    keyword newer than this backend.
    """
    return HEALTH_ADAPTERS.get((player_kind or "").strip().lower())


def monitored_kinds() -> list[str]:
    """Keywords that actually cause a call. The sync selects on exactly this."""
    return sorted(HEALTH_ADAPTERS)
```

- [ ] **Step 4: Write the NovaStar vendor wrapper**

```python
# app/health/vendors/vnnox/vendor.py
"""The VNNOX Care adapter, as the registry sees it.

A thin object over `sync.poll_links` so the registry has something uniform to
call. The vendor-specific work stays in sync.py / adapter.py.
"""

from __future__ import annotations

from typing import Sequence

from sqlalchemy.ext.asyncio import AsyncSession


class VnnoxCareVendor:
    key = "novastar"
    label = "NovaStar"

    async def poll(self, db: AsyncSession, links: Sequence[object]):
        from app.health.vendors.vnnox.sync import poll_links

        return await poll_links(db, links)
```

- [ ] **Step 5: Verify**

```bash
poetry run python -c "
from app.health.vendors.registry import vendor_for, monitored_kinds
assert vendor_for('NovaStar') is not None
assert vendor_for('andbox') is None
assert vendor_for('colorlight') is None
print('registry ok', monitored_kinds())
"
poetry run ruff check app/health/vendors
```
Expected: `registry ok ['novastar']`, no ruff output.

- [ ] **Step 6: Commit**

```bash
git add app/health/vendors/registry.py app/health/vendors/vnnox/vendor.py tests/test_health_vendor_registry.py
git commit -m "feat(health): keyword-to-adapter registry for panel telemetry"
```

---

## Task 7: `sync.py` + cron route

**Files:**
- Create: `app/health/vendors/vnnox/sync.py`
- Modify: `app/health/router.py` (append a cron router), `app/api/routers/routers.py`
- Test: `tests/test_vnnox_sync.py`

**Interfaces:**
- Consumes: `VnnoxClient`, `VnnoxError` (Task 3); `ScreenVnnoxLink` and `Screen.player_kind` (Task 4); `build_health_report`, `screen_entries` (Task 6); `VnnoxCareVendor` (Task 6b); `record_health` from `app.health.service`.
- Produces:
  - `async def sync_all(db: AsyncSession, client: VnnoxClient | None = None) -> SyncSummary`
  - `async def poll_links(db, pollable: Sequence[ScreenVnnoxLink], client=None) -> SyncSummary`
  - `class SyncSummary` with `.screens_polled: int`, `.screens_failed: int`, `.batches: int`
  - `BATCH_SIZE = 10`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_vnnox_sync.py
"""Batching and failure isolation for the VNNOX poll.

Two properties matter more than the happy path:
  * screens with no link row are never in a request (that is the entire gate);
  * one screen's failure does not blank the others.
"""

from app.health.vendors.vnnox.sync import BATCH_SIZE, chunk


def test_batch_size_matches_the_documented_bulk_ceiling():
    """POST /all accepts at most 10 SNs. Exceeding it fails the whole call."""
    assert BATCH_SIZE == 10


def test_chunk_splits_on_the_batch_size():
    assert chunk(list(range(25)), 10) == [
        list(range(10)), list(range(10, 20)), list(range(20, 25))
    ]


def test_chunk_of_empty_is_empty():
    assert chunk([], 10) == []


def test_chunk_shorter_than_batch_is_one_batch():
    assert chunk([1, 2], 10) == [[1, 2]]
```

- [ ] **Step 2: Verify the test is valid**

```bash
poetry run python -m py_compile tests/test_vnnox_sync.py && poetry run ruff check tests/test_vnnox_sync.py
```

- [ ] **Step 3: Write the sync**

```python
# app/health/vendors/vnnox/sync.py
"""Poll VNNOX Care for every linked screen and persist the result.

Two constraints shape this file.

**The rate limit.** VNNOX allows 5 requests/second and 1000/hour, account-wide
across every endpoint. Polling a screen through its 14 individual endpoints
costs 14 requests per screen per cycle, which at a 5-minute interval caps the
entire fleet at about five screens. `POST /all` returns every subsystem for ten
screens in ONE request, which raises that ceiling to roughly eight hundred. The
bulk endpoint is therefore mandatory, not an optimisation, and the per-endpoint
routes exist only for on-demand drill-down.

**Failure isolation.** A batch is ten screens. One unknown SN must not blank the
other nine, so a failed batch is retried per screen before anything is written
as unreachable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional, Sequence, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.health.link_models import ScreenVnnoxLink
from app.health.schemas import ControllerReport, HealthReport
from app.health.service import record_health
from app.health.vendors.vnnox.adapter import build_health_report, screen_entries
from app.health.vendors.vnnox.client import VnnoxClient, VnnoxError
from app.health.vendors.vnnox.vendor import VnnoxCareVendor
from app.screens.models import Screen

logger = logging.getLogger(__name__)

# The documented ceiling for POST /all. Sending more fails the whole request.
BATCH_SIZE = 10

ALL_PATH = "/v2/device-status-monitor/all"

T = TypeVar("T")


def chunk(items: Sequence[T], size: int) -> list[list[T]]:
    return [list(items[i : i + size]) for i in range(0, len(items), size)]


@dataclass
class SyncSummary:
    screens_polled: int = 0
    screens_failed: int = 0
    batches: int = 0
    errors: list[str] = field(default_factory=list)


async def sync_all(
    db: AsyncSession, client: Optional[VnnoxClient] = None
) -> SyncSummary:
    """Select the screens this vendor owns, then poll them.

    Selection is on the keyword AND the adapter's config row. A screen whose
    `player_kind` has no registered adapter is not merely skipped here — it is
    never a candidate, which is why our own media player cannot produce an error
    on this path.
    """
    rows = (
        (
            await db.execute(
                select(ScreenVnnoxLink)
                .join(Screen, Screen.id == ScreenVnnoxLink.screen_id)
                .where(Screen.player_kind == VnnoxCareVendor.key)
            )
        )
        .scalars()
        .all()
    )
    return await poll_links(db, [link for link in rows if link.pollable], client)


async def poll_links(
    db: AsyncSession,
    pollable: Sequence[ScreenVnnoxLink],
    client: Optional[VnnoxClient] = None,
) -> SyncSummary:
    """Poll a specific set of already-selected links. The registry's entry point."""
    summary = SyncSummary()
    client = client or VnnoxClient()
    if not client.configured:
        logger.info("vnnox: no credentials configured, skipping sync")
        return summary
    if not pollable:
        return summary

    by_sn = {link.effective_sn: link for link in pollable}

    for batch in chunk(list(by_sn), BATCH_SIZE):
        summary.batches += 1
        try:
            payload = await client.post(ALL_PATH, {"snList": batch})
        except VnnoxError as exc:
            # One bad SN fails the whole batch, so fall back to one call each
            # rather than marking ten healthy screens unreachable.
            logger.warning("vnnox: batch failed (%s), retrying individually", exc)
            for sn in batch:
                await _sync_one(db, client, by_sn[sn], sn, summary)
            continue

        entries = screen_entries(payload)
        for sn in batch:
            link = by_sn[sn]
            entry = entries.get(sn)
            if entry is None:
                await _mark_unreachable(db, link, "not returned by VNNOX", summary)
                continue
            await _persist(db, link, build_health_report(entry), summary)

    await db.commit()
    return summary


async def _sync_one(
    db: AsyncSession,
    client: VnnoxClient,
    link: ScreenVnnoxLink,
    sn: str,
    summary: SyncSummary,
) -> None:
    try:
        payload = await client.post(ALL_PATH, {"snList": [sn]})
    except VnnoxError as exc:
        await _mark_unreachable(db, link, str(exc), summary)
        return
    entry = screen_entries(payload).get(sn)
    if entry is None:
        await _mark_unreachable(db, link, "not returned by VNNOX", summary)
        return
    await _persist(db, link, build_health_report(entry), summary)


async def _persist(
    db: AsyncSession,
    link: ScreenVnnoxLink,
    report: HealthReport,
    summary: SyncSummary,
) -> None:
    await record_health(db, link.screen_id, report)
    link.touch_success()
    summary.screens_polled += 1


async def _mark_unreachable(
    db: AsyncSession, link: ScreenVnnoxLink, reason: str, summary: SyncSummary
) -> None:
    """Record that we could not see this wall.

    `reachable=False` with no panels drives every cabinet to `unknown`, which is
    the whole point: "we cannot see it" must never be stored as "it is fine".
    """
    await record_health(
        db,
        link.screen_id,
        HealthReport(controller=ControllerReport(reachable=False, brand="novastar")),
    )
    link.touch_error(reason)
    summary.screens_failed += 1
    summary.errors.append(f"{link.effective_sn}: {reason}")
```

- [ ] **Step 4: Add the cron route**

Append to `app/health/router.py`, following the pattern in `app/screenshots/router.py:331`:

```python
# ---- Cron router (secret-key auth, mounted under /api/cron) ----
from fastapi import Header  # noqa: E402  (grouped with the cron block)

from app.core.config import settings  # noqa: E402
from app.health.vendors.vnnox.sync import sync_all  # noqa: E402

cron_router = APIRouter(prefix="/cron", tags=["cron"])


def _require_cron_secret(x_cron_secret: str = Header(default="")) -> None:
    if not settings.CRON_SECRET or x_cron_secret != settings.CRON_SECRET:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)


@cron_router.post("/vnnox-health")
async def cron_vnnox_health(
    _=Depends(_require_cron_secret),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Poll VNNOX Care for every linked screen.

    Runs on cron-job.org every 5 minutes (GCP Cloud Scheduler is disabled on
    this project). At 12 cycles/hour and one request per ten screens, a
    hundred-screen fleet spends 120 of the 1000 hourly requests.
    """
    if not settings.VNNOX_ENABLED:
        return {"skipped": True}
    summary = await sync_all(db)
    return {
        "screens_polled": summary.screens_polled,
        "screens_failed": summary.screens_failed,
        "batches": summary.batches,
        "errors": summary.errors[:20],
    }
```

- [ ] **Step 5: Mount the cron router**

In `app/api/routers/routers.py`, alongside the existing cron imports and includes:

```python
from app.health.router import cron_router as health_cron_router
...
api_router.include_router(health_cron_router)
```

- [ ] **Step 6: Verify**

```bash
poetry run python -c "
from app.main import app
paths = [r.path for r in app.routes]
assert any('/cron/vnnox-health' in p for p in paths), paths
print('route mounted')
"
poetry run ruff check app/health
```
Expected: `route mounted`, no ruff output.

- [ ] **Step 7: Commit**

```bash
git add app/health/vendors/vnnox/sync.py app/health/router.py app/api/routers/routers.py tests/test_vnnox_sync.py
git commit -m "feat(health): poll VNNOX Care on a cron and persist per-cabinet state"
```

---

## Task 8: Setting the keyword — operator choice, plus heartbeat detection

**Files:**
- Create: `app/health/link_service.py`
- Modify: `app/playback/schemas.py`, `app/playback/service.py` (heartbeat handler), `app/health/router.py`, `app/health/schemas.py`
- Test: `tests/test_vnnox_link_service.py`

**Interfaces:**
- Consumes: `ScreenVnnoxLink` (Task 4).
- Produces:
  - `def clean_serial(serial: str | None) -> str | None`
  - `async def record_detected_controller(db, screen: Screen, vendor: str | None, serial: str | None) -> None`
  - `async def set_player_kind(db, screen_id: str, player_kind: str, vnnox_sn: str | None) -> ScreenVnnoxLink | None`
  - `async def get_link(db, screen_id: str) -> ScreenVnnoxLink | None`
  - Response schema `PlayerKindView` with `player_kind, monitored, vnnox_sn, effective_sn, detected_serial, detected_vendor, last_sync_at, last_error`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_vnnox_link_service.py
"""The monitoring source is chosen, not inferred.

The whole gate is: did an operator pick "NovaStar + VNNOX Care" for this screen?
Detection feeds the form a suggested serial and nothing else. These tests exist
mainly to pin down that separation, because collapsing the two is the obvious
"simplification" a later reader will be tempted to make.
"""

from app.health.link_service import clean_serial


def test_a_real_serial_survives_cleaning():
    assert clean_serial("2YHA23C12A3A10080149") == "2YHA23C12A3A10080149"


def test_surrounding_whitespace_is_stripped():
    assert clean_serial("  2YHA23C12A3A10080149\n") == "2YHA23C12A3A10080149"


def test_none_stays_none():
    assert clean_serial(None) is None


def test_blank_becomes_none():
    assert clean_serial("   ") is None


def test_the_android_placeholder_is_rejected():
    """Build.SERIAL returns the literal string "unknown" from API 29 without
    privileged permission. Prefilling a form with it would invite an operator to
    save a serial that cannot exist."""
    assert clean_serial("unknown") is None
    assert clean_serial("UNKNOWN") is None


def test_other_placeholder_values_are_rejected():
    assert clean_serial("null") is None
    assert clean_serial("0") is None
```

- [ ] **Step 2: Verify the test is valid**

```bash
poetry run python -m py_compile tests/test_vnnox_link_service.py && poetry run ruff check tests/test_vnnox_link_service.py
```

- [ ] **Step 3: Write the service**

```python
# app/health/link_service.py
"""Choosing a screen's panel-monitoring source.

Two jobs that must not be merged:

**The choice.** `set_player_kind` writes `screens.player_kind` — the keyword that
selects a telemetry adapter — and creates or removes that adapter's config row.
This is the only thing that can put a screen into a poll.

**The detection.** `record_detected_controller` stores what the APK saw on the
box it is running on. It writes to `screens`, never to the link, and therefore
can never cause a call to VNNOX. It exists so the form can prefill the serial
and suggest enabling monitoring.

The temptation to collapse these — "the APK already knows it is a NovaStar, just
link it" — is the design that was rejected. Detecting a NovaStar means matching
build-property substrings, and a false positive would poll VNNOX for a screen
that has no controller, producing an error on every cycle forever. A person
ticking a box cannot be wrong in that direction.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.health.link_models import ScreenVnnoxLink
from app.screens.models import Screen

# Android returns these literals instead of a serial when the caller lacks
# READ_PRIVILEGED_PHONE_STATE. They are not serials.
_PLACEHOLDERS = {"unknown", "null", "none", "0"}


def clean_serial(serial: Optional[str]) -> Optional[str]:
    """A usable serial, or None. Placeholders are treated as absent."""
    if not serial:
        return None
    cleaned = serial.strip()
    if not cleaned or cleaned.lower() in _PLACEHOLDERS:
        return None
    return cleaned


async def get_link(db: AsyncSession, screen_id: str) -> Optional[ScreenVnnoxLink]:
    return (
        await db.execute(
            select(ScreenVnnoxLink).where(ScreenVnnoxLink.screen_id == screen_id)
        )
    ).scalar_one_or_none()


async def record_detected_controller(
    db: AsyncSession,
    screen: Screen,
    vendor: Optional[str],
    serial: Optional[str],
) -> None:
    """Store what the APK detected. Never creates a link, never triggers a poll.

    Best-effort: must not raise into the heartbeat, or one malformed field would
    take a screen offline in the CMS.
    """
    cleaned = clean_serial(serial)
    if cleaned and screen.controller_serial != cleaned:
        screen.controller_serial = cleaned
    if vendor and screen.controller_vendor != vendor:
        screen.controller_vendor = vendor


async def set_player_kind(
    db: AsyncSession, screen_id: str, player_kind: str, vnnox_sn: Optional[str]
) -> Optional[ScreenVnnoxLink]:
    """Set a screen's player keyword, and its adapter config if it has one.

    Switching AWAY from a vendor deletes that vendor's config row rather than
    leaving it orphaned, so "is this screen polled by X" has exactly one answer
    and cannot drift between the keyword and a stale row.

    Unknown keywords are accepted and stored. A keyword this backend has no
    adapter for is inert, which is what makes it safe to roll out an APK that
    knows about a new player before the backend that polls it.
    """
    screen = (
        await db.execute(select(Screen).where(Screen.id == screen_id))
    ).scalar_one()
    screen.player_kind = (player_kind or "andbox").strip().lower()

    link = await get_link(db, screen_id)

    if screen.player_kind != "novastar":
        if link is not None:
            await db.delete(link)
        return None

    if link is None:
        link = ScreenVnnoxLink(screen_id=screen_id)
        db.add(link)
    link.vnnox_sn = clean_serial(vnnox_sn)
    link.last_error = None
    await db.flush()
    return link
```

- [ ] **Step 4: Carry the serial on the heartbeat**

In `app/playback/schemas.py`, add to `HeartbeatRequest` (both optional, so an unchanged beat stays byte-identical to before):

```python
    # Present only when the player is running on an LED controller that exposes
    # a serial (a NovaStar Taurus). Its ABSENCE is what keeps a plain media
    # player out of the VNNOX poll entirely.
    controller_vendor: Optional[str] = None
    controller_serial: Optional[str] = None
```

In the heartbeat handler in `app/playback/service.py`, after the screen row is loaded and before the response is built:

```python
    from app.health.link_service import record_detected_controller

    try:
        # Writes to `screens` only. Cannot enable monitoring — that is the
        # operator's call, recorded in screen_vnnox_link.
        await record_detected_controller(
            db, screen, payload.controller_vendor, payload.controller_serial
        )
    except Exception:  # never fail a heartbeat over a health detail
        logger.exception("controller detection failed for screen %s", screen.id)
```

- [ ] **Step 5: Add the CMS endpoints**

In `app/health/schemas.py`:

```python
class PlayerKindView(BaseModel):
    """A screen's player keyword as the CMS shows it.

    `monitored` is DERIVED from whether the keyword has a registered adapter —
    it is never stored, so it cannot disagree with the registry. `detected_*` is
    what the APK saw and is only ever a suggestion: a screen can have a detected
    NovaStar serial and still be `andbox`, which is a legitimate state.
    """

    player_kind: str
    monitored: bool
    vnnox_sn: Optional[str] = None
    effective_sn: Optional[str] = None
    detected_serial: Optional[str] = None
    detected_vendor: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None


class SetPlayerKindRequest(BaseModel):
    """Any keyword is accepted; one with no adapter is simply inert.

    `vnnox_sn` applies only to `novastar` and is ignored for anything else.
    """

    player_kind: str
    vnnox_sn: Optional[str] = None
```

In `app/health/router.py`:

```python
def _kind_view(screen: Screen, link: ScreenVnnoxLink | None) -> PlayerKindView:
    return PlayerKindView(
        player_kind=screen.player_kind,
        # Derived from the registry, never stored — so a keyword whose adapter is
        # removed stops claiming to be monitored without a data migration.
        monitored=vendor_for(screen.player_kind) is not None,
        vnnox_sn=link.vnnox_sn if link else None,
        effective_sn=link.effective_sn if link else None,
        detected_serial=screen.controller_serial,
        detected_vendor=screen.controller_vendor,
        last_sync_at=link.last_sync_at if link else None,
        last_error=link.last_error if link else None,
    )


@router.get("/{screen_id}/player-kind", response_model=PlayerKindView)
async def get_player_kind(
    screen_id: str,
    actor: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
):
    """Always returns a view, even for `andbox` — the form needs the detected
    serial in order to offer it as a suggestion."""
    await assert_can_manage_screen(db, actor, screen_id)
    screen = await _load_screen(db, actor, screen_id)
    return _kind_view(screen, await link_service.get_link(db, screen_id))


@router.put("/{screen_id}/player-kind", response_model=PlayerKindView)
async def put_player_kind(
    screen_id: str,
    body: SetPlayerKindRequest,
    actor: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
):
    """Set this screen's player keyword.

    The keyword selects a telemetry adapter: `novastar` → VNNOX Care, `andbox` →
    none. This is the only way a screen ever enters a poll — the APK's detection
    cannot do it, because a mis-detected screen would then error on every cycle.

    `vnnox_sn` is separate from the detected serial because we do not yet know
    that a Taurus's Android serial equals the SN VNNOX indexes it by.
    """
    await assert_can_manage_screen(db, actor, screen_id)
    screen = await _load_screen(db, actor, screen_id)
    link = await link_service.set_player_kind(
        db, screen_id, body.player_kind, body.vnnox_sn
    )
    await db.commit()
    return _kind_view(screen, link)
```

- [ ] **Step 6: Verify**

```bash
poetry run python -c "
from app.main import app
paths = [r.path for r in app.routes]
assert any('player-kind' in p for p in paths), 'player-kind routes missing'
print('link routes mounted')
"
poetry run ruff check app/health app/playback
```
Expected: `link routes mounted`, no ruff output.

- [ ] **Step 7: Commit**

```bash
git add app/health app/playback tests/test_vnnox_link_service.py
git commit -m "feat(health): bind screens to VNNOX from the heartbeat, with an operator override"
```

---

## Task 9: APK — report the controller serial

**Files:**
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/health/DeviceInfo.kt`
- Modify: the heartbeat request model (find with `grep -rn "cpu_percent" --include="*.kt" app/src`)

**Interfaces:**
- Produces: heartbeat fields `controller_vendor` and `controller_serial`, omitted when null.

- [ ] **Step 1: Add serial reading to `DeviceInfo.kt`**

`Build.SERIAL` returns the literal `"unknown"` on API 29+ without privileged permission, so read the system property directly — which works on the rooted/AOSP boxes we deploy to.

```kotlin
/**
 * The box's own serial, or null.
 *
 * This is a SUGGESTION, not a binding. The backend stores it on the screen and
 * the CMS offers it as a prefill when an operator turns on panel monitoring;
 * nothing here can cause a VNNOX call on its own. That separation is deliberate
 * — a wrong detection must never be able to put a screen into the poll.
 *
 * `Build.SERIAL` is useless from API 29 (returns the string "unknown" without
 * READ_PRIVILEGED_PHONE_STATE), so read the property the platform sets.
 */
fun controllerSerial(): String? = try {
    val process = Runtime.getRuntime().exec(arrayOf("getprop", "ro.serialno"))
    val value = process.inputStream.bufferedReader().readText().trim()
    process.waitFor()
    value.takeIf { it.isNotEmpty() && it.lowercase() !in setOf("unknown", "null", "0") }
} catch (e: Exception) {
    null
}

/**
 * A hint that this box looks like a NovaStar controller.
 *
 * Substring matching on build properties is a guess and is treated as one: the
 * CMS uses it only to prompt "this looks like a NovaStar — enable panel
 * monitoring?". It is never a gate, because a false positive would otherwise
 * poll VNNOX for a screen that has no controller.
 */
fun controllerVendor(): String? {
    val haystack = listOf(Build.MANUFACTURER, Build.BRAND, Build.MODEL, Build.DEVICE)
        .joinToString(" ") { it.orEmpty() }
        .lowercase()
    return if (haystack.contains("nova") || haystack.contains("taurus")) "novastar" else null
}
```

- [ ] **Step 2: Add the fields to the heartbeat model**

In the Kotlin data class that serialises the heartbeat body, add:

```kotlin
    @SerialName("controller_vendor") val controllerVendor: String? = null,
    @SerialName("controller_serial") val controllerSerial: String? = null,
```

The project's `Json` is configured with `explicitNulls = false`, so a player with no controller sends a body byte-identical to today's.

- [ ] **Step 3: Populate them where the heartbeat is built**

```kotlin
    controllerVendor = DeviceInfo.controllerVendor(),
    controllerSerial = DeviceInfo.controllerSerial(),
```

- [ ] **Step 4: Verify it compiles**

```bash
cd markai-player-apk && ./gradlew :app:compileDebugKotlin
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/tech/markai/player/health/DeviceInfo.kt
git commit -m "feat(health): report the controller serial so the backend can bind VNNOX"
```

---

## Task 9b: Ask at install time

The installer is physically at the box and knows what it is. That is a better moment to ask than any later one, so the existing first-launch enrollment screen asks it — the same question the CMS asks, writing the same row.

**Files:**
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/net/dto/RegisterDto.kt`
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/ui/PlayerActivity.kt` (the key-entry screen)
- Modify: `markai-player-apk/app/src/main/java/tech/markai/player/enroll/Enrollment.kt`
- Modify: `app/screens/schemas.py`, `app/screens/service.py` (register handler)
- Test: `tests/test_vnnox_register_link.py`

**Interfaces:**
- Consumes: `set_player_kind`, `clean_serial` (Task 8).
- Produces: `RegisterRequest.playerKind: String?` (`"andbox"` | `"novastar"` | future keywords) and `RegisterRequest.controllerSerial: String?`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_vnnox_register_link.py
"""Install-time choice of monitoring source.

Registration is idempotent on device_uid and re-runs on every reinstall or
factory reset. The rule that matters is therefore not "does it create a link"
but "does it leave an existing one alone" — otherwise reinstalling a box would
silently revert an operator's CMS correction.
"""

from app.screens.service import should_create_link_on_register


def test_novastar_with_a_serial_creates_a_link():
    assert should_create_link_on_register(
        kind="novastar", serial="2YHA23C12A3A10080149", existing=None
    ) is True


def test_andbox_creates_nothing():
    assert should_create_link_on_register(
        kind="andbox", serial=None, existing=None
    ) is False


def test_no_answer_creates_nothing():
    """The zero-touch/MDM path prompts nobody. Those screens must arrive
    unmonitored and be set up in the CMS — unmonitored is the safe default."""
    assert should_create_link_on_register(kind=None, serial=None, existing=None) is False


def test_a_detected_serial_alone_creates_nothing():
    """Detection is never the gate, even at registration."""
    assert should_create_link_on_register(
        kind=None, serial="2YHA23C12A3A10080149", existing=None
    ) is False


def test_an_existing_link_is_never_overwritten():
    """A reinstall must not undo a CMS correction."""
    assert should_create_link_on_register(
        kind="novastar", serial="NEWSERIAL", existing=object()
    ) is False


def test_novastar_without_a_serial_still_creates_the_link():
    """The installer knows it is a NovaStar but may not have the SN to hand.
    Linked-but-not-addressable is a real state; the CMS then asks for the SN."""
    assert should_create_link_on_register(
        kind="novastar", serial=None, existing=None
    ) is True
```

- [ ] **Step 2: Verify the test is valid**

```bash
poetry run python -m py_compile tests/test_vnnox_register_link.py && poetry run ruff check tests/test_vnnox_register_link.py
```

- [ ] **Step 3: Add the fields to the register DTO**

In `RegisterDto.kt`, inside `RegisterRequest`:

```kotlin
    // What the installer answered on the first-launch screen: "andbox", "novastar", or a
    // keyword added later. Null on the zero-touch path, which prompts nobody — those
    // screens arrive unmonitored and are set up in the CMS. This is the ONLY
    // thing that can put a screen into the VNNOX poll at registration; the
    // detected serial below cannot, on its own.
    @SerialName("player_kind") val playerKind: String? = null,
    // Prefilled from ro.serialno, editable by the installer.
    @SerialName("controller_serial") val controllerSerial: String? = null,
```

- [ ] **Step 4: Add the question to the enrollment screen**

In `PlayerActivity.kt`, after the enrollment key is accepted and before registration is attempted, show a second step with two buttons — "Our media player" and "NovaStar controller". Choosing NovaStar reveals an editable field prefilled with `DeviceInfo.controllerSerial()`.

Pass the answer through `Enrollment.enroll(...)` into `RegisterRequest`:

```kotlin
    playerKind = if (isNovastar) "novastar" else "andbox",
    controllerSerial = if (isNovastar) enteredSerial.ifBlank { null } else null,
```

Show this step **only** when the key-entry UI is already being shown. On the `require_enrollment_key: false` path nobody is prompted, and adding a prompt there would break zero-touch provisioning.

- [ ] **Step 5: Add the backend fields and rule**

In `app/screens/schemas.py`, on the register request model:

```python
    # The installer's answer on the first-launch screen. None on the zero-touch
    # path. See should_create_link_on_register for why detection alone is not
    # enough to act on.
    player_kind: Optional[str] = None
    controller_serial: Optional[str] = None
```

In `app/screens/service.py`:

```python
def should_create_link_on_register(
    *, kind: Optional[str], serial: Optional[str], existing: object | None
) -> bool:
    """Whether registration should put this screen under VNNOX monitoring.

    Registration is idempotent and re-runs on every reinstall, so an EXISTING
    link always wins: the CMS is the authority once a screen is in the field,
    and a reinstall must not silently revert a correction made there.

    A serial with no answer is not enough. Detection never opens this gate — at
    registration or anywhere else.
    """
    if existing is not None:
        return False
    return kind == "novastar"
```

And in the register handler, after the screen row exists:

```python
    from app.health import link_service

    # The keyword the installer's choice produced is the whole trigger. Anything
    # other than "novastar" — including "andbox" and no answer at all —
    # leaves this screen out of the VNNOX poll entirely.
    existing = await link_service.get_link(db, screen.id)
    if should_create_link_on_register(
        kind=payload.player_kind,
        serial=payload.controller_serial,
        existing=existing,
    ):
        await link_service.set_player_kind(
            db, screen.id, "novastar", payload.controller_serial
        )

    # Detection is recorded separately and cannot open the gate. The vendor here
    # comes from the device profile the APK sniffed, NOT from the answer above —
    # keeping them distinct is what lets the CMS say "this looks like a NovaStar
    # but nobody enabled monitoring".
    await link_service.record_detected_controller(
        db,
        screen,
        payload.device_info.get("controller_vendor"),
        payload.controller_serial,
    )
```

- [ ] **Step 6: Verify**

```bash
cd markai-signage-api && poetry run ruff check app/screens app/health
poetry run python -c "
from app.screens.service import should_create_link_on_register as f
assert f(kind='novastar', serial='X', existing=None) is True
assert f(kind='novastar', serial='X', existing=object()) is False
assert f(kind=None, serial='X', existing=None) is False
print('register gate ok')
"
cd ../markai-player-apk && ./gradlew :app:compileDebugKotlin
```
Expected: `register gate ok`, then `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(health): ask the installer whether the box is a NovaStar"
```

---

## Task 10: CMS — the player-keyword picker, badge, and corrected tier copy

**Files:**
- Create: `src/components/screen-health/PlayerKindPicker.tsx`
- Modify: `src/lib/types.ts`, `src/app/(dashboard)/screen-health/page.tsx`, `src/app/(dashboard)/screen-health/[id]/page.tsx`, `app/health/capability.py` (backend copy fix)

**Interfaces:**
- Consumes: `GET /api/cms/screen-health/{id}/player-kind` → `PlayerKindView` (Task 8).

- [ ] **Step 1: Add the type**

In `src/lib/types.ts`:

```ts
/** The keyword that selects a screen's telemetry adapter, and what it resolved to.
 *
 *  `monitored` is derived by the backend from its adapter registry — never
 *  stored — so the CMS cannot claim a screen is monitored by an adapter that no
 *  longer exists. `detected_*` is what the player saw on its box and is only ever
 *  a suggestion: a screen can have a detected NovaStar serial and still be
 *  `andbox`, and that is a legitimate state, not an inconsistency. */
export type PlayerKind = {
  player_kind: string;
  monitored: boolean;
  vnnox_sn: string | null;
  effective_sn: string | null;
  detected_serial: string | null;
  detected_vendor: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

/** Keyword → how it is shown. New integrations add a row here and an adapter on
 *  the backend; nothing else changes. A keyword absent from this map is rendered
 *  by its raw value rather than hidden, so a screen running a newer APK than this
 *  CMS still shows something truthful. */
export const PLAYER_KINDS: Record<
  string,
  { label: string; tone: "gray" | "blue"; blurb: string }
> = {
  andbox: {
    label: "AndBox",
    tone: "gray",
    blurb: "Our own media player. Playback, screenshots and proof-of-play work as normal; no panel telemetry, because the player cannot see the panel.",
  },
  novastar: {
    label: "NovaStar",
    tone: "blue",
    blurb: "NovaStar controller running our APK. Adds cabinet health, temperature, voltage and alarms via VNNOX Care. Scheduling still runs entirely on our own player.",
  },
};

export function playerKindLabel(kind: string | null | undefined): string {
  if (!kind) return "Unknown";
  return PLAYER_KINDS[kind]?.label ?? kind;
}
```

- [ ] **Step 2: Correct the tier copy**

In `src/app/(dashboard)/screen-health/[id]/page.tsx`, `TAB_NEEDS.environment` currently reads `"Needs monitoring cards fitted in the cabinets."` That is wrong against VNNOX: `receiving-card/monitor` returns temperature and voltage per card without any monitoring card. Replace with:

```ts
  environment: "Needs a controller that reports per-cabinet readings. Fan speed, smoke and cabinet-door sensors additionally need monitoring cards fitted.",
```

Make the matching correction in the backend's `app/health/capability.py`, `TIER_EXPLANATIONS[TIER_CONTROLLER]`:

```python
    TIER_CONTROLLER: (
        "The controller is answering, so dark cabinets are detected, and "
        "per-cabinet temperature and voltage are read from the receiving cards. "
        "Fan speed, smoke, cabinet-door and multi-channel voltage sensors need "
        "monitoring cards fitted, and this wall does not report any."
    ),
```

- [ ] **Step 3: Build the player-keyword picker**

Create `src/components/screen-health/PlayerKindPicker.tsx`. This is the control that decides whether a screen is ever polled, so it states the consequence of each option rather than just naming it. It renders from `PLAYER_KINDS`, so adding a future integration is a map entry rather than a new branch.

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { PLAYER_KINDS, type PlayerKind } from "@/lib/types";
import { Button, Card, Input } from "@/components/ui";

/**
 * Which player this screen runs, as a keyword.
 *
 * This control IS the gate: the keyword selects a telemetry adapter on the
 * backend, and a keyword with no adapter is never polled. It is a keyword rather
 * than a checkbox because more media players are planned and each has its own
 * API — the question is "which vendor", not "on or off". Rendering from
 * PLAYER_KINDS means a new integration adds a map entry, not a new branch here.
 *
 * It is a human decision on purpose: detecting a NovaStar from build properties
 * can be wrong, and a false positive would call a vendor API for a screen that
 * has no controller, failing on every cycle forever.
 */
export function PlayerKindPicker({
  screenId,
  value,
  onSaved,
}: {
  screenId: string;
  value: PlayerKind;
  onSaved: (next: PlayerKind) => void;
}) {
  const [kind, setKind] = useState(value.player_kind);
  const [sn, setSn] = useState(value.vnnox_sn ?? value.detected_serial ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      onSaved(
        await api.put<PlayerKind>(`/cms/screen-health/${screenId}/player-kind`, {
          player_kind: kind,
          vnnox_sn: kind === "novastar" ? sn || null : null,
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <h3 className="text-sm font-medium">Player</h3>

      {Object.entries(PLAYER_KINDS).map(([key, meta]) => (
        <label key={key} className="flex cursor-pointer gap-3">
          <input
            type="radio"
            checked={kind === key}
            onChange={() => setKind(key)}
            className="mt-1"
          />
          <span>
            <span className="block text-sm">{meta.label}</span>
            <span className="block text-xs text-fg-muted">{meta.blurb}</span>
          </span>
        </label>
      ))}

      {kind === "novastar" && (
        <div className="space-y-1 pl-7">
          <label className="text-xs text-fg-muted" htmlFor="vnnox-sn">
            VNNOX serial number
          </label>
          <Input
            id="vnnox-sn"
            value={sn}
            onChange={(e) => setSn(e.target.value)}
            placeholder="2YHA23C12A3A10080149"
          />
          {value.detected_serial && value.detected_serial !== sn && (
            <button
              type="button"
              onClick={() => setSn(value.detected_serial!)}
              className="text-xs text-accent underline"
            >
              Use the serial the player detected ({value.detected_serial})
            </button>
          )}
        </div>
      )}

      {kind !== "novastar" && value.detected_vendor === "novastar" && (
        <p className="text-xs text-amber-400">
          This player reports that it is running on a NovaStar box. Selecting
          NovaStar above would add panel health for this screen.
        </p>
      )}

      <Button onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </Card>
  );
}
```

- [ ] **Step 4: Show the badge and the sync time**

On the detail page, next to the tier badge:

```tsx
<Badge
  tone={PLAYER_KINDS[kind.player_kind]?.tone ?? "gray"}
  title={kind.effective_sn ?? undefined}
>
  {playerKindLabel(kind.player_kind)}
</Badge>
```

And under the header, VNNOX's own timestamp rather than our fetch time — their console warns of a synchronisation lag, and showing our poll time would overstate freshness:

```tsx
{detail.observed_at && (
  <p className="text-xs text-fg-muted">
    Synchronised {new Date(detail.observed_at).toLocaleString()} (from VNNOX)
  </p>
)}
{kind.monitored && kind.last_error && (
  <p className="text-xs text-amber-400">Last sync failed: {kind.last_error}</p>
)}
{kind.monitored && !kind.effective_sn && (
  <p className="text-xs text-amber-400">
    This screen is set to NovaStar but has no VNNOX serial, so it is not
    being polled yet.
  </p>
)}
```

- [ ] **Step 5: Verify**

```bash
cd markai-Web-cms && npx tsc --noEmit
```
Expected: no errors. Do not run `next build`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/components/screen-health/PlayerKindPicker.tsx "src/app/(dashboard)/screen-health"
git commit -m "feat(screen-health): choose a screen's panel-monitoring source"
```

---

## Task 10b: The player tag in the Screens section

The keyword has to be visible where operators actually work — the **Screens** list — not only inside Screen Health. A fleet list that shows the tag answers "which of my screens can even report a dead cabinet?" at a glance; without it, that is invisible until someone asks why a screen has no health data.

**Files:**
- Modify: `app/screens/schemas.py` (`ScreenSummary`), `app/screens/service.py` (the summary builder)
- Modify: `src/lib/types.ts` (`Screen`), `src/app/(dashboard)/screens/page.tsx`, `src/app/(dashboard)/screens/[id]/page.tsx`
- Test: `tests/test_screen_summary_player_kind.py`

**Interfaces:**
- Consumes: `screens.player_kind` (Task 4), `vendor_for` (Task 6b), `PLAYER_KINDS` / `playerKindLabel` (Task 10).
- Produces: `ScreenSummary.player_kind: str` and `ScreenSummary.panel_monitoring: bool`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_screen_summary_player_kind.py
"""The player tag on the fleet list.

`panel_monitoring` is derived from the adapter registry rather than stored, so a
screen cannot advertise monitoring by a vendor this build no longer has.
"""

from app.screens.service import summary_monitoring_flag


def test_novastar_is_monitored():
    assert summary_monitoring_flag("novastar") is True


def test_andbox_is_not_monitored():
    assert summary_monitoring_flag("andbox") is False


def test_an_unrecognised_keyword_is_not_monitored():
    """A screen registered by a newer APK shows its keyword but claims no
    monitoring, because this backend has no adapter to do it with."""
    assert summary_monitoring_flag("colorlight") is False


def test_missing_keyword_is_not_monitored():
    assert summary_monitoring_flag(None) is False
```

- [ ] **Step 2: Verify the test is valid**

```bash
poetry run python -m py_compile tests/test_screen_summary_player_kind.py && poetry run ruff check tests/test_screen_summary_player_kind.py
```

- [ ] **Step 3: Add the fields to `ScreenSummary`**

In `app/screens/schemas.py`, on `ScreenSummary` beside `model` / `manufacturer`:

```python
    # Which player this screen runs, and therefore which telemetry adapter (if
    # any) serves it. Shown as a tag on the fleet list.
    player_kind: str = "andbox"
    # Derived from the adapter registry, never stored — see summary_monitoring_flag.
    panel_monitoring: bool = False
```

- [ ] **Step 4: Derive the flag in the service**

In `app/screens/service.py`:

```python
def summary_monitoring_flag(player_kind: str | None) -> bool:
    """Whether this screen's keyword actually resolves to a telemetry adapter.

    Derived rather than stored so it cannot drift: removing an adapter makes
    every screen using it report `panel_monitoring: false` immediately, with no
    migration and no rows left claiming a capability that no longer exists.
    """
    from app.health.vendors.registry import vendor_for

    return vendor_for(player_kind) is not None
```

Populate both fields wherever `ScreenSummary` is built:

```python
        player_kind=screen.player_kind,
        panel_monitoring=summary_monitoring_flag(screen.player_kind),
```

- [ ] **Step 5: Add the fields to the CMS type**

In `src/lib/types.ts`, on the `Screen` type beside `model` / `manufacturer`:

```ts
  player_kind?: string;
  panel_monitoring?: boolean;
```

- [ ] **Step 6: Render the tag on the fleet list and the screen page**

In `src/app/(dashboard)/screens/page.tsx`, in each screen row beside the status badge:

```tsx
<Badge tone={PLAYER_KINDS[screen.player_kind ?? ""]?.tone ?? "gray"}>
  {playerKindLabel(screen.player_kind)}
</Badge>
```

Import from `@/lib/types`. Do the same on `src/app/(dashboard)/screens/[id]/page.tsx` in the header, next to the screen name.

Fall back to the raw keyword rather than hiding it: a screen registered by an APK newer than this CMS should show `colorlight` rather than nothing, so an unfamiliar tag prompts a question instead of silently reading as AndBox.

- [ ] **Step 7: Verify**

```bash
cd markai-signage-api && poetry run python -c "
from app.screens.service import summary_monitoring_flag as f
assert f('novastar') and not f('andbox') and not f('colorlight') and not f(None)
print('tag flag ok')
"
poetry run ruff check app/screens
cd ../markai-Web-cms && npx tsc --noEmit
```
Expected: `tag flag ok`, then no output from ruff or tsc.

- [ ] **Step 8: Commit**

```bash
git commit -am "feat(screens): tag each screen with its player keyword"
```

---

## Task 11: CMS — metric tabs on the cabinet grid

Reproduces VNNOX's `Working status | Temperature | Voltage` switcher over the same grid.

**Files:**
- Modify: `src/components/screen-health/PanelHealthMap.tsx`, `src/lib/screen-health.ts`

**Interfaces:**
- Consumes: `PanelView` (existing), which carries `state`, `temperature_c` and `voltages`.
- Produces: `export type GridMetric = "status" | "temperature" | "voltage"`, `export function metricCellClass(panel: PanelView, metric: GridMetric): string`, `export function metricLabel(panel: PanelView, metric: GridMetric): string`

- [ ] **Step 1: Add the metric helpers to `src/lib/screen-health.ts`**

```ts
export type GridMetric = "status" | "temperature" | "voltage";

export const GRID_METRIC_LABELS: Record<GridMetric, string> = {
  status: "Working status",
  temperature: "Temperature",
  voltage: "Voltage",
};

/** Temperature bands, matching the thresholds VNNOX Care uses in its own view. */
function temperatureClass(c: number): string {
  if (c >= 60) return "bg-red-500/40 border-red-500/70";
  if (c >= 45) return "bg-amber-500/30 border-amber-500/50";
  return "bg-emerald-500/25 border-emerald-500/40";
}

/** A cabinet with no reading is hatched, never coloured — an unread sensor is
 *  not a healthy one, and this grid is used to decide whether to send someone. */
const NO_READING =
  "border-white/20 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.10)_0_4px,transparent_4px_8px)]";

export function metricCellClass(panel: PanelView, metric: GridMetric): string {
  if (metric === "status") return STATE_CELL_CLASSES[panel.state];
  if (panel.state === "unknown" || panel.state === "dark") {
    return STATE_CELL_CLASSES[panel.state];
  }
  if (metric === "temperature") {
    return panel.temperature_c == null
      ? NO_READING
      : temperatureClass(panel.temperature_c);
  }
  const main = panel.voltages?.main;
  return main == null ? NO_READING : "bg-sky-500/25 border-sky-500/40";
}

export function metricLabel(panel: PanelView, metric: GridMetric): string {
  if (metric === "temperature") {
    return panel.temperature_c == null ? "—" : `${panel.temperature_c.toFixed(1)}°`;
  }
  if (metric === "voltage") {
    const main = panel.voltages?.main;
    return main == null ? "—" : `${main.toFixed(2)}V`;
  }
  return panel.label ?? panel.cabinet_id.slice(-4);
}
```

- [ ] **Step 2: Add the switcher to `PanelHealthMap.tsx`**

Add a `metric` state above the grid and render three buttons; pass `metric` into the cell class and label:

```tsx
const [metric, setMetric] = useState<GridMetric>("status");
...
<div className="flex gap-1 rounded-[var(--radius-md)] border border-line p-1">
  {(["status", "temperature", "voltage"] as GridMetric[]).map((m) => (
    <button
      key={m}
      type="button"
      onClick={() => setMetric(m)}
      className={cn(
        "rounded-[var(--radius-sm)] px-3 py-1 text-xs",
        metric === m ? "bg-accent/20 text-accent" : "text-fg-muted hover:text-fg",
      )}
    >
      {GRID_METRIC_LABELS[m]}
    </button>
  ))}
</div>
```

Then replace `STATE_CELL_CLASSES[panel.state]` in the cell's `className` with `metricCellClass(panel, metric)`, and the cell's inner text with `metricLabel(panel, metric)`.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/screen-health/PanelHealthMap.tsx src/lib/screen-health.ts
git commit -m "feat(screen-health): switch the cabinet grid between status, temperature and voltage"
```

---

## Task 12: CMS — alarm history filters and readable locations

**Files:**
- Modify: `src/components/screen-health/FaultHistory.tsx`

**Interfaces:**
- Consumes: `FaultEvent` (existing), whose `detail` now carries `location` (the human position string) and `alarms[]` from Task 6.

- [ ] **Step 1: Render the location and add filters**

VNNOX's Alarm History has Part / Alarm Type / Alarm Level / Status / date filters. Add level and state filters plus a free-text search over the location, matching that shape:

```tsx
const [level, setLevel] = useState<"all" | "dark" | "degraded">("all");
const [query, setQuery] = useState("");

const rows = events.filter((e) => {
  if (level !== "all" && e.state !== level) return false;
  if (query) {
    const location = (e.detail?.location as string | undefined) ?? e.cabinet_id;
    if (!location.toLowerCase().includes(query.toLowerCase())) return false;
  }
  return true;
});
```

Render the location column from `detail.location`, falling back to the raw cabinet id:

```tsx
<td className="px-3 py-2 text-xs text-fg-muted">
  {(event.detail?.location as string | undefined) ?? event.cabinet_id}
</td>
```

That column then reads
`Screen(No:1)–Sending card(No:1)–Ethernet port(No:1)–Receiving card(No:2)`,
exactly as VNNOX Care renders it.

- [ ] **Step 2: Show the open/resolved state the way VNNOX does**

An event with `resolved_at` set is what their console labels "Recover":

```tsx
{event.resolved_at ? (
  <Badge tone="green">Recovered</Badge>
) : (
  <Badge tone="red">Open</Badge>
)}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/screen-health/FaultHistory.tsx
git commit -m "feat(screen-health): filterable alarm history with readable cabinet locations"
```

---

## Task 13: Brightness history, on demand

Fetched only when the chart is opened. It has no bulk form — one request per screen — so polling it on a cycle would spend half the hourly budget at a few hundred screens for a chart nobody is looking at.

**Files:**
- Modify: `app/health/router.py`, `app/health/vendors/vnnox/sync.py`
- Create: `src/components/screen-health/BrightnessHistory.tsx`

**Interfaces:**
- Consumes: `VnnoxClient` (Task 3), `get_link` (Task 8).
- Produces: `GET /api/cms/screen-health/{screen_id}/brightness-history?days=7` → `{"points": [{"at": str, "value": int, "type": int, "ok": bool}]}`

- [ ] **Step 1: Add the fetch helper to `sync.py`**

```python
BRIGHTNESS_PATH = "/v2/device-status-monitor/brightness/history"

# VNNOX caps a brightness search at 30 days.
MAX_BRIGHTNESS_DAYS = 30


async def fetch_brightness_history(
    client: VnnoxClient, sn: str, days: int = 7
) -> list[dict]:
    """On-demand only. Never called from the poll: this endpoint has no bulk
    form, so a cycle would cost one request per screen."""
    days = max(1, min(days, MAX_BRIGHTNESS_DAYS))
    end = int(time.time() * 1000)
    start = end - days * 86_400_000
    payload = await client.post(
        BRIGHTNESS_PATH,
        {
            "sn": sn,
            "startTime": str(start),
            "endTime": str(end),
            "currentPage": 1,
            "pageSize": 1000,
            "orderRule": "asc",
        },
    )
    return payload.get("data") or []
```

Add `import time` at the top of the file.

- [ ] **Step 2: Add the route**

```python
# Adjustment types, from the documented `brightType` enum.
_BRIGHT_TYPES = {
    0: "Manual", 1: "Scheduled", 2: "Automatic", 5: "Light sensor read failed",
}


@router.get("/{screen_id}/brightness-history")
async def brightness_history(
    screen_id: str,
    days: int = Query(7, ge=1, le=30),
    actor: CmsUser = Depends(require_screenowner_or_super),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await assert_can_manage_screen(db, actor, screen_id)
    link = await link_service.get_link(db, screen_id)
    if link is None or not link.effective_sn:
        return {"points": [], "reason": "This screen has no VNNOX binding."}
    client = VnnoxClient()
    if not client.configured:
        return {"points": [], "reason": "VNNOX is not configured."}
    try:
        rows = await fetch_brightness_history(client, link.effective_sn, days)
    except VnnoxError as exc:
        return {"points": [], "reason": str(exc)}
    return {
        "points": [
            {
                "at": row.get("recordTime"),
                "value": row.get("brightValue"),
                "type": _BRIGHT_TYPES.get(row.get("brightType"), "Unknown"),
                "ok": bool(row.get("result")),
            }
            for row in rows
        ]
    }
```

- [ ] **Step 3: Build the chart component**

```tsx
// src/components/screen-health/BrightnessHistory.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Point = { at: string; value: number; type: string; ok: boolean };

/**
 * Brightness over time, fetched only when this component mounts.
 *
 * Deliberately not part of the polling cycle: the endpoint has no bulk form, so
 * a cycle would cost one VNNOX request per screen against a 1000/hour budget.
 * The data is historical, so on-demand loses nothing.
 */
export function BrightnessHistory({ screenId }: { screenId: string }) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ points: Point[]; reason?: string }>(
        `/cms/screen-health/${screenId}/brightness-history?days=7`,
      )
      .then((r) => {
        setPoints(r.points);
        setReason(r.reason ?? null);
      })
      .catch(() => setReason("Could not load brightness history."));
  }, [screenId]);

  if (reason) return <p className="text-sm text-fg-muted">{reason}</p>;
  if (!points) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (points.length === 0)
    return <p className="text-sm text-fg-muted">No brightness changes in the last 7 days.</p>;

  const max = Math.max(...points.map((p) => p.value), 100);
  return (
    <div className="space-y-2">
      <div className="flex h-24 items-end gap-[2px]">
        {points.map((p, i) => (
          <div
            key={i}
            title={`${p.at} — ${p.value}% (${p.type})`}
            style={{ height: `${(p.value / max) * 100}%` }}
            className={p.ok ? "flex-1 bg-accent/60" : "flex-1 bg-red-500/60"}
          />
        ))}
      </div>
      <p className="text-xs text-fg-muted">
        {points.length} adjustments · last {points[points.length - 1]?.value}%
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
cd markai-signage-api && poetry run ruff check app/health
cd ../markai-Web-cms && npx tsc --noEmit
```
Expected: no output from either.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(screen-health): on-demand brightness history"
```

---

## Task 14: Configure and verify end to end

**Files:**
- Modify: `.env.example` in `markai-signage-api`

- [ ] **Step 1: Document the settings**

```bash
# VNNOX Care (NovaStar cloud) — read-only device-status monitoring.
# Keys come from the Authentication tab of the NovaCloud Open Platform, and MUST
# belong to the same account the screens are bound to.
VNNOX_BASE_URL=https://open-in.vnnox.com
VNNOX_APP_KEY=
VNNOX_APP_SECRET=
VNNOX_ENABLED=true
```

- [ ] **Step 2: Confirm the credentials can see the fleet**

```bash
poetry run python -c "
import asyncio
from app.health.vendors.vnnox.client import VnnoxClient
async def main():
    c = VnnoxClient()
    print(await c.get('/v2/integration/account/list'))
    print(await c.get('/v2/device-status-monitor/screen/list', {'pageNumber':1,'pageSize':10}))
asyncio.run(main())
"
```
Expected: the account list names the account the screens live under, and `screen/list` returns `total` greater than zero.

**If `total` is 0, stop.** The key belongs to an account with no devices — the known blocker. Generate the AK/AS from inside the account that owns the screens, or add this account as a sub-user there. No later step can be verified until this returns real screens.

- [ ] **Step 3: Run one sync by hand**

```bash
curl -s -X POST localhost:8095/api/cron/vnnox-health -H "X-Cron-Secret: $CRON_SECRET" | python3 -m json.tool
```
Expected: `screens_polled` equals the number of linked screens, `screens_failed` is 0.

- [ ] **Step 4: Register the cron job**

Add a job on **cron-job.org** (not GCP Cloud Scheduler — its API is disabled on this project), every 5 minutes:
`POST https://<api-host>/api/cron/vnnox-health` with header `X-Cron-Secret`.

- [ ] **Step 5: Check the CMS against VNNOX's own console**

Open `/screen-health/<id>` beside `in.vnnox.com/care`. Cabinet colours, controller model and firmware, brightness and the alarm list must agree. A disagreement here is a bug in the composition rules, not a display preference.

- [ ] **Step 6: Commit**

```bash
git add .env.example
git commit -m "docs: VNNOX Care configuration"
```

---

## Saturday verification checklist

Two facts cannot be settled without the real controller. Both have a fallback already built, so neither blocks the rollout.

- [ ] **Does `ro.serialno` match VNNOX's SN?** On the box: `adb shell getprop ro.serialno`, and compare with the SN in VNNOX Care. If they differ, set the override via `PUT /api/cms/screen-health/{id}/player-kind` and record the real relationship in `docs/`.
- [ ] **How does a dead cabinet actually present?** Unplug one receiving card's data cable and re-poll. Note whether it disappears from `receivingCard.monitor` or appears with `status: false`. The adapter handles both; this is to learn which, not to fix anything.
- [ ] **Does the alarm `position` for a disconnected card resolve to the right cabinet?** Compare `describe_position` output with the Location column in VNNOX's Alarm History.
