-- DropIndex
DROP INDEX "RequirementAssignment_requirementId_userId_key";

-- CreateIndex
CREATE INDEX "RequirementAssignment_requirementId_userId_idx" ON "RequirementAssignment"("requirementId", "userId");
