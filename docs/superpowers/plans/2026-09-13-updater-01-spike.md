# Updater Phase 0 — Hardware Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove on Favara, remotely, that an ordinary Android app can run a bundled `tailscaled`, join Headscale by itself, be reached over the tunnel, and — as Device Owner — install an APK with no dialog; then remove every trace.

**Architecture:** A throwaway Java-only Gradle project with two modules: `:app` (a `testOnly` spike that ships `libtailscaled.so`, acts as Device Owner, and installs an APK) and `:hello` (a trivial APK to install). Everything is driven from the `headscale` VM, which already holds an authorised adb key and reaches Favara at `100.64.0.4:5555` over the tailnet.

**Tech Stack:** Go (Tailscale's pinned toolchain via `./tool/go`), Java 17, AGP 8.5.2, Gradle 9.3.0 wrapper, Android SDK build-tools 36.1.0, adb, Headscale v0.29.3, gcloud.

**Spec:** `docs/superpowers/specs/2026-09-13-updater-app-design.md` §15

## Global Constraints

- Target box is **Favara only** (`100.64.0.4:5555`, AndBox, Android 11, `armeabi-v7a`, SELinux Permissive, 0 accounts, no Device Owner). Never touch Jayanagar in this plan.
- **Never modify, stop, reinstall or uninstall `tech.markai.player`.** Never uninstall `com.tailscale.ipn` in this plan — it is the tunnel this plan runs over.
- `tailscaled` **v1.102.4**, `GOOS=linux GOARCH=arm GOARM=7`.
- The spike app **must** carry `android:testOnly="true"`, verified on the device, **before** `dpm set-device-owner`. If the check fails, stop.
- Use a **single-use, 1-hour** Headscale key minted on the VM and passed straight to adb. Never print it. Do not use `HEADSCALE_FLEET_KEY`.
- The spike project lives at `~/projects/MarkAi-worktrees/updater-spike/` — **outside** the public root repo. Never `git add` it.
- Task 10 (teardown) runs even if an earlier task fails.
- Record every command's result in the Results section at the bottom as you go.

## File Structure

```
~/projects/MarkAi-worktrees/updater-spike/
├── settings.gradle.kts            modules :app, :hello
├── build.gradle.kts               AGP 8.5.2 plugin declaration
├── gradlew, gradlew.bat, gradle/  copied from markai-player-apk (Gradle 9.3.0)
├── local.properties               sdk.dir
├── tailscale-src/                 git clone at v1.102.4 (build input only)
├── hello/
│   ├── build.gradle.kts
│   └── src/main/{AndroidManifest.xml, java/tech/markai/spikehello/HelloActivity.java}
└── app/
    ├── build.gradle.kts           useLegacyPackaging, abiFilters armeabi-v7a
    └── src/main/
        ├── AndroidManifest.xml    testOnly, device admin receiver, install receiver
        ├── res/xml/device_admin.xml
        ├── jniLibs/armeabi-v7a/libtailscaled.so
        └── java/tech/markai/updaterspike/
            ├── SpikeActivity.java          dispatches actions from intent extras
            ├── Tunnel.java                 starts tailscaled + runs `tailscale up` as the app process
            ├── Installer.java              PackageInstaller session install
            ├── InstallResultReceiver.java  records the install status
            └── SpikeAdmin.java             DeviceAdminReceiver
```

Shorthand used in every remote step (run from the laptop):

```bash
VMSSH='gcloud compute ssh headscale --project markai-499512 --zone us-central1-a --tunnel-through-iap --command'
```

---

### Task 1: Build `tailscaled` v1.102.4 for armeabi-v7a

**Files:**
- Create: `~/projects/MarkAi-worktrees/updater-spike/tailscale-src/` (clone)
- Create: `~/projects/MarkAi-worktrees/updater-spike/app/src/main/jniLibs/armeabi-v7a/libtailscaled.so`

**Interfaces:**
- Produces: a static ARM EABI5 binary that runs as `tailscaled` when invoked by that name and as the `tailscale` CLI when invoked through a symlink named `tailscale`.

- [ ] **Step 1: Clone at the pinned tag**

```bash
mkdir -p ~/projects/MarkAi-worktrees/updater-spike
cd ~/projects/MarkAi-worktrees/updater-spike
git clone --depth 1 --branch v1.102.4 https://github.com/tailscale/tailscale.git tailscale-src
git -C tailscale-src describe --tags
```
Expected: `v1.102.4`

- [ ] **Step 2: Build the combined small binary**

```bash
cd ~/projects/MarkAi-worktrees/updater-spike/tailscale-src
GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 ./build_dist.sh --extra-small --box ./cmd/tailscaled
ls -l tailscaled
```
Expected: a `tailscaled` file, roughly 20–35 MB. If `--box` is rejected by this version, re-run without `--box` and note it in Results (Task 5 then needs two binaries — stop and report instead of continuing).

- [ ] **Step 3: Verify architecture and linkage**

```bash
file ~/projects/MarkAi-worktrees/updater-spike/tailscale-src/tailscaled
```
Expected: contains `ELF 32-bit LSB executable, ARM, EABI5` and `statically linked`.

- [ ] **Step 4: Place it as a native library**

```bash
cd ~/projects/MarkAi-worktrees/updater-spike
mkdir -p app/src/main/jniLibs/armeabi-v7a
cp tailscale-src/tailscaled app/src/main/jniLibs/armeabi-v7a/libtailscaled.so
chmod 755 app/src/main/jniLibs/armeabi-v7a/libtailscaled.so
```
Expected: the file exists and is executable. Record its size in Results.

---

### Task 2: Gradle project skeleton

**Files:**
- Create: `settings.gradle.kts`, `build.gradle.kts`, `local.properties`
- Create (copy): `gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties`

**Interfaces:**
- Produces: a buildable root with modules `:app` and `:hello`.

- [ ] **Step 1: Copy the wrapper that already builds the Player**

```bash
cd ~/projects/MarkAi-worktrees/updater-spike
cp ~/projects/MarkAi/markai-player-apk/gradlew ~/projects/MarkAi/markai-player-apk/gradlew.bat .
mkdir -p gradle/wrapper
cp ~/projects/MarkAi/markai-player-apk/gradle/wrapper/gradle-wrapper.jar gradle/wrapper/
cp ~/projects/MarkAi/markai-player-apk/gradle/wrapper/gradle-wrapper.properties gradle/wrapper/
grep distributionUrl gradle/wrapper/gradle-wrapper.properties
```
Expected: `gradle-9.3.0-bin.zip`

- [ ] **Step 2: Write `settings.gradle.kts`**

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "MarkAiUpdaterSpike"
include(":app", ":hello")
```

- [ ] **Step 3: Write root `build.gradle.kts`**

```kotlin
plugins {
    id("com.android.application") version "8.5.2" apply false
}
```

- [ ] **Step 4: Write `local.properties`**

```properties
sdk.dir=/Users/akshat/Library/Android/sdk
```

- [ ] **Step 5: Confirm Gradle resolves the project**

Run: `cd ~/projects/MarkAi-worktrees/updater-spike && ./gradlew projects --no-daemon -q`
Expected: output lists `:app` and `:hello` (the modules' own build files come in Tasks 3–4; if Gradle errors only about their missing build files, that is expected here — create empty `app/` and `hello/` dirs and re-run).

---

### Task 3: `:hello` — the APK the Device Owner will install

**Files:**
- Create: `hello/build.gradle.kts`
- Create: `hello/src/main/AndroidManifest.xml`
- Create: `hello/src/main/java/tech/markai/spikehello/HelloActivity.java`

**Interfaces:**
- Produces: `hello/build/outputs/apk/debug/hello-debug.apk`, package `tech.markai.spikehello`.

- [ ] **Step 1: `hello/build.gradle.kts`**

```kotlin
plugins {
    id("com.android.application")
}

android {
    namespace = "tech.markai.spikehello"
    compileSdk = 34

    defaultConfig {
        applicationId = "tech.markai.spikehello"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "spike"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
```

- [ ] **Step 2: `hello/src/main/AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="SpikeHello">
        <activity
            android:name=".HelloActivity"
            android:exported="true" />
    </application>
</manifest>
```

- [ ] **Step 3: `hello/src/main/java/tech/markai/spikehello/HelloActivity.java`**

```java
package tech.markai.spikehello;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

public class HelloActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView view = new TextView(this);
        view.setText("Mark AI spike hello");
        setContentView(view);
    }
}
```

- [ ] **Step 4: Build**

Run: `cd ~/projects/MarkAi-worktrees/updater-spike && ./gradlew :hello:assembleDebug --no-daemon -q && ls -l hello/build/outputs/apk/debug/hello-debug.apk`
Expected: the APK exists.

---

### Task 4: `:app` — the spike app

**Files:**
- Create: `app/build.gradle.kts`
- Create: `app/src/main/AndroidManifest.xml`
- Create: `app/src/main/res/xml/device_admin.xml`
- Create: `app/src/main/java/tech/markai/updaterspike/SpikeAdmin.java`
- Create: `app/src/main/java/tech/markai/updaterspike/Tunnel.java`
- Create: `app/src/main/java/tech/markai/updaterspike/Installer.java`
- Create: `app/src/main/java/tech/markai/updaterspike/InstallResultReceiver.java`
- Create: `app/src/main/java/tech/markai/updaterspike/SpikeActivity.java`

**Interfaces:**
- Consumes: `app/src/main/jniLibs/armeabi-v7a/libtailscaled.so` (Task 1).
- Produces: `app/build/outputs/apk/debug/app-debug.apk`, package `tech.markai.updaterspike`. Launched as
  `am start -n tech.markai.updaterspike/.SpikeActivity --es action <tunnel_up|install_hello> [--es authkey <key>]`.
  Writes logs to `files/ts/tailscaled.log`, `files/ts/up.log`, `files/install.log`.

- [ ] **Step 1: `app/build.gradle.kts`**

```kotlin
plugins {
    id("com.android.application")
}

android {
    namespace = "tech.markai.updaterspike"
    compileSdk = 34

    defaultConfig {
        applicationId = "tech.markai.updaterspike"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "spike"
        ndk {
            abiFilters += listOf("armeabi-v7a")
        }
    }

    // AGP 8.5.2 with minSdk >= 23 stores native libs uncompressed and does NOT
    // extract them. There would be no file in nativeLibraryDir to execute.
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
```

- [ ] **Step 2: `app/src/main/AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <!-- testOnly is load-bearing: it is the only thing that lets
         `dpm remove-active-admin` take Device Owner back without a factory reset. -->
    <application
        android:label="UpdaterSpike"
        android:testOnly="true">

        <activity
            android:name=".SpikeActivity"
            android:exported="true" />

        <receiver
            android:name=".SpikeAdmin"
            android:exported="true"
            android:permission="android.permission.BIND_DEVICE_ADMIN">
            <meta-data
                android:name="android.app.device_admin"
                android:resource="@xml/device_admin" />
            <intent-filter>
                <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
            </intent-filter>
        </receiver>

        <!-- Manifest-declared, not registered at runtime: the install result can
             arrive after the installing process has been killed. -->
        <receiver
            android:name=".InstallResultReceiver"
            android:exported="false" />
    </application>
</manifest>
```

- [ ] **Step 3: `app/src/main/res/xml/device_admin.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<device-admin xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-policies />
</device-admin>
```

- [ ] **Step 4: `SpikeAdmin.java`**

```java
package tech.markai.updaterspike;

import android.app.admin.DeviceAdminReceiver;

public class SpikeAdmin extends DeviceAdminReceiver {
}
```

- [ ] **Step 5: `Tunnel.java`**

```java
package tech.markai.updaterspike;

import android.content.Context;
import android.system.Os;
import java.io.File;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Starts the bundled tailscaled AS THIS APP'S PROCESS — the thing risk R1 is about.
 * `run-as` would test a similar uid, not the real app process, so this runs from
 * inside the app on purpose.
 */
final class Tunnel {
    static final String CONTROL_URL = "https://headscale.mark-ai.tech";

    private Tunnel() {}

    static void up(Context context, String authKey) throws Exception {
        File dir = new File(context.getFilesDir(), "ts");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new IllegalStateException("cannot create " + dir);
        }
        String daemon = context.getApplicationInfo().nativeLibraryDir + "/libtailscaled.so";
        File socket = new File(dir, "tailscaled.sock");
        File cli = new File(dir, "tailscale");

        // The combined binary picks CLI mode from the name it was invoked by.
        if (cli.exists() && !cli.delete()) {
            throw new IllegalStateException("cannot replace " + cli);
        }
        Os.symlink(daemon, cli.getAbsolutePath());

        List<String> daemonCmd = Arrays.asList(
                daemon,
                "--tun=userspace-networking",
                "--statedir=" + dir.getAbsolutePath(),
                "--state=" + new File(dir, "tailscaled.state").getAbsolutePath(),
                "--socket=" + socket.getAbsolutePath());
        new ProcessBuilder(daemonCmd)
                .redirectErrorStream(true)
                .redirectOutput(new File(dir, "tailscaled.log"))
                .start();

        for (int i = 0; i < 30 && !socket.exists(); i++) {
            Thread.sleep(500);
        }

        List<String> upCmd = Arrays.asList(
                cli.getAbsolutePath(),
                "--socket=" + socket.getAbsolutePath(),
                "up",
                "--login-server=" + CONTROL_URL,
                "--authkey=" + authKey,
                "--hostname=updater-spike-favara",
                "--accept-dns=false");
        Process up = new ProcessBuilder(upCmd)
                .redirectErrorStream(true)
                .redirectOutput(new File(dir, "up.log"))
                .start();
        boolean finished = up.waitFor(90, TimeUnit.SECONDS);
        java.nio.file.Files.write(
                new File(dir, "up.exit").toPath(),
                (finished ? String.valueOf(up.exitValue()) : "timeout").getBytes());
    }
}
```

- [ ] **Step 6: `Installer.java`**

```java
package tech.markai.updaterspike;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** Installs an APK through PackageInstaller — silent only if we are Device Owner (risk R3). */
final class Installer {
    private Installer() {}

    static void install(Context context, File apk) throws Exception {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(apk);
                 OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buffer = new byte[65536];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    out.write(buffer, 0, n);
                }
                session.fsync(out);
            }
            Intent result = new Intent(context, InstallResultReceiver.class);
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            PendingIntent pending = PendingIntent.getBroadcast(context, sessionId, result, flags);
            session.commit(pending.getIntentSender());
        }
    }
}
```

- [ ] **Step 7: `InstallResultReceiver.java`**

```java
package tech.markai.updaterspike;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import java.io.File;
import java.io.FileWriter;

