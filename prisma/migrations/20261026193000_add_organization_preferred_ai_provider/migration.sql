ALTER TABLE "Organization" ADD COLUMN "preferredAiProvider" TEXT;

-- 已有组织沿用原先的默认执行器：有 Codex 凭据时优先 Codex，否则使用已配置的 Cursor。
UPDATE "Organization"
SET "preferredAiProvider" = 'codex'
WHERE "preferredAiProvider" IS NULL
  AND EXISTS (
    SELECT 1 FROM "OrganizationAiCredential"
    WHERE "OrganizationAiCredential"."organizationId" = "Organization"."id"
      AND "provider" = 'codex'
  );

UPDATE "Organization"
SET "preferredAiProvider" = 'cursor'
WHERE "preferredAiProvider" IS NULL
  AND EXISTS (
    SELECT 1 FROM "OrganizationAiCredential"
    WHERE "OrganizationAiCredential"."organizationId" = "Organization"."id"
      AND "provider" = 'cursor'
  );
