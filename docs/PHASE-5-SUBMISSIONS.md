# Phase 5 final submission and review

## Leader flow

Open the Final Submission navigation item for the selected registration. Submission is enabled only while onboarding is open and the registration is `DRAFT` or `RETURNED_FOR_CORRECTION`. At least one active person must exist, every active person must be `LEADER_APPROVED`, at least one company zone must be selected, and any requested vehicle pass must have a quantity and justification.

Each **View details / Ver detalhes** action opens the same in-place submission summary rather than navigating away. The modal presents event, company, selected zones, vehicle request and the included workers, while keeping sensitive document material out of the leader projection.

Submitting creates a numbered immutable snapshot, moves the registration to `AIA_REVIEW`, and locks registration and participant editing. Returning for correction re-enables the workspace and the next submit creates a new version rather than replacing history. Rejection remains locked.

An approved registration may be reopened explicitly only before the onboarding deadline. This invalidates the recorded approval, appends review history, returns the registration to `DRAFT`, and requires a fresh AIA review after resubmission. After the deadline, changes belong to the Phase 6 request workflow.

## Administrator flow

Pending registrations appear in Action Required with a Review link. The detail page decrypts the selected immutable snapshot only after administrator authorisation. Approve needs no invented explanation. Return and Reject require an allowlisted category and a nonblank comment, enforced by the UI, domain schema and database constraint.

## Persistence and security

- `CompanySubmission` contains version metadata, an AES-256-GCM envelope and a SHA-256 content hash.
- `CompanySubmissionReview` is append-only decision history.
- Database triggers reject update or delete for both tables.
- Registration status/version is updated atomically with snapshot/review, audit and durable invalidation records.
- Snapshot plaintext, worker details and review comments are excluded from audit metadata and outbox invalidations.
- The existing `DOCUMENT_ENCRYPTION_KEY` protects submission snapshots with a distinct authenticated-data context. Keep the key stable and protected; production rotation needs an explicit re-encryption migration.

No production deployment is authorised by this document.