/**
 * STATUS_PENDING_USER_ACTION here means Android wanted a human to tap "Install" —
 * i.e. the install was NOT silent and R3 fails.
 */
public class InstallResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Integer.MIN_VALUE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        String label;
        switch (status) {
            case PackageInstaller.STATUS_SUCCESS: label = "SUCCESS"; break;
            case PackageInstaller.STATUS_PENDING_USER_ACTION: label = "PENDING_USER_ACTION"; break;
            default: label = "FAILURE_" + status; break;
        }
        try (FileWriter w = new FileWriter(new File(context.getFilesDir(), "install.log"), true)) {
            w.write(label + " " + message + "\n");
        } catch (Exception ignored) {
            // A spike log write must never crash the receiver.
        }
    }
}
```

- [ ] **Step 8: `SpikeActivity.java`**

```java
package tech.markai.updaterspike;

import android.app.Activity;
import android.os.Bundle;
import java.io.File;
import java.io.FileWriter;

public class SpikeActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String action = getIntent().getStringExtra("action");
        String authKey = getIntent().getStringExtra("authkey");
        new Thread(() -> {
            try {
                if ("tunnel_up".equals(action)) {
                    Tunnel.up(getApplicationContext(), authKey);
                } else if ("install_hello".equals(action)) {
                    Installer.install(getApplicationContext(), new File(getFilesDir(), "hello.apk"));
                }
            } catch (Exception e) {
                try (FileWriter w = new FileWriter(new File(getFilesDir(), "error.log"), true)) {
                    w.write(action + ": " + e + "\n");
                } catch (Exception ignored) {
                    // nothing else to do in a spike
                }
            }
        }).start();
    }
}
```

- [ ] **Step 9: Build and inspect the APK**

```bash
cd ~/projects/MarkAi-worktrees/updater-spike
./gradlew :app:assembleDebug --no-daemon -q
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep libtailscaled.so
~/Library/Android/sdk/build-tools/36.1.0/aapt2 dump xmltree app/build/outputs/apk/debug/app-debug.apk --file AndroidManifest.xml | grep -E "testOnly|extractNativeLibs"
```
Expected: `lib/armeabi-v7a/libtailscaled.so` listed; manifest shows `testOnly` = true and `extractNativeLibs` = true.

---

### Task 5: Stage both APKs on the VM and install the spike app

**Files:** none

**Interfaces:**
- Consumes: `app-debug.apk`, `hello-debug.apk` (Tasks 3–4).
- Produces: `tech.markai.updaterspike` installed on Favara with its native lib extracted.

- [ ] **Step 1: Copy to the VM**

```bash
cd ~/projects/MarkAi-worktrees/updater-spike
gcloud compute scp app/build/outputs/apk/debug/app-debug.apk hello/build/outputs/apk/debug/hello-debug.apk \
  headscale:/tmp/ --project markai-499512 --zone us-central1-a --tunnel-through-iap
