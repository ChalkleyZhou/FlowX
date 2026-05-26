#!/usr/bin/env sh
# Promote earliest member to admin for organizations missing an admin (legacy data).
#
# Usage (on server, from repo root):
#   sh docker/backfill-organization-admins.sh
#   sh docker/backfill-organization-admins.sh --dry-run
#   sh docker/backfill-organization-admins.sh --yes
set -eu

CONTAINER="${FLOWX_CONTAINER:-flowx}"

if ! docker container inspect "${CONTAINER}" >/dev/null 2>&1; then
  echo "Container not found: ${CONTAINER}" >&2
  exit 1
fi

echo "Running db:backfill-admins in ${CONTAINER} ..."
exec docker exec "${CONTAINER}" pnpm db:backfill-admins --yes "$@"
