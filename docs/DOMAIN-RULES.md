# Domain rules and implementation status

## Enforced through Phase 5

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
- Worker records belong to one event registration and are never reused as a roster.
- Exactly three persisted document types are accepted. Document expiry must be on or after the event end date, and every selected working day must be inside the event range.
- Mobile numbers are validated and stored in E.164 form; nationality is stored as an uppercase ISO alpha-2 code selected from a localised list.
- Document numbers are encrypted with AES-256-GCM and fingerprinted with a separate HMAC-SHA-256 key after normalisation. An active leader membership authorises server-side decryption for participants in that company so the leader can verify the full number; encrypted fields and fingerprints never enter the UI projection.
- Same-event formatted duplicates enter `DUPLICATE_REVIEW_REQUIRED`. Only AIA sees conflict-company context and an AIA override is audited.
- Employee links are random, hash-only at rest, single-participant, one-time, revocable and bounded by onboarding close. Employees have no application account.
- Public employee routes are rate-limited. Successful submission requires all data, a user-confirmed square photo crop, a processed private photo and a versioned privacy acknowledgement, then waits for leader review.
- Leaders may enter details directly only while the registration is editable; they must record the person's privacy acknowledgement, then explicitly approve the complete worker.
- Active participant slots are counted inside a serializable transaction and cannot exceed the registration personnel limit.
- A leader may remove an active participant only while direct editing is allowed. Removal is an audited `REMOVED` status transition, revokes unused employee links, preserves the participant/photo/history and immediately releases the active personnel place.
- A final submission requires at least one active participant, every active participant to be leader-approved, a selected company zone and a valid vehicle request state. The normal path requires an open onboarding window; an approved, unfulfilled post-deadline request creates a bounded correction window that ends when its new submission is created.
- Every submission creates a new numbered encrypted snapshot and SHA-256 content hash. Snapshot and review rows reject update and delete at the database layer.
- `AIA_REVIEW` locks all leader edits. Only the latest pending submission can receive administrator person decisions and one final submission decision.
- AIA approval requires an explicit `APPROVED` decision for every active submitted person. When AIA returns selected people, only those people move back to `AWAITING_LEADER_REVIEW`; AIA-approved people remain `LEADER_APPROVED` and cannot be edited.
- The leader correction window exposes only the returned people. Their category and instruction are membership-scoped and selecting an Overview action opens the exact participant editor. While a person-level correction is open, company configuration, new-person creation, approved-person editing/removal and link issuance are locked. A corrected person must be approved by the leader again before resubmission.
- Return and rejection require an allowlisted reason category plus a nonblank comment. Approval records no invented reason.
- A returned registration can be corrected and resubmitted as a new immutable version. Rejected registrations remain final unless a later explicit administrator workflow is approved.
- An approved registration can be explicitly reopened by its company leader only before onboarding closes. Reopening appends an approval-invalidation review, returns the registration to `DRAFT`, and is audited.
- Submission, review and reopen writes use the registration version; stale or concurrent decisions fail cleanly.
- While the latest submission is in `AIA_REVIEW`, an administrator may save a submission-scoped photo framing. It is a new private derivative and append-only adjustment record; it cannot replace the participant source photo or encrypted snapshot, and no adjustment is accepted after a review decision.

## Persisted final-submission workflow

Leader submit, administrator approve/return/reject and leader pre-deadline reopen are persisted transactionally. There is no mutation API that simply sets status. Snapshot history remains unchanged when the mutable workspace is corrected for a later version.

## Reserved for owning phases

Limits: an approved extra-personnel request raises the explicit limit atomically. Emergency replacement never raises the limit.
Requests: no requested business change is applied before AIA approval. Replacement preserves the original as `REPLACED`, creates one request-linked draft replacement, and requires leader completion plus a normal final submission and AIA review.
QR: single central service; no invented reuse/reassignment.
Exports: immutable batch/item snapshots and both working provisional XLSX adapters.
Retention: approved policy and legal holds before automatic deletion.
