# AIA Acreditação

Local Phase 0 + Phase 1 foundation and Phase 2 authentication implementation for event-specific external personnel accreditation.

Source of truth: [engineering handoff](AIA_ACREDITACAO_CODEX_HANDOFF_v2.md).
**Approved amendment, 21 September 2026:** SMTP is the current email transport. Resend replaces SMTP after domain purchase and verification. Postmark references in the original handoff are superseded. The handoff is preserved as supplied.

## Implemented

- pnpm modular monolith: Next.js web, worker runtime, database/domain/config/email packages.
- PostgreSQL/Prisma foundation: internal identities, memberships, companies, events, catalogues, event registrations, company-wide zones, vehicle requests, append-oriented audit, notifications and outbox.
- Server domain services with database authorisation, strict inputs, optimistic concurrency and serializable transactions.
- Registration transition/edit policy tests. Persisted submission transitions are intentionally not exposed until immutable submission snapshots exist.
- SMTP adapter with local Mailpit verification. Business email templates and outbox consumption are later work.
- Local migration, integrity, authorisation, concurrency, rollback and SMTP integration tests.
- Web and worker liveness/readiness endpoints.
- PT/EN Clerk sign-in/sign-up routes, fail-closed configuration and PostgreSQL-backed portal authorization.
- Hashed, one-time, expiry-bound and verified-email-matched leader invitations. Company membership can only be assigned by invitation consumption or an authorised admin domain operation.
- Signed and size-bounded Clerk `email.created` webhook bridge. Authentication email payloads remain encrypted in the outbox until the worker sends them through SMTP.
- Playwright coverage for the no-Clerk state plus a live Clerk suite for unauthenticated access, mapped admin access, leader access, invitation states and company isolation.

The admin and company-leader portal shells are read-only until Phase 3. Phase 2 is not complete until the external Clerk development instance and live test evidence listed in [docs/AUTH-SETUP.md](docs/AUTH-SETUP.md) exist.
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

PostgreSQL: 127.0.0.1:16432; Redis: 127.0.0.1:16379; SMTP: 127.0.0.1:11025.
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
Both migrations must be applied to both local databases.
`test:e2e` always checks that the app is visibly unavailable without Clerk. After following `docs/AUTH-SETUP.md`, run `corepack pnpm test:e2e:clerk`; it intentionally fails if the required live configuration is missing.

For compiled runtime checks:

```powershell
corepack pnpm --filter @aia/web start
# Separate terminal:
corepack pnpm --filter @aia/worker start
```

Use infra:stop to stop only this project's dependencies without deleting volumes.

## Next milestones

Complete Phase 2 live Clerk configuration and verification. Only after that gate passes: Phase 3 operational company/event setup UI. Phase 4 onward: onboarding, immutable submission review, requests, outbox delivery/realtime, QR foundation and complete provisional exports.
See docs/OPEN-QUESTIONS.md before implementing unresolved behaviour.
