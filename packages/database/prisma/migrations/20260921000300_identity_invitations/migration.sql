-- CreateTable
CREATE TABLE "LeaderInvitation" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" UUID NOT NULL,
    "acceptedByUserId" UUID,

    CONSTRAINT "LeaderInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaderInvitation_tokenHash_key" ON "LeaderInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "LeaderInvitation_registrationId_createdAt_idx" ON "LeaderInvitation"("registrationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_fingerprint_key" ON "AuthSession"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEventRegistration_id_companyId_key" ON "CompanyEventRegistration"("id", "companyId");

-- AddForeignKey
ALTER TABLE "LeaderInvitation" ADD CONSTRAINT "LeaderInvitation_registrationId_companyId_fkey" FOREIGN KEY ("registrationId", "companyId") REFERENCES "CompanyEventRegistration"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderInvitation" ADD CONSTRAINT "LeaderInvitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderInvitation" ADD CONSTRAINT "LeaderInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaderInvitation" ADD CONSTRAINT invitation_lifetime CHECK ("expiresAt" > "createdAt"),
 ADD CONSTRAINT invitation_consumption CHECK (("usedAt" IS NULL) = ("acceptedByUserId" IS NULL)),
 ADD CONSTRAINT invitation_exclusive_terminal CHECK (NOT ("usedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));

