# VNNOX Care screen health — design

**Date:** 2026-09-09
**Surface:** `markai-Web-cms` → `/screen-health` (existing pages, extended)
**Backends touched:** `markai-signage-api` (vendor registry, adapter, sync), `markai-player-apk` (asks the installer for the player keyword, reports the box serial)
**Status:** design approved 2026-09-09; blocked on an account fix before it can be verified against real hardware

## Problem

Our APK cannot see whether the LED wall is actually lit. It takes screenshots by
`PixelCopy`-ing its own window buffer — the pixels we *send*, never the pixels the
wall *produces*. A dead cabinet, a failed driver IC, a disconnected receiving card:
all invisible, and the JPEG comes back clean however broken the wall is.

NovaStar's own cloud already knows. The controller polls every receiving card
continuously in order to push pixels to it, and reports what it finds to VNNOX Care.
We read that back rather than reimplementing it.

This is Phase C of the screen-health subsystem. Phases A and B — the capability
tiers, the four tables, the CMS pages — were built on 2026-08-06 and are stranded
on the `dev` branch of all three repos. Phase C was previously planned as a port of
NovaStar's reverse-engineered TCP protocol; **that plan is superseded.**

## Governing constraint: VNNOX is a sensor, not a controller

Our APK runs **on** the NovaStar controller (a TB1‑4G Taurus). Our backend owns
scheduling, playback, proof-of-play, screenshots, operating hours — all of it,
unchanged. VNNOX supplies exactly one thing: the hardware telemetry the APK
physically cannot observe.

**We call `/v2/device-status-monitor/*` and nothing else.** VNNOX's player,
program, real-time-control and scheduled-control APIs are off limits — they
duplicate functionality that already exists and works, and calling them would
create two sources of truth for the same screen.

## Governing constraint: the operator chooses, nothing is inferred

Not every screen has a NovaStar. Some run the plain AndBox player, which has no
controller telemetry at all. Calling VNNOX for those screens would produce a
guaranteed error on every poll.

The gate is **a keyword, not a boolean**: `screens.player_kind`, chosen explicitly
by a person.

> **Player**
> ( ) AndBox — our own media player
> (•) NovaStar — controller + VNNOX Care → *VNNOX serial:* `[____________]`

A boolean would have been enough for today, and is the wrong shape for what is
coming. More media players are planned, **each with its own telemetry API**, so
the question is never "is monitoring on" but "**which vendor's API do we call for
this screen**". A keyword answers that; a boolean would have to be replaced by one
the first time a second vendor appears, and every call site that branched on it
rewritten.

So the keyword selects an adapter from a registry:

```python
HEALTH_ADAPTERS = {"novastar": VnnoxCareAdapter()}   # colorlight, linsn, … later
```

`andbox` is simply a keyword with **no registered adapter**, which is why our own
media player is never called for. It is not a special case in the code — it is the
absence of an entry. Adding a vendor later means writing an adapter and adding one
line here; nothing that already works has to change.

An earlier draft made this automatic: the APK would report the box's serial and
the backend would create the link. That was rejected. Detecting "this is a
NovaStar" means substring-matching `Build.MANUFACTURER` for `nova`, and a false
positive there would call VNNOX for a screen that has none — precisely the
failure this constraint exists to prevent. A human ticking a box cannot be
wrong in that direction, and works before the APK is upgraded.

The APK's detected serial is kept as a **prefill suggestion** on the form, never
as a trigger. Vendor detection survives only as a hint shown to the operator
("this box looks like a NovaStar — set the keyword?"), never as a gate.

### The choice is offered twice, and it is the same choice

**At install**, on the existing first-launch enrollment screen — the installer is
standing at the box and knows what it is, which is the best-informed moment
anyone will ever have:

> **What is this box?**
> ( ) AndBox — our own media player
> ( ) NovaStar controller → *serial:* `[2YHA23C12A3A10080149]` (detected)

The APK sends the keyword the answer produced, in `player_kind`. As more players
are integrated, this list grows — which is the second reason it is a keyword and
not a checkbox: an installer will eventually be choosing between four boxes, not
ticking one.

**In the CMS**, on the screen page, for correction and for screens already in the
field whose APK predates this.

Both set the same `screens.player_kind`. Neither infers anything.

