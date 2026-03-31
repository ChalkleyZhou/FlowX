#!/usr/bin/env sh
set -eu

MODE="${1:-nginx}"

IMAGE_NAME="${IMAGE_NAME:-flowx:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-flowx}"
NGINX_CONTAINER_NAME="${NGINX_CONTAINER_NAME:-flowx-nginx}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.nginx.yml}"
BUILD_API_BASE_URL="${BUILD_API_BASE_URL:-}"
PORT="${PORT:-3000}"
WEB_PORT="${WEB_PORT:-4173}"
DATABASE_URL="${DATABASE_URL:-file:/data/dev-current.db}"
AI_EXECUTOR_PROVIDER="${AI_EXECUTOR_PROVIDER:-codex}"
CODEX_HOME="${CODEX_HOME:-/data/.codex}"
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-FlowX Bot}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-flowx@example.com}"
DATA_VOLUME="${DATA_VOLUME:-flowx-data:/data}"
AUTO_REMOVE_CONFLICT_CONTAINER="${AUTO_REMOVE_CONFLICT_CONTAINER:-0}"

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

compose_managed() {
  label="$(docker container inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$1" 2>/dev/null || true)"
  [ -n "${label}" ] && [ "${label}" != "<no value>" ]
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi

  echo "Docker Compose is not available. Install Docker Compose plugin or docker-compose." >&2
  exit 1
}

COMPOSE_CMD="$(compose_cmd)"

echo "==> Updating FlowX in mode: ${MODE}"
echo "==> Pulling latest code"
git pull --ff-only

echo "==> Building Docker image: ${IMAGE_NAME}"
docker build \
  --build-arg "VITE_API_BASE_URL=${BUILD_API_BASE_URL}" \
  -t "${IMAGE_NAME}" .

if [ "${MODE}" = "nginx" ]; then
  if container_exists "${CONTAINER_NAME}" && ! compose_managed "${CONTAINER_NAME}"; then
    echo "==> Found an existing standalone container named ${CONTAINER_NAME}." >&2
    if [ "${AUTO_REMOVE_CONFLICT_CONTAINER}" = "1" ]; then
      echo "==> AUTO_REMOVE_CONFLICT_CONTAINER=1, removing conflicting container ${CONTAINER_NAME}"
      docker rm -f "${CONTAINER_NAME}"
    else
      echo "Nginx mode needs Compose to own container names '${CONTAINER_NAME}' and '${NGINX_CONTAINER_NAME}'." >&2
      echo "Run one of these commands and then retry:" >&2
      echo "  docker rm -f ${CONTAINER_NAME}" >&2
      echo "  AUTO_REMOVE_CONFLICT_CONTAINER=1 sh scripts/deploy-update.sh nginx" >&2
      exit 1
    fi
  fi
  echo "==> Restarting with Docker Compose"
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" up -d --force-recreate
  echo "==> Done. Verify with: ${COMPOSE_CMD} -f ${COMPOSE_FILE} ps"
  exit 0
fi

if [ "${MODE}" = "single" ]; then
  echo "==> Recreating single container: ${CONTAINER_NAME}"
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${PORT}:${PORT}" \
    -p "${WEB_PORT}:${WEB_PORT}" \
    -e PORT="${PORT}" \
    -e WEB_PORT="${WEB_PORT}" \
    -e DATABASE_URL="${DATABASE_URL}" \
    -e AI_EXECUTOR_PROVIDER="${AI_EXECUTOR_PROVIDER}" \
    -e CODEX_HOME="${CODEX_HOME}" \
    -e GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME}" \
    -e GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL}" \
    -v "${DATA_VOLUME}" \
    "${IMAGE_NAME}"
  echo "==> Done. Verify with: docker ps"
  exit 0
fi

echo "Unsupported mode: ${MODE}" >&2
echo "Usage: sh scripts/deploy-update.sh [nginx|single]" >&2
exit 1
