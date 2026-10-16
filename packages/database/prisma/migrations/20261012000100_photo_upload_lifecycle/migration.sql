CREATE TABLE "PhotoUpload" (
  "id" UUID NOT NULL,
  "objectKey" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "participantId" UUID NOT NULL,
  "participantVersion" INTEGER NOT NULL CHECK ("participantVersion" > 0),
  "submissionId" UUID,
  "status" TEXT NOT NULL DEFAULT 'STAGED' CHECK ("status" IN ('STAGED', 'ADOPTED', 'CLEANING', 'CLEANED')),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhotoUpload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PhotoUpload_objectKey_key" ON "PhotoUpload"("objectKey");
CREATE INDEX "PhotoUpload_status_expiresAt_idx" ON "PhotoUpload"("status", "expiresAt");