**The heartbeat carries it too.** The APK stores the installer's answer and
re-asserts it on every beat, so a screen whose registration partly failed heals
itself on the next check-in instead of waiting for a reinstall.

That is only safe with a precedence ladder, because the beat fires every 60
seconds and would otherwise revert a human edit within a minute — 1,440 writes a
day against one considered correction. `screens.player_kind_source` records who
last set the keyword:

| Source | Set by | Can be overwritten by |
|---|---|---|
| `default` | migration backfill (`andbox`) | install, heartbeat, CMS |
| `install` | the installer's answer at registration | CMS only |
| `cms` | an operator on the screen page | CMS only |

So the heartbeat can fill in a keyword nobody has set, and can never argue with
one somebody has. A disagreement between what the box reports and what the CMS
says is **shown, not resolved**: "this player reports it is on a NovaStar box"
sits next to the setting, and a human decides.

Three further rules keep install-time and the CMS from fighting:

* **Registration sets the keyword once, never overwrites.** Re-registration is
  idempotent on `device_uid` and happens on reinstall or factory reset. If the
  screen already has a non-default keyword, registration leaves it alone —
  otherwise a reinstall would silently undo an operator's CMS correction.
* **No answer means the default keyword.** The zero-touch/MDM path shows no UI
  and prompts nobody (`require_enrollment_key: false`), so those screens arrive
  as `andbox` and an operator sets the real keyword in the CMS. Unmonitored is
  the safe default; wrongly monitored is not.
* **The CMS is the authority afterwards.** Install-time is a convenience for
  getting it right the first time, not a second source of truth.

## Verified against the live API (2026-09-09)

All facts below were confirmed by real calls with the production key, not read from
documentation.

### Auth

Base `https://open-in.vnnox.com` (IN node; `open-us` / `open-eu` / `open-au` exist).
Four headers, no token exchange:

    AppKey, Nonce (8–64 alphanumeric), CurTime (unix seconds),
    CheckSum = SHA256(AppSecret + Nonce + CurTime)

Clock skew must stay under 5 minutes. Secrets live in backend env only — never
`NEXT_PUBLIC_*`.

### Permission

All 17 Device Status Monitoring endpoints are authorized. A made-up SN returns
`406 ERROR-100002 "screen not exist"` — the last check before data is returned —
rather than the `403 INSUFFICIENT_PERMISSIONS` that blocked the previous key.

The two camera endpoints return `500 INTERNAL SERVER ERROR` for a non-existent
`sid`. Authorization is **unproven** for those; camera is out of scope for v1.

### Rate limit

**Documented** in the API Access Guide (`doc-4696857`), under "Rate Limits", and
stated **per IP address**:

    Instantaneous:  no more than 15 calls per second   per IP
    Cumulative:     no more than 1500 calls per hour    per IP

The headers observed on 2026-09-09 reported lower values (`Limit-Second: 5`,
`Limit-Hour: 1000`). **We design against the documented figures** — the user's
call — pacing at 12/sec to stay under the stated 15.

That is safe because the ceiling is handled at runtime rather than assumed: the
client reads `X-RateLimit-Remaining-Hour` off every response, and a 429 is met
with the server's own `Retry-After` rather than a guess. If the stricter values
turn out to be what is really applied, the sync pauses a second and continues —
and `VNNOX_MAX_REQUESTS_PER_SECOND` is one env var to turn down, no code change.

The counter is shared across every endpoint: nine different endpoints called in
sequence decremented one counter. Because the limit is keyed to the **IP**, the
budget belongs to the backend's egress address, and anything else calling VNNOX
from that address shares it.

Two consequences:

* **Failed calls still cost.** A `406 "screen not exist"` decrements the budget
  exactly like a success, so a screen with a wrong SN quietly spends requests on
  every cycle while returning nothing. This is why the sync writes `last_error`
  to the link row and the CMS surfaces it.
* This is a hard architectural constraint, not a tuning parameter:

| Approach | Cost/screen/cycle | Max fleet at 5-min polling |
|---|---|---|
| 14 per-endpoint calls | 14 req | **~8 screens** |
| `POST /all` (10 screens/call) | 0.1 req | **~1250 screens** |

`POST /v2/device-status-monitor/all` is therefore **mandatory**, not an
optimisation. Per-endpoint routes are used only for on-demand drill-down when an
operator opens one screen.

