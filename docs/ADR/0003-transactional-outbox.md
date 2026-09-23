# ADR 0003: Transactional outbox
Accepted.
Store audit, notification and durable side-effect intent in the same PostgreSQL transaction as a workflow mutation.
Redis is not business truth. Serializable retries must never invoke external APIs.
Phase 1 stores pending invalidation messages; consumers arrive with async/realtime work.
Later dispatch requires leases, retry-safe handlers, deduplication and recovery of pending work.
SMTP delivery is at-least-once in ambiguous failure cases; do not claim exactly-once.

