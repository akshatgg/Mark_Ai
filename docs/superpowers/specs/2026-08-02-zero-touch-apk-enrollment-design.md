# Zero-touch APK enrollment — design

**Date:** 2026-08-02
**Status:** Approved design, ready for implementation planning
**Repos touched:** `markai-player-apk`, `markai-signage-api`, `markai-Web-cms`, `markai-frontend-new`

---

## Problem

A screen owner installs the Mark AI player on a signage box and is asked to type
their enrollment key (`MRKA-7F2K-9B3D`). The box has no keyboard and no mouse —
it is a wall-mounted panel. Typing the key means physically carrying a keyboard to
the site, or driving a D-pad remote through an on-screen field.

That is the whole problem. Everything below exists to delete that step.

Secondary problem, discovered while scoping: `markai-player-apk` has **no CI at
all**. Release builds are produced by hand in Android Studio, and the production
provisioning key is pushed to Cloud Run by a manual script (`set-prod-key.sh`).
`versionCode` is hardcoded to `1`, so no build can ever install over another.

## Goals

1. A screen owner downloads **one file** that already knows who they are, installs
   it, and the screen enrolls itself with nothing typed.
2. Pushing a tag on the APK repo publishes a new version and makes it available in
   the CMS automatically — no manual build, no manual upload.
3. Two ways to get the file: a download button in the CMS (for us), and a public
   page where an owner enters their key (for them).
4. The CMS shows **which APK version each screen is actually running**, and flags
   the ones behind the current release.

## Non-goals

- **Updating screens that already have the player installed.** Fresh installs
  only. See "Deferred" — the answer depends on whether ScreenOx can provision the
  player as Android device owner, which is not ours to decide.
- Per-screen keys. The key stays per-owner.
- Play Store distribution. These are sideloaded AOSP boxes.

---

## Decisions

Three choices shaped everything else.

### 1. How the key gets into the APK → **inject into the APK Signing Block**

The alternatives were re-signing the APK at download time (needs the JDK, Android
build-tools, *and the release keystore* inside the Cloud Run container) and
rebuilding per owner in CI (2–4 minutes per owner per release, and it puts GitHub
on the critical path of creating a user).

Signing-block injection wins because it is the only option where **the release
keystore never leaves CI**, and because 50 owners and 500 owners cost the same.

Why the signature survives: APK Signature Scheme v2/v3 digests the ZIP entries,
the Central Directory, and the End of Central Directory record — but the EOCD's
central-directory-offset field is substituted during verification, and the signing
block itself is excluded from the digest. Unknown ID-value pairs inside the block
are ignored by the verifier. This is the mechanism the channel-packaging tools
(Walle, VasDolly) rely on in production.

### 2. Where the public download page lives → **`markai-frontend-new`**

Matches the existing operator-password-reset pattern, which already proxies to the
CMS backend through `/api/ext/*`. Keeps the admin CMS free of unauthenticated
routes.

### 3. The existing on-screen key-entry UI → **kept as a hidden fallback**

Resolution order on launch becomes: stored credentials → stored key → embedded key
(auto-enroll, UI never shown) → manual entry. A blank APK — a dev build, or a raw
CI artifact — still has a way in. No screen can end up bricked with no recovery
path.

### 4. Version reporting → **on the heartbeat, not `device_info`**

The player already reports `app_version` inside `device_info`
(`DeviceInfo.kt:127`), which looks like this is free. It is not.

`device_info` is written **only during registration** (`screens/service.py:223`),
and the player skips registration entirely when it already holds credentials
(`PlayerService.kt:199` → `"Already registered"`). An update install preserves app
data, so a screen that updates from v1.0.0 to v1.1.0 never re-registers and would
keep reporting v1.0.0 indefinitely — the exact opposite of what this feature is for.

So version rides the **heartbeat**, alongside the other live-state fields
(`display_on`, `player_foreground`) that already live there. It self-heals every
60 seconds and needs no registration event.

Rejected: re-registering when the version changes. It reuses existing code, but it
fires once — if that single call fails the screen is silently stale until the next
upgrade.

### 5. Scope → **screenowners only, enforced at the query**

A personalized APK exists only for an **active screenowner**. Superadmins have
`enrollment_key = NULL` (`cms_users/models.py:47`) and are never downloadable.

Both download paths resolve the owner through the existing
`get_screenowner_by_enrollment_key` (`app/cms_users/service.py:63`) rather than a
new lookup, because it already enforces every condition this feature needs:

