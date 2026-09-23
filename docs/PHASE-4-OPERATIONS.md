# Phase 4 local operations

Phase 4 is a local worker-onboarding implementation. It is not production authorisation.

## Start the dependencies

```powershell
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm dev
```

MinIO uses `http://127.0.0.1:19000` for its API and `http://127.0.0.1:19001` for its local console. The bucket is created by the application on readiness or first photo upload. Objects remain private and are retrieved only through the authenticated application endpoint.

The ignored `.env` needs the MinIO values shown in `.env.example` plus two independently generated 32-byte hex keys:

```powershell
node -e "const c=require('node:crypto'); console.log(c.randomBytes(32).toString('hex')); console.log(c.randomBytes(32).toString('hex'))"
```

Store the first as `DOCUMENT_ENCRYPTION_KEY` and the second as `DOCUMENT_FINGERPRINT_KEY`. Do not commit, reuse, or casually rotate these keys. Losing the encryption key makes stored document numbers unrecoverable; changing the fingerprint key breaks duplicate comparison with existing records.

## Operator flow

1. AIA publishes an event, creates its job roles/company registration and sets the personnel limit.
2. The company leader opens the registration and adds one person slot.
3. The leader either enters the data directly or generates an individual link and shares it outside the platform.
4. The person completes the link once, including photo, work days and acknowledgement. No Clerk account is used.
5. The leader reviews the returned record and explicitly approves it.
6. A same-event document match is held for AIA review. The leader sees no other-company details; AIA may auditably mark it reviewed.

Generated links are shown once to the leader, are not emailed by this platform, expire no later than onboarding close, and become unavailable after use or revocation.

## Optional ClamAV

Start the local profile and enable it in the ignored `.env`:

```powershell
docker compose -f infra/local/compose.yaml --profile malware-scan up -d clamav
```

Set `CLAMAV_HOST=127.0.0.1` and keep `CLAMAV_PORT=13310`, then restart the web process. When configured, scanner failure or malware detection rejects the photo; scanning is never silently bypassed.

## Local validation

```powershell
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e:clerk
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --audit-level=high
```

The live Clerk Playwright run uses only the isolated local test database and synthetic data. Do not point it at production.

## Production blockers

- AIA-approved bilingual privacy notice text and its real version identifier; `TODO-v1` is not acceptable.
- Dedicated production MinIO credentials/bucket and restricted networking.
- Production document keys in secret storage, with recovery/rotation procedure.
- Photo/database backup and restore evidence plus approved retention instructions.
- A decision whether ClamAV is mandatory and how scanner availability is monitored.
- All Phase 2 production Clerk/domain/SMTP gates.
