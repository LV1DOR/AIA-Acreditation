CREATE TABLE "SubmissionPhotoAdjustment" (
  "id" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "photoObjectKey" TEXT NOT NULL,
  "adjustedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionPhotoAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubmissionPhotoAdjustment_submissionId_participantId_createdAt_idx"
  ON "SubmissionPhotoAdjustment"("submissionId", "participantId", "createdAt");

ALTER TABLE "SubmissionPhotoAdjustment" ADD CONSTRAINT "SubmissionPhotoAdjustment_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "CompanySubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionPhotoAdjustment" ADD CONSTRAINT "SubmissionPhotoAdjustment_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "EventParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionPhotoAdjustment" ADD CONSTRAINT "SubmissionPhotoAdjustment_adjustedByUserId_fkey"
  FOREIGN KEY ("adjustedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER submission_photo_adjustment_append_only BEFORE UPDATE OR DELETE ON "SubmissionPhotoAdjustment"
  FOR EACH ROW EXECUTE FUNCTION reject_submission_mutation();