`brightness/history` has no bulk form (1 request per screen), so it is **never**
polled on a cycle — fetched on demand when the chart is opened, plus an optional
daily backfill.

**The per-second figure is a burst ceiling, not a sustainable rate.** Running
flat out at 15/sec would spend the whole hourly budget in 100 seconds. The
sustainable rate is one request every 2.4 seconds; the 5-minute cycle uses a tiny
fraction of that (12 requests/hour for two screens).

### There is no alarm-history endpoint

`brightness/history` is the only historical endpoint in VNNOX Care. Every alarm
route returns **currently active** alarms only, and three of the four
(`receivingCard`, `masterControl`, `smartModule`) already ride inside `POST /all`
— so alarms cost no extra request. `monitor-card/alarm` is the exception, and is
only relevant on walls with monitoring cards fitted.

**Our Alarm History is therefore ours to build, and starts empty.** The console
shows 48 rows going back to June because NovaStar's own database has been
recording since the device was bound; that archive is not reachable through the
API and cannot be imported.

`panel_health` already models exactly this: a fault opens when it first appears
in a poll and is stamped `resolved_at` when it stops appearing, which is the same
open→"Recover" lifecycle their console renders. From the first poll onward our
history is arguably better shaped than theirs — intervals rather than events,
queryable, and joinable to bookings for "was this cabinet dark while that
campaign ran".

Two consequences to expect rather than debug:

* **Day one shows an empty history** even though VNNOX's console is full.
* **A fault that opens and clears between two polls is never seen.** This, not
  the rate limit, is the real cost of the polling interval. At 1500 requests/hour
  a 1-minute cadence costs 60/hour and remains comfortable, so the interval is a
  product decision, not a budget one.

### The blocker

The API key's account is `akshatgg` (org admin, no sub-users, zero devices). The
real screens live under VNNOX Care account **MantriLED** (`in.vnnox.com/care`,
screen 4685 "LED 16"). Different tenants — the key returns `total: 0` and will
keep doing so.

**Resolution required before any live verification:** generate AK/AS from inside
the MantriLED account, or add `akshatgg` as a sub-user there.
`GET /v2/integration/account/list` returns the users *including sub-users* who have
access, and is the check for whether this is fixed.

## Data model

### Existing (Phase A/B, migration `0038_panel_health` → renumbered `0065`)

The stranded migration declares `down_revision = "0037_creative_fit_jobs"`, and
main's `0039_screen_location_source` declares the same parent. Cherry-picked
unchanged it would create **two alembic heads** and break `alembic upgrade head`.
It is renumbered to `0065_panel_health` with `down_revision = "0064_drop_studio"`
so the chain stays linear. A free filename was never the issue; the parent
pointer was.

| Table | Behaviour | Holds |
|---|---|---|
| `screen_health` | 1:1, upsert | tier, controller brand/model/firmware, brightness, resolution, cabinets total/ok/degraded/dark, `unreachable_since` |
| `screen_panels` | map, upsert | `cabinet_id`, `row_index`/`col_index`, `x`/`y`/`w`/`h`, `label` |
| `panel_readings` | latest, upsert | `state`, `temperature_c`, `fan_rpm`, `voltages` (JSON), `door_open`, `smoke_alarm`, `flat_cable_ok`, `module_status` |
| `panel_health` | fault log, **append on state CHANGE only** | `state`, `observed_at`, `last_seen_at`, `resolved_at` |

Readings and faults are separate because a temperature is a time series and a fault
is an interval. Current panel state is **derived**: no open `panel_health` row means
`ok`, enforced by the partial unique index `uq_panel_health_open` on
`(panel_id) WHERE resolved_at IS NULL`.

### New: `screen_vnnox_link`

1:1 with `screens`. A separate table rather than more columns on `screens`, which
already carries 60+.

| Column | Purpose |
|---|---|
| `screen_id` | unique FK |
| `vnnox_sn` | the SN we poll — set by the operator, prefilled from the detected serial |
| `vnnox_sid` | VNNOX's numeric screen id, cached from `screen/list` |
| `last_sync_at`, `last_error` | sync bookkeeping, surfaced in the CMS |

This table is **the NovaStar adapter's own configuration**, not the gate. A second
vendor gets its own table with its own fields rather than columns bolted onto this
one, because a Colorlight controller has no `vnnox_sn` and pretending otherwise
produces a table of mostly-null columns.

