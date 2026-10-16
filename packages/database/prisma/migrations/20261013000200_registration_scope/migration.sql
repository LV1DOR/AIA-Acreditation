-- Preserve the company/event assignment model for already registered personnel.
-- Association changes must use a new registration, never move existing evidence.
CREATE FUNCTION aia_immutable_registration_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."companyId" IS DISTINCT FROM OLD."companyId" OR NEW."eventId" IS DISTINCT FROM OLD."eventId" THEN
    RAISE EXCEPTION 'REGISTRATION_SCOPE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aia_registration_scope BEFORE UPDATE ON "CompanyEventRegistration"
FOR EACH ROW EXECUTE FUNCTION aia_immutable_registration_scope();
