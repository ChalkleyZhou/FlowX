-- AlterTable
ALTER TABLE "DeliveryTarget" ADD COLUMN "userId" TEXT;
ALTER TABLE "DeliveryTarget" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "DeliveryTarget_userId_idx" ON "DeliveryTarget"("userId");
