#!/bin/sh
# Apply legacy SQL migrations that prisma db push cannot perform with existing rows.
set -eu

SCHEMA_PATH="${1:-/app/prisma/schema.prisma}"
MIGRATION_SQL="/app/prisma/migrations/20260604180000_delivery_target_project_scope/migration.sql"

resolve_db_path() {
  db_url="${DATABASE_URL:-file:/data/dev.db}"
  case "$db_url" in
    file:*)
      path="${db_url#file:}"
      if [ "${path#/}" = "$path" ]; then
        # Relative to prisma schema directory (schema lives in /app/prisma).
        printf '%s\n' "/app/prisma/${path#./}"
      else
        printf '%s\n' "$path"
      fi
      ;;
    *)
      printf '%s\n' ""
      ;;
  esac
}

DB_PATH="$(resolve_db_path)"
if [ -z "$DB_PATH" ] || [ ! -f "$DB_PATH" ]; then
  exit 0
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required to migrate DeliveryTarget rows before db push." >&2
  exit 1
fi

has_workspace_id="$(
  sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM pragma_table_info('DeliveryTarget') WHERE name='workspaceId';" \
    2>/dev/null || echo 0
)"

if [ "$has_workspace_id" != "1" ]; then
  exit 0
fi

echo "Migrating DeliveryTarget from workspaceId to projectId in ${DB_PATH}..."
sqlite3 "$DB_PATH" < "$MIGRATION_SQL"
