#!/usr/bin/env bash
# Nightly pg_dump of the ingredo-prod stack. Installed via ingredo-backup.timer
# (systemd --user). Keeps the newest 30 dumps.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/srv/ingredo/backups}"
KEEP=30

mkdir -p "$BACKUP_DIR"
rm -f "$BACKUP_DIR"/ingredo-*.dump.partial
dump="$BACKUP_DIR/ingredo-$(date +%F).dump"
docker exec ingredo-prod-postgres-1 \
  pg_dump -Fc -U ingredo ingredo \
  > "$dump.partial"
mv -- "$dump.partial" "$dump"
ls -1t "$BACKUP_DIR"/ingredo-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm --
