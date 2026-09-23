# AIA Acreditação

Local Phase 0-4 implementation for event-specific external personnel accreditation.

Source of truth: [engineering handoff](AIA_ACREDITACAO_CODEX_HANDOFF_v2.md).
**Approved amendment, 21 September 2026:** SMTP is the current email transport. Resend replaces SMTP after domain purchase and verification. Postmark references in the original handoff are superseded. The handoff is preserved as supplied.

Local operator sequences: [Phase 3 setup](docs/PHASE-3-OPERATIONS.md) and [Phase 4 worker onboarding](docs/PHASE-4-OPERATIONS.md). Authentication and invitation-provider setup: [Clerk setup](docs/AUTH-SETUP.md).

## Implemented

- pnpm modular monolith: Next.js web, worker runtime, database/domain/config/email packages.
- PostgreSQL/Prisma foundation: internal identities, memberships, companies, events, catalogues, event registrations, company-wide zones, vehicle requests, append-oriented audit, notifications and outbox.
- Server domain services with database authorisation, strict inputs, optimistic concurrency and serializable transactions.
- Registration transition/edit policy tests. Persisted submission transitions are intentionally not exposed until immutable submission snapshots exist.
- SMTP adapter with local Mailpit verification and encrypted outbox delivery for Clerk authentication and leader-invitation emails.
- Local migration, integrity, authorisation, concurrency, rollback and SMTP integration tests.
- Web and worker liveness/readiness endpoints.
- PT/EN Clerk sign-in/sign-up routes, fail-closed configuration and PostgreSQL-backed portal authorization.
- Hashed, one-time, expiry-bound and verified-email-matched leader invitations. Company membership can only be assigned by invitation consumption or an authorised admin domain operation.
- Invite-only leader account creation: direct sign-up is unavailable, and Clerk renders account creation only after a valid AIA invitation creates a non-emailing Clerk ticket.
- Signed and size-bounded Clerk `email.created` webhook bridge. Authentication email payloads remain encrypted in the outbox until the worker sends them through SMTP.
- Playwright coverage for the no-Clerk state plus a live Clerk suite for unauthenticated access, mapped admin access, leader access, invitation states and company isolation.
- Admin setup for event/company CRUD, global zones/job roles, event-zone activation, event registrations, personnel limits and leader invitation/revocation.
- Company-leader registration setup for company-wide zones and vehicle-pass requests without plate, driver or vehicle identity data.
- Event-specific worker slots, direct leader entry and random one-time employee onboarding links with mobile PT/EN forms.
- Full-event document-expiry validation, E.164 phone storage, ISO nationality selection, individual work days, encrypted document numbers and event-scoped duplicate review.
- Mandatory sanitised photos in private local MinIO, optional ClamAV scanning, versioned privacy acknowledgement and explicit leader approval.

Phase 2 live Clerk evidence is complete locally. Phase 3 and Phase 4 remain local-only and are not production readiness evidence. Final privacy wording is still required before real worker onboarding.
No production infrastructure has been configured or deployed.

## Local setup (PowerShell)

Requirements: Node 22.13+ (tested with 22.17), Corepack, Docker Desktop.
Run from this repository root.

```powershell
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
corepack pnpm infra:up
corepack pnpm db:generate
corepack pnpm db:migrate
```

Do not overwrite an existing configured .env. The supplied values are for isolated loopback development only.

Start web and worker in separate terminals:

```powershell
corepack pnpm dev
corepack pnpm dev:worker
```

Web: http://127.0.0.1:3100  
Mailpit: http://127.0.0.1:18025  
Worker health: http://127.0.0.1:3102/api/health/ready

PostgreSQL: 127.0.0.1:16432; Redis: 127.0.0.1:16379; SMTP: 127.0.0.1:11025; MinIO API/console: 127.0.0.1:19000 / 127.0.0.1:19001.
Local Compose uses only its own project and volumes. MinIO is introduced with photo/export storage; no shared production credentials are used.

## Validation

```powershell
corepack pnpm check
corepack pnpm build
```

Prepare the integration database once (if it already exists, skip createdb):

```powershell
docker compose -f infra/local/compose.yaml exec -T postgres createdb -U acreditacao_local aia_acreditacao_test
$env:DATABASE_URL = 'postgresql://acreditacao_local:local_only_password@127.0.0.1:16432/aia_acreditacao_test'
corepack pnpm db:migrate
Remove-Item Env:DATABASE_URL
corepack pnpm test:integration
corepack pnpm test:e2e
```

Tests refuse non-loopback databases or any database name except aia_acreditacao_test.
They insert synthetic, uniquely identified fixtures, retaining audit rows rather than deleting audit history. SMTP integration sends only synthetic messages to local Mailpit.
All migrations must be applied to both local databases.
`test:e2e` always checks that the app is visibly unavailable without Clerk. After following `docs/AUTH-SETUP.md`, run `corepack pnpm test:e2e:clerk`; it intentionally fails if the required live configuration is missing.

For compiled runtime checks:

```powershell
corepack pnpm --filter @aia/web start
# Separate terminal:
corepack pnpm --filter @aia/worker start
```

Use infra:stop to stop only this project's dependencies without deleting volumes.

## Next milestones

Phase 5 adds immutable company-submission snapshots, locking and the AIA approve/return/reject workflow. Later phases add requests, realtime business outbox processing, QR and provisional exports.
See docs/OPEN-QUESTIONS.md before implementing unresolved behaviour.
