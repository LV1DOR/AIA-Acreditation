# Deployment

Only local development is configured and authorised.
No SSH connection, production migration, VPS refactor, GHCR publication or deployment has occurred.

Local Compose project: aia-acreditacao-local.
Services: PostgreSQL 17, Redis 7, Mailpit and private MinIO, bound to loopback ports. ClamAV is an optional Compose profile for local malware-scanning verification.
Their volumes are separate from other AIA projects. Stop with pnpm infra:stop; do not use volume deletion as routine shutdown.

Web and worker validate environment. Web liveness checks process availability. Web readiness fails with HTTP 503 until all four Clerk/bridge values are valid, then checks PostgreSQL with bounded connection/query timeouts. This intentionally prevents an authentication-less portal from appearing deployable. Worker readiness checks PostgreSQL; the worker validates its environment before listening.
Web readiness now checks authentication configuration, PostgreSQL and the private photo bucket. A missing/invalid storage configuration or unreachable MinIO returns HTTP 503 without exposing connection details. Redis is required by public worker rate limiting; a Redis failure closes those routes rather than bypassing the limit. Add a dedicated Redis readiness signal before production deployment.
The current worker consumes only encrypted `AUTH_EMAIL` and `LEADER_INVITATION_EMAIL` messages. It does not consume or acknowledge business invalidation messages.

Production remains manual and requires explicit authorisation.
Before deployment inspect the actual Volunteers stack, select safe shared dependencies, create separate DB/role and MinIO buckets/credentials, separate Redis prefixes and use the existing proxy.
Do not refactor Volunteers merely to match a preferred directory layout.
Do not expose database/cache/object-storage ports publicly.
Use immutable images and reviewed migrations. Add CI/GHCR release workflows with deployment work, not automatic production updates.
Backups are not proven until off-site restore is tested.

## Authentication deployment gate

Follow [AUTH-SETUP.md](AUTH-SETUP.md) for the Clerk development-instance setup and live validation. A deployment candidate is not authentication-ready unless `corepack pnpm test:e2e:clerk` passes against the intended Clerk instance and an isolated test database. Development keys, webhook signing secrets, the email encryption key and SMTP credentials stay in uncommitted environment storage.

Leader account creation uses Clerk's Backend Invitations API only after a valid AIA invitation has been opened. Keep Clerk Access mode set to Invite-only, monitor the provider invitation rate limit, and do not enable a generic public sign-up route. Clerk invitation creation uses `notify: false`; the existing encrypted SMTP outbox remains the only platform invitation email.

Production requires a separate Clerk production instance/domain configuration, production keys, an HTTPS webhook endpoint, verified sender DNS, individually verified admin accounts mapped through the controlled bootstrap, and repeated live Playwright/webhook/SMTP evidence. None of that has been configured or verified, and no production action is authorised.

## Worker-onboarding deployment gate

Follow [PHASE-4-OPERATIONS.md](PHASE-4-OPERATIONS.md) for local operation. Production requires separate random document-encryption and fingerprint keys, a dedicated private MinIO bucket/credential, a decision on ClamAV operation, backup/restore evidence that includes photos and encrypted document data, approved privacy wording/versioning, and retention instructions. The current `TODO-v1` privacy marker is deliberately not production-acceptable.

The browser crop workflow currently accepts JPEG, PNG and WebP sources up to 150 MiB and emits a 1200x1200 JPEG before upload. Any reverse proxy must support the chosen request ceiling. Server-side Sharp validation, pixel limits, metadata stripping and optional malware scanning remain mandatory and must not be replaced by the browser crop.

Phase 6 adds no new external service. Apply all Prisma migrations before starting the web and worker processes. Request notifications are currently in-app records; workflow email and realtime delivery are Phase 7 and must not be advertised as active. This remains a local implementation, not evidence of production readiness or deployment.

## Final-submission deployment gate

Apply all Phase 5 migrations, including the submission-photo-adjustment migration, before enabling final submission. The runtime must retain the same protected document-encryption key for the lifetime of encrypted submission snapshots; losing or rotating it without a migration makes historical snapshots unreadable. Backups must include submission rows, append-only review and photo-adjustment rows, and every referenced private derivative object. Restore evidence must demonstrate that an authorised administrator can decrypt and review an older version and retrieve its selected photo framing. Production remains blocked by the unresolved retention policy and all earlier deployment gates.
