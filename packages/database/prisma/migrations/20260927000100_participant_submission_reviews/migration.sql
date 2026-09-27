CREATE TYPE "SubmissionParticipantReviewOutcome" AS ENUM ('APPROVED', 'RETURNED_FOR_CORRECTION');

CREATE TABLE "SubmissionParticipantReview" (
  "id" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "participantId" UUID NOT NULL,
  "outcome" "SubmissionParticipantReviewOutcome" NOT NULL,
  "reasonCategory" "ReviewReasonCategory",
  "comment" TEXT,
  "reviewedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SubmissionParticipantReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubmissionParticipantReview_reason_check" CHECK (
    ("outcome" = 'APPROVED' AND "reasonCategory" IS NULL AND "comment" IS NULL)
    OR
    ("outcome" = 'RETURNED_FOR_CORRECTION' AND "reasonCategory" IS NOT NULL AND length(btrim("comment")) > 0)
  )
);

CREATE UNIQUE INDEX "SubmissionParticipantReview_submissionId_participantId_key"
  ON "SubmissionParticipantReview"("submissionId", "participantId");
CREATE INDEX "SubmissionParticipantReview_participantId_outcome_idx"
  ON "SubmissionParticipantReview"("participantId", "outcome");

ALTER TABLE "SubmissionParticipantReview"
  ADD CONSTRAINT "SubmissionParticipantReview_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "CompanySubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionParticipantReview"
  ADD CONSTRAINT "SubmissionParticipantReview_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "EventParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionParticipantReview"
  ADD CONSTRAINT "SubmissionParticipantReview_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
