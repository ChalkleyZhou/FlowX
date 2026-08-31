DROP INDEX IF EXISTS "YunxiaoWebhookDelivery_organizationId_eventId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "YunxiaoWebhookDelivery_organizationId_eventId_matchedUserId_key"
  ON "YunxiaoWebhookDelivery"("organizationId", "eventId", "matchedUserId");
