-- AlterTable
ALTER TABLE "PrivacyNotice" ADD COLUMN     "synthetic" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "EventRetentionPolicy" ADD COLUMN     "synthetic" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PrivacyErasureJob" ADD COLUMN     "synthetic" BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION execute_privacy_erasure(job_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
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
 IF p.id<>(SELECT id FROM public."EventRetentionPolicy" WHERE "eventId"=j."eventId" ORDER BY "createdAt" DESC,id DESC LIMIT 1) THEN RAISE EXCEPTION 'ERASURE_POLICY_CHANGED'; END IF;
 IF j.synthetic<>p.synthetic THEN RAISE EXCEPTION 'ERASURE_CLASSIFICATION_MISMATCH'; END IF;
 registration:=j."registrationId";
 PERFORM 1 FROM public."CompanyEventRegistration" WHERE id=registration AND "eventId"=j."eventId" AND version=j."registrationVersion" FOR UPDATE;
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