```python
key = normalize_enrollment_key(raw_key)
if not key: return None           # blank/missing cannot match
CmsUser.enrollment_key == key,
CmsUser.role == "screenowner",    # superadmins excluded
CmsUser.is_active.is_(True),      # deactivated owners excluded
```

Two consequences worth stating, because they fall out for free and should not be
re-implemented:

- **Deactivating a screenowner instantly kills their APK download** — the CMS
  button and the public page both stop working, with no cache to purge, because
  the owner never resolves.
- **A blank or malformed key cannot enumerate anything** — it fails before the
  query runs.

`GET /api/cms/users/{id}/apk` applies the same rule by id: 404 unless the target is
an active screenowner holding a key.

### 6. Versioning → **tags drive it, starting at `v1.0.0`**

`versionName` comes from the tag. `versionCode` is derived:

```
versionCode = major*10000 + minor*100 + patch

v1.0.0 → 10000    v1.2.3 → 10203    v2.0.0 → 20000
```

Screens currently carry the hand-built `versionCode 1`, so `10000` installs over it
cleanly, and the two are never ambiguous when read off a device. The hardcoded
`1.0.0` / `1` stay in `build.gradle.kts` as the untagged local-build fallback.

---

## Architecture

```
markai-player-apk ── git tag v1.0.0 ──► GitHub Actions
                                          │ build · sign · apksigner verify
                                          │ upload → gs://<bucket>/apk/releases/<code>/markai-player.apk
                                          └─ POST /api/ext/apk/releases   (X-CI-Secret)
                                                       │
                                             markai-signage-api
                                             ├─ apk_releases table (is_latest)
                                             ├─ app/apk/signing_block.py  ← the injector
                                             └─ cache → gs://<bucket>/apk/personalized/<owner_id>/<code>.apk
                                                    ▲                          ▲
                              GET /api/cms/users/{id}/apk           POST /api/ext/apk/claim
                                                    │                          │
                                           markai-Web-cms              markai-frontend-new
                                           /users → "APK" column        /get-player page
```

Two concepts:

- **Release** — one built, signed binary, registered with the backend. Built once
  per tag. Contains no owner key.
- **Personalized APK** — a release with one owner's key stamped into its signing
  block. Made on first request, cached, never built.

---

## Components

### 1. CI — `markai-player-apk/.github/workflows/`

Two workflows:

- `ci.yml` — on push/PR to `main`: `./gradlew testReleaseUnitTest assembleRelease`.
  Build gate only, publishes nothing.
- `release.yml` — on tags matching `v*`:
  1. JDK 17 (temurin) + Android SDK + Gradle cache
  2. Rehydrate secrets: `KEYSTORE_JKS_BASE64` → `keystore/markai-release.jks`;
     store/alias/key passwords → `keystore/signing.properties`;
     `PROVISIONING_KEY` → `local.properties`. These are the exact files
     `app/build.gradle.kts` already reads — no build-script restructuring.
  3. `./gradlew testReleaseUnitTest assembleRelease` with `MARKAI_VERSION_NAME`
     and `MARKAI_VERSION_CODE` from the tag
  4. `apksigner verify --print-certs` — hard gate
  5. Authenticate to GCP via Workload Identity Federation
     (`google-github-actions/auth`). No service-account key: org policy forbids it.
  6. Upload to `gs://<GCP_BUCKET_NAME>/apk/releases/<versionCode>/markai-player.apk`
  7. `POST {CMS_API_BASE}/api/ext/apk/releases` with `X-CI-Secret`

**Required GitHub repo secrets:** `KEYSTORE_JKS_BASE64`, `KEYSTORE_STORE_PASSWORD`,
`KEYSTORE_KEY_ALIAS`, `KEYSTORE_KEY_PASSWORD`, `PROVISIONING_KEY`,
`GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `CMS_API_BASE`, `CMS_CI_SECRET`.

**`app/build.gradle.kts` change** — the only one:

```kotlin
val versionNameFromEnv = System.getenv("MARKAI_VERSION_NAME") ?: "1.0.0"
val versionCodeFromEnv = System.getenv("MARKAI_VERSION_CODE")?.toInt() ?: 1
```

Once this lands, `set-prod-key.sh` is obsolete as a release step — CI owns the
provisioning key. Leave the script in place for one-off Cloud Run fixes.

### 2. The injector — `markai-signage-api/app/apk/signing_block.py`

Standalone, no dependencies, ~180 lines. The only genuinely tricky code in this
design, so it is isolated in one file with two functions that test against each
other.

**Block layout** (ends immediately before the Central Directory):

```
uint64   size_of_block            (excludes this field; = len(pairs) + 8 + 16)
repeated:
    uint64  pair_length           (= 4 + len(value))
    uint32  id
    bytes   value
