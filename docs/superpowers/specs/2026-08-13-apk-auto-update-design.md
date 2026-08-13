# CMS-approved over-the-air player updates — design

**Date:** 2026-08-13
**Status:** design, not implemented
**Hardware:** AndBox Prime X4 RTC (Amlogic S905X4, Android 11, 4GB/32GB, generic AOSP)
**Supersedes the deferral in:** `2026-08-02-zero-touch-apk-enrollment-design.md:501`, which parked
self-update behind "can the player be provisioned as Android device owner on their boxes?"
We now own the hardware, so that question is ours to answer — see Phase 0.

---

## The problem

Installing a new player build today means physically visiting the screen. At any fleet
size above about five screens that is the binding constraint on shipping anything.

We want: publish a build → an operator approves it in the CMS → every targeted screen
installs it unattended and resumes playing. Superadmin can roll out to any screen;
a screenowner can roll out to the screens assigned to them.

## What already exists

| Piece | Where | State |
|---|---|---|
| Tag-driven build + sign + register | `.github/workflows/release.yml` | done |
| Release registry (`version_code`, `sha256`, GCS object, `is_latest`) | `app/apk/models.py` | done |
| Player reports its version every beat | `net/dto/HeartbeatDto.kt:21-22` | done |
| Backend stores it per screen | `app/screens/models.py:76-77` | done |
| `is_outdated` computed per screen | `app/screens/service.py:405-414` | done |
| CMS renders version + "Outdated" badge | `screens/page.tsx:340-349` | done |
| Bulk screen write, role-scoped | `app/cms/screens_router.py:82-101` | done |
| Per-screen "queue an action for next beat" | `screens_router.py:142-155` (rescan-location) | done |

**Nothing installs anything.** No `PackageInstaller`, no device admin, no
`REQUEST_INSTALL_PACKAGES` anywhere in the APK. That is the entire gap.

---

## Phase 0 — the spike that decides the architecture

**Do this before writing any feature code.** Roughly 30 minutes on one real box.
The result selects between two materially different designs, and no amount of
design work substitutes for it.

```bash
# THE decisive one. Empty output = silent install is impossible on this hardware.
adb shell pm list features | grep device_admin      # want: android.software.device_admin

# Device-owner preconditions (all must hold)
adb shell pm list users                             # want: exactly one user
adb shell dumpsys account | head -40                # want: zero accounts
adb shell dumpsys device_policy | grep -i "Device Owner"   # want: empty

# The fallback path
adb shell which su                                  # is it rooted?
adb shell getenforce                                # Enforcing?

# The thing that decides remote-fix vs truck-roll
adb shell getprop service.adb.tcp.port
adb shell getprop ro.debuggable
```

**Decision table**

| `device_admin` feature | `su` | Architecture |
|---|---|---|
| present | either | **Device Owner.** Full design below. |
| absent | present | Root-only install. Same backend/CMS; no kiosk, no BAL exemption, no remote reboot. Fragile across hardware batches — re-run this spike on every new batch. |
| absent | absent | **Silent update is impossible on this box.** Stop. Either change hardware or accept hand-installs. Do not build the feature. |

⚠️ **Zero accounts is a hard gate.** Signing into Google on the box blocks enrollment.
Removing the account clears it — a factory reset is *not* required (verified against
AOSP `DevicePolicyManagerService.checkDeviceOwnerProvisioningPreConditionLocked`, which
takes the permissive `isAdb` branch; the "setup wizard closes the door" advice applies
only to the NFC/QR provisioning path).

---

## Architecture

### The core decision: the updater is a separate APK

Committing a `PackageInstaller` session **kills the installing process** — AOSP
`PackageManagerService.installPackageLI` freezes and kills the package inline, with the
comment *"so that we do not end up in a confused state while the user is still using the
older version."* An app that installs its own replacement is therefore the code
responsible for its own recovery, and it is dead at the moment recovery is needed.

The existing `service/Watchdog.kt` has the same defect: it is an AlarmManager tick
*inside* the APK it is meant to protect. It cannot save a build that crashes on boot.

