-- AlterTable
ALTER TABLE "ProjectBriefingConfig" ADD COLUMN "lastSchedulerSlot" TEXT;
ALTER TABLE "ProjectBriefingConfig" ADD COLUMN "lastSchedulerRunAt" DATETIME;
ALTER TABLE "ProjectBriefingConfig" ADD COLUMN "lastSchedulerMessage" TEXT;
