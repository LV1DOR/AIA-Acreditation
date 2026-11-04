DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM "EmailDelivery" WHERE id='00000000-0000-4000-8000-000000000041' AND "rfcMessageId"='<synthetic-rehearsal@example.invalid>' AND "rfcIdHash"=encode(sha256(convert_to('<synthetic-rehearsal@example.invalid>','UTF8')),'hex') AND status='SENT') THEN RAISE EXCEPTION 'SYNTHETIC_LEGACY_BACKFILL_FAILED'; END IF;
END $$;
-- Rehearse old artifact SQL after all three migrations, including trigger redaction.
UPDATE "EmailDelivery" SET "recipientHash"=NULL,"providerMessageId"=NULL,"lastFailureCode"='RETENTION_EXPIRED' WHERE id='00000000-0000-4000-8000-000000000041';
DO $$ BEGIN IF NOT EXISTS(SELECT FROM "EmailDelivery" WHERE id='00000000-0000-4000-8000-000000000041' AND "erasedAt" IS NOT NULL AND cardinality(recipients)=0) THEN RAISE EXCEPTION 'SYNTHETIC_LEGACY_REDACTION_FAILED'; END IF; END $$;
