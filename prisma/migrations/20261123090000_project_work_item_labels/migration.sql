CREATE TABLE "ProjectLabel" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "projectId" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "nameKey" TEXT NOT NULL,
 "color" TEXT NOT NULL DEFAULT 'BLUE',
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "ProjectLabel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectLabel_projectId_nameKey_key" ON "ProjectLabel"("projectId", "nameKey");
CREATE INDEX "ProjectLabel_projectId_createdAt_id_idx" ON "ProjectLabel"("projectId", "createdAt", "id");
CREATE TABLE "WorkItemLabel" (
 "workItemId" TEXT NOT NULL,
 "labelId" TEXT NOT NULL,
 PRIMARY KEY ("workItemId", "labelId"),
 CONSTRAINT "WorkItemLabel_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WorkItemLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "ProjectLabel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkItemLabel_labelId_workItemId_idx" ON "WorkItemLabel"("labelId", "workItemId");