```
Expected: both files transferred.

- [ ] **Step 2: Install with `-t` (test-only) and confirm it is test-only**

```bash
$VMSSH 'T=100.64.0.4:5555; adb connect $T >/dev/null; sleep 2;
  adb -s $T install -t -r /tmp/app-debug.apk;
  adb -s $T shell dumpsys package tech.markai.updaterspike | grep -E "flags=|nativeLibraryDir|legacyNativeLibraryDir"'
```
Expected: `Success`; a `flags=[ ... TEST_ONLY ... ]` line; a `nativeLibraryDir=` line. Record the path.

- [ ] **Step 3: Confirm the library file is on disk and executable**

```bash
$VMSSH 'T=100.64.0.4:5555; D=$(adb -s $T shell dumpsys package tech.markai.updaterspike | grep -m1 -o "legacyNativeLibraryDir=[^ ]*" | cut -d= -f2 | tr -d "\r");
  adb -s $T shell ls -l "$D/arm/libtailscaled.so" "$D/armeabi-v7a/libtailscaled.so" 2>&1'
```
Expected: one of the two paths lists the file with `x` permission bits.

---

### Task 6: R1 + R2 — the app process runs `tailscaled` and joins Headscale

**Files:** none

**Interfaces:**
- Consumes: installed spike app (Task 5).
- Produces: a Headscale node named `updater-spike-favara` with an IP, or a recorded failure.

- [ ] **Step 1: Mint a single-use 1-hour key and launch, without printing the key**

```bash
$VMSSH 'set -e; T=100.64.0.4:5555;
  K=$(sudo headscale preauthkeys create --user 1 --tags tag:player --expiration 1h -o json \
      | python3 -c "import sys,json; r=sys.stdin.read(); print(json.loads(r[r.find(\"{\"):])[\"key\"])");
  case "$K" in hskey-*) ;; *) echo "no key minted"; exit 1;; esac;
  adb -s $T shell am start -n tech.markai.updaterspike/.SpikeActivity --es action tunnel_up --es authkey "$K" >/dev/null;
  unset K; echo launched'
