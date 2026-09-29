CREATE TABLE "EmailDelivery" (
    "id" UUID NOT NULL,
    "outboxMessageId" UUID NOT NULL,
    "recipientHash" CHAR(64),
    "provider" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastFailureCode" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDelivery_outboxMessageId_key" ON "EmailDelivery"("outboxMessageId");
CREATE INDEX "EmailDelivery_status_createdAt_idx" ON "EmailDelivery"("status", "createdAt");
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_outboxMessageId_fkey" FOREIGN KEY ("outboxMessageId") REFERENCES "OutboxMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
