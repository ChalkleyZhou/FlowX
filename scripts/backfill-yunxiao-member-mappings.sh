#!/usr/bin/env bash
# Backfill Yunxiao member mapping identity fields. Run from repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

exec pnpm --filter flowx-api exec tsx ../../scripts/backfill-yunxiao-member-mappings.ts "$@"
