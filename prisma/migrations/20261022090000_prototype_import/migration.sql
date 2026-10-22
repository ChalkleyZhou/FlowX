CREATE TABLE "PrototypeImport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requirementId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ANALYZING',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "materialRevision" INTEGER NOT NULL DEFAULT 1,
  "aiProvider" TEXT NOT NULL DEFAULT 'codex',
  "goal" TEXT NOT NULL DEFAULT '',
  "manifest" JSONB NOT NULL,
  "analysis" JSONB,
  "answers" JSONB,
  "errorMessage" TEXT,
  "confirmedBy" TEXT,
  "confirmedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PrototypeImport_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PrototypeImport_requirementId_key" ON "PrototypeImport"("requirementId");
CREATE INDEX "PrototypeImport_status_updatedAt_idx" ON "PrototypeImport"("status", "updatedAt");
