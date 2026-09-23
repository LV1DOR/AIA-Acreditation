# Foundation and local Phase 2 validation — 23 September 2026

Validated locally on Windows with Node 22.17.0, pnpm 10.14.0 and the isolated aia-acreditacao-local Docker project.

- Prisma schema validation and client generation passed.
- Both migration files applied successfully to local development and dedicated test PostgreSQL databases.
- ESLint and strict TypeScript checks passed, including test source typechecks.
- Vitest: 36 unit tests and 25 integration tests passed after the user-approved removal of the paid Clerk MFA requirement.
- Real PostgreSQL integration covers foreign keys/checks, authorisation, disabled users, revoked memberships, deadline/state locks, audited override, catalogue setup, stale concurrent writes and atomic rollback.
- SMTP transport delivered synthetic bilingual messages to local Mailpit. Search assertions match the unique test subject, not the inbox-wide total.
- Next.js production build and bundled worker build passed; both compiled runtimes started locally.
- The isolated missing-configuration Playwright project confirms the portal is visibly unavailable, web liveness returns HTTP 200 and web readiness correctly returns HTTP 503 for the authentication dependency.
- A synthetic Clerk Standard Webhooks request verifies a valid signature, rejects a modified signature, rejects a declared body over 1,000,000 bytes, deduplicates delivery, and stores no plaintext recipient/code in the outbox payload.
- All eight Playwright scenarios passed, covering missing configuration, unauthenticated access, mapped admin access, leader portal access, one-time invitation acceptance, expired/revoked invitations and company isolation.
- Clerk Dashboard successfully delivered a signed `email.created` example to the public route. Because Clerk marked that example as already delivered, the route correctly returned success without duplicating it. A separate signed undelivered example traversed the same public route, was encrypted at rest, delivered by the worker to Mailpit and scrubbed after processing.
- The first individually authorised verified-email Clerk administrator was mapped by the guarded bootstrap command, and the `ADMIN_BOOTSTRAPPED` system audit event was verified.
- Dependency audit reported no known vulnerabilities after the documented transitive overrides.

The PT/EN portal shells and authentication boundaries are implemented, and live Clerk development-instance browser coverage passes.
The worker consumes only `AUTH_EMAIL` outbox messages. Other business outbox handlers, personnel onboarding, snapshots/reviews, request execution, QR and provisional export generation remain later milestones.
No production services, VPS infrastructure, real recipient email or real personnel data were used.
