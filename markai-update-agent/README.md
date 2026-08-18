# markai-update-agent

Installs player APKs onto signage screens when an operator clicks **Update now**
in the CMS.

```
CMS click  ->  apk_update_jobs (queued)  ->  this agent polls /api/agent/apk/claim
                                                      |
                                    pulls the release from gs://markai-storage
                                            verifies sha256
                                                      |
                                    adb install over the Headscale tunnel
                                            reads versionCode back off the box
                                                      |
                                              /api/agent/apk/report
                                                      |
                          the screen's next heartbeat clears "Outdated" by itself
```

It runs on the **`headscale` GCE VM** — the only machine that is both on the
tailnet and holds an adb key the screens have authorized.

## Deploy

```bash
./deploy.sh
```

Requires `/etc/markai-agent.env` on the VM (mode 600, never in git):

```
MARKAI_AGENT_SECRET=<same value as AGENT_SECRET on cms-back>
```

## Watch it

```bash
gcloud compute ssh headscale --zone=us-central1-a --project=markai-499512 \
  --tunnel-through-iap --command="sudo journalctl -u markai-update-agent -f"
```

## Provisioning a new screen

Everything below happens **once**, with a cable, at install time. Get it wrong
and the box needs a second visit.

1. **Put the fleet adb key on your laptop first** — see "The adb key" below.
   Do this *before* you leave.
2. **Install Tailscale first, and join it**, before the player:
   - **Settings → Accounts → ⋮ → "Use an alternate server"** →
     `https://headscale.mark-ai.tech/` (keep the trailing slash — without it the
     TV keyboard autocorrects `.tech` to `.technology`)
   - Then **⋮ → "Use an auth key"** with a reusable tagged key (`./hs key` from
     `headscale-local/`; copy it at creation, `preauthkeys list` masks it forever)
   - Turn the **Connect to VPN** toggle ON and tap **Allow** on Android's VPN
     prompt. Until that is tapped there is no `tun0`, and the box answers pings
     while refusing every TCP connection — which looks like a firewall problem
     and is not one.
   - **Always-on VPN** ON. ⚠️ Leave **"Block connections without VPN" OFF**: with
     it on, a VPN failure blocks *all* traffic — no heartbeat, no ads, no way in.

   Tailscale first is deliberate. The player reads its own fleet address when it
   registers, so if the tunnel is already up the CMS is populated in one step
   instead of waiting for the next heartbeat.
3. Install the **release** APK (never a debug build — different `applicationId`
   and signing key, so a debug install can never be updated into the release app).
   Sideload it from a pendrive, or let the box download it in its own browser.
4. Enable **USB debugging** in Developer options (Settings → About → tap
   **Android TV OS build** 7×). Note there is no "wireless debugging" toggle on
   these ROMs — adb listens once USB debugging is on.
5. Make adb survive power cuts (needs root, which these boxes have):
   `adb root && adb shell setprop persist.adb.tcp.port 5555`
6. **Reboot the box and confirm it is still reachable.** This is the step people
   skip and regret.
7. Confirm the CMS filled in the screen's address by itself. It should need no
   typing; the manual field is an override for boxes on an older player build.

⚠️ **These boxes have no USB port that can talk to a laptop.** Both USB ports are
host-only — a connected Mac charges but never enumerates, whatever cable or USB
mode you choose. Everything is done over the network.

## The adb key

The agent can only reach a box whose adb daemon has authorized **the agent's**
key, and authorizing a key requires a physical tap. So the laptop used for
provisioning must present the *same* identity as the agent.

```bash
# once, from the VM
gcloud compute ssh headscale --zone=us-central1-a --project=markai-499512 \
  --tunnel-through-iap --command="sudo cat /root/.android/adbkey"     > ~/markai-fleet-adbkey
gcloud compute ssh headscale --zone=us-central1-a --project=markai-499512 \
  --tunnel-through-iap --command="sudo cat /root/.android/adbkey.pub" > ~/markai-fleet-adbkey.pub

# on the provisioning laptop
cp ~/.android/adbkey ~/.android/adbkey.backup 2>/dev/null || true
cp ~/markai-fleet-adbkey     ~/.android/adbkey
cp ~/markai-fleet-adbkey.pub ~/.android/adbkey.pub
adb kill-server && adb start-server
```

Store both files in the team password manager. Losing them means a physical
visit to every box to re-authorize.

## Known limitations — read these before relying on it

1. **`adb tcpip 5555` may not survive a reboot.** It sets a non-persistent
   property; making it stick needs `persist.adb.tcp.port`, which SELinux does not
   let the shell user write. On a box without root, a power cut can take a screen
   off adb until someone visits. **Test this on every new hardware batch.**
2. **A new adb key cannot be authorized remotely.** See above.
3. **There is no rollback.** Android refuses a lower `versionCode`, and Device
   Owner does not change that. Recovery is shipping a fix forward.
4. **Vendor firmware can refuse adb installs.** Xiaomi/MIUI returns
   `INSTALL_FAILED_USER_RESTRICTED` unless "Install via USB" is enabled (which
   needs a Mi account and a SIM). Generic AOSP boxes do not do this — but verify
   `adb install -r` works on each new hardware batch before deploying it.
5. **Tailscale must stay installed and always-on** on every box, and Headscale
   rejects Tailscale clients older than roughly ten releases. Boxes with no Play
   Store cannot auto-update the client, so plan to refresh it about yearly.

## Tests

```bash
python -m pytest test_agent.py -q
```

Covers hashing and version parsing. The install path is proven by the smoke test
in the plan, not by mocking adb — faking adb would only test the fake.
