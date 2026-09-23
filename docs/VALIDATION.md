# Foundation through local Phase 3 validation — 23 September 2026

Validated locally on Windows with Node 22.17.0, pnpm 10.14.0 and the isolated aia-acreditacao-local Docker project.

- Prisma schema validation and client generation passed.
- Both migration files applied successfully to local development and dedicated test PostgreSQL databases.
- ESLint and strict TypeScript checks passed, including test source typechecks.
- Vitest: 38 unit tests and 26 integration tests passed after the user-approved removal of the paid Clerk MFA requirement.
- Real PostgreSQL integration covers foreign keys/checks, authorisation, disabled users, revoked memberships, deadline/state locks, audited override, catalogue setup, stale concurrent writes and atomic rollback.
- SMTP transport delivered synthetic bilingual messages to local Mailpit. Search assertions match the unique test subject, not the inbox-wide total.
- Next.js production build and bundled worker build passed; both compiled runtimes started locally.
- The isolated missing-configuration Playwright project confirms the portal is visibly unavailable, web liveness returns HTTP 200 and web readiness correctly returns HTTP 503 for the authentication dependency.
- A synthetic Clerk Standard Webhooks request verifies a valid signature, rejects a modified signature, rejects a declared body over 1,000,000 bytes, deduplicates delivery, and stores no plaintext recipient/code in the outbox payload.
- All 11 Playwright tests passed. The nine live browser scenarios cover unauthenticated access, mapped admin access, Phase 3 admin setup, leader portal access, leader zone/vehicle configuration, direct registration isolation, one-time invitation acceptance and expired/revoked invitations; the other projects cover Clerk setup and missing configuration.
- The Phase 3 browser setup scenario verifies that opening a second compact MUI X picker closes the first, date-only calendars are fully rendered in a portal, only Draft/Published options are exposed, and catalogue order controls are absent before exercising an administrator mutation.
- Phase 3 integration coverage verifies event/company updates, personnel-limit changes, catalogue reorder/deactivation, event-zone activation/reactivation and in-use protection, company-wide zone replacement, vehicle requests, optimistic concurrency and encrypted leader-invitation delivery.
- Clerk Dashboard successfully delivered a signed `email.created` example to the public route. Because Clerk marked that example as already delivered, the route correctly returned success without duplicating it. A separate signed undelivered example traversed the same public route, was encrypted at rest, delivered by the worker to Mailpit and scrubbed after processing.
- The first individually authorised verified-email Clerk administrator was mapped by the guarded bootstrap command, and the `ADMIN_BOOTSTRAPPED` system audit event was verified.
- Dependency audit reported no known vulnerabilities after the documented transitive overrides.
- Next.js was updated from 16.3.5 to 16.3.6. A traced Clerk browser run confirmed that the prior `pg` concurrent-query deprecation and account-control hydration mismatch no longer occur; portal reads now avoid interactive transactions while all state-changing workflows retain serializable transactions.
- One full development-server browser run emitted Next.js 16.3.x's known `MaxListenersExceededWarning` for a Gzip stream after repeated requests. It caused no failed request, does not originate in the application event code, and did not appear in the production build or compiled-runtime health checks. Keep it under review when upgrading Next.js.

The PT/EN portals, authentication boundaries and Phase 3 setup workflows are implemented, and live Clerk development-instance browser coverage passes.
The worker consumes encrypted `AUTH_EMAIL` and `LEADER_INVITATION_EMAIL` outbox messages. Business invalidation handlers, personnel onboarding, snapshots/reviews, request execution, QR and provisional export generation remain later milestones.
No production services, VPS infrastructure, real recipient email or real personnel data were used.
