BEGIN;
-- One logical outbox delivery can have multiple provider IDs after an existing
-- ambiguous SMTP retry. Retain each identity and its erasure tombstone.
CREATE TABLE "EmailProviderIdentity" (
  "idHash" CHAR(64) NOT NULL,
  "resendEmailId" UUID,
  "emailDeliveryId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reconciledAt" TIMESTAMPTZ(3),
  "reconciledStatus" VARCHAR(30),
  CONSTRAINT "EmailProviderIdentity_pkey" PRIMARY KEY ("idHash"),
  CONSTRAINT "EmailProviderIdentity_emailDeliveryId_fkey" FOREIGN KEY ("emailDeliveryId") REFERENCES "EmailDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailProviderIdentity_resendEmailId_key" ON "EmailProviderIdentity"("resendEmailId");
CREATE INDEX "EmailProviderIdentity_emailDeliveryId_idx" ON "EmailProviderIdentity"("emailDeliveryId");
ALTER TABLE "EmailDeliveryEvent" ADD COLUMN "resendEmailId" UUID;
INSERT INTO "EmailProviderIdentity" ("idHash","resendEmailId","emailDeliveryId","reconciledAt","reconciledStatus")
SELECT "resendIdHash",CASE WHEN "erasedAt" IS NULL THEN "resendEmailId" END,id,"reconciledAt","reconciledStatus"
FROM "EmailDelivery" WHERE "resendIdHash" IS NOT NULL;
-- Historical event IDs cannot be reconstructed safely from a logical row's
-- current ID. Leave those NULL rather than attribute an event to a guessed send.

CREATE OR REPLACE FUNCTION redact_email_monitoring() RETURNS trigger LANGUAGE plpgsql AS $$
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
    UPDATE "EmailProviderIdentity" SET "resendEmailId"=NULL,"reconciledAt"=NULL,"reconciledStatus"=NULL WHERE "emailDeliveryId"=OLD.id;
  END IF;
  RETURN NEW;
END $$;
GRANT SELECT,UPDATE ON "EmailProviderIdentity" TO aia_privacy_owner;
COMMIT;
