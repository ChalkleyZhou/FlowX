-- 为统一工作项增加面向用户的可读编号，并为每个项目、类型建立独立序列。
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

ALTER TABLE "WorkItem" ADD COLUMN "displayCode" TEXT;

CREATE TABLE IF NOT EXISTS "WorkItemSequence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkItemSequence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkItemSequence_projectId_kind_key" ON "WorkItemSequence" ("projectId", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkItem_projectId_displayCode_key" ON "WorkItem" ("projectId", "displayCode");

-- 历史工作项按照项目、类型、创建时间稳定回填编号。
WITH numbered AS (
  SELECT
    "id",
    printf('%s-%03d', CASE "kind" WHEN 'REQUIREMENT' THEN 'REQ' WHEN 'ISSUE' THEN 'ISSUE' WHEN 'BUG' THEN 'BUG' ELSE "kind" END,
      ROW_NUMBER() OVER (PARTITION BY "projectId", "kind" ORDER BY "createdAt" ASC, "id" ASC)) AS "displayCode"
  FROM "WorkItem"
  WHERE "displayCode" IS NULL
)
UPDATE "WorkItem"
SET "displayCode" = (SELECT "displayCode" FROM numbered WHERE numbered."id" = "WorkItem"."id")
WHERE "displayCode" IS NULL;

INSERT OR IGNORE INTO "WorkItemSequence" ("id", "projectId", "kind", "nextValue", "createdAt", "updatedAt")
SELECT
  'work-item-sequence-' || "projectId" || '-' || "kind",
  "projectId",
  "kind",
  MAX(CAST(substr("displayCode", instr("displayCode", '-') + 1) AS INTEGER)),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "WorkItem"
WHERE "displayCode" IS NOT NULL
GROUP BY "projectId", "kind";

COMMIT;
PRAGMA foreign_keys=ON;
