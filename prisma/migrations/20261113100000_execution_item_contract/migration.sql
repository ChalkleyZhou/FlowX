ALTER TABLE "ExecutionItem" ADD COLUMN "ownerHint" TEXT;
ALTER TABLE "ExecutionItem" ADD COLUMN "verification" TEXT NOT NULL DEFAULT '';
