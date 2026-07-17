-- AlterTable: give DeliveryTarget independent briefing / code review purpose flags.
-- Existing rows keep both flags true so current delivery behavior is unchanged.
ALTER TABLE "DeliveryTarget" ADD COLUMN "forBriefing" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DeliveryTarget" ADD COLUMN "forCodeReview" BOOLEAN NOT NULL DEFAULT true;