uint64   size_of_block            (same value, again)
16 bytes magic                    "APK Sig Block 42"
```

**Our pair:** ID `0x4D41524B` (ASCII `MARK`, no collision with the known IDs —
v2 `0x7109871a`, v3 `0xf05368c0`, v3.1 `0x1b93ad61`, padding `0x42726577`).
Value is UTF-8 JSON so it can be extended without a format change:

```json
{"v": 1, "k": "MRKA-7F2K-9B3D", "o": "<owner_id>"}
```

**API:**

- `read_key(apk: bytes) -> str | None`
- `inject_key(apk: bytes, key: str, owner_id: str) -> bytes`

**`inject_key` algorithm:**

1. Scan backwards from EOF for the EOCD magic `PK\x05\x06` (bounded by the 64 KiB
   max comment length). Read the central-directory offset at EOCD+16.
2. Verify the magic `APK Sig Block 42` sits at `[cd_offset-16, cd_offset)`. If it
   is absent the APK is v1-only — raise, do not silently fall through.
3. Read the trailing `size_of_block` at `[cd_offset-24, cd_offset-16)`. Block
   starts at `cd_offset - 8 - size`.
4. Parse the pairs. **Drop** any existing `0x4D41524B` pair (so re-injection is
   idempotent, not cumulative) and any padding pair `0x42726577`.
5. Append our pair. Re-add a padding pair to realign the block to a 4096-byte
   multiple, preserving the original invariant.
6. Rewrite both size fields, splice the block back in, and patch the EOCD
   central-directory offset by the net delta.

**Guards:** refuse ZIP64 (an APK over 4 GiB is not a thing we ship, and handling it
silently-wrong is worse than refusing); refuse an APK with no signing block.

**Why entry alignment is safe:** the signing block sits *after* all ZIP entries and
*before* the Central Directory. Inserting bytes there moves no entry, so
zipalign's uncompressed-entry alignment is preserved.

### 3. Backend domain — `markai-signage-api/app/apk/`

Follows the per-domain convention used by `screens/`, `bookings/`, `loops/`:
`models.py`, `schemas.py`, `service.py`, `router.py` (ext), `cms_router.py`,
plus `signing_block.py`.

**`service.py`:**

- `register_release(...)` — insert the row, clear `is_latest` on the previous
  current release, set it on the new one. Idempotent on `version_code`.
- `personalized_apk_url(owner) -> str` — cache path
  `apk/personalized/<owner_id>/<version_code>.apk`. If the blob exists, return a
  signed URL. Otherwise: download the release, `inject_key`, upload, sign, return.
- `invalidate_owner_cache(owner_id)` —
  `delete_gcs_prefix("apk/personalized/<owner_id>/")`.

Note the path is keyed **owner first, version second**. The reverse
(`<version_code>/<owner_id>.apk`) reads more naturally but scatters one owner's
files across every version folder, so a key regenerate could not be cleaned up
with a single prefix delete.

Reuses `app/core/gcs_service.py` (`upload_to_gcs`, `get_blob_metadata`,
`signed_url_for`, `delete_gcs_prefix`) — no new storage plumbing.

### 4. Data model — migration `0036_apk_release_and_screen_version`

```
apk_releases
  id             str(36) pk
  version_name   str(32)   not null           -- "1.0.0"
  version_code   int       not null unique    -- 10000
  gcs_object     str(512)  not null           -- apk/releases/10000/markai-player.apk
  sha256         str(64)   not null
  size_bytes     int       not null
  git_sha        str(40)   null
  release_notes  text      null
  is_latest      bool      not null default false   -- partial unique index where is_latest
  created_at     timestamptz not null
```

```
screens  (two new columns, both nullable)
  app_version_name  str(32)  null    -- "1.0.0", as reported by the running player
  app_version_code  int      null    -- 10000, the number we compare on
