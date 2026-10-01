-- Historical vehicle requests have no reliable request timestamp. Leave them null.
ALTER TABLE "VehiclePassRequest" ADD COLUMN "requestedAt" TIMESTAMPTZ(3);
