#!/usr/bin/env bash
# Backfill organization admin roles. Run from repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

exec pnpm --filter flowx-api exec tsx ../../scripts/backfill-organization-admins.ts "$@"