```

Both nullable because a screen running the pre-pipeline hand build reports
neither. `NULL` renders as "unknown" and resolves itself the moment that screen
gets a pipeline-built APK.

No change to `cms_users` — `enrollment_key` already exists (`models.py:47`).

### 5. Endpoints

| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /api/ext/apk/releases` | `X-CI-Secret` | Register a build. Idempotent on `version_code`. |
| `GET  /api/cms/apk/releases` | superadmin | List releases, newest first. |
| `GET  /api/cms/users/{id}/apk` | superadmin, or screenowner for self | 302 → signed URL |
| `POST /api/ext/apk/claim` | ext API key + IP rate limit | `{enrollment_key}` → signed URL |

`/api/ext/apk/claim` reuses `app/screens/enrollment_ratelimit.py` — the same
brute-force protection the register path already has. The key is required to get
the APK, so the public page grants nothing a key holder did not already have.

### 6. CMS — `markai-Web-cms`

`src/app/(dashboard)/users/page.tsx` gains an **APK** column. Per "Scope" above the
button renders only on active `screenowner` rows — superadmin rows show an em dash,
not a disabled button, because an APK is not a thing that exists for them. It is
disabled with an explanatory tooltip when no release is registered yet.

A screenowner logged into the CMS sees the button on their own row only. That
matches the established permission model, where an owner can already read their own
enrollment key.

**Cache invalidation:** the existing "regenerate enrollment key" action must also
call `invalidate_owner_cache(owner_id)`, or the owner's next download would carry
the revoked key.

### 7. Public page — `markai-frontend-new`

`/get-player`: a key input and a button. Submits to a Next route handler that
holds the ext API key server-side, calls `/api/ext/apk/claim`, and redirects the
browser to the signed URL. Same proxy shape as the operator password reset.

### 8. Player — `markai-player-apk`

**New `enroll/EmbeddedKey.kt`:**

```kotlin
fun read(context: Context): String?
```

