-- CreateTable
CREATE TABLE "IdeationSessionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdeationSessionEvent_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "IdeationSession" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "IdeationSessionEvent_sessionId_createdAt_idx"
ON "IdeationSessionEvent"("sessionId", "createdAt");
