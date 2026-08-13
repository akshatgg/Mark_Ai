#!/bin/bash
# Ship the updater agent to the headscale VM and restart it.
#
# The VM is the only machine that is both on the tailnet and holds an adb key the
# screens have authorized, which is why the agent lives there and not on Cloud Run.
set -euo pipefail

ZONE=us-central1-a
PROJECT=markai-499512
VM=headscale
SSH="gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --tunnel-through-iap"

echo "==> preparing directories"
$SSH --command="sudo mkdir -p /opt/markai-agent /var/lib/markai-agent/apk"

echo "==> uploading"
for f in agent.py requirements.txt markai-update-agent.service; do
  gcloud compute scp "$f" "$VM:/tmp/$f" --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap
done

echo "==> installing"
$SSH --command="
  set -e
  sudo mv /tmp/agent.py /opt/markai-agent/agent.py
  sudo mv /tmp/requirements.txt /opt/markai-agent/requirements.txt
  sudo mv /tmp/markai-update-agent.service /etc/systemd/system/markai-update-agent.service
  sudo apt-get install -y -qq python3-pip adb >/dev/null
  sudo pip3 install --break-system-packages -q -r /opt/markai-agent/requirements.txt
  test -f /etc/markai-agent.env || {
    echo 'MISSING /etc/markai-agent.env — create it with MARKAI_AGENT_SECRET=<secret>, mode 600'
    exit 1
  }
  sudo systemctl daemon-reload
  sudo systemctl enable --now markai-update-agent
  sudo systemctl restart markai-update-agent
  sleep 3
  sudo systemctl is-active markai-update-agent
"
echo "==> done. logs: $SSH --command='sudo journalctl -u markai-update-agent -f'"
