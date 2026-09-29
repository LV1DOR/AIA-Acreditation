# ADR 0003: Transactional outbox
Accepted.
Store audit, notification and durable side-effect intent in the same PostgreSQL transaction as a workflow mutation.
Redis is not business truth. Serializable retries must never invoke external APIs.
Phase 7 consumers lease encrypted authentication emails, privacy-minimised business emails and domain invalidations with bounded retries and deterministic deduplication. Email attempts are tracked separately from the durable intent. Redis publication contains no stored entity identifiers and only triggers authorised refetch.
SMTP delivery is at-least-once in ambiguous failure cases; do not claim exactly-once.
