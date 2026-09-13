# Mark AI Updater — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute phase plans in the order below; never start a phase whose gate has not passed.

**Goal:** Every screen runs exactly two APKs — the Player and an Updater downloaded from the CMS — where the Updater gets a permanent private-network IP by itself, stays running forever, updates the Player silently outside operating hours, and rolls a bad release back automatically.

**Architecture:** A new `:updater` Android module (same repo, same signing key as the Player) runs a bundled userspace `tailscaled` v1.102.4 and is the box's Device Owner. It checks in with `signage-api`, which stamps the Headscale join key into the Updater download, versions Player and Updater releases separately, hands out install commands, and only marks an install successful after a 10-minute health window. The CMS gains an Updater download, an Updater status card, and roll-back controls.

**Tech Stack:** Kotlin/Android (AGP 8.5.2, Gradle 9.3.0, minSdk 24, targetSdk 34), Go cross-compile for `tailscaled`, FastAPI + SQLAlchemy + Alembic (Postgres), Next.js 15 + React 19, Headscale v0.29.3, GitHub Actions, GCP Secret Manager.

**Spec:** `docs/superpowers/specs/2026-09-13-updater-app-design.md`

## Global Constraints

- Exactly two APKs on a screen: `tech.markai.player` and `tech.markai.updater`. No `com.tailscale.ipn`.
- `tailscaled` **v1.102.4**, `GOOS=linux GOARCH=arm GOARM=7` (both fleet boxes are `armeabi-v7a`). Headscale rejects clients below **v1.80**.
- `packaging.jniLibs.useLegacyPackaging = true` for any module shipping `tailscaled`.
- The Updater and the Player are signed with the **same** release keystore, forever. A Device Owner app can never change its key without a factory reset.
- Headscale join key comes only from GCP Secret Manager secret **`HEADSCALE_FLEET_KEY`**. Never print it, never commit it, never paste it into a chat. The root repo `akshatgg/Mark_Ai` is **public**.
- Any Device Owner test build is `android:testOnly="true"` — the only kind `dpm remove-active-admin` can remove.
- Rollback is roll-forward: rebuild a release's `git_sha` with a higher `versionCode`. Never uninstall+reinstall the Player (wipes enrollment, token, proof-of-play key).
- Installs happen only outside the screen's `on_start_minute`–`on_end_minute` window.
- New Alembic migration is **`0072_apk_release_app_kind`**, revising **`0071_user_screen_health_access`**.
- Backend verification in this repo is import + `ruff`; **do not run pytest** — write the tests, the user runs them.
- CMS verification is `tsc --noEmit` + `vitest`; **never run `next build`** (clobbers `.next` under the running dev server).
- Work in a git worktree off `origin/main` of the target repo; never lift a diff out of a dirty checkout.
- Commits as `akshatgg <akshatg9636@gmail.com>` with **no** Claude `Co-Authored-By` trailer and no AI attribution in PR bodies.

---

## Plan set

| # | File | Phase | Written | Why now / why later |
|---|---|---|---|---|
| 00 | `2026-09-13-updater-00-master.md` | — | now | this file |
| 01 | `2026-09-13-updater-01-spike.md` | 0 — hardware spike | **now** | Blocks everything; decides whether the tunnel can run inside an app |
| 02 | `2026-09-13-updater-02-backend.md` | 1 — signage-api | after G0 | Independent of spike mechanics, but pointless if G0 fails |
| 03 | `2026-09-13-updater-03-apk.md` | 2 — APK repo | after G0 | Its tunnel code depends directly on R1/R2 outcomes (exec path, DNS build flavour) |
| 04 | `2026-09-13-updater-04-cms.md` | 3 — Web-cms | after 02 merged | Consumes the API contract that 02 fixes |
| 05 | `2026-09-13-updater-05-acl.md` | 4 — Headscale ACL | now-safe, run before 06 | Security prerequisite; independent of the app |
| 06 | `2026-09-13-updater-06-rollout.md` | 5 — rollout | after G2 | Needs a signed, smoke-tested Updater build |

A plan marked "after Gx" is written only once that gate passes, so its code is written against real
results rather than assumptions. This is sequencing, not a gap: each written plan is complete and
executable on its own.

## Gates

