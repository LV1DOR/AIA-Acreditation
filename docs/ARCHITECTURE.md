# Architecture

One modular monolith, one authoritative PostgreSQL database, two runtime processes.

apps/web owns transport/presentation. apps/worker is currently a validated runtime/health shell.
packages/domain owns authorisation, invariants and transaction boundaries.
packages/database owns schema, migrations and Prisma client construction.
packages/config owns environment validation and allowlisted logging.
packages/email exposes EmailTransport and the working SMTP adapter.

Thin server adapters construct ActorContext from verified Clerk sessions. They must never deserialize actor identity from a mutation body. Domain services re-read database role/disabled status and memberships inside each transaction.
No authentication entry point or public business mutation is exposed in Phase 1.

Critical mutations use serializable transactions with bounded retry on serialization conflicts. Expected versions detect stale edits. Side effects inside retry callbacks are DB-only.
Each business mutation appends audit and durable outbox metadata. Admin registration changes notify the responsible leader in the same transaction.
Outbox messages remain pending until consumers exist; the current worker does not falsely mark them delivered.

Dates use PostgreSQL DATE and validated YYYY-MM-DD boundaries; timestamps use timestamptz.
CompanyZoneRequest uses composite foreign keys to bind the selected zone and registration to the same event.
Primary leader memberships must belong to the registration's company.
Catalogue entries are deactivated instead of deleted.

Later modules retain their approved boundaries: personnel, submissions, requests, QR, export orchestration and retention. No reusable employee roster.
Submission content will be immutable; review outcomes will be separate records.
Export mappings will live in packages/exports, separate from domain snapshots and batching.

Stable Prisma 7.10.0 is pinned. Its generated client uses a custom output and the PostgreSQL driver adapter.
References: https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators and https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7 .
