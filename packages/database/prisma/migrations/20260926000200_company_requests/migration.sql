CREATE TYPE "RequestType" AS ENUM ('EXTRA_PERSONNEL', 'ADD_AFTER_DEADLINE', 'REMOVE_AFTER_DEADLINE', 'REPLACE_PERSON', 'EDIT_PERSON', 'CHANGE_WORK_DAYS', 'REPLACE_PHOTO', 'VEHICLE_PASS_CHANGE', 'OTHER');
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "RequestPriority" AS ENUM ('NORMAL', 'URGENT');

CREATE TABLE "CompanyRequest" (
  "id" UUID NOT NULL,
  "registrationId" UUID NOT NULL,
  "targetParticipantId" UUID,
  "createdByUserId" UUID NOT NULL,
  "type" "RequestType" NOT NULL,
  "priority" "RequestPriority" NOT NULL DEFAULT 'NORMAL',
  "reason" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  "resolutionComment" TEXT,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CompanyRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyRequest_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 5 AND 2000),
  CONSTRAINT "CompanyRequest_resolution_check" CHECK (
    ("status" = 'PENDING' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL AND "resolutionComment" IS NULL)
    OR ("status" = 'CANCELLED' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL)
    OR ("status" IN ('APPROVED','REJECTED') AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
  )
);
CREATE INDEX "CompanyRequest_status_priority_createdAt_idx" ON "CompanyRequest"("status", "priority", "createdAt");
CREATE INDEX "CompanyRequest_registrationId_createdAt_idx" ON "CompanyRequest"("registrationId", "createdAt");
CREATE INDEX "CompanyRequest_targetParticipantId_status_idx" ON "CompanyRequest"("targetParticipantId", "status");
ALTER TABLE "CompanyRequest" ADD CONSTRAINT "CompanyRequest_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "CompanyEventRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyRequest" ADD CONSTRAINT "CompanyRequest_targetParticipantId_fkey" FOREIGN KEY ("targetParticipantId") REFERENCES "EventParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyRequest" ADD CONSTRAINT "CompanyRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyRequest" ADD CONSTRAINT "CompanyRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
