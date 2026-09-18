# LED Panel Health Monitoring — Design

**Date:** 2026-08-05
**Status:** **SUPERSEDED as of 2026-08-06 — Phases A+B are BUILT.**
**Repos touched:** `markai-signage-api`, `markai-Web-cms`, `markai-player-apk`

> ## ⚠️ Read the built design instead
>
> This document is the original brainstorm. The scope grew materially on
> 2026-08-06 (show *all* readings — brightness, temperature, voltage, fan — and
> degrade honestly on screens with no controller or no monitoring cards), and the
> implemented design differs from what is written below:
>
> | This doc says | What was actually built |
> |---|---|
> | 2 tables (`screen_panels`, `panel_health`) | **4** — `screen_health`, `screen_panels`, `panel_readings`, `panel_health` |
> | backend module `app/panels/` | `app/health/` (self-contained subsystem, incl. its own `overlay.py`) |
> | one CMS fleet page | fleet page **+** per-screen detail with Overview/Cabinets/Environment/History tabs |
> | no tier concept | **capability tiers** `none → display → controller → monitoring`, derived in `app/health/capability.py` |
> | overlay in `app/screenshots/overlay.py` | `app/health/overlay.py`, applied **on read** from the download paths |
>
> The authoritative record of what shipped is
> `~/.claude/plans/idempotent-enchanting-bumblebee.md`. The sections below are
> kept for the protocol research (still accurate and still useful for Phase C).

## Problem

An LED wall is built from **cabinets** — tiles bolted into a grid, each holding several
LED modules plus a receiving card. When a cabinet or module dies, the wall shows a black
(or discoloured) patch. An advertiser is billed for an ad that was partly invisible, and
nobody finds out until someone walks past the screen.

Operators reasonably assume our milestone screenshots would reveal this. **They cannot.**

## Why screenshots can never show it

`markai-player-apk/app/src/main/java/tech/markai/player/ui/ScreenshotCapture.kt` uses
`PixelCopy` to copy the player's **own window / SurfaceView buffer**. There is no
`MediaProjection` and no screen-record permission in the manifest. The capture therefore
records the pixels we *send*, not the pixels the wall *produces*:

```
APK draws ad → framebuffer → HDMI → controller → receiving cards → LED modules
                    ↑
        screenshot copied HERE — three steps upstream of the fault
```

There is no return path. The panel never reports what it emitted. A screenshot of a wall
with a dead centre comes back complete and perfect. `display_on`
(`PowerManager.isInteractive`) is likewise only Android's opinion that a display is awake.

Faults **upstream** of the copy — a bad creative, a failed decode, an empty Solution zone,
the wrong ad — **do** appear in the JPEG. The rule is *where in the chain the fault
occurs*, not what colour it is.

**Consequence:** the fault data must come from the hardware that can actually observe it.

## Where the data comes from

Each cabinet carries a **monitoring card** (Novastar MON300 or the equivalent for
whichever control system is installed). It detects open/short circuits — which is dead-LED
detection, subject to the modules' driver ICs supporting it — plus cabinet temperature,
humidity, supply voltage, fan speed, flat-cable faults and door state. Receiving cards
pass this up to the **controller** (sending card), which relays it onward.

The controller is a **messenger, not a detector**. Without monitoring cards in the
cabinets it has nothing to report and will show perfect health on a half-dark wall.

**Confirmed for this fleet:** monitoring cards are fitted. The screens were installed by
Vinux hardware; every working screen already has a controller. Nothing physical needs to
be purchased.

