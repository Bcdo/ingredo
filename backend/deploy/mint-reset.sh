#!/usr/bin/env bash
# Mint a single-use password-reset code (60-minute TTL) for one user of the
# ingredo-prod database and print it for hand-off. Only the SHA-256 hex of
# the code is stored (see Domain/PasswordResetCode.cs — pinned vector:
# sha256("ABC234") = 8c640c4e71f90160b2b3615af86739e6b15ddc877ae79e18aada753565f756c4).
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: mint-reset.sh <email>" >&2
  exit 1
fi

EMAIL="$1"
CONTAINER="${CONTAINER:-ingredo-prod-postgres-1}"
ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789'

NORMALIZED=$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]' | xargs)
case "$NORMALIZED" in
  *"'"* )
    echo "invalid email" >&2
    exit 1
    ;;
esac

USER_ID=$(docker exec "$CONTAINER" psql -U ingredo -d ingredo -At -c \
  "SELECT \"Id\" FROM \"Users\" WHERE \"NormalizedEmail\" = '$NORMALIZED';")
if [ -z "$USER_ID" ]; then
  echo "No user with email: $EMAIL" >&2
  exit 1
fi

code=''
for _ in $(seq 1 6); do
  idx=$(( $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % ${#ALPHABET} ))
  code+="${ALPHABET:idx:1}"
done
hash=$(printf '%s' "$code" | sha256sum | cut -d' ' -f1)

docker exec "$CONTAINER" psql -U ingredo -d ingredo -q -c \
  "INSERT INTO \"PasswordResetCodes\" (\"Id\", \"UserId\", \"CodeHash\", \"CreatedAt\", \"ExpiresAt\") VALUES (gen_random_uuid(), '$USER_ID', '$hash', now(), now() + interval '60 minutes');"

echo "Reset code for $EMAIL (valid 60 minutes, single-use):"
echo "  ${code:0:3}-${code:3}"
echo "Outstanding codes: docker exec $CONTAINER psql -U ingredo -d ingredo -c 'SELECT \"UserId\", \"CreatedAt\", \"ExpiresAt\", \"UsedAt\" FROM \"PasswordResetCodes\" ORDER BY \"CreatedAt\" DESC LIMIT 10;'"
