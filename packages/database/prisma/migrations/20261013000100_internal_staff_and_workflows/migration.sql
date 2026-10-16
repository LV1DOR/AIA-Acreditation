-- CreateEnum
CREATE TYPE "InternalOrganisation" AS ENUM ('AIA', 'PARKALGAR');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "internalOrganisation" "InternalOrganisation";

-- AlterTable
ALTER TABLE "CompanyLeaderMembership" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "EventParticipant" ADD COLUMN     "editRequestId" UUID,
ADD COLUMN     "internalReference" VARCHAR(100),
ADD COLUMN     "photoReference" VARCHAR(200);

-- AlterTable
ALTER TABLE "CompanyRequest" ADD COLUMN     "effectBasePhotoKey" TEXT,
ADD COLUMN     "effectBaseVersion" INTEGER;

-- CreateTable
CREATE TABLE "ParticipantZoneRequest" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,

    CONSTRAINT "ParticipantZoneRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalImportBatch" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "fileHash" CHAR(64) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParticipantZoneRequest_eventId_zoneId_idx" ON "ParticipantZoneRequest"("eventId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipantZoneRequest_participantId_zoneId_key" ON "ParticipantZoneRequest"("participantId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalImportBatch_registrationId_fileHash_key" ON "InternalImportBatch"("registrationId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "Company_internalOrganisation_key" ON "Company"("internalOrganisation");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_id_eventId_key" ON "EventParticipant"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_registrationId_internalReference_key" ON "EventParticipant"("registrationId", "internalReference");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRequest_id_registrationId_key" ON "CompanyRequest"("id", "registrationId");

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_editRequestId_registrationId_fkey" FOREIGN KEY ("editRequestId", "registrationId") REFERENCES "CompanyRequest"("id", "registrationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantZoneRequest" ADD CONSTRAINT "ParticipantZoneRequest_participantId_eventId_fkey" FOREIGN KEY ("participantId", "eventId") REFERENCES "EventParticipant"("id", "eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantZoneRequest" ADD CONSTRAINT "ParticipantZoneRequest_eventId_zoneId_fkey" FOREIGN KEY ("eventId", "zoneId") REFERENCES "EventZone"("eventId", "zoneId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalImportBatch" ADD CONSTRAINT "InternalImportBatch_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "CompanyEventRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Explicit organisation identity is immutable; never promote an external company by name.
CREATE FUNCTION aia_immutable_company_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."internalOrganisation" IS DISTINCT FROM OLD."internalOrganisation" THEN
    RAISE EXCEPTION 'COMPANY_KIND_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aia_company_kind BEFORE UPDATE ON "Company"
FOR EACH ROW EXECUTE FUNCTION aia_immutable_company_kind();

CREATE FUNCTION aia_zone_assignment_model() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "InternalOrganisation";
BEGIN
  IF TG_TABLE_NAME = 'ParticipantZoneRequest' THEN
    SELECT c."internalOrganisation" INTO kind FROM "Company" c
      JOIN "CompanyEventRegistration" r ON r."companyId" = c.id
      JOIN "EventParticipant" p ON p."registrationId" = r.id WHERE p.id = NEW."participantId";
    IF kind IS NULL THEN RAISE EXCEPTION 'INDIVIDUAL_ZONES_REQUIRE_INTERNAL_ORGANISATION'; END IF;
  ELSE
    SELECT c."internalOrganisation" INTO kind FROM "Company" c
      JOIN "CompanyEventRegistration" r ON r."companyId" = c.id WHERE r.id = NEW."registrationId";
    IF kind IS NOT NULL THEN RAISE EXCEPTION 'INTERNAL_COMPANY_ZONES_FORBIDDEN'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aia_individual_zone_model BEFORE INSERT OR UPDATE ON "ParticipantZoneRequest"
FOR EACH ROW EXECUTE FUNCTION aia_zone_assignment_model();
CREATE TRIGGER aia_company_zone_model BEFORE INSERT OR UPDATE ON "CompanyZoneRequest"
FOR EACH ROW EXECUTE FUNCTION aia_zone_assignment_model();

CREATE FUNCTION aia_immutable_participant_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."registrationId" IS DISTINCT FROM OLD."registrationId" OR NEW."eventId" IS DISTINCT FROM OLD."eventId" THEN
    RAISE EXCEPTION 'PARTICIPANT_SCOPE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aia_participant_scope BEFORE UPDATE ON "EventParticipant"
FOR EACH ROW EXECUTE FUNCTION aia_immutable_participant_scope();