### New: three columns on `screens`

| Column | Purpose |
|---|---|
| `player_kind` | **the keyword** — `andbox`, `novastar`, … Selects the adapter. |
| `controller_serial` | `ro.serialno` as read by the APK — informational |
| `controller_vendor` | what the box's build properties suggest — informational |

`player_kind` is the gate. The other two are **detection output, never a gate**:
they exist so the form can prefill the serial and suggest a keyword. A screen can
carry both and still never be polled, because nobody chose the keyword.

`vnnox_sn` is stored separately from `screens.controller_serial` because we do not
yet know that a Taurus's Android serial equals the SN VNNOX indexes it by. If they
differ, the operator edits one field and nothing else changes.

## Field mapping

Everything below arrives in a single `POST /all` response; the standalone endpoints
are the drill-down equivalents.

| Target | Source | Field |
|---|---|---|
| `screen_health.controller_model` / `_firmware` | `master-control/basics` | `version`, `mac`, `status`, `timeZone` |
| `screen_health.brightness_percent` | `screen/monitor` | `brightness`, `envBrightness` (`-1` = not read) |
| `screen_health` resolution | `screen/monitor` | `width`, `height`, `displayDevice` (LED/LCD) |
| `screen_panels` | `receiving-card/topology` | `topologys[].x/y/width/height`, `senderIndex`, `portIndex`, `connectIndex` |
| `panel_readings.temperature_c` / `.voltages` | `receiving-card/monitor` | `temperature`, `voltage` |
| `panel_readings.fan_rpm` / `.door_open` / `.smoke_alarm` | `monitor-card/monitor` | `fansSpeed{0..8}`, `cabinDoorStatus`, `smokeStatus`, `voltage{0..8}` |
| `panel_readings.module_status` | `module/monitor`, `smart-module/monitor` | `icType`, `lineDecodingIc`, `scanNum`, `width`, `height` |
| `panel_health` | `*/alarm` | `alarmType`, `level`, `alarmValue`, `position`, `createAt` |

### Two field-name traps

**The same boolean is named differently in the two endpoints:**

* `receiving-card/monitor/{sn}` → `items[].deviceWorkState`
* `POST /all` → `receivingCard.monitor[].status`

Same meaning. The adapter reads both names; missing this would silently render
every cabinet grey.

**`-255` is a "no sensor fitted" sentinel** in `fansSpeed{0..8}` and
`voltage{0..8}` — 9 sensor channels on **one** card, not 9 cabinets. Stored as
NULL. Rendering it would paint a healthy wall with −255 V faults.

## Cabinet state: composed, not read

VNNOX's UI shows Normal / Faulty / Risky per cabinet, but **no endpoint returns a
three-state field.** `deviceWorkState` is a boolean, which cannot express "Risky".
VNNOX composes the colours from two endpoints and so do we:

| State | Rule |
|---|---|
| `ok` (green) | present in `monitor`, `deviceWorkState: true`, no open alarm at that position |
| `dark` (red) | `deviceWorkState: false` — **or** open alarm `level: 4` — **or** present in topology but **absent from `monitor`** |
| `degraded` (yellow) | open alarm `level: 3` at that position |
| `unknown` (grey) | VNNOX did not answer for this screen |

**Topology is what makes a dead cabinet detectable at all.** `monitor` returns the
cards that *answered*. A cabinet whose receiving card has died may simply not appear
in the list rather than appearing with a false flag — read alone, a wall with a dead
tile looks like a smaller, perfectly healthy wall. Topology is the expected set,
`monitor` is the answering set, and the difference is dark.

Which way the hardware actually behaves is unverified until a screen is bound, so
the adapter treats absence and `false` identically. That costs nothing.

### `dark` vs `degraded` is not cosmetic

A disconnected receiving card is `dark`. A high-temperature or over-voltage alarm
is `degraded` — the cabinet is still lighting up. This matters beyond colour:
proof-of-play overlays discount only `dark` cabinets, so labelling a hot-but-working
cabinet as dark would under-report delivered ads and cost real revenue.

## Decoding `position`

`position` is the join key between topology and alarms/readings, and the piece most
likely to be got wrong. It lives in its own pure, unit-tested module.