So:

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  markai-player-updater       │        │  markai-player (existing)    │
│  ~100KB · changes rarely     │        │  the thing that plays ads    │
│  IS the Device Owner         │───────▶│  installed/updated BY the    │
│  · installs the player       │        │  updater · stays dumb        │
│  · watchdogs it              │        │  · reports version on beat   │
│  · retains last-known-good   │        │  · no install code at all    │
│  · own minimal heartbeat     │        │                              │
└──────────────────────────────┘        └──────────────────────────────┘
```

This mirrors what every product in this space does — garlic-launcher (AGPL, the cleanest
reference), Headwind's launcher, Esper's Agent, NowSignage's RDM watchdog. Read
garlic-launcher's `Installer.java` and `WatchDogService.java` before writing ours; that
is where the fleet-killing bugs live.

**Consequence for the player:** it needs no update code, no new permissions, and no
behaviour change. The `app_update` signal is consumed by the updater, not the player.

### Install path order — Device Owner FIRST

1. **Device Owner + `PackageInstaller`** — silent, deterministic, ours to provision.
2. **Root (`su`)** — fallback only. An accident of whatever ROM the vendor flashed;
   can vanish on the next hardware batch, and shelling to root from a network-triggered
   path is the highest-value exploit target on the box.
3. **Refuse and alert** — surface "manual install required" in the CMS. Never prompt.

There is no fourth option. `PackageInstaller.setRequireUserAction(false)` — the modern
"an app may silently update itself" route — is **API 31+**, and these boxes are API 30.
`REQUEST_INSTALL_PACKAGES` is `signature|appop` and always shows a dialog. On a
wall-mounted box with no keyboard, prompting is not a fallback.

Xibo does root-first and it is widely regarded as their weakest point.

### Why Device Owner is the keystone

It is simultaneously five things, which is why nothing else substitutes:

- the reason silent install is legal — `PackageInstallerSession.needToAskForPermissionsLocked()`
  waives the prompt for a device owner
- a **background-activity-start exemption** on Android 11 — `ActivityStarter` has
  `if (mService.isDeviceOwner(callingUid)) return false;`. Undocumented, present 11→14.
  This is what stops the screen sitting black after an update.
- an exemption to Android 12+'s FGS-from-background restriction (future-proofing)
- the gate for lock-task kiosk (`setLockTaskPackages`) and `DevicePolicyManager.reboot()`
- provisionable over adb on an already-set-up box, no factory reset

### Delivery

Unchanged from the original sketch, and it is sound: the 60s heartbeat carries a
*signal*, not bytes. `app_update {version_name, version_code, url, sha256}`, with a
signed GCS URL (V4, 7-day TTL, already cached in `gcs_service.py:23`) and a WorkManager
download. Deployed players tolerate the new field — `ApiClient.kt:97` sets
`ignoreUnknownKeys = true` and every response field has a default.

### Install timing — off-hours only, not "end of the current ad"

Deferring to a slot boundary buys ten seconds (`DEFAULT_SLOT_DURATION_SECONDS = 10`)
while the actual disruption — install, process death, relaunch — is 10–60s of black
screen. Deferral does not shrink it.

Instead: **install only outside the screen's operating hours.** The mechanism already
exists (`on_start_minute`/`on_end_minute`, and off-hours screens already keep a 15-min
keep-alive beat specifically so operators can reach closed screens). A 24/7 screen
(both null) has no off-hours and needs an explicit maintenance window — new field.

### Rollout control

`screens.target_version_code` is correct as the **device-facing desired state**:
declarative, idempotent, converges. It is insufficient as the **control surface**.

Add a `apk_rollouts` object owning intent: which cohort, which stage, paused or running,
who approved it, and a halt policy. Rings: **1 canary → 5 → 25% → rest**, each gated on
health. `target_version_code` stores the *resolved* code at rollout time, never a
"follow latest" sentinel — otherwise a CI publish mid-rollout silently splits the fleet.

**Health-gated auto-halt** using signals already collected (`last_seen_at`,
`app_version_code`, `player_foreground`): if screens that took the update stop checking
in, halt the rollout automatically. Android's own `PackageWatchdog` thresholds are a
reasonable starting point — 5 crashes in 1 minute, 5 boot loops in 10 minutes, 2-day
observation window.

---

## There is no rollback. Design for roll-forward.

Verified against AOSP: Android refuses a lower `versionCode`; `pm install -d` is honoured
only when the installed package or the device build is debuggable; **device owner does
not unlock downgrade** (`setRequestDowngrade()` is `@SystemApi` gated on
`INSTALL_PACKAGES`); `RollbackManager` is `signature|privileged`. Uninstall+reinstall
works but wipes app data — including the enrollment key and auth token.

So the recovery model is **fix forward**, and the metric to optimise is
time-to-ship-a-fix, not rollback capability. That makes the pre-rollout gates
(Phase 0 spike, canary ring, health halt, CI release smoke-test) the actual safety
system, not a nice-to-have.

The updater retains the last-known-good APK on disk so a broken player can be
reinstalled without a network round-trip — but note this only helps via
uninstall+reinstall, with the data-wipe cost above.

---

## Bugs this feature would inherit (fix as part of it)

1. **🔴 The `sha256` handed out with every download is the wrong file's digest.**
   `app/apk/service.py:204` returns `release.sha256` — computed by CI on the *plain* APK
   (`release.yml:109`) — while the URL serves *personalized* bytes. Dormant today because
   nothing verifies it; the update path is precisely what makes it live. Fix: hash the
   personalized bytes at `service.py:171`.

2. **🔴 Re-publishing a version code never invalidates the personalized cache.**
   `register_release` is idempotent on `version_code` and the workflow documents re-running
   as the repair path — but personalized blobs are keyed `{owner}/{version_code}.apk` and
   only regenerated when absent (`service.py:158`). A re-cut release serves stale bytes
   forever. Fix: delete `apk/personalized/*/{version_code}.apk` when an existing row's
   `sha256` changes, or key the cache by `sha256`.

3. **🔴 CI never builds the artifact that ships.** `ci.yml` runs only `assembleDebug`.
   The shipped binary is a *different package* (`applicationIdSuffix = ".debug"`) built
   through R8 (`isMinifyEnabled` + `isShrinkResources`), first assembled at tag time and
   never run on a device before it reaches walls. An R8-only `NoSuchMethodError` in a
   kotlinx-serialization DTO is the classic form of this. Fix: build the release APK on
   every merge and smoke-test it on a real device before it is rollout-eligible.

4. **🔴 Gradle 9.3.0 wrapper against AGP 8.5.2.** Gradle 9 requires AGP 8.11+. If this is
   what CI runs, `assembleRelease` fails and no release can be cut at all. **Verify
   before anything else.**

5. **🟡 `BASE_URL` and `PROVISIONING_KEY` are compile-time constants**, and the
   provisioning key silently falls back to `markai-dev-provisioning-key` when
   `local.properties` is absent. `SessionRecovery` re-registers with that constant and it
   is the only recovery from token expiry. A release built without the CI secret ships a
   key the backend 403s. Combined with `JWT_EXPIRE_DAYS = 365` and screens installed in
   the same week, that is a fleet going dark on a date nobody has written down. Make both
   runtime-configurable and persisted, with the compiled value as first-boot seed only.

6. **🟡 `ContentCache.enforceCap` never evicts `.part` files** — aborted downloads
   accumulate forever on a 32GB box. The updater adds another ~20MB download per release.
   Gate installs on `storage_free_mb`, which is already reported every beat.

7. **🟡 CI sets `is_latest` automatically**, so publishing instantly marks the whole fleet
   `is_outdated` with no gate between "built" and "approved". Separate the two concepts.

---

## Integration points (verified, with line numbers)

**Backend**
- Model: `app/screens/models.py:77` — `target_version_code`, nullable Integer, beside `app_version_code`
- Migration: `0042_screen_target_version.py`, `down_revision = "0041_gmail_booking_drafts"`.
  Revision id must stay under 32 chars (`alembic_version.version_num` is VARCHAR(32)).
  Template: `0036_apk_release_and_version.py`.
- Heartbeat: compose in `app/playback/router.py:52-59` alongside `pending_screenshots`.
  ⚠️ Compare against `payload.app_version_code`, **never** `screen.app_version_code` —
  `record_heartbeat` writes it via a Core `update()` and the session is
  `expire_on_commit=False`, so the ORM object holds the pre-beat value.
  ⚠️ A screen reporting no version must not be treated as behind.
  Zero added queries when `target_version_code` is null, which is the common case.
- Per-screen endpoint: copy `POST /cms/screens/{id}/rescan-location`
  (`screens_router.py:142-155`) — `require_screenowner_or_super` +
  `assert_can_manage_screen` (`app/cms_users/deps.py:87`). **No new auth code needed.**
- Bulk endpoint: copy `PATCH /cms/screens/operating-hours` (`screens_router.py:82-101`)
  and its `screen_ids`-xor-`filter` contract (`schemas.py:321-376`), scoped by
  `_visible_screen_conditions` (`service.py:531-546`).
  ⚠️ Must be declared **above** `/{screen_id}` or the literal path is captured as an id.
  ⚠️ Do **not** copy its per-screen `update_screen` loop — one commit per screen. Use a
  single `UPDATE ... WHERE id IN (...)`.
  ⚠️ Do **not** bump `schedule_updated_at` — a version target is not a schedule change.
- URL: sign `release.gcs_object` directly. Heartbeat auth is a **screen**, not a CMS user
  (`get_current_screen`), so `build_download_for_owner` does not apply.
  ⚠️ `signed_url_for` is synchronous and blocks the event loop on a cache miss
  (`gcs_service.py:126-130`) — pre-warm or accept one stall per blob per 6 days.
- Jitter the delivery. 100 screens taking the same beat will stampede GCS and the café
  uplinks. Precedent: `SCHEDULE_REFRESH_JITTER_MS`.

**CMS**
- Types: `src/lib/types.ts:133` — `target_version_code` beside `is_outdated`
- Bulk UI already exists — reuse `screens/page.tsx:244-273` (including "select all N
  matching") and the `saveBulk` dual-shape call at `:130-164`
- Per-screen action: screen detail page, copy the Location card's Re-scan button
  (`screens/[id]/page.tsx:332-347`) including its "runs the next time this screen checks
  in" copy
- New routes must live under `/api/cms/*` — the BFF proxy forwards only that prefix
- Cache invalidation is automatic (`query-invalidation.ts:50-52` maps `/cms/screens*`)
- Role: `useAuth()` → `isSuperadmin` / `isScreenOwner` decide what the UI *offers*;
  the server still scopes

**Updater APK (new project)**
- `DeviceAdminReceiver` protected by `BIND_DEVICE_ADMIN` with `android.app.device_admin`
  meta-data
- `MY_PACKAGE_REPLACED` receiver **with no `<data>` element** — PMS sends it with a null
  URI, so `scheme="package"` makes it silently never fire. This is the single most-copied
  wrong snippet in this area.
- Install-status receiver must be **manifest-declared** — the session callback is
  delivered after our process is killed, so a runtime-registered receiver loses it
- Never gate success on the `su` exit code — the pipe dies with the process, so a
  successful install routinely returns truncated output. Verify via
  `getPackageInfo().longVersionCode` on next launch.
- Stage the APK in `/data/local/tmp` via plain `cp` — never `mv` (keeps the
  `app_data_file` label), never `cp -a`/`--preserve=xattr`
- `targetSdk 34` requires explicit `android:exported` on every receiver with a filter

**Tests**
- `tests/test_screens.py:96-101` asserts the heartbeat body with exact dict equality and
  will fail on the new field.

---

## Open questions

1. **Does the box declare `android.software.device_admin`?** Phase 0. Decides everything.
2. **Master or personalized bytes over OTA?** Master is simpler and the screen is already
   registered (its token survives an update). But then a later factory reset lands at the
   enrollment-key prompt. Personalized costs an extra query to resolve the screen's owner
   at heartbeat time. Recommend **personalized**, once bug #1 is fixed.
3. **Maintenance window for 24/7 screens** — new per-screen field, or reuse a global?
4. **Remote unenroll.** Once device owner is set, the app cannot be uninstalled without a
   factory reset. Ship a remote "unenroll" command *before* deploying at scale.

---

## Build vs buy

**Build the rollout logic, don't hand-roll the device-owner shell.**

Buying does not remove the per-device physical touch — Esper's own docs confirm AOSP
devices cannot use QR, Android for Work, or Zero Touch enrolment, and their AOSP
zero-touch path needs the AOSP source tree a generic supplier will not provide. So the
expensive part is unavoidable either way; what you would buy is rollout *tooling*, on
top of a backend, CMS, heartbeat and release pipeline we already own.

- **Android Management API / managed Google Play — impossible**, not merely degraded.
  Provisioning runs through Google Setup Wizard and private-app distribution needs the
  Play Store. Neither exists on a non-GMS box.
- **Esper** — $2/$4/$6 per device/month, 25-device minimum; staged-rollout Pipelines is
  the $6 tier. ~$7,200/yr at 100 screens.
- **Headwind MDM** — Apache-2.0 self-hosted, free; explicitly targets AOSP/de-Googled
  devices. Worth reading regardless of whether we adopt it.

Revisit at roughly 500 screens.

---

## Sequencing

**Phase 0** — the spike (§ above). Blocks everything.
**Phase 1** — unblock releases: fix the Gradle/AGP pairing, build release in CI, smoke-test on a device.
**Phase 2** — updater APK: device admin, install, watchdog, last-known-good. Provision one box by hand end-to-end.
**Phase 3** — backend: column, migration, heartbeat field, endpoints, the three inherited bug fixes.
**Phase 4** — CMS: rollout banner, per-screen action, status chips, role scoping.
**Phase 5** — rollout object: rings, health-gated halt, audit.

Phases 3 and 4 can proceed in parallel with 2 — they are independent, and the backend
half is inert until an updater exists in the field to consume it.
