#!/bin/sh
# Apply SQL migrations that prisma db push cannot perform safely with existing rows.
# Each step is idempotent: it checks schema state before applying.
set -eu

SCHEMA_PATH="${1:-/app/prisma/schema.prisma}"
DELIVERY_TARGET_MIGRATION_SQL="/app/prisma/migrations/20260604180000_delivery_target_project_scope/migration.sql"
CODE_REVIEW_CONFIG_MIGRATION_SQL="/app/prisma/migrations/20260717080000_add_project_code_review_config/migration.sql"
CODE_REVIEW_SOURCE_MIGRATION_SQL="/app/prisma/migrations/20260717100000_add_code_review_source/migration.sql"

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

table_exists() {
  table_name="$1"
  sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table_name}';" \
    2>/dev/null || echo 0
}

column_exists() {
  table_name="$1"
  column_name="$2"
  sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM pragma_table_info('${table_name}') WHERE name='${column_name}';" \
    2>/dev/null || echo 0
}

DB_PATH="$(resolve_db_path)"
if [ -z "$DB_PATH" ] || [ ! -f "$DB_PATH" ]; then
  exit 0
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for pre-db-push migrations." >&2
  exit 1
fi

# --- DeliveryTarget: workspaceId → projectId (legacy) ---
if [ "$(column_exists DeliveryTarget workspaceId)" = "1" ]; then
  echo "Migrating DeliveryTarget from workspaceId to projectId in ${DB_PATH}..."
  sqlite3 "$DB_PATH" < "$DELIVERY_TARGET_MIGRATION_SQL"
fi

# --- ProjectCodeReviewConfig: move CR scheduler fields off ProjectBriefingConfig ---
# Must run before db push drops lastCodeReviewScheduler* columns, or that status
# history is lost and CR schedule state is not seeded.
if [ "$(column_exists ProjectBriefingConfig lastCodeReviewSchedulerSlot)" = "1" ]; then
  echo "Migrating ProjectCodeReviewConfig from ProjectBriefingConfig in ${DB_PATH}..."
  sqlite3 "$DB_PATH" < "$CODE_REVIEW_CONFIG_MIGRATION_SQL"
fi

# --- CodeReviewSource: create + backfill before db push creates an empty table ---
if [ "$(table_exists CodeReviewSource)" = "0" ] \
  && [ "$(table_exists ProjectCodeReviewConfig)" = "1" ]; then
  echo "Creating CodeReviewSource and backfilling from BriefingSource in ${DB_PATH}..."
  sqlite3 "$DB_PATH" < "$CODE_REVIEW_SOURCE_MIGRATION_SQL"
fi
