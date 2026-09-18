# Mark AI Updater app — design

**Date:** 2026-09-13 · **Status:** design agreed in discussion with Akshat; implementation gated on Phase 0
**Repos:** `markai-player-apk` (Adneuron/APK-CMS), `markai-signage-api` (Adneuron/CMS-Back), `markai-Web-cms` (Adneuron/CMS-Web), Headscale VM
**Supersedes, in part:** `2026-08-13-apk-auto-update-design.md` (its Device Owner + roll-forward decisions stand; its "updater is a separate APK" decision is realised here, with the tunnel added)

## 1. Goal (Akshat's words, condensed)

> Put only two APKs on a screen: the Player and the Updater. No Tailscale app. The
> Updater is downloaded from the CMS, gets its private-network IP by itself, stays
> running in the background forever, updates the Player from the CMS, and can roll a
> bad Player release back with no risk to the screen. Nobody types an IP or a key.

## 2. Non-goals

- Installing or configuring the official Tailscale app on any box.
- A true Android downgrade to a lower `versionCode` (Android forbids it; see §9).
- Changing how the Player plays ads, schedules, or reports proof of play.
- Multi-tenant networks (one Headscale, one fleet key).

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Exactly two APKs per box: **Player** and **Updater** | Akshat's hard requirement |
| D2 | The tunnel engine (`tailscaled`) lives **inside the Updater**, not the Player | A Player release that crashes on start would otherwise take down the only channel used to roll it back |
| D3 | The Updater is the box's **Device Owner** | Only way to install/update apps silently on a touchless LED box; also blocks uninstall/disable |
| D4 | The Headscale **join key is stamped into the Updater at CMS download** (stamp field `t`) | Same signing-block mechanism the Player already uses; key never in git; no prompt |
| D5 | Rollback is **roll-forward**: rebuild the last good release's `git_sha` with a higher `versionCode` | Android refuses a lower `versionCode`; Device Owner does not unlock downgrade |
| D6 | The Updater **reads the Player's screen identity**; it never creates its own | `device_uid` falls back to a random UUID stored in the Player's DataStore when ANDROID_ID is unusable |
| D7 | Updater and Player are **one Gradle project, one signing key, one CI** | A Device Owner app can never change its signing key without a factory reset; shared key also gives both apps the same ANDROID_ID |
| D8 | Updates install **only outside the screen's operating hours** | Never interrupt an ad |
| D9 | New releases go to a **canary screen first** (Favara), rollout halts on failure | Catch a bad build on one wall, not all |

## 4. Verified facts this design rests on

Checked live on 2026-09-12/13 unless stated.

**Favara Baby World (AndBox, `ohm`)** — Android 11 / SDK 30, ABI `armeabi-v7a`, `userdebug`,
`ro.debuggable=1`, **SELinux Permissive**, `device_admin` feature present, 1 user, **0 accounts,
no Device Owner set**, `/system/xbin/su` is `root:shell` setuid (an app uid cannot use it),
24 GB free on `/data`. Tailnet `100.64.0.4` online; adb `:5555` reachable from `gcp-updater`.

**Spark ads Jayanagar (NovaStar T40)** — `armeabi-v7a`, `userdebug`, Device Owner preconditions
pass (2026-09-12). Tailnet `100.64.0.5` **offline** since a reboot; adb `:5555` closed. Its
standalone `tailscaled` died on reboot and nothing on that firmware can restart it; adbd reverts
to USB-only on every boot. SELinux mode **not yet checked** (box unreachable).

**Headscale** — v0.29.3 on GCE VM `headscale`, `100.64.0.0/10`, allocation `sequential`, node
expiry `0`, systemd `headscale serve` with `ExecReload` = HUP. **No ACL policy** (`policy.path: ""`
= allow-all). Minimum client **v1.80**, and it rejected a v1.74 client on 2026-09-12.
Fleet join key stored in GCP Secret Manager as **`HEADSCALE_FLEET_KEY`** (Headscale key id 7,
reusable, `tag:player`); keys 4 and 6 expired. `ohm` is **untagged** (user `markai`).

**Tailscale** — latest stable **v1.102.4** (2026-09-10).

**Build & CI** — AGP 8.5.2 / Gradle 9.3.0 builds fine: `release.yml` has 6 successful runs
(2026-08-18 → 09-10); production `apk_releases` holds 1.1.2 → 1.4.0, **every row with a
`git_sha`**. `ci.yml` builds only `assembleDebug`; the shipped `assembleRelease` (R8-minified) is
built only at release time and never run on a device first. Module list: `include(":app")`.
Local toolchain: Go 1.26.5, JDK 17, Android SDK + NDK 25.1/27.1, adb.