```
Expected: `launched`.

- [ ] **Step 2: Wait 60 s, then read the app's own logs**

```bash
$VMSSH 'T=100.64.0.4:5555; sleep 60;
  for f in ts/up.exit ts/up.log error.log; do echo "== $f"; adb -s $T shell run-as tech.markai.updaterspike cat files/$f 2>&1 | tail -20; done;
  echo "== tailscaled.log (tail)"; adb -s $T shell run-as tech.markai.updaterspike tail -25 files/ts/tailscaled.log'
```
Expected for PASS: `up.exit` = `0`; no `error.log`; `tailscaled.log` shows the state machine reaching `Running`.
R1 FAIL signature: `error.log` contains `error=13, Permission denied` or `Cannot run program`.
R2 FAIL signature: `tailscaled.log` contains `no such host` / `lookup headscale.mark-ai.tech` errors.

- [ ] **Step 3: Confirm from Headscale's side**

```bash
$VMSSH 'sudo headscale nodes list -o json | python3 -c "
import sys,json; r=sys.stdin.read(); n=[x for x in json.loads(r[r.find(\"[\"):]) if x.get(\"given_name\")==\"updater-spike-favara\" or x.get(\"name\")==\"updater-spike-favara\"]
print(\"FOUND\", n[0][\"id\"], n[0][\"ip_addresses\"], \"online=\", n[0].get(\"online\")) if n else print(\"NOT FOUND\")"'
```
Expected: `FOUND <id> ['100.64.0.N', ...] online= True`. Record the id and IPv4 in Results — Tasks 7 and 10 need them.

---

### Task 7: R4 — inbound over the userspace tunnel reaches local adbd

**Files:** none

**Interfaces:**
- Consumes: the spike node IPv4 from Task 6 Step 3.

- [ ] **Step 1: Probe port 5555 on the spike node from the VM**

```bash
SPIKE_IP=100.64.0.N   # the IPv4 recorded in Task 6
$VMSSH "timeout 8 bash -c '</dev/tcp/$SPIKE_IP/5555' && echo OPEN || echo CLOSED"
```
Expected for PASS: `OPEN` — the connection entered the app's userspace tunnel and was forwarded to Favara's adbd.

- [ ] **Step 2: Prove it is adb, not a stray listener**

```bash
$VMSSH "adb connect $SPIKE_IP:5555; sleep 2; adb -s $SPIKE_IP:5555 shell getprop ro.product.model; adb disconnect $SPIKE_IP:5555"
```
Expected: prints Favara's model (the same value `adb -s 100.64.0.4:5555 shell getprop ro.product.model` returns).

---

### Task 8: R3 — Device Owner installs an APK with no dialog

**Files:** none

**Interfaces:**
- Consumes: `/tmp/hello-debug.apk` on the VM (Task 5).

- [ ] **Step 1: Re-check preconditions and the test-only flag — stop on any mismatch**

```bash
$VMSSH 'T=100.64.0.4:5555; S="adb -s $T shell";
  echo "accounts: $($S dumpsys account | grep -m1 "Accounts:" | tr -d "\r")";
  echo "users:    $($S pm list users | grep -c UserInfo)";
  echo "owner:    [$($S dumpsys device_policy | grep -i "Device Owner" | tr -d "\r")]";
  echo "testonly: $($S dumpsys package tech.markai.updaterspike | grep -c TEST_ONLY)"'
```
Expected: `Accounts: 0`, `users: 1`, `owner: []` (empty), `testonly: 1` or more. **If `testonly` is 0, STOP — do not run Step 2.**

- [ ] **Step 2: Make the spike app Device Owner**

```bash
$VMSSH 'adb -s 100.64.0.4:5555 shell dpm set-device-owner tech.markai.updaterspike/.SpikeAdmin'
```
Expected: `Success: Device owner set to package ComponentInfo{tech.markai.updaterspike/tech.markai.updaterspike.SpikeAdmin}`

- [ ] **Step 3: Put `hello.apk` in the app's private files**

```bash
$VMSSH 'T=100.64.0.4:5555; adb -s $T push /tmp/hello-debug.apk /data/local/tmp/spike-hello.apk >/dev/null;
  adb -s $T shell run-as tech.markai.updaterspike cp /data/local/tmp/spike-hello.apk files/hello.apk;
  adb -s $T shell run-as tech.markai.updaterspike ls -l files/hello.apk'
```
Expected: `files/hello.apk` listed with a non-zero size.

- [ ] **Step 4: Trigger the install and capture the screen at the same moment**

```bash
$VMSSH 'T=100.64.0.4:5555;
  adb -s $T shell am start -n tech.markai.updaterspike/.SpikeActivity --es action install_hello >/dev/null;
  sleep 6; adb -s $T shell screencap -p /data/local/tmp/spike-during.png;
  sleep 10;
  echo "install.log: $(adb -s $T shell run-as tech.markai.updaterspike cat files/install.log 2>&1 | tr -d "\r")";
  echo "installed:   $(adb -s $T shell pm list packages tech.markai.spikehello | tr -d "\r")"'
gcloud compute ssh headscale --project markai-499512 --zone us-central1-a --tunnel-through-iap \
  --command 'adb -s 100.64.0.4:5555 pull /data/local/tmp/spike-during.png /tmp/spike-during.png >/dev/null && echo pulled'
gcloud compute scp headscale:/tmp/spike-during.png ~/projects/MarkAi-worktrees/updater-spike/ \
  --project markai-499512 --zone us-central1-a --tunnel-through-iap
```
Expected for PASS: `install.log: SUCCESS null`; `installed: package:tech.markai.spikehello`; the screenshot shows the Player's ad, not a system install dialog.
R3 FAIL signature: `PENDING_USER_ACTION`.

---

### Task 9: R1 in a real process restart — the identity survives

**Files:** none

**Interfaces:**
- Consumes: the node id and IPv4 from Task 6.

- [ ] **Step 1: Kill the app process and start the tunnel again WITHOUT a key**

```bash
$VMSSH 'T=100.64.0.4:5555;
  adb -s $T shell am force-stop tech.markai.updaterspike;
  adb -s $T shell am start -n tech.markai.updaterspike/.SpikeActivity --es action tunnel_up --es authkey unused >/dev/null;
  sleep 45; adb -s $T shell run-as tech.markai.updaterspike tail -5 files/ts/tailscaled.log'
```
Expected: the daemon starts from `tailscaled.state` and reaches `Running` (the `up` step with key `unused` may report the node is already logged in — that is fine).

- [ ] **Step 2: Confirm the same IP**

Re-run Task 6 Step 3. Expected: same node id, same IPv4 as recorded — proves the identity (and IP) persists across a process restart with no key.

---

### Task 10: Teardown — runs even if anything above failed

**Files:** none

- [ ] **Step 1: Release Device Owner (only possible because the app is test-only)**

```bash
$VMSSH 'adb -s 100.64.0.4:5555 shell dpm remove-active-admin tech.markai.updaterspike/.SpikeAdmin'
```
Expected: `Success: Admin removed ...` (skip if Task 8 Step 2 never ran). Then:
```bash
$VMSSH 'adb -s 100.64.0.4:5555 shell dumpsys device_policy | grep -i "Device Owner" || echo "no device owner"'
```
Expected: `no device owner`

- [ ] **Step 2: Uninstall both spike packages and remove staged files**

```bash
$VMSSH 'T=100.64.0.4:5555;
  adb -s $T uninstall tech.markai.spikehello; adb -s $T uninstall tech.markai.updaterspike;
  adb -s $T shell rm -f /data/local/tmp/spike-hello.apk /data/local/tmp/spike-during.png;
  rm -f /tmp/app-debug.apk /tmp/hello-debug.apk /tmp/spike-during.png;
  adb -s $T shell pm list packages | grep -E "updaterspike|spikehello" || echo "spike packages gone"'
```
Expected: `spike packages gone`

- [ ] **Step 3: Delete the spike node from Headscale**

```bash
SPIKE_NODE_ID=N   # from Task 6
$VMSSH "sudo headscale nodes delete --identifier $SPIKE_NODE_ID --force"
```
Expected: node deleted; `sudo headscale nodes list` no longer shows `updater-spike-favara`.

- [ ] **Step 4: Prove Favara is exactly as it was**

```bash
$VMSSH 'T=100.64.0.4:5555;
  echo "player: $(adb -s $T shell dumpsys package tech.markai.player | grep -m1 versionName | tr -d "\r")";
  echo "tailscale app: $(adb -s $T shell pm list packages com.tailscale.ipn | tr -d "\r")";
  sudo headscale nodes list -o json | python3 -c "
import sys,json; r=sys.stdin.read(); n=[x for x in json.loads(r[r.find(\"[\"):]) if x.get(\"name\")==\"ohm\"]
print(\"ohm online=\", n[0].get(\"online\") if n else \"MISSING\")"'
```
Then confirm in the CMS (or production DB) that Favara Baby World's last heartbeat is under 2 minutes old.
Expected: `player: versionName=1.4.0`, `tailscale app: package:com.tailscale.ipn`, `ohm online= True`, fresh heartbeat.

---

### Task 11: Record the gate decision

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-updater-app-design.md` §15 (append an outcome column)
- Modify: this file — Results section below

- [ ] **Step 1: Fill in Results** with the evidence line for R1–R4 and teardown.

- [ ] **Step 2: Decide**

| Outcome | Next |
|---|---|
| R1–R4 PASS, teardown clean | **G0 passed** → write plans 02, 03, 05 |
| R2 FAIL only (DNS) | Rebuild `tailscaled` with `GOOS=android CGO_ENABLED=1` and the NDK 27.1 armv7a clang, repeat Tasks 1, 4–7, 10 |
| R1 FAIL (cannot exec) | Stop. Re-open the design: tunnel cannot live in an app on this ROM |
| R3 FAIL (dialog shown) | Stop. Re-open the design: silent install unavailable; Device Owner assumption invalid |
| R4 FAIL | Updates still work (pull), but remote adb debug over the Updater tunnel does not; record and continue to G0 with that limitation noted in the spec |

- [ ] **Step 3: Commit the spec and plan updates (root repo)**

```bash
cd ~/projects/MarkAi
git add docs/superpowers/specs/2026-09-13-updater-app-design.md docs/superpowers/plans/2026-09-13-updater-01-spike.md
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "docs: record Phase 0 spike results for the Updater"
```

---

## Results

| Check | Evidence | PASS / FAIL |
|---|---|---|
| Task 1 binary | size, `file` output | |
| R1 app process runs `tailscaled` | `up.exit`, `error.log` | |
| R2 joins Headscale | node id, IPv4, `online` | |
| R4 inbound reaches adbd | `OPEN`, model string | |
| R3 silent install as Device Owner | `install.log`, package listed, screenshot | |
| Identity survives restart | same node id + IPv4 | |
| Teardown clean | no DO, packages gone, node deleted, `ohm` online, heartbeat fresh | |
| **G0** | | |
