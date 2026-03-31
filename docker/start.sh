#!/bin/sh
set -eu

API_PORT="${PORT:-3000}"
WEB_PORT="${WEB_PORT:-4173}"
AI_PROVIDER="${AI_EXECUTOR_PROVIDER:-mock}"
CODEX_HOME_DIR="${CODEX_HOME:-/data/.codex}"

mkdir -p "${CODEX_HOME_DIR}"

if [ "${AI_PROVIDER}" = "codex" ]; then
  if ! command -v codex >/dev/null 2>&1; then
    echo "Codex CLI is not installed in the image, but AI_EXECUTOR_PROVIDER=codex." >&2
    exit 1
  fi

  if [ -z "${OPENAI_API_KEY:-}" ]; then
    echo "OPENAI_API_KEY is empty. FlowX will rely on Codex CLI login state in ${CODEX_HOME_DIR}." >&2
    echo "If this is a fresh server, run 'codex login' inside the container once before using AI stages." >&2
  fi
fi

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
