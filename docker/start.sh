#!/bin/sh
set -eu

API_PORT="${PORT:-3000}"
WEB_PORT="${WEB_PORT:-4173}"

if [ -n "${GIT_AUTHOR_NAME:-}" ]; then
  git config --global user.name "${GIT_AUTHOR_NAME}"
fi

if [ -n "${GIT_AUTHOR_EMAIL:-}" ]; then
  git config --global user.email "${GIT_AUTHOR_EMAIL}"
fi

if [ -n "${GIT_COMMITTER_NAME:-}" ]; then
  git config --global committer.name "${GIT_COMMITTER_NAME}"
fi

if [ -n "${GIT_COMMITTER_EMAIL:-}" ]; then
  git config --global committer.email "${GIT_COMMITTER_EMAIL}"
fi

pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma

node apps/api/dist/main.js &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

serve -s apps/web/dist -l "tcp://0.0.0.0:${WEB_PORT}"
