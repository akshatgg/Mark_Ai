#!/bin/bash
# Headscale control-plane bootstrap — markai-499512 / us-central1
#
# Pinned to v0.29.3 deliberately. Everything that makes unattended fleets viable
# (tagged nodes exempt from expiry, and the fix for a tagged node being unable to
# log back in after logout) landed across 0.29.x. Do NOT run this on 0.28 or older.
#
# TLS is Headscale's own built-in ACME, not a reverse proxy: upstream states
# plainly that reverse proxies in front of Headscale are unsupported, and the
# control protocol upgrades a raw connection via POST + Upgrade, which managed
# L7 proxies handle badly.
set -euxo pipefail

HEADSCALE_VERSION="0.29.3"
DOMAIN="headscale.mark-ai.tech"

if [ -f /var/lib/headscale/.bootstrapped ]; then
  echo "already bootstrapped; leaving existing install alone"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates

cd /tmp
curl -fsSL -o headscale.deb \
  "https://github.com/juanfont/headscale/releases/download/v${HEADSCALE_VERSION}/headscale_${HEADSCALE_VERSION}_linux_amd64.deb"
dpkg -i headscale.deb

# Patch the shipped config rather than authoring one from scratch: headscale
# fails to start on missing keys, and the packaged file is guaranteed complete
# for this exact version.
CFG=/etc/headscale/config.yaml
sed -i "s|^server_url:.*|server_url: https://${DOMAIN}|" "$CFG"
sed -i "s|^listen_addr:.*|listen_addr: 0.0.0.0:443|" "$CFG"
sed -i "s|^metrics_listen_addr:.*|metrics_listen_addr: 127.0.0.1:9090|" "$CFG"
sed -i "s|^grpc_listen_addr:.*|grpc_listen_addr: 127.0.0.1:50443|" "$CFG"
sed -i "s|^tls_letsencrypt_hostname:.*|tls_letsencrypt_hostname: ${DOMAIN}|" "$CFG"
sed -i "s|^tls_letsencrypt_challenge_type:.*|tls_letsencrypt_challenge_type: HTTP-01|" "$CFG"

# Unattended screens must never expire. This is the default in 0.29.x, but it is
# the single property the whole fleet depends on, so assert it rather than
# inherit it — a future package default change would silently orphan every box.
sed -i "s|^  expiry:.*|  expiry: 0|" "$CFG"

mkdir -p /var/lib/headscale
systemctl enable headscale
systemctl restart headscale

touch /var/lib/headscale/.bootstrapped
echo "headscale ${HEADSCALE_VERSION} bootstrap complete"
