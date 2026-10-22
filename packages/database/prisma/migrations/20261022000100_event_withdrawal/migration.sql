BEGIN;
-- Additive: keep all existing rows, photos, submissions and acknowledgements.
ALTER TABLE "CompanyEventRegistration" ADD COLUMN "withdrawnAt" TIMESTAMPTZ(3);
-- Withdrawn registrations cannot regain active approval through an older action.
ALTER TABLE "CompanyEventRegistration" ADD CONSTRAINT "withdrawn_registration_is_closed"
CHECK ("withdrawnAt" IS NULL OR "status" = 'REJECTED');
COMMIT;