Opens `context.applicationInfo.sourceDir` with `RandomAccessFile` (no permission
needed — it is the app's own APK), parses the signing block for `0x4D41524B`,
decodes the JSON, returns the key. Returns `null` on any parse failure — a blank
or malformed APK must fall back, never crash.

The installed `base.apk` is a byte-identical copy of the downloaded file, which is
what makes this work.

**`PlayerActivity`** resolution order:

1. stored credentials → play
2. stored enrollment key → register, play
3. `EmbeddedKey.read()` → `Enrollment.verifyAndRegister()`, **no UI shown**
4. none of the above → today's manual key-entry screen

### 9. Version reporting — heartbeat → CMS

**Player** (`net/dto/HeartbeatDto.kt`) adds two fields to the request it already
sends every 60 seconds:

```kotlin
val appVersionName: String = BuildConfig.VERSION_NAME
val appVersionCode: Int    = BuildConfig.VERSION_CODE
```

Read straight from `BuildConfig`, so they cannot drift from the installed binary.

**Backend** (`playback/schemas.py`) adds them to `HeartbeatRequest` as
`Optional`, matching how `display_on` and `player_foreground` stay back-compatible
with players that do not send them. The heartbeat handler writes them to the two
new `screens` columns.

Both `name` and `code` are sent, rather than deriving one from the other: the
legacy hand build reports name `1.0.0` with code `1`, while a pipeline build
reports name `1.0.0` with code `10000`. Deriving the code from the name would
label the legacy build as current.

**Surfacing** — `ScreenSummary` gains:

```
app_version_name  Optional[str]
app_version_code  Optional[int]
is_outdated       bool          # computed: code < the is_latest release's code
```

`is_outdated` is computed server-side against the current `apk_releases` row, so
the CMS never has to know the version scheme. A screen reporting `NULL` is shown
as unknown and is **not** flagged outdated — absence of data is not evidence of
staleness.

**CMS** — the screens list gains a **Version** column: the version name, with a
subtle "outdated" badge when `is_outdated`. Screen detail shows the same, plus
the current release for comparison. This is what makes the pipeline operable —
after tagging a release you can see it actually reaching the fleet.

---

## Data flow

**Publishing:** tag → CI builds and signs → GCS → `POST /api/ext/apk/releases` →
row inserted, `is_latest` flipped. The CMS never polls GitHub.

**Download (CMS):** superadmin clicks → `GET /api/cms/users/{id}/apk` →
cache hit returns a signed URL; cache miss injects first (~50 ms) then returns.

**Download (public):** owner enters key → route handler → `/api/ext/apk/claim` →
key validated and rate-limited → same personalization path → redirect.

**First launch:** install → `EmbeddedKey.read()` → `verifyAndRegister()` →
backend validates key, registers the device, assigns it to the owner → credentials
persisted → playback starts.

**Multi-screen owners:** the key is per-owner, so an owner with 12 screens installs
the *same file* on all 12. Each install still generates its own `device_uid` and
registers separately; the key only says which owner they belong to.

---

## Error handling

| Failure | Behaviour |
|---|---|
| CI build or `apksigner verify` fails | Workflow fails, nothing published, CMS keeps serving the previous release |
| CI upload succeeds but the CMS call fails | Release exists in GCS but unregistered. The registration call is idempotent on `version_code`, so re-running the workflow fixes it. |
| No release registered yet | CMS download button disabled with a tooltip; `/api/ext/apk/claim` returns 503 with a clear message |
| `inject_key` raises | 500, nothing cached. A partial file is never written — upload only on success. |
| Invalid key on `/get-player` | 403, generic message, failure recorded against the IP |
| Key belongs to a deactivated owner | 403, same generic message — the owner does not resolve, so it is indistinguishable from a wrong key |
| `/api/cms/users/{id}/apk` for a superadmin | 404 — no APK exists for a user without an enrollment key |
| Too many bad keys from one IP | 429, existing rate-limit window |
| Owner regenerated their key after downloading | Already-enrolled screens are unaffected (they hold credentials, not the key). A *fresh* install from the stale file gets 403 and falls back to the manual entry screen. |
| APK has no embedded key | Manual entry screen — today's behaviour |
| Signing block unparseable on device | `read()` returns null → manual entry screen. Never crashes. |
| Screen reports no version (pre-pipeline build) | Shown as "unknown", **not** flagged outdated. Resolves itself once that screen runs a pipeline build. |
| Screen reports a version newer than `is_latest` | Not flagged. Happens transiently if a tag is published before its CMS registration lands. |

---

## Testing

Per project convention, tests are written but **not executed by Claude** — the user
runs them. Backend verification here is import/syntax checks plus `ruff`.

**Python unit tests** (`app/apk/`):
- round-trip: `read_key(inject_key(apk, key)) == key`
- idempotence: injecting twice does not grow the block or duplicate the pair
- padding realignment keeps the block a 4096-byte multiple
- EOCD central-directory offset is patched by exactly the net delta
- a v1-only APK and a ZIP64 APK both raise rather than corrupt

**Kotlin unit tests** (JVM, no device): parser against a synthetic block fixture,
including the malformed cases that must return `null`.

**The real gate — done manually during implementation, in this order:**
1. Inject into an actual release APK, run `apksigner verify` → must pass.
2. Install that injected APK on the Redmi test device → must install (this is
   where a byte-level mistake surfaces).
3. Confirm it auto-enrolls with nothing typed, and appears under the right owner.

Steps 1–2 are the ones that matter. Unit tests prove the parser agrees with
itself; only `apksigner` and a real install prove it agrees with Android.

---

## Risks

1. **The injector is wrong and produces an uninstallable APK.** Highest risk in
   this design. Mitigated by the `apksigner verify` gate and a real device install
   before anything ships. Failure is loud (install refused), not silent.
2. **`sourceDir` is not byte-identical to the download.** Expected to hold for
   sideloaded APKs, and confirmed by the manual install test in step 3. If it ever
   fails, the fallback is option B (re-sign at download time) with the keystore in
   production.
3. **A downloaded APK exposes the owner's key.** True, but the key was always
   designed to be read and typed, and blast radius is unchanged: it can enroll a
   junk screen that plays black, and Regenerate revokes it.
4. **Stale cached APK after a key regenerate.** Explicitly handled by
   `invalidate_owner_cache`; called out because forgetting it is silent.

---

## Deferred

**Self-update for already-installed screens.** Everything above covers fresh
installs. A screen running v1.0.0 stays on v1.0.0 until someone visits it — the
same problem, moved to a different day.

The design hinges on a question only ScreenOx can answer: **can the player be
provisioned as Android device owner on their boxes?** If yes, the screen can
download and install a new version silently over the existing heartbeat. If no,
someone must tap "Install" once on the TV — better than typing a key, but not
zero-touch. Keeping this out means the unknown does not block the work above.

Note for whoever picks it up: version *reporting* is already done here
(Component 9), so the "which screens are behind" view exists before self-update is
built. That view is also how you would verify a self-update rollout is working.