**Backend** — `apk_releases.version_code` is **globally unique** (`ix_apk_releases_version_code`)
and exactly one row may be latest (`uq_apk_releases_is_latest`). CI registers via
`POST /api/ext/apk/releases` (`X-CI-Secret`). Downloads: `GET /api/cms/users/{id}/apk` →
`build_download_for_owner` → `ensure_personalized_build` (stamped sha256 — correct) → signed URL.
Stamp payload `{"v":1,"k","o","p"?}`; cache path `personalized_object_path(owner, version_code,
player_kind)` has **no key fingerprint**. Install verification: `settle_verified_jobs` succeeds when
the reported version matches; `VERIFY_TIMEOUT_MINUTES = 10`, `STALE_CLAIM_MINUTES = 15`. Alembic
head on main: **`0071_user_screen_health_access`**.

**Player always-on pattern (proven in the field)** — foreground service `START_STICKY`, watchdog
`setInexactRepeating` every **5 min**, `BootReceiver` for `BOOT_COMPLETED`,
`LOCKED_BOOT_COMPLETED`, `QUICKBOOT_POWERON`, HTC quickboot. Heartbeat 60 s.

## 5. Architecture

```
            CMS (Next.js)                         Headscale (GCE)
   Download Updater ─┐   Screen: Updater status      ▲  join key → IP
                     │   Roll back / Release DO      │
                     ▼                               │
          signage-api (FastAPI) ◄──── check-in ──── UPDATER (Device Owner) ──── tailscaled (bundled)
          · stamps join key `t`        (screen token)   │ installs silently
          · updater releases                            ▼
          · commands + health gate                  PLAYER ── heartbeat ──► signage-api
```

**Updater responsibilities — exactly five:** keep the tunnel up; check in (report IP, versions,
health); download; verify; install / roll back. No UI beyond a minimal status screen, no ad logic.

**Player changes — exactly one:** export its screen identity (`device_uid`, `auth_token`,
`screen_id`) through a `ContentProvider` protected by a **signature-level permission**, so only
an app signed with the same key (the Updater) can read it.

## 6. The tunnel

- Build `tailscaled` **v1.102.4** as a single combined binary (`--extra-small --box`) for
  `GOOS=linux GOARCH=arm GOARM=7`, ship it as `updater/src/main/jniLibs/armeabi-v7a/libtailscaled.so`.
- `packaging { jniLibs { useLegacyPackaging = true } }` — with AGP 8.5.2 and `minSdk 24`, native
  libs are otherwise **not extracted**, and there is no file to execute.
- Run with `--tun=userspace-networking` → no VPN consent dialog, no Device Owner VPN APIs needed.
  State in `filesDir/tailscale/tailscaled.state`, socket in `filesDir/tailscale/tailscaled.sock`.
  App-private data survives `install -r`, so **the node identity — and its IP — is permanent**.
- First start: `tailscale up --login-server=https://headscale.mark-ai.tech --authkey=<stamp t>
  --hostname=<screen name slug>`. Later starts need no key.
- **IP report:** read `Self.TailscaleIPs` from the LocalAPI (`/localapi/v0/status` over the unix
  socket); userspace mode creates no network interface, so interface enumeration returns nothing.
- **Supervisor:** restart the process with backoff on exit; separately poll LocalAPI `BackendState`
  every 60 s and restart if not `Running` for 3 consecutive checks.
- **Identity continuity:** on first start, if `filesDir/tailscale/tailscaled.state` is absent and an
  adopted state file was placed at `filesDir/tailscale/adopt.state` (by the one-time install
  procedure, as root), move it into place before starting. T40 keeps `100.64.0.5` this way.
  Favara's official-app identity is not portable → it gets a new IP once; the CMS updates itself.

## 7. Staying alive 24/7

Copies the Player's proven pattern, plus Device Owner:

| Layer | Detail |
|---|---|
| Foreground service | `foregroundServiceType="systemExempted"` (permitted for Device Owner apps), `START_STICKY` |
| Watchdog | `setInexactRepeating(ELAPSED_REALTIME_WAKEUP)` every 5 min, re-armed on each tick |
| Boot | `BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED`, `QUICKBOOT_POWERON`, `com.htc.intent.action.QUICKBOOT_POWERON` |
| Self-update | `MY_PACKAGE_REPLACED` receiver **with no `<data>` element** (with one it never fires) |
| Device Owner | `setUninstallBlocked(self, true)`; cannot be disabled from Settings |
| Manifest | every receiver with a filter declares `android:exported` explicitly (targetSdk 34) |

## 8. Updating the Player

