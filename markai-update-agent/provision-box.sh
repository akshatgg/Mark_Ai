#!/bin/bash
# provision-box.sh — turn a factory AndBox into a Mark AI screen, in one command.
#
#   ./provision-box.sh 192.168.1.42
#
# Run it with the box on the SAME network as this laptop (its own WiFi, a phone
# hotspot, or LAN). Everything after this is remote, forever.
#
# What it can NOT do yet: type the Tailscale server + auth key. That needs Device
# Owner (see the end of this file) — until then it pauses and tells you the two
# values to enter on the box.
set -euo pipefail

IP="${1:?usage: ./provision-box.sh <box-ip>}"
D="$IP:5555"

PLAYER_APK="${PLAYER_APK:-$HOME/Downloads/markai-player-1.1.2.apk}"
TAILSCALE_APK="${TAILSCALE_APK:-$(dirname "$0")/tailscale.apk}"
HEADSCALE_URL="https://headscale.mark-ai.tech/"
PKG="tech.markai.player"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/8  connecting"
adb connect "$D" >/dev/null
adb -s "$D" wait-for-device
adb -s "$D" shell getprop ro.product.model | tr -d '\r' | sed 's/^/     box: /'

say "2/8  root (these boxes ship debuggable)"
adb -s "$D" root >/dev/null 2>&1 || true
sleep 4; adb connect "$D" >/dev/null; sleep 2
adb -s "$D" shell id | tr -d '\r' | grep -o 'uid=[0-9]*' | sed 's/^/     /'

say "3/8  make adb survive power cuts"
# Without this a cafe power cut takes the screen off adb until someone visits.
adb -s "$D" shell "setprop persist.adb.tcp.port 5555"
adb -s "$D" shell "getprop persist.adb.tcp.port" | tr -d '\r' | sed 's/^/     persist.adb.tcp.port=/'

say "4/8  installing Tailscale"
adb -s "$D" install -r "$TAILSCALE_APK" 2>&1 | tail -1 | sed 's/^/     /'

say "5/8  installing the player"
adb -s "$D" install -r "$PLAYER_APK" 2>&1 | tail -1 | sed 's/^/     /'
adb -s "$D" shell "dumpsys package $PKG | grep -m1 versionName" 2>/dev/null | tr -d '\r' | sed 's/^ */     /'

say "6/8  always-on VPN (so Tailscale returns after a power cut)"
# NOT lockdown: with 'block connections without VPN' a Tailscale failure kills ALL
# traffic — no heartbeat, no ads, no way back in.
adb -s "$D" shell "settings put secure always_on_vpn_app com.tailscale.ipn"
adb -s "$D" shell "settings put secure always_on_vpn_lockdown 0"
adb -s "$D" shell "settings get secure always_on_vpn_app" | tr -d '\r' | sed 's/^/     always-on: /'

say "7/8  YOUR TURN — 60 seconds on the box"
cat <<TXT
     Tailscale app -> gear -> Accounts -> kebab:
       1. "Use an alternate server"  ->  $HEADSCALE_URL
          (keep the trailing slash: the TV keyboard turns .tech into .technology)
       2. "Use an auth key"          ->  run:  ../headscale-local/hs key
       3. Connect to VPN toggle ON, tap Allow on the VPN prompt
     Settings -> More Settings -> Auto Start Application -> enable the player
TXT
read -rp "     press Enter once that is done… "

say "8/8  verifying"
adb -s "$D" shell "ip -4 addr show 2>/dev/null | grep 100.64" | tr -d '\r' | xargs | sed 's/^/     tunnel: /' || echo "     tunnel: DOWN — Tailscale not connected"
TS_IP=$(adb -s "$D" shell "ip -4 addr show 2>/dev/null | grep -o '100\.64\.[0-9]*\.[0-9]*' | head -1" | tr -d '\r')
echo
echo "     ┌──────────────────────────────────────────────┐"
printf  "     │  Tailscale IP: %-29s │\n" "${TS_IP:-not connected}"
echo "     │  Put this in the CMS -> Screen settings      │"
echo "     └──────────────────────────────────────────────┘"
echo
echo "     Now reboot the box and confirm it comes back playing:"
echo "       adb -s $D reboot"
