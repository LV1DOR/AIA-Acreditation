-- PostgreSQL CHECK accepts NULL; require an explicit non-null approved quantity.
ALTER TABLE "VehiclePassRequest" DROP CONSTRAINT vehicle_approval_shape;
ALTER TABLE "VehiclePassRequest" ADD CONSTRAINT vehicle_approval_shape CHECK (
  ("approvedQuantity" IS NULL AND "decidedAt" IS NULL AND "decidedByUserId" IS NULL)
  OR ("approvedQuantity" IS NOT NULL AND "approvedQuantity" >= 0
      AND "decidedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL)
);
