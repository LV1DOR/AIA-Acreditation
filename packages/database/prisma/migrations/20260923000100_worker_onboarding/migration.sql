CREATE TYPE "DocumentType" AS ENUM ('PASSPORT', 'CARTAO_CIDADAO', 'CARTAO_RESIDENCIA');
CREATE TYPE "ParticipantStatus" AS ENUM ('DRAFT', 'AWAITING_EMPLOYEE', 'AWAITING_LEADER_REVIEW', 'LEADER_APPROVED', 'DUPLICATE_REVIEW_REQUIRED', 'REMOVED', 'REPLACED');

CREATE TABLE "EventParticipant" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "jobRoleId" UUID,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'DRAFT',
    "fullName" TEXT,
    "dateOfBirth" DATE,
    "documentType" "DocumentType",
    "documentNumberCiphertext" TEXT,
    "documentNumberIv" TEXT,
    "documentNumberAuthTag" TEXT,
    "documentNumberKeyVersion" INTEGER,
    "documentNumberFingerprint" CHAR(64),
    "documentNumberLast3" VARCHAR(3),
    "documentExpiryDate" DATE,
    "mobileE164" TEXT,
    "nationalityCode" CHAR(2),
    "photoObjectKey" TEXT,
    "privacyNoticeVersion" TEXT,
    "privacyAcknowledgedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventParticipant_registrationId_eventId_fkey" FOREIGN KEY ("registrationId", "eventId") REFERENCES "CompanyEventRegistration"("id", "eventId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventParticipant_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ParticipantWorkDay" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    CONSTRAINT "ParticipantWorkDay_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ParticipantWorkDay_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "EventParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "EmployeeInvitationToken" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeInvitationToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmployeeInvitationToken_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "EventParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EmployeeInvitationToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "EventParticipant_registrationId_status_idx" ON "EventParticipant"("registrationId", "status");
CREATE INDEX "EventParticipant_eventId_documentNumberFingerprint_idx" ON "EventParticipant"("eventId", "documentNumberFingerprint");
CREATE INDEX "EventParticipant_jobRoleId_idx" ON "EventParticipant"("jobRoleId");
CREATE UNIQUE INDEX "ParticipantWorkDay_participantId_workDate_key" ON "ParticipantWorkDay"("participantId", "workDate");
CREATE UNIQUE INDEX "EmployeeInvitationToken_tokenHash_key" ON "EmployeeInvitationToken"("tokenHash");
CREATE INDEX "EmployeeInvitationToken_participantId_createdAt_idx" ON "EmployeeInvitationToken"("participantId", "createdAt");
