#!/usr/bin/env bash
# Production deploy — run from the prod checkout (~/srv/ingredo/backend).
# Pulls the tracked branch (master) and rebuilds the ingredo-prod stack.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only
docker compose -p ingredo-prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --build
docker compose -p ingredo-prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  ps
echo "Deployed. Verify: curl -fsS https://api.kodesmien.no/health"
