-- AlterTable
ALTER TABLE "PrivacyErasureJob" ADD COLUMN     "evidencePurgeReference" TEXT,
ADD COLUMN     "evidencePurgeRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "evidencePurgeRequestedByUserId" UUID;

CREATE OR REPLACE FUNCTION reject_erasure_scope_mutation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE registration uuid; data jsonb;
BEGIN
 data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='CompanyEventRegistration' THEN registration:=(data->>'id')::uuid;
 ELSIF data ? 'registrationId' THEN registration:=(data->>'registrationId')::uuid;
 ELSIF data ? 'submissionId' THEN SELECT "registrationId" INTO registration FROM public."CompanySubmission" WHERE id=(data->>'submissionId')::uuid;
 ELSIF data ? 'participantId' THEN SELECT "registrationId" INTO registration FROM public."EventParticipant" WHERE id=(data->>'participantId')::uuid;
 END IF;
 IF NOT public.privacy_operation_allows(registration) AND (EXISTS(SELECT 1 FROM public."PrivacyErasureJob" WHERE "registrationId"=registration AND status<>'CANCELLED') OR EXISTS(SELECT 1 FROM public."CompanyEventRegistration" WHERE id=registration AND "erasedAt" IS NOT NULL)) THEN RAISE EXCEPTION 'ERASURE_SCOPE_LOCKED'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public."PrivacyErasureJob"%ROWTYPE;
BEGIN
 IF current_user='aia_privacy_owner' THEN
  SELECT * INTO j FROM public."PrivacyErasureJob" WHERE id=nullif(current_setting('aia.privacy_job',true),'')::uuid AND status='DATABASE_PENDING';
  IF j.id IS NOT NULL AND OLD."eventId"=j."eventId" THEN
   IF TG_OP='DELETE' AND OLD."entityId"=j.id AND j."evidencePurgeRequestedAt" IS NOT NULL THEN RETURN OLD; END IF;
   IF OLD."companyId"=(SELECT "companyId" FROM public."CompanyEventRegistration" WHERE id=j."registrationId") THEN
    IF TG_OP='DELETE' AND j.stage='ALL_EVIDENCE' THEN RETURN OLD; END IF;
    IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'metadata')=(to_jsonb(OLD)-'metadata') AND NEW.metadata='{}'::jsonb THEN RETURN NEW; END IF;
   END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'AUDIT_APPEND_ONLY';
END $$;
CREATE FUNCTION purge_privacy_operation_evidence(job_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public."PrivacyErasureJob"%ROWTYPE; p public."EventRetentionPolicy"%ROWTYPE;
BEGIN
 SELECT * INTO STRICT j FROM public."PrivacyErasureJob" WHERE id=job_id FOR UPDATE;
 SELECT * INTO STRICT p FROM public."EventRetentionPolicy" WHERE "eventId"=j."eventId" AND synthetic=j.synthetic ORDER BY "createdAt" DESC,id DESC LIMIT 1;
 IF j.status<>'COMPLETE' OR j."evidencePurgeRequestedAt" IS NULL OR length(btrim(j."evidencePurgeReference"))<5 OR current_timestamp<p."evidenceEraseAfter" OR EXISTS(SELECT 1 FROM public."EventPrivacyHold" WHERE "eventId"=j."eventId" AND active) THEN RAISE EXCEPTION 'EVIDENCE_PURGE_BLOCKED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."User" WHERE id=j."evidencePurgeRequestedByUserId" AND role='ADMIN' AND "disabledAt" IS NULL) THEN RAISE EXCEPTION 'EVIDENCE_PURGE_AUTHORISATION_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public."CompanyEventRegistration" WHERE id=j."registrationId") OR EXISTS(SELECT 1 FROM public."StorageDeletion" WHERE "jobId"=j.id AND status<>'VERIFIED') OR EXISTS(SELECT 1 FROM public."BackupRun" WHERE status<>'DELETED' AND "createdAt"<=j."databaseErasedAt") THEN RAISE EXCEPTION 'EVIDENCE_COPY_REMAINS'; END IF;
 UPDATE public."PrivacyErasureJob" SET status='DATABASE_PENDING' WHERE id=j.id;
 PERFORM set_config('aia.privacy_job',j.id::text,true);
 DELETE FROM public."AuditEvent" WHERE "entityId"=j.id AND "eventId"=j."eventId";
 DELETE FROM public."StorageDeletion" WHERE "jobId"=j.id;
 DELETE FROM public."PrivacyErasureJob" WHERE id=j.id;
 INSERT INTO public."AuditEvent"(id,"occurredAt","actorType","actorUserId",action,"entityType","entityId","eventId","correlationId","metadataVersion",metadata) VALUES(gen_random_uuid(),current_timestamp,'SYSTEM',NULL,'PRIVACY_OPERATION_EVIDENCE_PURGED','Event',j."eventId",j."eventId",gen_random_uuid(),1,'{}');
END $$;
ALTER FUNCTION purge_privacy_operation_evidence(uuid) OWNER TO aia_privacy_owner;
REVOKE ALL ON FUNCTION purge_privacy_operation_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_privacy_operation_evidence(uuid) TO aia_privacy_executor;
GRANT SELECT,UPDATE,DELETE ON "StorageDeletion","PrivacyErasureJob" TO aia_privacy_owner;
