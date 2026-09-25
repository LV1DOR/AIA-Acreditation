ALTER TABLE "CompanySubmission" ADD CONSTRAINT "CompanySubmission_version_positive" CHECK ("version" > 0 AND "registrationVersion" > 0);

ALTER TABLE "CompanySubmissionReview" ADD CONSTRAINT "CompanySubmissionReview_reason_shape" CHECK (
  ("outcome" IN ('APPROVED', 'APPROVAL_INVALIDATED') AND "reasonCategory" IS NULL AND "comment" IS NULL)
  OR
  ("outcome" IN ('RETURNED_FOR_CORRECTION', 'REJECTED') AND "reasonCategory" IS NOT NULL AND length(btrim("comment")) > 0)
);

CREATE FUNCTION reject_submission_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SUBMISSION_IMMUTABLE';
END;
$$;

CREATE TRIGGER company_submission_immutable BEFORE UPDATE OR DELETE ON "CompanySubmission"
  FOR EACH ROW EXECUTE FUNCTION reject_submission_mutation();

CREATE TRIGGER company_submission_review_append_only BEFORE UPDATE OR DELETE ON "CompanySubmissionReview"
  FOR EACH ROW EXECUTE FUNCTION reject_submission_mutation();
