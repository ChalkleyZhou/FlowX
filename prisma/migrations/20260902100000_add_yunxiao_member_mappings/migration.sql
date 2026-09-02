CREATE TABLE "YunxiaoMemberMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "yunxiaoOrganizationIdentifier" TEXT NOT NULL,
    "yunxiaoUserIdentifier" TEXT NOT NULL,
    "yunxiaoDisplayName" TEXT NOT NULL,
    "flowxUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "YunxiaoMemberMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "YunxiaoMemberMapping_flowxUserId_fkey" FOREIGN KEY ("flowxUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "YunxiaoMemberMapping_organizationId_yunxiaoOrganizationIdentifier_yunxiaoUserIdentifier_key"
ON "YunxiaoMemberMapping"("organizationId", "yunxiaoOrganizationIdentifier", "yunxiaoUserIdentifier");

CREATE INDEX "YunxiaoMemberMapping_organizationId_flowxUserId_idx"
ON "YunxiaoMemberMapping"("organizationId", "flowxUserId");
