BEGIN;
-- Expand only: old web/worker artifacts continue to work. No sends or secrets change.
ALTER TABLE "EmailDelivery" ALTER COLUMN "outboxMessageId" DROP NOT NULL,
  ADD COLUMN "recipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "category" VARCHAR(100),
  ADD COLUMN "companyId" UUID,
  ADD COLUMN "eventId" UUID,
  ADD COLUMN "resendEmailId" UUID,
  ADD COLUMN "resendIdHash" CHAR(64),
  ADD COLUMN "rfcMessageId" VARCHAR(500),
  ADD COLUMN "rfcIdHash" CHAR(64),
  ADD COLUMN "providerStatus" VARCHAR(30),
  ADD COLUMN "providerStatusAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastWebhookAt" TIMESTAMPTZ(3),
  ADD COLUMN "reconciledAt" TIMESTAMPTZ(3),
  ADD COLUMN "reconciledStatus" VARCHAR(30),
  ADD COLUMN "erasedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "EmailDelivery_resendEmailId_key" ON "EmailDelivery"("resendEmailId");
CREATE UNIQUE INDEX "EmailDelivery_resendIdHash_key" ON "EmailDelivery"("resendIdHash");
CREATE INDEX "EmailDelivery_providerStatus_createdAt_id_idx" ON "EmailDelivery"("providerStatus","createdAt","id");
CREATE INDEX "EmailDelivery_createdAt_id_idx" ON "EmailDelivery"("createdAt","id");
CREATE INDEX "EmailDelivery_rfcIdHash_idx" ON "EmailDelivery"("rfcIdHash");
CREATE INDEX "EmailDelivery_recipientHash_idx" ON "EmailDelivery"("recipientHash");
CREATE INDEX "EmailDelivery_recipients_idx" ON "EmailDelivery" USING GIN ("recipients");
CREATE INDEX "EmailDelivery_eventId_createdAt_id_idx" ON "EmailDelivery"("eventId","createdAt","id");
CREATE INDEX "EmailDelivery_companyId_eventId_idx" ON "EmailDelivery"("companyId","eventId");
CREATE TABLE "EmailDeliveryEvent" (
  "id" UUID NOT NULL,
  "emailDeliveryId" UUID NOT NULL,
  "svixId" VARCHAR(200) NOT NULL,
  "payloadDigest" CHAR(64) NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reasonCode" VARCHAR(100),
  CONSTRAINT "EmailDeliveryEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailDeliveryEvent_emailDeliveryId_fkey" FOREIGN KEY ("emailDeliveryId") REFERENCES "EmailDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailDeliveryEvent_svixId_key" ON "EmailDeliveryEvent"("svixId");
CREATE INDEX "EmailDeliveryEvent_emailDeliveryId_occurredAt_id_idx" ON "EmailDeliveryEvent"("emailDeliveryId","occurredAt","id");

-- Safe context backfill: no decryption, no guessed recipients or delivery outcomes.
UPDATE "EmailDelivery" d SET "category"=CASE WHEN o.type='BUSINESS_EMAIL' THEN COALESCE(o.payload->>'template',o.type) ELSE o.type END,
  "eventId"=o."eventId", "companyId"=r."companyId"
FROM "OutboxMessage" o LEFT JOIN "CompanyEventRegistration" r ON r.id=o."registrationId"
WHERE d."outboxMessageId"=o.id;
UPDATE "EmailDelivery" SET "rfcMessageId"="providerMessageId", "rfcIdHash"=encode(sha256(convert_to("providerMessageId",'UTF8')),'hex')
WHERE "providerMessageId" ~ '^<[^<>]+>$' AND "lastFailureCode" IS DISTINCT FROM 'RETENTION_EXPIRED' AND "lastFailureCode" IS DISTINCT FROM 'PRIVACY_ERASURE';

-- Existing communication retention and SECURITY DEFINER erasure routines already
-- clear these legacy fields. Extend that boundary, including when rolling back
-- the application, so added addresses cannot survive an existing erasure action.
CREATE FUNCTION redact_email_monitoring() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."lastFailureCode" IN ('RETENTION_EXPIRED','PRIVACY_ERASURE')
     OR (OLD."recipientHash" IS NOT NULL AND NEW."recipientHash" IS NULL
         AND NEW."providerMessageId" IS NULL AND NEW.recipients=OLD.recipients) THEN
    IF NEW."rfcIdHash" IS NULL AND OLD."providerMessageId" ~ '^<[^<>]+>$' THEN
      NEW."rfcIdHash" := encode(sha256(convert_to(OLD."providerMessageId",'UTF8')),'hex');
    END IF;
    NEW.recipients := ARRAY[]::TEXT[];
    NEW."resendEmailId" := NULL;
    NEW."rfcMessageId" := NULL;
    NEW."reconciledStatus" := NULL;
    NEW."erasedAt" := COALESCE(OLD."erasedAt",CURRENT_TIMESTAMP);
    DELETE FROM "EmailDeliveryEvent" WHERE "emailDeliveryId"=OLD.id;
    -- Only non-reversible hashes of random provider/RFC IDs remain, to reject
    -- late webhook replays without restoring personal data. No recipient hash.
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER email_monitoring_redaction BEFORE UPDATE ON "EmailDelivery"
FOR EACH ROW EXECUTE FUNCTION redact_email_monitoring();
GRANT SELECT,DELETE ON "EmailDeliveryEvent" TO aia_privacy_owner;
COMMIT;
