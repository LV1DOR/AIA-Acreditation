ALTER TYPE "RequestType" ADD VALUE 'ZONE_CHANGE';

ALTER TABLE "EventParticipant"
  ADD COLUMN "replacementRequestId" UUID;

ALTER TABLE "CompanyRequest"
  ADD COLUMN "fulfilledBySubmissionId" UUID;

CREATE UNIQUE INDEX "EventParticipant_replacementRequestId_key"
  ON "EventParticipant"("replacementRequestId");

CREATE INDEX "CompanyRequest_fulfilledBySubmissionId_idx"
  ON "CompanyRequest"("fulfilledBySubmissionId");

ALTER TABLE "EventParticipant"
  ADD CONSTRAINT "EventParticipant_replacementRequestId_fkey"
  FOREIGN KEY ("replacementRequestId") REFERENCES "CompanyRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyRequest"
  ADD CONSTRAINT "CompanyRequest_fulfilledBySubmissionId_fkey"
  FOREIGN KEY ("fulfilledBySubmissionId") REFERENCES "CompanySubmission"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
