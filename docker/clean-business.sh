#!/usr/bin/env sh
# Clear business data only by default (keeps users, credentials, /data/.codex, flowx-workdir).
#
# Usage (on server, from repo root):
#   sh docker/clean-business.sh
#   sh docker/clean-business.sh workflows
#   sh docker/clean-business.sh sessions
set -eu

CONTAINER="${FLOWX_CONTAINER:-flowx}"
MODE="${1:-business}"

case "${MODE}" in
  business | workflows | sessions) ;;
  *)
    echo "Usage: sh docker/clean-business.sh [business|workflows|sessions]" >&2
    exit 1
    ;;
esac

if ! docker container inspect "${CONTAINER}" >/dev/null 2>&1; then
  echo "Container not found: ${CONTAINER}" >&2
  exit 1
fi

echo "Running db:clean --mode=${MODE} in ${CONTAINER} ..."
exec docker exec "${CONTAINER}" pnpm db:clean --mode="${MODE}" --yes
