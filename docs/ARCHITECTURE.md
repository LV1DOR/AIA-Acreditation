# Architecture

One modular monolith, one authoritative PostgreSQL database, two runtime processes.

apps/web owns transport/presentation. apps/worker owns health endpoints and encrypted SMTP delivery for Clerk authentication and leader-invitation email outbox messages.
packages/domain owns authorisation, invariants and transaction boundaries.
packages/database owns schema, migrations and Prisma client construction.
packages/config owns environment validation and allowlisted logging.
packages/email exposes EmailTransport and the working SMTP adapter.
packages/storage owns the S3-compatible private object adapter, image sanitation and optional ClamAV stream scan. packages/config validates storage endpoints and distinct document-protection keys.

Thin server adapters construct ActorContext from verified Clerk sessions. They must never deserialize actor identity from a mutation body. Domain services re-read database role/disabled status and memberships inside each transaction.
Server Actions authenticate again at the mutation boundary and pass only the verified Clerk identity and a generated correlation ID into domain services.

Phase 3 setup is deliberately split by authority. Administrators manage events, global zones and job roles, event-zone activation, companies, event registrations, personnel limits and invitations. Company leaders can read and configure only registrations belonging to an active PostgreSQL membership. Their zone selection is company-wide and their vehicle request stores only required/quantity/justification.

Phase 4 worker mutations remain in the domain package. The public onboarding page receives only a random one-time token and never constructs an actor. Leader actions construct identity only from Clerk, then the domain re-resolves membership. Leader queries decrypt the full document number only after company membership scope succeeds and discard all encrypted fields and duplicate fingerprints from the returned projection. The browser cropper creates the intended square framing, while the web storage adapter remains authoritative for sanitisation before writing a deterministic private key to MinIO; authorised retrieval is proxied through a no-store route.

Phase 5 keeps `CompanyEventRegistration` as the mutable workspace and creates a new `CompanySubmission` for every leader submission. The snapshot payload is canonicalised, hashed and AES-256-GCM encrypted; the submission identity is authenticated data. Snapshot and review rows are immutable at the database layer. Review decisions are separate append-only `CompanySubmissionReview` records. Registration status remains the fast current-state projection and changes only through serializable submission/review services with expected-version checks.

AIA photo reframing during review is represented by a `SubmissionPhotoAdjustment` derivative rather than a mutation of either the participant source photo or encrypted snapshot. The derivative is private, submission-scoped, append-only and audit-coupled. This preserves the submitted evidence while allowing AIA to prepare a suitable square badge image.

The administrator UI exposes an event only as draft or published/live. The domain derives the operational onboarding, active and completed phases from the event schedule. Catalogue sort order remains an internal presentation concern and is not a capacity control.

Critical mutations use serializable transactions with bounded retry on serialization conflicts. Expected versions detect stale edits. Side effects inside retry callbacks are DB-only.
Each business mutation appends audit and durable outbox metadata. Admin registration changes notify the responsible leader in the same transaction.
Business invalidation outbox messages remain pending until consumers exist. Encrypted email messages are leased, retried with bounded backoff, delivered through SMTP and scrubbed after successful or terminal processing.

Dates use PostgreSQL DATE and validated YYYY-MM-DD boundaries; timestamps use timestamptz.
CompanyZoneRequest uses composite foreign keys to bind the selected zone and registration to the same event.
Primary leader memberships must belong to the registration's company.
Catalogue entries are deactivated instead of deleted.

Later modules retain their approved boundaries: requests, QR, export orchestration and retention. No reusable employee roster.
Submission content is immutable; review outcomes are separate records.
Export mappings will live in packages/exports, separate from domain snapshots and batching.

Stable Prisma 7.10.0 is pinned. Its generated client uses a custom output and the PostgreSQL driver adapter.
References: https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators and https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7 .
