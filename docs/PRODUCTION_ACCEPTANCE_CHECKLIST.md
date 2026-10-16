# Production acceptance — Phase 4B gate

Prepared 15 October 2026, Europe/Lisbon. **No production launch is authorised by this checklist.** Record date, operator, environment, exact source/image digests and evidence link for each item. Blank items are not passes. Assign the accountable technical, privacy, backup and incident-response functions through AIA; no named responsibilities are assumed.

## Authorisation and isolation

- [ ] Explicit approval to inspect the named VPS; approved maintenance window and deployment operator.
- [ ] Host inventory, architecture, free memory/disk/inodes, other AIA services/ports, Docker networks and volume owners reviewed read-only.
- [ ] Accreditation-specific project, databases, logins, bucket, volumes, routes, certificates and backup destination; no unrelated restart or cleanup.
- [ ] Exact candidate/source/materials inventory and locked dependencies reviewed; image signatures/provenance and current image/dependency advisories checked.
- [ ] Maintained, supported object-storage implementation approved. The cached 2025 MinIO community image used for synthetic compatibility tests is **not** a production choice.

## Infrastructure and credentials

- [ ] Host time synchronisation is healthy and container UTC agrees with a trusted time source; provider-issued JWT not-before/expiry checks work without widening their tolerance. Assign clock-drift monitoring/response. Local Phase 4A encountered an unsynchronised Windows CMOS clock approximately 50 seconds behind Clerk.
- [ ] Actual domain/DNS approved; existing services retain their routes. TLS chain/renewal/expiry alert tested.
- [ ] Only the reviewed accreditation ingress is reachable; PostgreSQL, Redis, MinIO API/console and worker health have no public mappings.
- [ ] Forwarding headers overwritten; trusted edge addresses are exact and verified; direct backend access denied.
- [ ] Runtime containers non-root, read-only with bounded writable tmpfs; CPU, memory, PID, log and shutdown limits checked on the actual host.
- [ ] Secret files owned/readable by the intended Linux service UID only; parent directories private. Compose file-backed secrets do not fix host ownership automatically.
- [ ] Web contains no migration/backup/erasure credentials. Separate actual database logins have tested runtime privileges and cannot own schema or invoke privacy functions.
- [ ] PostgreSQL TLS/SCRAM, Redis TLS/ACL and private scoped storage tested with no TLS-verification bypass.
- [ ] Document, fingerprint, mail, archive and custody keys are distinct; custody/recovery/version plan approved and recoverable independently of the VPS.

## Clerk and SMTP — provider approval required

- [ ] Production Clerk instance and `pk_live`/`sk_live` keys; image built with the matching public key. Never promote the test-key image to production.
- [ ] Invite-only creation, allowed origins/domains, redirect URLs, session expiry/revocation and account suspension reviewed in the provider console.
- [ ] Verified internal administrator bootstrap uses an approved identity; membership restrictions and company suspension verified with disposable authorised accounts.
- [ ] `/api/webhooks/clerk` signature, event-id deduplication, timestamp/replay limits and user-disable processing tested against the actual provider.
- [ ] Approved SMTP provider/domain/sender and reply handling; verified SPF/DKIM/DMARC records and STARTTLS/SMTPS credentials.
- [ ] Explicit approval for one external synthetic delivery to an approved test mailbox; record inbox/spam result and authentication headers, not message credentials.
- [ ] Failed/uncertain delivery visibility, current-scope reissue, fresh auth/invitation flows and duplicate-delivery caveat accepted.

## Migration, release, backup and operations

- [ ] Verified scoped encrypted DB/object/key backup; actual off-site copy checksums and independent key recovery confirmed.
- [ ] Actual restore into a clean isolated target succeeds with current erasure journal applied before any public ingress or worker dispatch is enabled.
- [ ] Legacy photo inventory backed up; no claim of recovering overwritten historic bytes. No mixed old/new photo writers.
- [ ] All migration checksums/order, constraints/functions/indexes and lock timeouts reviewed; staging upgrade and deliberate failure evidence accepted.
- [ ] Candidate validated before stopping/replacing services; prior exact images/configuration retained; forward schema recovery and compatible artifact rollback rehearsed.
- [ ] Web/worker readiness, dependency interruption/recovery, graceful shutdown and worker crash recovery tested on the deployment.
- [ ] Actual proxy 413/chunked rejection, trusted source, 429, SSE/reconnect and bounded image/upload concurrency tested; host capacity and deadline workload approved.
- [ ] External uptime/alert destination tested; queue, leases, backup age/failure, disks/volumes, container restarts, repeated errors and TLS expiry produce actionable alerts.
- [ ] AIA assigns each alert category to an accountable response function and escalation contact; log retention/rotation reviewed.

## Core workflow and human Excel

- [ ] External event/company/leader invitation, worker entry/onboarding/photo, company zones, submission/review/approval and effective permissions verified through the actual deployed interface.
- [ ] Correction, resubmission, changed approved content and stale public links retain the Phase 1/2 boundaries.
- [ ] AIA and Parkalgar template download/import, missing photos/notices, per-person zones, review and effective access verified. Two internal workers have independently different zones; external workers inherit company zones only.
- [ ] Nicole/Yana use the actual supported Microsoft Excel version: download/open/save/reopen without repair; preserve text documents/leading zeros/phone plus signs and ISO dates; use Roles/Zones UUIDs and semicolon-separated individual zones.
- [ ] Upload invalid rows, read locale-specific errors, correct/reupload, confirm exact rows, finish photos/notices, review/approve and inspect actual effective zones. Retry must not duplicate imports.
- [ ] Record Excel version, operator, event, synthetic workbook and results. Automated workbook tests do not close this item.

## Formal AIA policy approval — required before real data

- [ ] Approved PT/EN worker notices and separate leader declaration; controller/contact, purposes/lawful bases and necessary fields documented.
- [ ] Acknowledgement/proxy procedure, rights-request identity checks, incident-response responsibilities and processor arrangements approved.
- [ ] Event/account/audit/communications/backups retention, legal holds, evidence scope and external-copy verification approved; destructive automatic retention stays disabled without separate approval.
- [ ] RPO/RTO, backup cadence/retention and encryption-key custody approved; off-site restore evidence accepted.
- [ ] Replacement-cancellation policy and empty-registration closure rules confirmed, or the current fail-closed behaviour explicitly accepted for launch.
- [ ] Technical, operational and privacy sign-offs recorded; explicit final launch authorisation received. A passing technical configuration alone is insufficient.
