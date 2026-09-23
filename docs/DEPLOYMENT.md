# Deployment

Only local development is configured and authorised.
No SSH connection, production migration, VPS refactor, GHCR publication or deployment has occurred.

Local Compose project: aia-acreditacao-local.
Services: PostgreSQL 17, Redis 7 and Mailpit, bound to loopback ports.
Their volumes are separate from other AIA projects. Stop with pnpm infra:stop; do not use volume deletion as routine shutdown.

Web and worker validate environment. Web liveness checks process availability. Web readiness fails with HTTP 503 until all four Clerk/bridge values are valid, then checks PostgreSQL with bounded connection/query timeouts. This intentionally prevents an authentication-less portal from appearing deployable. Worker readiness checks PostgreSQL; the worker validates its environment before listening.
Redis/MinIO/email readiness checks must be added when those runtime consumers become required; their existence in the handoff does not mean they are integrated today.
The current worker hosts health endpoints but does not consume or acknowledge outbox jobs.

Production remains manual and requires explicit authorisation.
Before deployment inspect the actual Volunteers stack, select safe shared dependencies, create separate DB/role and MinIO buckets/credentials, separate Redis prefixes and use the existing proxy.
Do not refactor Volunteers merely to match a preferred directory layout.
Do not expose database/cache/object-storage ports publicly.
Use immutable images and reviewed migrations. Add CI/GHCR release workflows with deployment work, not automatic production updates.
Backups are not proven until off-site restore is tested.

## Authentication deployment gate

Follow [AUTH-SETUP.md](AUTH-SETUP.md) for the Clerk development-instance setup and live validation. A deployment candidate is not authentication-ready unless `corepack pnpm test:e2e:clerk` passes against the intended Clerk instance and an isolated test database. Development keys, webhook signing secrets, the email encryption key and SMTP credentials stay in uncommitted environment storage.

Production requires a separate Clerk production instance/domain configuration, production keys, an HTTPS webhook endpoint, verified sender DNS, individually verified admin accounts mapped through the controlled bootstrap, and repeated live Playwright/webhook/SMTP evidence. None of that has been configured or verified, and no production action is authorised.
