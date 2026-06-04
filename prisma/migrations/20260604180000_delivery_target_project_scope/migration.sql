-- Redefine DeliveryTarget as project-scoped (migrate existing workspace targets to first project in workspace).

PRAGMA foreign_keys=OFF;

CREATE TABLE "DeliveryTarget_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "emailAddress" TEXT,
    "dingtalkWebhookUrl" TEXT,
    "dingtalkSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "DeliveryTarget_new" (
    "id",
    "projectId",
    "type",
    "name",
    "userId",
    "organizationId",
    "emailAddress",
    "dingtalkWebhookUrl",
    "dingtalkSecret",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    dt."id",
    (
        SELECT p."id"
        FROM "Project" p
        WHERE p."workspaceId" = dt."workspaceId"
        ORDER BY p."createdAt" ASC
        LIMIT 1
    ),
    dt."type",
    dt."name",
    dt."userId",
    dt."organizationId",
    dt."emailAddress",
    dt."dingtalkWebhookUrl",
    dt."dingtalkSecret",
    dt."isActive",
    dt."createdAt",
    dt."updatedAt"
FROM "DeliveryTarget" dt
WHERE EXISTS (
    SELECT 1
    FROM "Project" p
    WHERE p."workspaceId" = dt."workspaceId"
);

DELETE FROM "DeliveryLog"
WHERE "deliveryTargetId" IN (
    SELECT dt."id"
    FROM "DeliveryTarget" dt
    WHERE NOT EXISTS (
        SELECT 1
        FROM "Project" p
        WHERE p."workspaceId" = dt."workspaceId"
    )
);

DROP TABLE "DeliveryTarget";
ALTER TABLE "DeliveryTarget_new" RENAME TO "DeliveryTarget";

CREATE INDEX "DeliveryTarget_projectId_idx" ON "DeliveryTarget"("projectId");
CREATE INDEX "DeliveryTarget_type_idx" ON "DeliveryTarget"("type");
CREATE INDEX "DeliveryTarget_isActive_idx" ON "DeliveryTarget"("isActive");
CREATE INDEX "DeliveryTarget_userId_idx" ON "DeliveryTarget"("userId");

PRAGMA foreign_keys=ON;
