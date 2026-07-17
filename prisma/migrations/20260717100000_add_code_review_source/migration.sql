-- CreateTable
CREATE TABLE "CodeReviewSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodeReviewSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CodeReviewSource_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CodeReviewSource_repositoryId_key" ON "CodeReviewSource"("repositoryId");
CREATE INDEX "CodeReviewSource_workspaceId_idx" ON "CodeReviewSource"("workspaceId");
CREATE INDEX "CodeReviewSource_isActive_idx" ON "CodeReviewSource"("isActive");

-- DataMigration: CodeReviewSource makes the Code Review repo scope independent
-- of BriefingSource. Before this change, daily code review generation reused
-- BriefingSource repositories implicitly, so we do a practical backfill here to
-- avoid silently breaking Code Review for workspaces that already rely on it:
-- seed a CodeReviewSource for every active BriefingSource repository that
-- belongs to a workspace which either has Code Review enabled
-- (ProjectCodeReviewConfig.enabled = true) or already has DailyCodeReview
-- history. Workspaces with no prior Code Review activity are intentionally
-- left with zero CodeReviewSource rows so operators explicitly opt repositories
-- into the now-independent CR scope going forward (see Settings > Code Review
-- Sources). This is best-effort and does not attempt to reconstruct historical
-- webhook/commit evidence.
INSERT INTO "CodeReviewSource" ("id", "workspaceId", "repositoryId", "isActive", "createdAt", "updatedAt")
SELECT
    lower(hex(randomblob(16))),
    seed."workspaceId",
    seed."repositoryId",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT bs."workspaceId" AS "workspaceId", bs."repositoryId" AS "repositoryId"
    FROM "BriefingSource" bs
    WHERE bs."isActive" = true
      AND (
        EXISTS (
          SELECT 1
          FROM "Project" p
          JOIN "ProjectCodeReviewConfig" prc ON prc."projectId" = p."id"
          WHERE p."workspaceId" = bs."workspaceId" AND prc."enabled" = true
        )
        OR EXISTS (
          SELECT 1 FROM "DailyCodeReview" dcr WHERE dcr."workspaceId" = bs."workspaceId"
        )
      )
) seed;
