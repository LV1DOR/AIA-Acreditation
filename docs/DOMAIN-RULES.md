# Domain rules and implementation status

## Enforced through Phase 3

- Internal user must exist, be enabled and have a database role. Admin authority is granted only through the controlled verified-email bootstrap.
- Company leaders require active membership for the target company.
- Leader edits require a published, non-archived event, opening <= now < closing, and DRAFT or RETURNED_FOR_CORRECTION registration state. Event lifecycle phases are derived from its configured schedule instead of being selected manually.
- AIA_REVIEW, APPROVED and REJECTED block direct leader edits.
- Admin draft/correction changes after closure require explicit reason category and audit.
- Leader configuration inputs cannot change personnel limit, registration status, approval decision or primary leader. Personnel limits are changed only by an authorised admin mutation with optimistic concurrency.
- Default personnel limit is 10; database rejects nonpositive limits.
- Zones are registration-wide, active in the same event and selected from the AIA catalogue.
- Vehicle request yes requires positive quantity and nonblank justification. No resets any prior decision and stores zero/null request details.
- Concurrent expected-version writes produce exactly one accepted change.
- Event date ranges and onboarding windows must be valid.
- Audit history rejects UPDATE and DELETE through a database trigger.
- Notification and outbox insertion are transactionally coupled to their triggering mutation.
- Catalogue entries and companies are deactivated instead of deleted.
- Event-zone deactivation is refused while a company still requests that zone. Previously deactivated event-zone links can be reactivated.
- Event, company, zone, job-role and personnel-limit updates require the expected record version; stale forms are rejected.
- Leader invitations are issued only by an admin, queued in the same transaction as their audit event, and delivered with the existing encrypted SMTP pipeline.

## Policy foundation, not yet a persisted workflow

The tested registration policy supports submit, approve, return, reject and pre-deadline reopen.
Return/reject require category plus nonblank comment. Reopen returns DRAFT and explicitly signals approval invalidation.
There is no mutation API that simply sets status.
Snapshot-aware admin edits of reviewed/approved/rejected packages are deferred to Phase 5.
Admin authority is not removed; the current foundation refuses incomplete snapshot operations.

## Reserved for owning phases

Personnel: required photo/data/acknowledgement, exactly three document types, full-event ID validity, working days, encrypted ID and event-scoped duplicate resolution.
The inclusive ID expiry date comparison is unit tested; no personnel completion service exists yet.
Limits: transaction-safe worker-slot consumption and approved extra-personnel adjustments.
Tokens: one-time employee submission and deadline-bound expiry.
Requests: no change until approval; replacements preserve the original record.
QR: single central service; no invented reuse/reassignment.
Exports: immutable batch/item snapshots and both working provisional XLSX adapters.
Retention: approved policy and legal holds before automatic deletion.
