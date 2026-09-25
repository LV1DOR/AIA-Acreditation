CREATE TYPE "SubmissionReviewOutcome" AS ENUM ('APPROVED', 'RETURNED_FOR_CORRECTION', 'REJECTED', 'APPROVAL_INVALIDATED');

CREATE TABLE "CompanySubmission" (
  "id" UUID NOT NULL,
  "registrationId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "registrationVersion" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "submittedByUserId" UUID NOT NULL,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanySubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanySubmissionReview" (
  "id" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "outcome" "SubmissionReviewOutcome" NOT NULL,
  "reasonCategory" "ReviewReasonCategory",
  "comment" TEXT,
  "reviewedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanySubmissionReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySubmission_registrationId_version_key" ON "CompanySubmission"("registrationId", "version");
CREATE INDEX "CompanySubmission_registrationId_submittedAt_idx" ON "CompanySubmission"("registrationId", "submittedAt");
CREATE INDEX "CompanySubmissionReview_submissionId_createdAt_idx" ON "CompanySubmissionReview"("submissionId", "createdAt");

ALTER TABLE "CompanySubmission" ADD CONSTRAINT "CompanySubmission_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "CompanyEventRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanySubmission" ADD CONSTRAINT "CompanySubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanySubmissionReview" ADD CONSTRAINT "CompanySubmissionReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CompanySubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanySubmissionReview" ADD CONSTRAINT "CompanySubmissionReview_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
