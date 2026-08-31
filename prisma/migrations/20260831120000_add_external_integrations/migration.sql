-- Add the persisted enable/disable state for built-in external integrations.
CREATE TABLE "ExternalIntegration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalIntegration_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExternalIntegration_organizationId_provider_key"
  ON "ExternalIntegration"("organizationId", "provider");
CREATE INDEX "ExternalIntegration_organizationId_enabled_idx"
  ON "ExternalIntegration"("organizationId", "enabled");
