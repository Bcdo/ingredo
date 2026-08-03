#!/usr/bin/env bash
# Mint N single-use invite codes (default 10) into the ingredo-prod database
# and print them in hand-out form. Re-runnable: a colliding code is skipped,
# not overwritten. Uses the same I/L/O/0/1-free alphabet as join codes.
set -euo pipefail

N="${1:-10}"
CONTAINER="${CONTAINER:-ingredo-prod-postgres-1}"
ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789'

codes=()
for _ in $(seq 1 "$N"); do
  code=''
  for _ in $(seq 1 6); do
    idx=$(( $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % ${#ALPHABET} ))
    code+="${ALPHABET:idx:1}"
  done
  codes+=("$code")
done

values=$(printf "(gen_random_uuid(), '%s', now())," "${codes[@]}")
docker exec "$CONTAINER" psql -U ingredo -d ingredo -q -c \
  "INSERT INTO \"InviteCodes\" (\"Id\", \"Code\", \"CreatedAt\") VALUES ${values%,} ON CONFLICT (\"Code\") DO NOTHING;"

echo "Minted (hand out one per tester):"
for code in "${codes[@]}"; do
  echo "  ${code:0:3}-${code:3}"
done

unused=$(docker exec "$CONTAINER" psql -U ingredo -d ingredo -At -c \
  'SELECT count(*) FROM "InviteCodes" WHERE "UsedAt" IS NULL;')
echo "Unused codes in the database: $unused"
echo "Usage overview: docker exec $CONTAINER psql -U ingredo -d ingredo -c 'SELECT \"Code\", \"CreatedAt\", \"UsedAt\" FROM \"InviteCodes\" ORDER BY \"CreatedAt\";'"