**Open:** the control-system brand and model, and whether its monitoring detects LED
open/short or only environmental values. See [Open Questions](#open-questions).

## Protocol research (2026-08-05)

The controller protocol is **not a black box**. For Novastar it is fully reverse-engineered
and public; Colorlight has an equivalent open implementation.

### Novastar — `sarakusha/novastar`

[github.com/sarakusha/novastar](https://github.com/sarakusha/novastar) — TypeScript,
actively maintained (last commit 2026-07-29), derived from **decompiled NovaLCT .NET
assemblies** (`Nova.LCT.GigabitSystem.DataClass`). A Wireshark dissector (`novastar.lua`)
ships with it for inspecting live traffic.

**Transport:** TCP, ports **5200 / 5201 / 5203**. Packet = header (`aa 55`) + content +
checksum.

**Addressing:** `(addr, portAddr, scanBoardAddr)` — sender address, controller output port,
receiving-card index along that port's daisy chain. **This is our cabinet identity**, so
`screen_panels.cabinet_id` is stored as `"{port}-{scanBoardAddr}"`.

**The calls that matter:**

| Call | Gives us |
|---|---|
| `ReadIsMonitorCardExist` | Whether monitoring cards are actually fitted — answers open question 2 **programmatically**, no vendor email needed |
| `ReadAllModuelStatus(addr, port, scanBoard, len)` | Per-**module** status via `Scanner_AllMonitorModuelDataAddr` — this is dead-module detection |
| `ReadMonitorCardAllStatus` / `ReadMonitorCardAllInfo` | Full monitoring payload per cabinet |
| `ReadTempInfoOfMonitorCard`, `ReadVoltageOfMonitorCard`, `ReadHumiOfMonitorCard`, `ReadFanSpeedOfMonitorCard`, `ReadSmokeWarningOfMonitorCard` | Environmental values |
| `ReadCabinetInfo`, `ReadScannerCabinetID` | Cabinet identity, for auto-populating `screen_panels` instead of hand-entering the grid |
| `ReadSenderDVIStatus` | Whether the controller is even receiving video from the AndBox |

**`MonitorErrData`** carries the error counters we surface as `degraded`:
`SmartModuleStateErrCount`, `SBStatusErrCount` (receiving card), `MCStatusErrCount`
(monitor card), plus smoke / temperature / humidity / fan / power alarm counts and
`SenderDviExceptionCnt`.

**Implication for `screen_panels`:** the grid may not need manual entry at all.
`ReadCabinetInfo` + `ReadScannerCabinetID` can discover the topology, so the operator
confirms a detected layout rather than typing rows × columns. Manual entry stays as the
fallback for controllers that don't report it.

### Colorlight — `thesleort/LED-Server`

[github.com/thesleort/LED-Server](https://github.com/thesleort/LED-Server) — open
implementation of the proprietary Colorlight protocol for their displays and sender cards.
Less complete than the Novastar work; enough to confirm a second adapter is feasible.

### Official protocols

Novastar publishes control protocols for some lines (VX1000 all-in-one, COEX central
control). Worth requesting from the distributor — an official spec beats a decompilation
where one exists.

### Consequence for our implementation

The reference implementation is **TypeScript/Node**, which neither our Python backend nor
our Kotlin APK can consume directly. We therefore **port the packet format**, not the
library — and we only need a handful of read commands, not the full API. The repo gives us
the packet structure, checksum, and `AddressMapping` constants to port from, which removes
essentially all of the guesswork.

This materially de-risks Phase 2: it is now a porting job against a working reference,
not a reverse-engineering project.

## Architecture

```
cabinets → monitoring cards → receiving cards → controller
                                                    │
                              ┌─────────────────────┴───────────────┐
                              │  PanelHealthReader (interface)      │
                              │   ├─ LocalControllerReader (APK)    │  ← primary
                              │   ├─ CloudReader (backend cron)     │  ← if vendor API exists
                              │   └─ MockReader (dev/test)          │
                              └─────────────────────┬───────────────┘
                                                    ▼
                                          panel_health table
                                    ┌───────────────┴───────────────┐
                                    ▼                               ▼
                        CMS: wall map + badges          screenshot overlay:
                        "cabinet 7 dark since Tue"      dead cabinets painted black
```

Everything except the reader adapter is brand-independent. Only the adapter speaks a
vendor protocol, and it is the last piece to be written.

### Why the reader is an interface

The control-system brand is not yet confirmed, and a future screen purchase may use a
different one. Isolating the vendor protocol behind one interface means:

- the pipeline is built and tested today against `MockReader`, with no hardware
- a second brand is one new adapter, not a rewrite
- the local-vs-cloud decision can change without touching the database, CMS or overlay

## Data model

New migration `0038_panel_health.py` (latest on main is `0037_creative_fit_jobs`).

### `screen_panels` — the physical map of a wall

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `screen_id` | fk → `screens.id` cascade | |
| `cabinet_id` | str | Vendor's identifier, e.g. `"1-4"` (chain-position) |
| `row`, `col` | int | Position in the grid |
| `x`, `y`, `w`, `h` | float | Percent of screen area — same convention as `bookings.layout` zones, so the screenshot overlay reuses existing geometry code |
| `created_at` | timestamptz | |

Unique on `(screen_id, cabinet_id)`.

The grid is entered once per screen by an operator (rows × cols), and x/y/w/h are derived.
Cabinets in a wall are uniform, so this is arithmetic, not per-cabinet data entry.

### `panel_health` — current + historical status

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `screen_id` | fk → `screens.id` cascade | Denormalised for cheap fleet queries |
| `panel_id` | fk → `screen_panels.id` cascade | |
| `state` | enum | `ok` \| `degraded` \| `dark` \| `unknown` |
| `detail` | JSON nullable | Raw vendor payload — temperature, voltage, error counts |
| `observed_at` | timestamptz | When the reader saw it |
| `resolved_at` | timestamptz nullable | Set when the panel returns to `ok` |

Rows are appended on **state change**, not on every poll — that gives "dark since Tuesday"
for free and keeps the table small. A row is *open* while `resolved_at IS NULL`.

Current state per panel:

- **no open row** → the panel is `ok` (healthy is the absence of a fault, so a fleet of
  healthy screens writes nothing)
- **one open row** → that row's `state`; `observed_at` is when the fault began, which is
  what "dark since Tuesday" reads from

A panel therefore has at most one open row, enforced by a partial unique index on
`(panel_id) WHERE resolved_at IS NULL`.

`unknown` is a first-class state: it means the reader could not reach the controller, and
must never be rendered as healthy.

## Reader interface

### APK side (`markai-player-apk`)

```kotlin
interface PanelHealthReader {
    /** Null when the controller is unreachable — the caller reports `unknown`, not `ok`. */
    suspend fun read(): List<PanelStatus>?
}

data class PanelStatus(val cabinetId: String, val state: String, val detail: Map<String, String>)
```

Implementations: `MockPanelHealthReader` (dev), and one vendor adapter once the brand is
known.

**Ethernet binding — the detail that will silently break this.** Android routes all
traffic through whichever network holds the default route, normally the internet link.
Controller queries sent without binding will leave via the internet port and vanish. The
adapter must acquire the controller's network explicitly:

```kotlin
ConnectivityManager.requestNetwork(
    NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET).build(),
    callback,
)
// then network.bindSocket(socket) / network.socketFactory for every controller call
```

The AndBox Prime X4 RTC reportedly exposes two Ethernet ports (the product page lists
one). Confirm with `adb shell ip link` — both `eth0` and `eth1` must appear. If only one
NIC is live, the controller shares the internet link and must sit on the same subnet.

### Backend side (`markai-signage-api`)

`app/panels/service.py` exposes `record_panel_health(screen_id, statuses)`, which diffs
against current state and appends only changes. Both the heartbeat path and a future
cloud-cron path call the same function.

## Heartbeat contract

`HeartbeatRequest` gains one optional field, alongside the existing `display_on` /
`now_playing_media_id` / `app_version_*`:

```kotlin
@SerialName("panel_health") val panelHealth: List<PanelStatusDto>? = null
```

Rules:

- **Optional and nullable.** An older APK omits it; the backend stores nothing and leaves
  existing state untouched. Contract stays backward-compatible, per the APK guide.
- **Sent when the reading has changed since the last acknowledged send, and otherwise once
  per hour as a liveness refresh.** Panel faults change on a scale of days; the heartbeat
  runs every 60s. Re-sending an unchanged 40-cabinet array 1,440 times a day is pure waste,
  but never re-sending makes a stale reading indistinguishable from a fresh one.
- **Read on a slower cadence than the beat.** The reader polls the controller on its own
  interval (default 15 min), caches the result, and the heartbeat carries the cache.
- **Off-hours safe.** Outside a screen's operating window the heartbeat drops to the slow
  keep-alive; panel health rides that cadence unchanged. A closed screen is not polled.

## Screenshot overlay

`app/screenshots/overlay.py` already burns the GPS-Map-Camera banner onto milestone
frames and is called fail-open by `ingest_screenshot`. It gains a second pass:

```python
def paint_dead_panels(img: Image, panels: list[PanelRect]) -> Image:
    """Black out cabinets known-dark at capture time, with a thin red border + label."""
```

- Runs **before** the GPS banner, so the banner is never obscured.
- Uses `panel_health` as of the frame's `captured_at`, not "now" — the stored proof must
  reflect the wall's state when the ad played.
- **Fail-open, like the banner.** Any error returns the un-overlaid frame; losing the
  proof is worse than losing the annotation.
- **The raw frame is stored unmodified.** The overlay is applied on read, so the original
  evidence is never destroyed and a later correction to fault data re-renders correctly.
- Dead regions are drawn with a visible border and `CABINET 7 — NO OUTPUT` label so nobody
  mistakes an annotation for the creative's own black area.

This is the deliverable the operator originally asked for: an ad frame **with the hole in
it**, reconstructed from real fault data rather than photographed.

## CMS surface

### Sidebar — a dedicated section

Panel health gets its own top-level nav item, not just a widget buried in screen detail.

`src/components/layout/Sidebar.tsx`, in the **Operate** group directly under *Screens*:

```tsx
{ href: "/screen-health", label: "Screen health", icon: HeartPulse, visible: always },
```

`visible: always` is correct here: **both roles see it.** A screenowner is a superadmin
scoped to their own screens, and screen condition is squarely their job — they own the
panel. Scoping is enforced in the backend via `screen_assignments`, exactly as every other
screen route already does, so the nav entry needs no role predicate.

New route `src/app/(dashboard)/screen-health/page.tsx` — the fleet health view:

- every screen the caller may see, worst-first (dark before degraded before ok)
- per screen: name, location, cabinet grid thumbnail, `3/40 dark`, "dark since 29 Jul"
- filters: state, and screenowner (superadmin only)
- click through to the screen detail

A screenowner opening this sees only their assigned screens and no owner filter — no
separate page, no separate component, just fewer rows.

### Components

`src/app/(dashboard)/screens/[id]/page.tsx` is already 726 lines. Panel health goes in new
components, not into that file:

- `src/components/screens/PanelHealthMap.tsx` — the cabinet grid, colour-coded
  (`ok` grey / `degraded` amber / `dark` red / `unknown` hatched), with a tooltip carrying
  `detail` and "dark since <date>".
- `src/components/screens/PanelHealthBadge.tsx` — compact indicator for the screens list
  and the fleet view, e.g. `3/40 dark`.

Screens list (`screens/page.tsx`) gains the badge in the existing status column. A screen
with dark cabinets reads as **impaired**, distinct from `offline` and from `off_hours` —
it is playing, just not fully visible.

**Booking-side effect is out of scope for v1.** Whether an impaired screen should be
blocked from booking or discounted is a commercial decision, not a technical one. The data
will exist for that decision to be made later.

## Access control

Panel health follows the existing screen-scoping rule: a **screenowner** sees it for their
assigned screens only; a **superadmin** sees the whole fleet. No new permission concept —
it reuses `screen_assignments`, consistent with the governing role model.

## Error handling

| Failure | Behaviour |
|---|---|
| Controller unreachable | Reader returns null → state `unknown`, never `ok`. CMS renders hatched, not healthy |
| Malformed vendor payload | Log, skip the poll, keep previous state. Never write garbage into `panel_health` |
| Cabinet appears that isn't in `screen_panels` | Store it with `row/col` null and flag it in the CMS — the grid was mis-entered, and silently dropping it hides a real fault |
| Overlay rendering fails | Fail open — return the raw frame |
| APK too old to send the field | Field absent; existing state untouched; no false "recovered" |
| Screen off-hours | Not polled; state retained with its existing `observed_at` |

## Testing

Following the project rule that pytest is not run in these backends — verification is by
import/syntax checks plus the user's own test runs.

- **Backend:** `record_panel_health` diff logic — no-op on unchanged, appends on change,
  sets `resolved_at` on recovery. `paint_dead_panels` geometry against known rects.
- **APK:** `PanelHealthReaderTest` against `MockPanelHealthReader`; heartbeat serialisation
  test proving the field is omitted when null (backward compatibility).
- **CMS:** `PanelHealthMap` rendering per state, including `unknown`, under the existing
  vitest setup.
- **End-to-end without hardware:** `MockPanelHealthReader` emits a scripted fault, and the
  whole chain — heartbeat → table → CMS map → screenshot overlay — is verified before any
  vendor adapter exists.

## Phasing

**Phase 1 — pipeline (no hardware dependency).** Migration, `screen_panels` /
`panel_health`, `record_panel_health`, heartbeat field, `PanelHealthReader` + mock, CMS map
and badge, screenshot overlay. Fully testable and shippable on its own.

**Phase 2 — vendor adapter (blocked).** One class implementing `PanelHealthReader` against
the confirmed control system, plus the Ethernet binding. Requires the brand, the protocol
or SDK, and ideally one screen to iterate against.

**Phase 3 — optional.** Alerting (a dark cabinet raises a notification), and the
commercial decision about impaired screens and bookings.

## Open questions

1. **Which control system?** Brand and model of the sending card and receiving cards.
   Vinux specified and installed the screens and will have this in a spec sheet. This is
   the only genuinely blocking unknown — it selects which adapter to port.
2. **Wall resolution per screen** — needed regardless, for `markai-creative-fit` and to
   confirm the AndBox's HDMI output matches the wall's native pixel dimensions.
3. **Does the AndBox expose two live NICs?** `adb shell ip link` → `eth0` + `eth1`. If
   only one, the controller shares the internet link and must sit on the same subnet.

**No longer open, thanks to the protocol research:**

- *Do the monitoring cards detect LED open/short?* → `ReadIsMonitorCardExist` and
  `ReadAllModuelStatus` answer this from the wire, once we can reach a controller. No
  vendor confirmation needed.
- *Is there an SDK or documented protocol?* → for Novastar, a maintained reverse-engineered
  reference exists; for Colorlight, a partial one. Official protocol docs are still worth
  requesting, but are no longer a prerequisite.

Phase 1 waits on none of these.

## Explicitly out of scope

- **Camera-based verification.** Only a camera catches dirt, glare, obstruction, or a
  vehicle parked in front — all electrically perfect and visually broken. Worth adding at
  a few high-value sites later; not part of this design.
- **Modifying the screenshot capture path in the APK.** It is correct as built; the
  limitation is physical, not a defect.
- Blocking or discounting bookings on impaired screens (see CMS surface).
