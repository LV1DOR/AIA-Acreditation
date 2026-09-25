# Phase 4 local operations

Phase 4 is a local worker-onboarding implementation. It is not production authorisation.

## Start the dependencies

```powershell
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm dev
```

MinIO uses `http://127.0.0.1:19000` for its API and `http://127.0.0.1:19001` for its local console. The bucket is created by the application on readiness or first photo upload. Objects remain private and are retrieved only through the authenticated application endpoint.

Photo source files may be at most 150 MiB. This is an ingestion ceiling, not the stored object size: accepted images are bounded to 30 million decoded pixels, orientation-corrected, resized to a maximum 1200-pixel edge, stripped of metadata and re-encoded as JPEG before private storage. Reverse proxies used in a later deployment must explicitly support the same request size or a smaller documented operator limit.

The ignored `.env` needs the MinIO values shown in `.env.example` plus two independently generated 32-byte hex keys:

```powershell
node -e "const c=require('node:crypto'); console.log(c.randomBytes(32).toString('hex')); console.log(c.randomBytes(32).toString('hex'))"
```

Store the first as `DOCUMENT_ENCRYPTION_KEY` and the second as `DOCUMENT_FINGERPRINT_KEY`. Do not commit, reuse, or casually rotate these keys. Losing the encryption key makes stored document numbers unrecoverable; changing the fingerprint key breaks duplicate comparison with existing records.

## Operator flow

1. AIA publishes an event, creates its job roles/company registration and sets the personnel limit.
2. The company leader opens the registration and selects **Add person / Adicionar pessoa**.
3. A single modal asks whether the leader will enter the data manually or create an individual one-time link. Link creation and copy-to-clipboard remain inside this modal; participant rows do not expose a second link-generation action.
4. The person completes the link once, including photo, work days and acknowledgement. No Clerk account is used.
5. The leader reviews the returned record and explicitly approves it from the **Team / Equipa** worker row.
6. A same-event document match is held for AIA review. The leader sees no other-company details; AIA may auditably mark it reviewed.

Generated links are shown once to the leader, are not emailed by this platform, expire no later than onboarding close, and become unavailable after use or revocation.
Creation of the worker slot and its invitation token is one serializable transaction. Capacity or deadline failure therefore creates neither record, and PostgreSQL stores only the token hash.

Registration configuration is editable only while the published event is inside its configured onboarding window and the registration is in Draft or Returned for correction. After the closing timestamp the leader screen explains that AIA must extend the event's onboarding close time, shows the configured deadline and disables the configuration and add-person actions. The domain deadline check remains authoritative even if a stale browser tries to submit the form.

## Optional ClamAV

Start the local profile and enable it in the ignored `.env`:

```powershell
docker compose -f infra/local/compose.yaml --profile malware-scan up -d clamav
```

Set `CLAMAV_HOST=127.0.0.1` and keep `CLAMAV_PORT=13310`, then restart the web process. When configured, scanner failure or malware detection rejects the photo; scanning is never silently bypassed.

For nonlocal deployments, ClamAV's `StreamMaxLength` must be configured to accept the chosen application upload ceiling. A smaller scanner limit intentionally causes the upload to fail closed rather than bypassing malware inspection.

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