1. **Check-in** (`POST /api/updater/checkin`, every 5 min, jittered ±60 s, screen token from the
   Player's provider): reports tunnel IP, tunnel state, Updater and Player installed versions,
   free storage, last Player heartbeat seen. Response may carry **one command**.
2. **Command `install`** `{app, version_code, url, sha256, size_bytes, job_id}`.
3. **Gate:** inside operating hours → defer to the window edge; `storage_free_mb < size×3` → report
   `blocked:storage`.
4. **Download** to `cacheDir/updates/<job_id>.apk`; **verify sha256** against the command; mismatch →
   delete, report `failed:checksum`.
5. **Install** via `PackageInstaller` session as Device Owner (silent). The install-result receiver
   is **manifest-declared** — the result arrives after the installing process may have died.
6. **Confirm** on the next launch via `getPackageInfo().longVersionCode`, never via a return code.
   Report `installed`.
7. **Health window (§9).**

## 9. Health gate and rollback

- Today a job succeeds when the reported version matches. **That is not enough:** a Player can
  report its version and then crash-loop.
- New rule: after `installed`, the job enters `observing` for **10 minutes**. It becomes `succeeded`
  only if, inside operating hours, the Player sent ≥ 8 heartbeats with `player_foreground=true`;
  outside hours, ≥ 1 heartbeat and no crash reported by the Updater (`ApplicationExitInfo`).
- On failure → `failed:unhealthy`, and the backend **queues a rollback job** automatically.
- **Rollback = roll-forward:** a superadmin "Roll back to X" (or the automatic trigger) dispatches
  `release.yml` with `ref=<X.git_sha>` and `version_code = current_max + 1`. The rebuilt APK is
  registered as a new release and installed like any update. Data, identity and tunnel untouched.
- **Break-glass** on debuggable boxes only (both current boxes): `adb install -r -d <old.apk>` over
  the tunnel. Documented, not automated.
- **Never** uninstall+reinstall: it wipes the enrollment key, auth token and proof-of-play key.

## 10. Backend changes (signage-api)

- **Migration `0072_apk_release_app_kind`** (revises `0071_user_screen_health_access`): add
  `apk_releases.app_kind VARCHAR(16) NOT NULL DEFAULT 'player'`; drop `ix_apk_releases_version_code`
  and `uq_apk_releases_is_latest`; create unique `(app_kind, version_code)` and partial unique
  `(app_kind) WHERE is_latest`. Add `apk_update_jobs.app_kind`, `screens.updater_version_code`,
  `screens.updater_checked_in_at`, `screens.tunnel_state`.
- `RegisterReleaseRequest.app_kind: Literal["player","updater"] = "player"`; `register_release` and
  `get_latest_release(db, app_kind="player")` scoped per kind.
- **Stamp:** `build_payload(..., join_key: Optional[str] = None)` writes `t` only when set.
  `inject_key` forwards it. `settings.HEADSCALE_FLEET_KEY` (from Secret Manager in production).
- **Cache fix:** `personalized_object_path` gains a 12-char sha256 prefix of
  `release.sha256 + join_key_fingerprint` — fixes both key rotation and re-published versions.
- `GET /api/cms/users/{id}/updater` — same scoping as the Player download, `app_kind="updater"`.
- `POST /api/updater/checkin` — auth `get_current_screen`; records §8.1 fields; returns next command.
- `POST /api/updater/jobs/{id}/status` — `downloading|installed|failed:*`.
- Health gate (§9) replaces version-match settlement for jobs created by the Updater path.
- Commands for superadmins: `rollback`, `release_device_owner`.

## 11. CMS changes (Web-cms)

- **Player app page:** a second button, "Download Updater", same owner scoping as the Player.
- **Screen page:** Updater card — tunnel IP, tunnel state, Updater and Player versions, last
  check-in, current job; superadmin actions **Roll back Player** (release picker) and
  **Release Device Owner** (confirm dialog).
- Fleet list: a tag when the Updater hasn't checked in for > 15 min.

## 12. CI changes (APK repo)

- New module **`:stamp`** (Kotlin/JVM library) holding the signing-block reader now in
  `app/.../enroll/EmbeddedKey.kt`; `:app` and `:updater` both depend on it.
- New module **`:updater`**, `applicationId "tech.markai.updater"`, same `signingConfigs.release`.
- `release.yml`: build both, verify both signatures, upload `apk/releases/{code}/markai-updater.apk`,
  register with `app_kind`. Accept `workflow_dispatch` inputs `ref` and `version_code` for rollbacks.
- `ci.yml`: also build `assembleRelease` for both modules with a throwaway keystore, so an R8-only
  failure surfaces on the PR, not at release.
- A release is **rollout-eligible** only after an install-and-launch smoke test on the canary.

## 13. Security

- **Headscale ACL** (`/etc/headscale/policy.hujson`, `policy.path` set): `tagOwners` for
  `tag:server` and `tag:player`; `tag:server` → `tag:player:5555` only; no rule lets `tag:player`
  reach anything. Tag `ohm` **before** enabling (else `gcp-updater` loses it; IP unchanged).
- Once the Updater installs on its own, **disable network adb** on each box
  (`settings put global adb_enabled 0` via Device Owner `setGlobalSetting`), closing both the tunnel
  and venue-LAN root exposure (T40 has `ro.adb.secure=0`).
- Downloads stay behind CMS login / API key. `HEADSCALE_FLEET_KEY` rotated by minting a new key into
  a new secret version; the cache fingerprint makes rotation take effect.
- Never paste keys into chats or repos (this repo is public).

## 14. Rollout

| Step | Favara (AndBox) | Jayanagar (T40) |
|---|---|---|
| Reach | remote, over existing tunnel | **one site visit** (ViPlex Express or USB keyboard) |
| Install Updater + `dpm set-device-owner` | via `gcp-updater` adb | on site |
| Identity | new identity → **IP changes once** | copy `/data/local/tmp/tailscaled.state` to `adopt.state` as root → **keeps `100.64.0.5`** |
| Cut-over | uninstall `com.tailscale.ipn` **only after** Updater tunnel verified | delete standalone binaries |
| Canary | yes, first | after Favara passes |

## 15. Risks — all tested in Phase 0 before any build

| Risk | Test |
|---|---|
| R1 An app uid may be unable to exec a bundled binary | Launch `libtailscaled.so` from a `testOnly` app on Favara |
| R2 A static Go binary run by an app may fail DNS for `headscale.mark-ai.tech` (no `/etc/resolv.conf` on Android) | Same app: `tailscale up` must reach Headscale; if not, fall back to a `GOOS=android` cgo build with the NDK |
| R3 Device Owner silent install may not work on this ROM | `testOnly` DO app installs a trivial APK with no prompt |
| R4 Inbound over a userspace tunnel may not reach local adbd | `gcp-updater` → new node IP `:5555` |
| R5 T40 SELinux may be Enforcing and block R1 | Check `getenforce` at the Jayanagar visit before installing |

A `testOnly` Device Owner can be removed with `adb shell dpm remove-active-admin`; a normal one
cannot. The spike **must** use `android:testOnly="true"`.

## 16. Goal verification

| Requirement | Mechanism | Verified by |
|---|---|---|
| Only two APKs, no Tailscale app | D1, D2, §6; Favara cut-over removes `com.tailscale.ipn` | `pm list packages` shows `tech.markai.player`, `tech.markai.updater`, no `com.tailscale.ipn` |
| Updater downloaded from CMS | §10 route, §11 button | CMS download produces an APK whose stamp contains `t` (`read_stamp`) |
| Gets its IP by itself | §6 stamped key + LocalAPI report | Fresh install → IP appears on the screen in the CMS with no input |
| IP permanent | §6 identity in app-private storage; node expiry 0 | IP unchanged after reboot, power cut, Updater update, Player update |
| Existing IP kept | §6 adopt path | Jayanagar reports `100.64.0.5` after install |
| Runs forever in background | §7 | Force-stop → back within 5 min; reboot → back without touch |
| Updates from CMS, silently | §8, D3 | CMS "Update" → Player version changes, no dialog on the wall |
| Never interrupts ads | D8 | Install timestamp is outside `on_start_minute`–`on_end_minute` |
| Roll back a bad release, no risk | §9 | Push a deliberately crashing build to canary → auto-rollback within one health window |
| Nobody types an IP or key | D4 | Install checklist has no typing step |
| Not usable by someone who knows the IP | §13 ACL + adb off | From a `tag:player` node, `:5555` on another player is refused |

## 17. Sequencing

**Phase 0** spike (R1–R4 on Favara) — blocks everything · **Phase 1** backend · **Phase 2** APK repo
(`:stamp`, `:updater`, Player provider, CI) · **Phase 3** CMS · **Phase 4** Headscale ACL ·
**Phase 5** rollout (Favara → Jayanagar). Phases 1 and 3 can run alongside 2 after Phase 0 passes.

## 18. Open questions

1. Should screenowners see the Updater card, or superadmins only? Recommend: owners see status,
   only superadmins get Roll back and Release Device Owner.
2. Rollback trigger: automatic on `failed:unhealthy`, or queued for a superadmin to approve?
   Recommend automatic on the canary, approval-gated for the fleet.
