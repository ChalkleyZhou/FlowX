ALTER TABLE "Briefing" ADD COLUMN "period" TEXT NOT NULL DEFAULT 'DAILY';
ALTER TABLE "Briefing" ADD COLUMN "periodStart" DATETIME;
ALTER TABLE "Briefing" ADD COLUMN "periodEnd" DATETIME;
CREATE INDEX "Briefing_projectId_period_periodStart_idx" ON "Briefing"("projectId", "period", "periodStart");
