ALTER TABLE "YunxiaoMemberMapping" ADD COLUMN "yunxiaoMemberId" TEXT;
ALTER TABLE "YunxiaoMemberMapping" ADD COLUMN "yunxiaoUserId" TEXT;
ALTER TABLE "YunxiaoMemberMapping" ADD COLUMN "aliyunAccountId" TEXT;

-- 旧字段在此前版本保存的是云效 userId，先回填到语义明确的新字段。
UPDATE "YunxiaoMemberMapping"
SET "yunxiaoUserId" = "yunxiaoUserIdentifier"
WHERE "yunxiaoUserId" IS NULL;

CREATE INDEX "YunxiaoMemberMapping_organizationId_yunxiaoMemberId_idx"
ON "YunxiaoMemberMapping"("organizationId", "yunxiaoMemberId");

CREATE INDEX "YunxiaoMemberMapping_organizationId_yunxiaoUserId_idx"
ON "YunxiaoMemberMapping"("organizationId", "yunxiaoUserId");

CREATE INDEX "YunxiaoMemberMapping_organizationId_aliyunAccountId_idx"
ON "YunxiaoMemberMapping"("organizationId", "aliyunAccountId");