| Gate | Passes when | Unlocks |
|---|---|---|
| **G0** | Plan 01 records PASS for R1 (app uid runs bundled `tailscaled`), R2 (joins Headscale, resolves `headscale.mark-ai.tech`), R3 (Device Owner installs an APK with no dialog), R4 (`gcp-updater` reaches the spike node on `:5555`), and teardown leaves Favara's Player healthy and `ohm` online | 02, 03, 05 |
| **G1** | Plan 02 merged and deployed; `alembic heads` single head `0072_apk_release_app_kind`; `POST /api/ext/apk/releases` accepts `app_kind="updater"` | 04 |
| **G2** | Plan 03: CI publishes a signed `markai-updater.apk`; `apksigner verify --print-certs` shows the **same** certificate SHA-256 as `markai-player.apk`; install-and-launch smoke test passes on Favara | 06 |
| **G3** | Plan 06: Favara canary healthy for 24 h (Updater checked in every ≤ 5 min, tunnel `Running`, one Player update succeeded through the health window) | Jayanagar visit |

## Spec coverage

| Spec § | Covered by |
|---|---|
| §3 D1, D2 two APKs, tunnel in Updater | 03 (module), 06 (Favara cut-over removes `com.tailscale.ipn`) |
| §3 D3 Device Owner | 01 Task 8 (proof), 03 (receiver, provisioning), 06 (provisioning on both boxes) |
| §3 D4 stamped join key | 02 (`build_payload` field `t`, secret wiring), 03 (Updater reads `t`) |
| §3 D5 roll-forward | 02 (rollback command + dispatch), 03 (`release.yml` `ref`/`version_code` inputs) |
| §3 D6 identity from Player | 03 (Player `ContentProvider` + signature permission) |
| §3 D7 one project, one key | 03 (`:stamp`, `:updater`, shared `signingConfigs.release`), G2 cert check |
| §3 D8 off-hours installs | 03 (install gate), 06 (verify timestamps) |
| §3 D9 canary | 02 (`canary` flag), 06 (Favara first) |
| §6 tunnel | 01 (R1, R2, R4), 03 (supervisor, LocalAPI IP, adopt path) |
| §7 always-on | 03 (foreground service, watchdog, boot + package-replaced receivers) |
| §8 update flow | 02 (check-in, jobs, status), 03 (download, verify, install, confirm) |
| §9 health gate | 02 (`observing` state, heartbeat window, auto-rollback) |
| §10 backend | 02 |
| §11 CMS | 04 |
| §12 CI | 03 |
| §13 security | 05 (ACL, tag `ohm`), 03 (disable network adb post-DO), 02 (cache fingerprint) |
| §14 rollout | 06 |
| §15 risks R1–R5 | 01 (R1–R4), 06 Task 1 (R5 at Jayanagar) |

## Goal verification (run at the end of plan 06)

Each row must be checked and its evidence pasted into the plan 06 results section before the goal is declared met.

| Goal requirement | Check | Pass condition |
|---|---|---|
| Only two APKs, no Tailscale app | `adb shell pm list packages \| grep -E 'markai\|tailscale'` on each box | exactly `tech.markai.player` and `tech.markai.updater` |
| Updater downloaded from the CMS | Download from the CMS Player app page, then `python -c "from app.apk.signing_block import read_stamp; print(sorted(read_stamp(open('u.apk','rb').read())))"` | keys include `t`, `k`, `o`, `v` |
| IP assigned with no input | Fresh Updater install on a box with no prior identity | its tailnet IP appears on the CMS screen page within 5 min, nobody typed anything |
| IP permanent | Record IP → reboot → cut power → push an Updater update → push a Player update | IP identical after each |
| Existing IP kept (Jayanagar) | CMS screen page after plan 06 | `100.64.0.5` |
| Runs forever in background | `adb shell am force-stop tech.markai.updater`; then reboot | check-in resumes within 5 min; resumes after reboot with nobody touching the box |
| Updates silently from the CMS | CMS "Update Player" on the canary | new `app_version_code` reported; screenshot during install shows no system dialog |
| Never interrupts ads | Job `installed_at` vs screen `on_start_minute`/`on_end_minute` | install time outside the window |
| Bad release rolled back, no risk | Publish a build that crashes on launch to the canary | job ends `failed:unhealthy`; rollback job auto-created; canary back on the previous code within one health window + one rebuild |
| Nobody types an IP or key | The install checklist in plan 06 | contains no typing step for IP or key |
| Knowing the IP gives nothing | From a `tag:player` node: `timeout 5 bash -c '</dev/tcp/<other player IP>/5555'` | refused; and network adb disabled on both boxes |

---

## Execution Handoff

Start with plan 01 only. After it records G0, write plans 02, 03 and 05, then 04 after G1, and 06 after G2.
