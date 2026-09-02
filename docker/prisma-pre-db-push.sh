#!/bin/sh
# Apply SQL migrations that prisma db push cannot perform safely with existing rows.
# Each step is idempotent: it checks schema state before applying.
set -eu

SCHEMA_PATH="${1:-/app/prisma/schema.prisma}"
DELIVERY_TARGET_MIGRATION_SQL="/app/prisma/migrations/20260604180000_delivery_target_project_scope/migration.sql"
CODE_REVIEW_CONFIG_MIGRATION_SQL="/app/prisma/migrations/20260717080000_add_project_code_review_config/migration.sql"
CODE_REVIEW_SOURCE_MIGRATION_SQL="/app/prisma/migrations/20260717100000_add_code_review_source/migration.sql"
WORKSPACE_ORGANIZATION_MIGRATION_SQL="/app/prisma/migrations/20260826160000_add_workspace_organization/migration.sql"
YUNXIAO_ORGANIZATION_BINDING_MIGRATION_SQL="/app/prisma/migrations/20260831130000_add_yunxiao_organization_binding/migration.sql"
YUNXIAO_MULTI_RECIPIENT_MIGRATION_SQL="/app/prisma/migrations/20260831183000_expand_yunxiao_delivery_recipients/migration.sql"
YUNXIAO_RECIPIENT_AUDIT_MIGRATION_SQL="/app/prisma/migrations/20260902090000_add_yunxiao_recipient_audit/migration.sql"

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

index_exists() {
  index_name="$1"
  sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='${index_name}';" \
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

# --- Workspace: establish the organization tenant boundary for existing data ---
if [ "$(table_exists Workspace)" = "1" ] \
  && [ "$(column_exists Workspace organizationId)" = "0" ]; then
  echo "Adding organization ownership to existing workspaces in ${DB_PATH}..."
  sqlite3 "$DB_PATH" < "$WORKSPACE_ORGANIZATION_MIGRATION_SQL"
fi

# --- ExternalIntegration: bind a Yunxiao organization without db-push warnings ---
# Existing rows receive NULL, and SQLite permits multiple NULL values in a unique index.
if [ "$(table_exists ExternalIntegration)" = "1" ] \
  && [ "$(column_exists ExternalIntegration yunxiaoOrganizationIdentifier)" = "0" ]; then
  echo "Adding Yunxiao organization binding to ExternalIntegration in ${DB_PATH}..."
  sqlite3 "$DB_PATH" < "$YUNXIAO_ORGANIZATION_BINDING_MIGRATION_SQL"
elif [ "$(table_exists ExternalIntegration)" = "1" ] \
  && [ "$(index_exists ExternalIntegration_yunxiaoOrganizationIdentifier_key)" = "0" ]; then
  echo "Adding the Yunxiao organization binding unique index in ${DB_PATH}..."
  sqlite3 "$DB_PATH" \
    'CREATE UNIQUE INDEX "ExternalIntegration_yunxiaoOrganizationIdentifier_key" ON "ExternalIntegration"("yunxiaoOrganizationIdentifier");'
fi

# --- YunxiaoWebhookDelivery: allow one idempotent delivery per recipient ---
if [ "$(table_exists YunxiaoWebhookDelivery)" = "1" ] \
  && { [ "$(index_exists YunxiaoWebhookDelivery_organizationId_eventId_key)" = "1" ] \
    || [ "$(index_exists YunxiaoWebhookDelivery_organizationId_eventId_matchedUserId_key)" = "0" ]; }; then
  echo "Expanding Yunxiao webhook deliveries to multiple recipients in ${DB_PATH}..."
  sqlite3 "$DB_PATH" < "$YUNXIAO_MULTI_RECIPIENT_MIGRATION_SQL"
fi

# --- YunxiaoWebhookRecipient: persist every recipient matching result ---
if [ "$(table_exists YunxiaoWebhookRecipient)" = "0" ]; then
  echo "Creating YunxiaoWebhookRecipient audit table in ${DB_PATH}..."
  sqlite3 "$DB_PATH" < "$YUNXIAO_RECIPIENT_AUDIT_MIGRATION_SQL"
fi

# --- Spec & Plan redesign: drop obsolete Task/Plan tables before db push ---
# Spec & Plan content now lives in StageExecution.output; keeping non-empty Task/Plan
# tables causes `prisma db push` to abort with a data-loss warning.
if [ "$(table_exists Task)" = "1" ] || [ "$(table_exists Plan)" = "1" ]; then
  echo "Dropping obsolete Task/Plan tables for Spec & Plan redesign in ${DB_PATH}..."
  sqlite3 "$DB_PATH" <<'SQL'
PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS "Task";
DROP TABLE IF EXISTS "Plan";
PRAGMA foreign_keys=ON;
SQL
fi

# --- Deploy integration removal: drop obsolete deploy tables before db push ---
if [ "$(table_exists DeployJobRecord)" = "1" ] \
  || [ "$(table_exists RepositoryDeployConfig)" = "1" ] \
  || [ "$(table_exists ProjectDeployConfig)" = "1" ]; then
  echo "Dropping obsolete deploy integration tables for schema cleanup in ${DB_PATH}..."
  sqlite3 "$DB_PATH" <<'SQL'
PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS "DeployJobRecord";
DROP TABLE IF EXISTS "RepositoryDeployConfig";
DROP TABLE IF EXISTS "ProjectDeployConfig";
PRAGMA foreign_keys=ON;
SQL
fi
