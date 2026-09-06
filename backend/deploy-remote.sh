#!/usr/bin/env bash
# Deploy production from the dev machine: runs deploy.sh on the always-on
# host over SSH. Requires master to be pushed first — deploy.sh pulls
# fast-forward-only from origin, it does not read this checkout.
#
#   backend/deploy-remote.sh            # deploy whatever origin/master is
#   INGREDO_HOST=bcdo@otherbox backend/deploy-remote.sh
set -euo pipefail

HOST="${INGREDO_HOST:-bcdo@omarchy}"
REMOTE_SCRIPT='~/srv/ingredo/backend/deploy.sh'

cd "$(dirname "$0")/.."
if git rev-parse --verify -q origin/master >/dev/null; then
  git fetch -q origin master
  unpushed=$(git rev-list --count origin/master..master 2>/dev/null || echo 0)
  if [[ "$unpushed" != "0" ]]; then
    echo "master has $unpushed commit(s) not pushed to origin; push first." >&2
    exit 1
  fi
fi

echo "Deploying origin/master ($(git rev-parse --short origin/master)) on $HOST"
ssh -o BatchMode=yes "$HOST" "$REMOTE_SCRIPT"
curl -fsS https://api.kodesmien.no/health && echo
