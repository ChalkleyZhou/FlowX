-- CreateTable
CREATE TABLE "ProjectVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVersion_projectId_name_key" ON "ProjectVersion"("projectId", "name");

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_createdAt_idx" ON "ProjectVersion"("projectId", "createdAt");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "currentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ProjectVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("id", "status", "workspaceId", "name", "code", "description", "createdAt", "updatedAt")
SELECT "id", "status", "workspaceId", "name", "code", "description", "createdAt", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_workspaceId_createdAt_idx" ON "Project"("workspaceId", "createdAt");

CREATE TABLE "new_Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptanceCriteria" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "planningStatus" TEXT NOT NULL DEFAULT 'UNSCHEDULED',
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "ideationStatus" TEXT NOT NULL DEFAULT 'NONE',
    "versionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requirement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Requirement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Requirement" ("id", "status", "title", "description", "acceptanceCriteria", "priority", "planningStatus", "projectId", "workspaceId", "ideationStatus", "createdAt", "updatedAt")
SELECT "id", "status", "title", "description", "acceptanceCriteria", "priority", "planningStatus", "projectId", "workspaceId", "ideationStatus", "createdAt", "updatedAt" FROM "Requirement";
DROP TABLE "Requirement";
ALTER TABLE "new_Requirement" RENAME TO "Requirement";
CREATE INDEX "Requirement_projectId_createdAt_idx" ON "Requirement"("projectId", "createdAt");
CREATE INDEX "Requirement_projectId_versionId_idx" ON "Requirement"("projectId", "versionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