Four hex digits per group, `(deviceTypeCode, index)`, outermost first. Index is
0-based; VNNOX displays it 1-based.

Device types: `01` screen · `02` sending card · `03` Ethernet port ·
`05` receiving card · `06` monitor card · `0C` smart module ·
`0D`/`0E` smart-module x/y.

Alarm positions append one more group whose codes are *physical quantities*:
`00` voltage · `01` temperature · `04` fan speed · `05` smoke · `06` working status ·
`07` input source · `09` cabinet door · `0B` flat cable · `0C` port redundancy ·
`0E` hardware connection.

So `0100 0200 0300 0501` renders as
`Screen(No:1)–Sending card(No:1)–Ethernet port(No:1)–Receiving card(No:2)`, matching
VNNOX's own Alarm History column exactly.

## Sync

`app/health/vendors/vnnox/`:

* `client.py` — signed HTTP client; paces at 12/sec, under the documented 15;
  honours `Retry-After` on a 429 rather than a fixed backoff.
* `position.py` — the decoder above. Pure functions, no I/O.
* `adapter.py` — VNNOX JSON → the four tables. One function per subsystem.
* `sync.py` — selects linked screens, batches by 10, calls `/all`, writes.

Driven by `/api/cron/vnnox-health` every 5 minutes. Cron jobs run on
**cron-job.org**, not GCP Cloud Scheduler (the API is disabled on the project) —
this becomes the fourth such job.

Two screens cost 12 requests/hour, roughly 1% of budget.

## The three player types this is built for

The keyword is not a NovaStar flag. It is the answer to "which health API does
this screen use", and the roadmap has at least three answers:

| Keyword | Monitoring hardware | Health source |
|---|---|---|
| `andbox` | none | nothing — no adapter registered |
| `novastar` | NovaStar cards, VNNOX-managed | VNNOX Care cloud |
| `markai` *(planned)* | Mark AI's own monitoring chip | our own API, or the player itself |

A `novastar` screen never touches the Mark AI chip's API and vice versa, because
the registry only ever resolves a screen's own keyword. That isolation is the
reason this is a keyword and not a boolean.

**Adding the third type is: write an adapter, add one registry line, add one
label.** The cron iterates `HEALTH_ADAPTERS` rather than naming a vendor, so it
does not change. Neither do the four tables, `record_health`, the capability
tiers, or any CMS view — those are already vendor-neutral and driven by
`HealthReport`.

Each vendor selects its own screens (`poll_due`) rather than being handed them,
because each has its own config table — `screen_vnnox_link` here, something else
for the chip — and a registry that selected generically would have to know every
vendor's schema.

### The registry means "we poll it", not "it has health"

If the Mark AI chip is read by our own APK and reported on the heartbeat, it gets
**no registry entry**: there is nothing for the backend to poll. The keyword still
tags the screen, and `vendor_owns_health` correctly returns False, so the
heartbeat stays the source. A registry entry is specifically the statement *the
backend calls an external API for this screen* — which is what must be true for
the heartbeat to be overruled.

## The player tag in the Screens section

The choice must be visible where operators actually live, which is the **Screens**
list — not buried in Screen Health. Every screen row and every screen page carries
a tag naming the hardware:

| Tag | `player_kind` | Adapter | Panel monitoring |
|---|---|---|---|
| **NovaStar** | `novastar` | VNNOX Care | Yes — polled every 5 min |
| **AndBox** | `andbox` | *none registered* | **No** — nothing is called |

The tag is not decoration. It is the visible form of the gate: an operator looking
at a fleet list can see at a glance which screens can report a dead cabinet and
which cannot, which is otherwise invisible until someone asks why a screen has no
health data.

`andbox` never triggers monitoring — not because it is special-cased, but because
no adapter is registered for it. Only a keyword with an adapter causes a call.

The tag is the keyword's label, mapped in the CMS. A new integration adds a row to
that map and an adapter to the registry; the tag column, the sync loop and every
existing screen are untouched.

Existing pages under `/screen-health`, extended to full parity with VNNOX Care:

* **Fleet list** — health status per screen, plus a plain badge: `VNNOX Care` or
  `Not monitored`.
* **System overview** — Controller ● Normal (T1‑4G, 4.7.7.1601) → Screen ● Normal
  (65%), resolution, and **VNNOX's own sync timestamp**, not our poll time. Their UI
  warns of a synchronisation lag; showing our poll time would overstate freshness.
