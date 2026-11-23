-- Add structured source metadata for imported work items.
ALTER TABLE "WorkItem" ADD COLUMN "sourceProvider" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN "affectedVersion" TEXT;

CREATE UNIQUE INDEX "WorkItem_sourceProvider_sourceId_key" ON "WorkItem"("sourceProvider", "sourceId");
