BEGIN;
ALTER TABLE "EmailDelivery" ADD COLUMN "subject" VARCHAR(998), ADD COLUMN "sender" VARCHAR(320), ADD COLUMN "senderDomain" VARCHAR(253);
CREATE INDEX "EmailDelivery_senderDomain_createdAt_id_idx" ON "EmailDelivery"("senderDomain","createdAt","id");
ALTER TABLE "EmailDeliveryEvent" ADD COLUMN "providerMessage" VARCHAR(4000), ADD COLUMN "smtpResponse" VARCHAR(8000);
CREATE OR REPLACE FUNCTION redact_email_monitoring() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."lastFailureCode" IN ('RETENTION_EXPIRED','PRIVACY_ERASURE')
     OR (OLD."recipientHash" IS NOT NULL AND NEW."recipientHash" IS NULL
         AND NEW."providerMessageId" IS NULL AND NEW.recipients=OLD.recipients) THEN
    IF NEW."rfcIdHash" IS NULL AND OLD."providerMessageId" ~ '^<[^<>]+>$' THEN
      NEW."rfcIdHash" := encode(sha256(convert_to(OLD."providerMessageId",'UTF8')),'hex');
    END IF;
    NEW.recipients := ARRAY[]::TEXT[];
    NEW.subject := NULL; NEW.sender := NULL; NEW."senderDomain" := NULL;
    NEW."resendEmailId" := NULL; NEW."rfcMessageId" := NULL; NEW."reconciledStatus" := NULL;
    NEW."erasedAt" := COALESCE(OLD."erasedAt",CURRENT_TIMESTAMP);
    DELETE FROM "EmailDeliveryEvent" WHERE "emailDeliveryId"=OLD.id;
    UPDATE "EmailProviderIdentity" SET "resendEmailId"=NULL,"reconciledAt"=NULL,"reconciledStatus"=NULL WHERE "emailDeliveryId"=OLD.id;
  END IF;
  RETURN NEW;
END $$;
COMMIT;
