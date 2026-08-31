-- Store the Yunxiao organization that owns each FlowX integration.
ALTER TABLE "ExternalIntegration" ADD COLUMN "yunxiaoOrganizationIdentifier" TEXT;

CREATE UNIQUE INDEX "ExternalIntegration_yunxiaoOrganizationIdentifier_key"
  ON "ExternalIntegration"("yunxiaoOrganizationIdentifier");