* **Cabinet grid** — `[Status] [Temperature] [Voltage] [Modules]` tabs, laid out
  from topology's real `x/y/width/height`.
* **Cabinet drawer** — per-channel voltages, fan RPM, door, smoke, flat cable,
  FPGA/MCU version.
* **Alarm history** — filterable by part / type / level / status / date, location
  rendered in words. Backed by `panel_health`, which already models the
  open→resolved interval VNNOX shows as "Recover".
* **Brightness history** — chart with `brightType` (0 manual, 1 scheduled,
  2 automatic, 5 sensor read failed). Fetched on demand.

The CMS renders `tier`, `tier_explanation` and `tabs` from the API and never
re-derives capability rules; a second copy in TypeScript would drift.

Screenowners see health for screens assigned to them, consistent with the existing
permission model (screenowner = superadmin scoped to owned screens).

### Correction to existing tier text

`TIER_CONTROLLER`'s explanation currently says temperature and voltage require
monitoring cards. Against VNNOX that is wrong: `receiving-card/monitor` returns
temperature and voltage per card, which is why the Receiving Card view has those
tabs on a wall with no monitoring cards fitted. Monitoring cards add fan speed,
smoke, cabinet door and the 9-channel voltages. The wording is corrected.

## Invariants

* **`unknown` ≠ `ok`.** If VNNOX does not answer, cabinets go grey, not green. "We
  cannot see the wall" and "the wall is fine" are opposite facts.
* **Healthy writes nothing** to `panel_health` — that is what keeps it small.
* **`observed_at` carries forward** across re-observations of the same state; it is
  what "dark since Tuesday" reads. Only `last_seen_at` advances.
* **Absent ≠ recovered.** A screen missing from a sync is unreachable, not fixed.
* Overlay is applied **on read**, fail-open, and only for `dark`.

## Testing

Built against **recorded fixtures** taken from the documented example payloads, so
the adapter, the position decoder and the state composition are all testable before
any hardware exists. Per project convention, tests are written but not run by the
agent (`ruff` is the gate; the user runs the suite).

## Risks

| Risk | Mitigation |
|---|---|
| Account mismatch — key cannot see the screens | Must be fixed externally; nothing verifies until then |
| Taurus `ro.serialno` ≠ VNNOX SN | Operator types the SN on the form; detection is only a prefill |
| Dead cabinet drops out of `monitor` rather than flagging false | Adapter treats absent and `false` identically |
| Phase A/B stranded 49 commits behind `main` | Cherry-pick first, as its own step; the migration must be renumbered onto main's head or alembic branches |
| Camera endpoints unverified (500s) | Out of scope for v1 |
| Alarm endpoint may be current-only, so history starts empty | Settled by one call on Saturday; the wall has 48 historical and 0 active alarms, so an empty response proves current-only |
| Existing AndBox screen must be unaffected | `andbox` backfill, no enrollment prompt on an upgraded box, byte-identical heartbeat |

## Phasing

The implementation plan is
`docs/superpowers/plans/2026-09-09-vnnox-care-screen-health.md` — 17 tasks.

1. Land the Phase A/B health work on `main` in all three repos.
2. Backend: position decoder → client → keyword + tables → fixtures → adapter →
   registry → sync + cron → keyword service and endpoints.
3. APK: report the box serial; ask the installer for the keyword at enrollment.
4. CMS: keyword picker, the Screens-section tag, cabinet grid tabs, alarm
   history, brightness history.
5. Configure, then verify against the real controller on Saturday.

## Open decisions

* **Reading history.** `panel_readings` is latest-only, so temperature and
  voltage show the current value and yesterday's is lost. Faults keep their
  intervals, so "dark since Tuesday" already works. Storing a reading history
  would give the one genuinely predictive signal — a cabinet drifting hot for
  weeks before it fails — and unrecorded history cannot be recovered later.
  Recommended: append from day one, hourly rollup after 7 days. **Not decided.**
* **A "Refresh now" button.** One request covers 10 screens, so it is affordable
  with a per-screen throttle. **Not decided.**
* **Poll interval.** 5 minutes. A fault that opens and clears inside one window
  is never seen; the budget would allow 1 minute. Revisit once Saturday shows how
  often VNNOX's own `reportTime` actually advances.
