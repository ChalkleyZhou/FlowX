-- Ensure legacy installations have an organization available for existing workspaces.
INSERT INTO "Organization" (
    "id",
    "provider",
    "providerOrganizationId",
    "name",
    "createdAt",
    "updatedAt"
)
SELECT
    'legacy-default-organization',
    'local',
    'legacy-default-organization',
    '默认组织',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Workspace")
  AND NOT EXISTS (SELECT 1 FROM "Organization");

-- Existing workspaces prefer an organization already recorded by their execution sessions.
-- Remaining legacy rows are assigned to the oldest organization so the migration is lossless.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Workspace" (
    "id",
    "organizationId",
    "status",
    "name",
    "description",
    "createdAt",
    "updatedAt"
)
SELECT
    workspace."id",
    COALESCE(
        (
            SELECT session."organizationId"
            FROM "ExecutionSession" AS session
            WHERE session."workspaceId" = workspace."id"
              AND session."organizationId" IS NOT NULL
            ORDER BY session."createdAt" ASC
            LIMIT 1
        ),
        (
            SELECT target."organizationId"
            FROM "DeliveryTarget" AS target
            INNER JOIN "Project" AS project ON project."id" = target."projectId"
            WHERE project."workspaceId" = workspace."id"
              AND target."organizationId" IS NOT NULL
            ORDER BY target."createdAt" ASC
            LIMIT 1
        ),
        (SELECT organization."id" FROM "Organization" AS organization ORDER BY organization."createdAt" ASC LIMIT 1)
    ),
    workspace."status",
    workspace."name",
    workspace."description",
    workspace."createdAt",
    workspace."updatedAt"
FROM "Workspace" AS workspace;
DROP TABLE "Workspace";
ALTER TABLE "new_Workspace" RENAME TO "Workspace";
CREATE INDEX "Workspace_organizationId_createdAt_idx" ON "Workspace"("organizationId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
