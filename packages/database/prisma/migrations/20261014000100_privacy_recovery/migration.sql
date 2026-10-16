-- AlterTable
ALTER TABLE "CompanyEventRegistration" ADD COLUMN     "erasedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "EventParticipant" ADD COLUMN     "erasedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "OutboxMessage" ADD COLUMN     "eventId" UUID,
ADD COLUMN     "recoveries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recoveryPayload" JSONB,
ADD COLUMN     "registrationId" UUID,
ADD COLUMN     "terminalAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "PrivacyNotice" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" VARCHAR(100) NOT NULL,
    "textPt" TEXT NOT NULL,
    "textEn" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "approvalReference" TEXT NOT NULL,
    "approvedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyAcknowledgement" (
    "id" UUID NOT NULL,
    "noticeId" UUID,
    "eventId" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "participantId" UUID,
    "submissionId" UUID,
    "actorType" TEXT NOT NULL,
    "actorUserId" UUID,
    "locale" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "noticeHash" CHAR(64) NOT NULL,
    "presentedText" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRetentionPolicy" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "recordsEraseAfter" TIMESTAMPTZ(3) NOT NULL,
    "evidenceEraseAfter" TIMESTAMPTZ(3) NOT NULL,
    "communicationsEraseAfter" TIMESTAMPTZ(3) NOT NULL,
    "backupsEraseAfter" TIMESTAMPTZ(3) NOT NULL,
    "approvalReference" TEXT NOT NULL,
    "approvedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPrivacyHold" (
    "eventId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL,
    "reference" TEXT NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EventPrivacyHold_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "PrivacyErasureJob" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'PERSONAL_DATA',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "requestedByUserId" UUID NOT NULL,
    "authorisationReference" TEXT NOT NULL,
    "registrationVersion" INTEGER NOT NULL,
    "previewHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "databaseErasedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "externalCopiesReference" TEXT,
    "externalCopiesVerifiedByUserId" UUID,
    "lastFailureCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrivacyErasureJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageDeletion" (
    "id" UUID NOT NULL,
    "jobId" UUID,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "lastFailureCode" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "archiveHash" CHAR(64),
    "migrationHash" CHAR(64),
    "keyBundleHash" CHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "lastFailureCode" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalHeartbeat" (
    "id" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,

    CONSTRAINT "OperationalHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivacyNotice_eventId_kind_createdAt_idx" ON "PrivacyNotice"("eventId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyNotice_eventId_kind_version_key" ON "PrivacyNotice"("eventId", "kind", "version");

-- CreateIndex
CREATE INDEX "PrivacyAcknowledgement_registrationId_acknowledgedAt_idx" ON "PrivacyAcknowledgement"("registrationId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "PrivacyAcknowledgement_participantId_idx" ON "PrivacyAcknowledgement"("participantId");

-- CreateIndex
CREATE INDEX "EventRetentionPolicy_eventId_createdAt_idx" ON "EventRetentionPolicy"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivacyErasureJob_status_createdAt_idx" ON "PrivacyErasureJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StorageDeletion_status_availableAt_idx" ON "StorageDeletion"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageDeletion_bucket_objectKey_key" ON "StorageDeletion"("bucket", "objectKey");

-- CreateIndex
CREATE INDEX "BackupRun_status_createdAt_idx" ON "BackupRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "StorageDeletion" ADD CONSTRAINT "StorageDeletion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PrivacyErasureJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The executor credential is provisioned separately; the runtime is never a member.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='aia_privacy_owner') THEN CREATE ROLE aia_privacy_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='aia_privacy_executor') THEN CREATE ROLE aia_privacy_executor NOLOGIN; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO aia_privacy_owner, aia_privacy_executor;
ALTER TABLE "PrivacyNotice" ADD CONSTRAINT privacy_notice_kind CHECK ("kind" IN ('WORKER','LEADER'));
ALTER TABLE "EventRetentionPolicy" ADD CONSTRAINT retention_dates CHECK ("evidenceEraseAfter">="recordsEraseAfter");
ALTER TABLE "PrivacyErasureJob" ADD CONSTRAINT erasure_stage CHECK ("stage" IN ('PERSONAL_DATA','ALL_EVIDENCE'));
ALTER TABLE "PrivacyErasureJob" ADD CONSTRAINT erasure_status CHECK ("status" IN ('QUEUED','DATABASE_PENDING','STORAGE_PENDING','COPIES_PENDING','COMPLETE','CANCELLED'));
ALTER TABLE "StorageDeletion" ADD CONSTRAINT deletion_status CHECK ("status" IN ('PENDING','DELETING','RETRYING','VERIFIED'));
CREATE INDEX outbox_recovery ON "OutboxMessage"("type","terminalAt","leaseExpiresAt") WHERE "processedAt" IS NULL;
CREATE UNIQUE INDEX one_pending_erasure ON "PrivacyErasureJob"("registrationId") WHERE "status" NOT IN ('COMPLETE','CANCELLED');

CREATE FUNCTION privacy_operation_allows(registration uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT current_user='aia_privacy_owner' AND EXISTS (
   SELECT 1 FROM public."PrivacyErasureJob" j WHERE j.id=nullif(current_setting('aia.privacy_job',true),'')::uuid
   AND j."registrationId"=registration AND j.status='DATABASE_PENDING'
 );
$$;
CREATE OR REPLACE FUNCTION reject_submission_mutation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE registration uuid;
BEGIN
 IF TG_TABLE_NAME='CompanySubmission' THEN registration:=OLD."registrationId";
 ELSE SELECT "registrationId" INTO registration FROM public."CompanySubmission" WHERE id=OLD."submissionId";
 END IF;
 IF public.privacy_operation_allows(registration) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 RAISE EXCEPTION 'SUBMISSION_IMMUTABLE';
END $$;
CREATE FUNCTION privacy_registry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PRIVACY_CONFIGURATION_IMMUTABLE'; END $$;
CREATE TRIGGER privacy_notice_immutable BEFORE UPDATE OR DELETE ON "PrivacyNotice" FOR EACH ROW EXECUTE FUNCTION privacy_registry_immutable();
CREATE TRIGGER retention_policy_immutable BEFORE UPDATE OR DELETE ON "EventRetentionPolicy" FOR EACH ROW EXECUTE FUNCTION privacy_registry_immutable();
CREATE FUNCTION privacy_ack_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF public.privacy_operation_allows(OLD."registrationId") THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND OLD."submissionId" IS NULL AND NEW."submissionId" IS NOT NULL
 AND (to_jsonb(OLD)-'submissionId')=(to_jsonb(NEW)-'submissionId')
 AND EXISTS(SELECT 1 FROM public."CompanySubmission" WHERE id=NEW."submissionId" AND "registrationId"=OLD."registrationId") THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'PRIVACY_ACKNOWLEDGEMENT_IMMUTABLE';
END $$;
CREATE TRIGGER privacy_ack_append_only BEFORE UPDATE OR DELETE ON "PrivacyAcknowledgement" FOR EACH ROW EXECUTE FUNCTION privacy_ack_immutable();

CREATE FUNCTION reject_erasure_scope_mutation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE registration uuid; data jsonb;
BEGIN
 data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='CompanyEventRegistration' THEN registration:=(data->>'id')::uuid;
 ELSIF data ? 'registrationId' THEN registration:=(data->>'registrationId')::uuid;
 ELSIF data ? 'submissionId' THEN SELECT "registrationId" INTO registration FROM public."CompanySubmission" WHERE id=(data->>'submissionId')::uuid;
 ELSIF data ? 'participantId' THEN SELECT "registrationId" INTO registration FROM public."EventParticipant" WHERE id=(data->>'participantId')::uuid;
 END IF;
 IF NOT public.privacy_operation_allows(registration) AND EXISTS(SELECT 1 FROM public."PrivacyErasureJob" WHERE "registrationId"=registration AND status<>'CANCELLED') THEN RAISE EXCEPTION 'ERASURE_SCOPE_LOCKED'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['CompanyEventRegistration','EventParticipant','CompanySubmission','CompanySubmissionReview','SubmissionParticipantReview','SubmissionPhotoAdjustment','ParticipantWorkDay','ParticipantZoneRequest','EmployeeInvitationToken','LeaderInvitation','CompanyRequest','InternalImportBatch','PhotoUpload'] LOOP
 EXECUTE format('CREATE TRIGGER erasure_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION reject_erasure_scope_mutation()',t);
 END LOOP;
END $$;

CREATE FUNCTION execute_privacy_erasure(job_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public."PrivacyErasureJob"%ROWTYPE; p public."EventRetentionPolicy"%ROWTYPE; registration uuid; submission_ids uuid[]; participant_ids uuid[];
BEGIN
 SELECT * INTO STRICT j FROM public."PrivacyErasureJob" WHERE id=job_id FOR UPDATE;
 IF j."databaseErasedAt" IS NOT NULL THEN RETURN; END IF;
 IF j.status NOT IN ('QUEUED','DATABASE_PENDING') THEN RAISE EXCEPTION 'ERASURE_NOT_QUEUED'; END IF;
 SELECT * INTO STRICT p FROM public."EventRetentionPolicy" WHERE id=j."policyId" AND "eventId"=j."eventId";
 IF EXISTS(SELECT 1 FROM public."EventPrivacyHold" WHERE "eventId"=j."eventId" AND active) OR
 current_timestamp < (CASE WHEN j.stage='ALL_EVIDENCE' THEN p."evidenceEraseAfter" ELSE p."recordsEraseAfter" END) THEN RAISE EXCEPTION 'ERASURE_POLICY_BLOCKED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."User" WHERE id=j."requestedByUserId" AND role='ADMIN' AND "disabledAt" IS NULL) OR length(btrim(j."authorisationReference"))<5 THEN RAISE EXCEPTION 'ERASURE_AUTHORISATION_REQUIRED'; END IF;
 registration:=j."registrationId";
 PERFORM 1 FROM public."CompanyEventRegistration" WHERE id=registration AND version=j."registrationVersion" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ERASURE_STALE_SCOPE'; END IF;
 UPDATE public."PrivacyErasureJob" SET status='DATABASE_PENDING',attempts=attempts+1 WHERE id=job_id;
 PERFORM set_config('aia.privacy_job',job_id::text,true);
 SELECT array_agg(id) INTO submission_ids FROM public."CompanySubmission" WHERE "registrationId"=registration;
 SELECT array_agg(id) INTO participant_ids FROM public."EventParticipant" WHERE "registrationId"=registration;
 DELETE FROM public."PrivacyAcknowledgement" WHERE "registrationId"=registration;
 DELETE FROM public."ParticipantWorkDay" WHERE "participantId"=ANY(participant_ids);
 DELETE FROM public."ParticipantZoneRequest" WHERE "participantId"=ANY(participant_ids);
 DELETE FROM public."EmployeeInvitationToken" WHERE "participantId"=ANY(participant_ids);
 DELETE FROM public."LeaderInvitation" WHERE "registrationId"=registration;
 DELETE FROM public."InternalImportBatch" WHERE "registrationId"=registration;
 DELETE FROM public."Notification" WHERE "registrationId"=registration;
 UPDATE public."OutboxMessage" SET payload='{}',"recoveryPayload"='{}',"processedAt"=current_timestamp,"terminalAt"=current_timestamp,"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"lastFailureCode"='PRIVACY_ERASURE' WHERE "registrationId"=registration;
 UPDATE public."EmailDelivery" SET "recipientHash"=NULL,"providerMessageId"=NULL,"lastFailureCode"='PRIVACY_ERASURE' WHERE "outboxMessageId" IN (SELECT id FROM public."OutboxMessage" WHERE "registrationId"=registration);
 UPDATE public."EventParticipant" SET "fullName"=NULL,"dateOfBirth"=NULL,"documentType"=NULL,"documentNumberCiphertext"=NULL,"documentNumberIv"=NULL,"documentNumberAuthTag"=NULL,"documentNumberKeyVersion"=NULL,"documentNumberFingerprint"=NULL,"documentNumberLast3"=NULL,"documentExpiryDate"=NULL,"mobileE164"=NULL,"nationalityCode"=NULL,"photoObjectKey"=NULL,"privacyNoticeVersion"=NULL,"privacyAcknowledgedAt"=NULL,"internalReference"=NULL,"photoReference"=NULL,"editRequestId"=NULL,"replacementRequestId"=NULL,"jobRoleId"=NULL,"erasedAt"=current_timestamp,status='REMOVED',version=version+1 WHERE "registrationId"=registration;
 UPDATE public."CompanyRequest" SET reason='[erased]',payload='{}',"resolutionComment"=NULL,"effectBasePhotoKey"=NULL WHERE "registrationId"=registration;
 UPDATE public."SubmissionPhotoAdjustment" SET "photoObjectKey"='[erased]' WHERE "submissionId"=ANY(submission_ids);
 UPDATE public."SubmissionParticipantReview" SET comment=CASE WHEN comment IS NULL THEN NULL ELSE '[erased]' END WHERE "submissionId"=ANY(submission_ids);
 UPDATE public."CompanySubmissionReview" SET comment=CASE WHEN comment IS NULL THEN NULL ELSE '[erased]' END WHERE "submissionId"=ANY(submission_ids);
 UPDATE public."CompanySubmission" SET snapshot=jsonb_build_object('schemaVersion',3,'erased',true,'company',jsonb_build_object('internalOrganisation',NULL),'zones','[]'::jsonb,'participants','[]'::jsonb) WHERE "registrationId"=registration;
 UPDATE public."PhotoUpload" SET status='CLEANED' WHERE "participantId"=ANY(participant_ids);
 UPDATE public."AuditEvent" SET metadata='{}' WHERE "eventId"=j."eventId" AND "companyId"=(SELECT "companyId" FROM public."CompanyEventRegistration" WHERE id=registration);
 UPDATE public."CompanyEventRegistration" SET "erasedAt"=current_timestamp,status='REJECTED' WHERE id=registration;
 IF j.stage='ALL_EVIDENCE' THEN
   DELETE FROM public."CompanyRequest" WHERE "registrationId"=registration;
   DELETE FROM public."SubmissionPhotoAdjustment" WHERE "submissionId"=ANY(submission_ids);
   DELETE FROM public."SubmissionParticipantReview" WHERE "submissionId"=ANY(submission_ids);
   DELETE FROM public."CompanySubmissionReview" WHERE "submissionId"=ANY(submission_ids);
   DELETE FROM public."CompanySubmission" WHERE "registrationId"=registration;
   DELETE FROM public."PhotoUpload" WHERE "participantId"=ANY(participant_ids);
   DELETE FROM public."EventParticipant" WHERE "registrationId"=registration;
   DELETE FROM public."CompanyZoneRequest" WHERE "registrationId"=registration;
   DELETE FROM public."VehiclePassRequest" WHERE "registrationId"=registration;
   DELETE FROM public."AuditEvent" WHERE "eventId"=j."eventId" AND "companyId"=(SELECT "companyId" FROM public."CompanyEventRegistration" WHERE id=registration);
   DELETE FROM public."CompanyEventRegistration" WHERE id=registration;
 END IF;
 UPDATE public."PrivacyErasureJob" SET "databaseErasedAt"=current_timestamp,status='STORAGE_PENDING',"lastFailureCode"=NULL WHERE id=job_id;
 INSERT INTO public."AuditEvent"(id,"occurredAt","actorType","actorUserId",action,"entityType","entityId","eventId","correlationId","metadataVersion",metadata)
 VALUES(gen_random_uuid(),current_timestamp,'SYSTEM',NULL,'PRIVACY_DATABASE_ERASED','PrivacyErasureJob',job_id,j."eventId",gen_random_uuid(),1,'{}');
END $$;
ALTER FUNCTION execute_privacy_erasure(uuid) OWNER TO aia_privacy_owner;
REVOKE ALL ON FUNCTION execute_privacy_erasure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_privacy_erasure(uuid) TO aia_privacy_executor;
GRANT SELECT ON "PrivacyErasureJob","EventRetentionPolicy","EventPrivacyHold","User","CompanyEventRegistration","CompanySubmission","EventParticipant","OutboxMessage" TO aia_privacy_owner;
GRANT INSERT ON "AuditEvent" TO aia_privacy_owner;
GRANT UPDATE ON "PrivacyErasureJob","CompanyEventRegistration","CompanySubmission","EventParticipant","OutboxMessage","EmailDelivery","CompanyRequest","SubmissionPhotoAdjustment","SubmissionParticipantReview","CompanySubmissionReview","PhotoUpload","AuditEvent" TO aia_privacy_owner;
GRANT DELETE ON "PrivacyAcknowledgement","ParticipantWorkDay","ParticipantZoneRequest","EmployeeInvitationToken","LeaderInvitation","InternalImportBatch","Notification","CompanyRequest","SubmissionPhotoAdjustment","SubmissionParticipantReview","CompanySubmissionReview","CompanySubmission","PhotoUpload","EventParticipant","CompanyZoneRequest","VehiclePassRequest","AuditEvent","CompanyEventRegistration" TO aia_privacy_owner;
-- UPDATE/DELETE predicates and trigger lookups require SELECT on each target.
GRANT SELECT ON "PrivacyAcknowledgement","ParticipantWorkDay","ParticipantZoneRequest","EmployeeInvitationToken","LeaderInvitation","InternalImportBatch","Notification","EmailDelivery","CompanyRequest","SubmissionPhotoAdjustment","SubmissionParticipantReview","CompanySubmissionReview","PhotoUpload","CompanyZoneRequest","VehiclePassRequest","AuditEvent" TO aia_privacy_owner;
