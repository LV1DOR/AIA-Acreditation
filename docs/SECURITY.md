# Security

There is no unauthenticated development admin shortcut. Clerk sessions are verified by the current Next.js SDK middleware, while every protected page and domain query enforces access again next to the resource.
Role and membership authority lives in PostgreSQL. Client-supplied identity or role claims must never become ActorContext.
Runtime environment errors are generic, with no original values. Logs accept fixed codes and UUID context only; request bodies, URLs, raw errors and PII are not passed through.

The portal fails closed when any required Clerk value is missing or malformed. Liveness remains available, but web readiness returns HTTP 503 with only the unavailable dependency name. Admin access requires an individually verified Clerk account mapped to the PostgreSQL `ADMIN` role by the controlled bootstrap command. MFA is not required because it is unavailable on the selected Clerk plan. Company leaders receive no role or company membership from Clerk metadata or public sign-up. PostgreSQL membership is created only by consuming an AIA-issued invitation.

Leader invitation tokens contain 256 random bits, are stored only as SHA-256 hashes, expire, may be revoked and are consumed once using a serializable transaction. Acceptance requires a verified Clerk email matching the normalized invited address. Raw tokens are removed from the URL into a Secure/HttpOnly/SameSite cookie, are never written to audit metadata, and invalid/expired/revoked/used invitations share one public response.

The public Clerk webhook endpoint accepts at most 1,000,000 bytes and calls Clerk's `verifyWebhook()` before using any event data. Only undelivered `email.created` events are accepted into the outbox. Recipient and message bodies are encrypted with AES-256-GCM until the worker sends them through the SMTP adapter; successful and terminally failed payloads are scrubbed. Webhook retries are deduplicated by a hash of the Clerk email event ID.

Audit metadata is schema-validated and allowlisted. Free-form vehicle justification lives in the business row, not audit/log metadata.
Outbox invalidations contain entity IDs and versions only.
Current append-only audit triggers prevent ordinary UPDATE/DELETE, not database-owner tampering. Production needs separate migration/runtime roles and restricted grants.

SMTP credentials are environment-only. Remote SMTP requires TLS (implicit or STARTTLS), certificate verification is not disabled, and Nodemailer logging/file/URL access are disabled.
Email transport errors discard provider text. Real messages and recipients must not enter test fixtures.
Stable Message-ID is useful for correlation but SMTP does not guarantee exactly-once delivery. Future delivery/outbox processing must explicitly handle the crash-after-acceptance ambiguity.

Before worker onboarding: separate encryption/HMAC keys, AES-GCM authenticated encryption, random token/hash storage, no token URL telemetry, rate limits, private processed photos, size/decode checks and EXIF removal.
Before snapshots/exports: encrypt sensitive snapshots, version referenced photo objects, authorised decryption and short-lived private downloads.
Before destructive retention: approved purpose/timing, all PII copies tracked and legal holds checked.
Before production: live Clerk production-instance verification, TLS/CSP, dedicated DB role and storage credentials, restricted networks, off-site encrypted backup and restore evidence.

No production secret is included. .env.example contains only explicit local development credentials.

Prisma CLI is a development dependency. The lockfile overrides its transitive deepmerge-ts to 8.0.2 and mysql2 to 3.24.4 to address reported advisories; this app uses PostgreSQL, not MySQL. Reassess these overrides when updating stable Prisma. Validate/generate/migrate and the full suite must pass with these resolutions.
