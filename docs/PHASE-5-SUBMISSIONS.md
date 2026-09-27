# Phase 5 final submission and review

## Leader flow

Open the Final Submission navigation item for the selected registration. Submission is enabled only while onboarding is open and the registration is `DRAFT` or `RETURNED_FOR_CORRECTION`. At least one active person must exist, every active person must be `LEADER_APPROVED`, at least one company zone must be selected, and any requested vehicle pass must have a quantity and justification.

Each **View details / Ver detalhes** action opens the same in-place submission summary rather than navigating away. The modal presents event, company, selected zones, vehicle request and the included workers. Full identification numbers are decrypted only for the membership-scoped leader projection; encrypted storage fields and duplicate fingerprints remain server-only.

Submitting creates a numbered immutable snapshot, moves the registration to `AIA_REVIEW`, and locks registration and participant editing. AIA reviews each submitted person independently before deciding the submission. Returning selected people for correction reopens only those records; people explicitly approved by AIA remain leader-approved and read-only. The next submit creates a new version rather than replacing history. Rejection remains locked.

An approved registration may be reopened explicitly only before the onboarding deadline. This invalidates the recorded approval, appends review history, returns the registration to `DRAFT`, and requires a fresh AIA review after resubmission. After the deadline, changes belong to the Phase 6 request workflow.

## Administrator flow

Pending registrations appear in Action Required with a Review link. The detail page decrypts the selected immutable snapshot only after administrator authorisation. Each person opens in a review modal where AIA can approve that person or return that person with an allowlisted category and clear instruction. Submission approval requires every active person to have an AIA approval. A person-level return preserves the decisions for approved people and is finalised as one registration return. Global Return and Reject require an allowlisted category and a nonblank comment, enforced by the UI, domain schema and database constraints.

The leader Overview has one Action Required surface. A returned-person instruction appears there with the affected person's photo, category and comment; selecting it opens that person's editor directly. The editor repeats the exact correction instruction. Generic submission-level feedback remains on Final Submission only for returns that are not attached to a specific person.

While the latest submission remains in AIA review, an administrator can open a submitted worker photo, pan, zoom or rotate it, and save a square badge framing. Saving creates a new private, submission-scoped derivative plus an append-only audited adjustment record. The company workspace photo and encrypted snapshot are not modified. The control disappears after a review decision.

## Persistence and security

- `CompanySubmission` contains version metadata, an AES-256-GCM envelope and a SHA-256 content hash.
- `CompanySubmissionReview` is append-only decision history.
- `SubmissionParticipantReview` stores one current AIA outcome per submitted person and submission. Database constraints require correction reason/comment fields only for returned outcomes.
- `SubmissionPhotoAdjustment` is append-only AIA framing history for an exact submission and participant.
- Database triggers reject update or delete for both tables.
- Registration status/version is updated atomically with snapshot/review, audit and durable invalidation records.
- Snapshot plaintext, worker details and review comments are excluded from audit metadata and outbox invalidations.
- The existing `DOCUMENT_ENCRYPTION_KEY` protects submission snapshots with a distinct authenticated-data context. Keep the key stable and protected; production rotation needs an explicit re-encryption migration.

No production deployment is authorised by this document.
