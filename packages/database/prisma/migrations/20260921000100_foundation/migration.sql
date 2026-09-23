-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'COMPANY_LEADER');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'ONBOARDING_OPEN', 'ONBOARDING_CLOSED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CompanyRegistrationStatus" AS ENUM ('DRAFT', 'AIA_REVIEW', 'RETURNED_FOR_CORRECTION', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ReviewReasonCategory" AS ENUM ('ZONES', 'VEHICLE_PASS', 'PERSONNEL', 'PHOTO', 'DOCUMENT', 'WORK_DAYS', 'HEADCOUNT', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'COMPANY_LEADER', 'EMPLOYEE_LINK', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "deactivatedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyLeaderMembership" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyLeaderMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "onboardingOpensAt" TIMESTAMPTZ(3) NOT NULL,
    "onboardingClosesAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deactivatedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventZone" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "deactivatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EventZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRole" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deactivatedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyEventRegistration" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "primaryLeaderMembershipId" UUID,
    "status" "CompanyRegistrationStatus" NOT NULL DEFAULT 'DRAFT',
    "personnelLimit" INTEGER NOT NULL DEFAULT 10,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyEventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyZoneRequest" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,

    CONSTRAINT "CompanyZoneRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehiclePassRequest" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "requestedQuantity" INTEGER NOT NULL DEFAULT 0,
    "justification" TEXT,
    "approvedQuantity" INTEGER,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "VehiclePassRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "eventId" UUID,
    "companyId" UUID,
    "correlationId" UUID NOT NULL,
    "metadataVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" UUID NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "processedAt" TIMESTAMPTZ(3),
    "lastFailureCode" TEXT,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "eventId" UUID,
    "registrationId" UUID,
    "type" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE INDEX "CompanyLeaderMembership_userId_revokedAt_idx" ON "CompanyLeaderMembership"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLeaderMembership_companyId_userId_key" ON "CompanyLeaderMembership"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLeaderMembership_id_companyId_key" ON "CompanyLeaderMembership"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_status_onboardingClosesAt_idx" ON "Event"("status", "onboardingClosesAt");

-- CreateIndex
CREATE INDEX "Zone_deactivatedAt_sortOrder_idx" ON "Zone"("deactivatedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EventZone_eventId_zoneId_key" ON "EventZone"("eventId", "zoneId");

-- CreateIndex
CREATE INDEX "JobRole_deactivatedAt_sortOrder_idx" ON "JobRole"("deactivatedAt", "sortOrder");

-- CreateIndex
CREATE INDEX "CompanyEventRegistration_eventId_status_idx" ON "CompanyEventRegistration"("eventId", "status");

-- CreateIndex
CREATE INDEX "CompanyEventRegistration_primaryLeaderMembershipId_companyI_idx" ON "CompanyEventRegistration"("primaryLeaderMembershipId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEventRegistration_eventId_companyId_key" ON "CompanyEventRegistration"("eventId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEventRegistration_id_eventId_key" ON "CompanyEventRegistration"("id", "eventId");

-- CreateIndex
CREATE INDEX "CompanyZoneRequest_eventId_zoneId_idx" ON "CompanyZoneRequest"("eventId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyZoneRequest_registrationId_zoneId_key" ON "CompanyZoneRequest"("registrationId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "VehiclePassRequest_registrationId_key" ON "VehiclePassRequest"("registrationId");

-- CreateIndex
CREATE INDEX "AuditEvent_eventId_occurredAt_idx" ON "AuditEvent"("eventId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_companyId_occurredAt_idx" ON "AuditEvent"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_occurredAt_idx" ON "AuditEvent"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_deduplicationKey_key" ON "OutboxMessage"("deduplicationKey");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_deduplicationKey_key" ON "Notification"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx" ON "Notification"("recipientUserId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "CompanyLeaderMembership" ADD CONSTRAINT "CompanyLeaderMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLeaderMembership" ADD CONSTRAINT "CompanyLeaderMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventZone" ADD CONSTRAINT "EventZone_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventZone" ADD CONSTRAINT "EventZone_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEventRegistration" ADD CONSTRAINT "CompanyEventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEventRegistration" ADD CONSTRAINT "CompanyEventRegistration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEventRegistration" ADD CONSTRAINT "CompanyEventRegistration_primaryLeaderMembershipId_company_fkey" FOREIGN KEY ("primaryLeaderMembershipId", "companyId") REFERENCES "CompanyLeaderMembership"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyZoneRequest" ADD CONSTRAINT "CompanyZoneRequest_registrationId_eventId_fkey" FOREIGN KEY ("registrationId", "eventId") REFERENCES "CompanyEventRegistration"("id", "eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyZoneRequest" ADD CONSTRAINT "CompanyZoneRequest_eventId_zoneId_fkey" FOREIGN KEY ("eventId", "zoneId") REFERENCES "EventZone"("eventId", "zoneId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehiclePassRequest" ADD CONSTRAINT "VehiclePassRequest_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "CompanyEventRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehiclePassRequest" ADD CONSTRAINT "VehiclePassRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Domain constraints not expressible in Prisma schema.
ALTER TABLE "Event" ADD CONSTRAINT event_calendar_range CHECK ("startDate" <= "endDate"),
  ADD CONSTRAINT event_onboarding_range CHECK ("onboardingOpensAt" < "onboardingClosesAt");
ALTER TABLE "CompanyEventRegistration" ADD CONSTRAINT registration_limit_positive CHECK ("personnelLimit" > 0);
ALTER TABLE "VehiclePassRequest" ADD CONSTRAINT vehicle_request_shape CHECK (
  ("required" AND "requestedQuantity" > 0 AND "justification" IS NOT NULL AND length(btrim("justification")) > 0)
  OR (NOT "required" AND "requestedQuantity" = 0 AND "justification" IS NULL)
), ADD CONSTRAINT vehicle_approval_shape CHECK (
  ("approvedQuantity" IS NULL AND "decidedAt" IS NULL AND "decidedByUserId" IS NULL)
  OR ("approvedQuantity" >= 0 AND "decidedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL)
);
ALTER TABLE "OutboxMessage" ADD CONSTRAINT outbox_attempts_nonnegative CHECK ("attempts" >= 0),
 ADD CONSTRAINT outbox_lease_pair CHECK (("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL));
CREATE INDEX outbox_pending_available ON "OutboxMessage" ("availableAt", "id") WHERE "processedAt" IS NULL;
ALTER TABLE "AuditEvent" ADD CONSTRAINT audit_actor_shape CHECK (
 ("actorType" IN ('ADMIN','COMPANY_LEADER') AND "actorUserId" IS NOT NULL)
 OR ("actorType" IN ('EMPLOYEE_LINK','SYSTEM') AND "actorUserId" IS NULL)
);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'AUDIT_APPEND_ONLY';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "AuditEvent"
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

ALTER TABLE "Company" ADD CONSTRAINT "Company_version_positive" CHECK ("version" > 0);

ALTER TABLE "Event" ADD CONSTRAINT "Event_version_positive" CHECK ("version" > 0);

ALTER TABLE "Zone" ADD CONSTRAINT "Zone_version_positive" CHECK ("version" > 0);

ALTER TABLE "JobRole" ADD CONSTRAINT "JobRole_version_positive" CHECK ("version" > 0);

ALTER TABLE "CompanyEventRegistration" ADD CONSTRAINT "CompanyEventRegistration_version_positive" CHECK ("version" > 0);

ALTER TABLE "VehiclePassRequest" ADD CONSTRAINT "VehiclePassRequest_version_positive" CHECK ("version" > 0);

