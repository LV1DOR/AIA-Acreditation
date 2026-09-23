# AIA ACREDITAÇÃO — CODEX ENGINEERING HANDOFF

**Status:** requirements and architecture baseline agreed.  
**Purpose:** source-of-truth engineering handoff for Codex.  
**Production target:** same Netcup VPS as AIA Volunteers.  
**Critical instruction:** do not deploy to or modify production until explicitly instructed.

---

## 1. Product purpose

AIA Acreditação is a controlled back-office/onboarding platform for **external company personnel attending events at Autódromo Internacional do Algarve (AIA)**.

It replaces manual collection from email/WhatsApp/spreadsheets and prepares accurate, reviewed personnel data for accreditation/pass creation.

The platform **does not** own entrance scanning or replace WeBook/Kforce.

Boundary:

**Collect → validate → company-leader review → AIA review → lock → WeBook QR association when applicable → controlled exports → audit**

WeBook remains the external ticket/pass system. Kforce/security use external scanners.

---

## 2. Actors

### AIA Admin
Only a small number of AIA users are expected (Yana plus perhaps 2–3 others).

V1:
- every admin has an individual Clerk account;
- no shared admin account;
- admin access requires an individually verified Clerk account and controlled internal role mapping; MFA was removed by user decision on 2026-09-22 because it requires the Clerk Pro plan;
- all admins have full app permissions;
- AIA can override/edit any business record;
- every meaningful admin action is audited;
- login/session activity should be logged where technically available;
- all admins can view the audit log;
- audit log should be accessible from a secondary area such as **Settings → Audit & Security**.

### Company Leader
A real authenticated user responsible for one or more external companies/event registrations.

Can:
- receive AIA invitation;
- access company dashboard;
- configure participation;
- select requested zones;
- request vehicle passes;
- add workers;
- generate individual worker onboarding links;
- enter worker information themselves;
- review/edit worker submissions while editing is allowed;
- approve workers;
- submit company package to AIA;
- receive approval/correction/rejection decisions;
- create requests after normal editing closes.

Primary notification channel: **email**.  
Secondary: simple in-app notification bell.

### Employee / Worker
No account.

Uses a **one-time expiring URL** created by the company leader.

Can:
- submit their own data;
- upload/take mandatory photo;
- select working days;
- acknowledge privacy notice;
- submit once.

After successful submission:
- employee link is permanently unusable;
- employee cannot edit again;
- leader/AIA take over management.

Employees receive **no workflow emails** from the platform.

---

## 3. Core hierarchy

```text
AIA
└── Event
    ├── Event Zones
    ├── Companies
    │   └── Company Event Registration
    │       ├── Company Leader
    │       ├── Requested Zones
    │       ├── Vehicle Pass Request
    │       ├── Event-specific Workers
    │       ├── Submission Versions
    │       └── Requests / Exceptions
    ├── WeBook QR Pool
    ├── Export Batches
    ├── Notifications
    └── Audit Events
```

**Companies may persist across events. Workers must not.**

Do not create an indefinite reusable employee roster. Personnel onboarding is repeated for each event.

---

## 4. Event model

AIA creates events, e.g. MotoGP 2026.

Required concepts:
- name;
- optional code/slug;
- event start date;
- event end date;
- onboarding open datetime;
- onboarding close datetime;
- timezone, default `Europe/Lisbon`;
- status;
- available zones;
- event configuration.

Suggested `EventStatus`:
- `DRAFT`
- `ONBOARDING_OPEN`
- `ONBOARDING_CLOSED`
- `ACTIVE`
- `COMPLETED`
- `ARCHIVED`

Treat event dates as calendar dates; do not allow timezone conversion to shift the day.

---

## 5. Companies and leaders

A `Company` may be reused across events.

A company is linked to an event via `CompanyEventRegistration`.

A company may have persistent leader memberships, but each company-event registration should know the primary responsible leader.

For a new event:
- AIA can select an existing company or create a new one;
- AIA sends an invitation to the company leader;
- no old employee roster is copied forward.

Company leader registration must be invite-only. No public leader signup that allows someone to attach themselves to arbitrary companies.

---

## 6. Personnel limit

Default personnel limit per company/event:

**10 workers**

This is a hard operational limit.

The leader cannot silently add worker #11.

For more than 10:
- create **Extra Personnel Request**;
- include requested additional quantity;
- include proposed worker names / who is needed where known;
- include reason/justification;
- AIA approves/rejects;
- if approved, increase effective company-event personnel limit.

Enforce limit server-side and transaction-safely.

---

## 7. Global job roles

AIA owns one global job-role catalogue.

All companies use the same list.

Admin UI:
**Administration → Job Roles**

Admins can:
- create;
- rename;
- reorder;
- deactivate.

Prefer deactivate over delete when historically referenced.

Workers must choose a role from the catalogue. No arbitrary free-text role for normal users.

Actual role values will be entered by AIA later.

---

## 8. Zones

AIA creates/controls the zone catalogue.

Company leader selects the zones the **whole company** needs.

Rules:
- zones are company-wide;
- no per-worker zones in V1;
- every worker in the company receives the same approved zone access;
- only AIA-defined zones can be selected;
- AIA makes the final decision during company review.

Model recommendation:
- global `Zone`;
- `EventZone` to activate a zone for an event;
- `CompanyZoneRequest` linking company-event registration to requested zones.

If AIA believes too many/inappropriate zones were requested, AIA can return/reject the submission with a reason category and mandatory comment.

---

## 9. Vehicle pass

Company-level only.

Leader answers:
- vehicle pass required: Yes/No.

If Yes:
- requested quantity;
- mandatory reason/justification.

AIA reviews.

Store:
- requested quantity;
- approved quantity;
- reason;
- decision metadata.

This allows e.g. 3 requested, 1 approved.

No plate/vehicle/driver details in V1 unless requirements change.

---

## 10. Required worker data

Current required data for WeBook/pass creation:

- Full name;
- Date of birth;
- ID type;
- ID number;
- ID expiry date;
- Mobile number;
- Nationality;
- Organisation/company — automatic from company event registration;
- Job role/function — global AIA list;
- Mandatory photo;
- Individual working days;
- Privacy/data-processing acknowledgement.

### Hard-coded ID types
Exactly three V1 values:

```text
PASSPORT
CARTAO_CIDADAO
CARTAO_RESIDENCIA
```

UI:
- Passaporte / Passport
- Cartão de Cidadão / Portuguese Citizen Card
- Cartão de Residência / Residence Permit

Persist enum values, never translated strings.

### Nationality
Prefer stable ISO country code, e.g. ISO 3166 alpha-2, and localise labels in UI.

### Phone
Normalise where practical to E.164 using a mature library such as `libphonenumber-js`.

### Working days
Per worker, not company-wide.
Only dates inside the event date range may be selected.

---

## 11. ID validity

Hard business rule:

**The ID must remain valid through the entire event, regardless of the worker's individual working days.**

Current rule:

```text
documentExpiryDate >= eventEndDate
```

Examples:
- expires day before event end → block;
- expires on event end date → valid under current rule.

Must be enforced server-side.

Revalidate later as well, not only at first form submit.

If invalid, show a clear bilingual advisory that the worker must renew/update the document before onboarding can complete.

---

## 12. Duplicate ID detection

Detect duplicate IDs **within the same event**.

Normalise:
- uppercase;
- trim;
- remove spaces;
- remove appropriate separators.

Example:
`AB 123-456` and `AB123456` should match.

Recommended fingerprint input:

```text
<ID_TYPE>:<NORMALISED_ID_NUMBER>
```

Store a keyed fingerprint using HMAC-SHA-256, not a second plaintext copy.

Persist:
- encrypted full document number;
- HMAC fingerprint;
- last 3 characters for masked display.

Behaviour:
- ordinary user completion/finalisation is blocked or held for duplicate review;
- AIA can see the conflicting record/company;
- company leader only sees a privacy-safe message;
- AIA can resolve/override;
- override is audit logged.

Do not treat every duplicate as fraud.

---

## 13. Photo handling

Photo is mandatory.

No completed worker onboarding without it.

Employee form should support normal mobile file/camera capture.

Pipeline:

```text
upload
→ size/type validation
→ decode validation
→ optional existing ClamAV scan
→ Sharp
→ fix orientation
→ strip EXIF/GPS metadata
→ resize
→ standardise output
→ private MinIO
```

Do not retain raw original if not needed after sanitised processing.

No permanent public photo URLs.

Use short-lived authorised/signed access only after server-side permission check.

Temporary source size until Matica spec arrives:
- keep a clean high-quality processed image;
- roughly 1200px long edge is acceptable;
- do not guess final print dimensions.

---

## 14. Employee one-time links

Employees have no accounts.

Token requirements:
- cryptographically random, e.g. 256-bit;
- raw token only in URL;
- DB stores SHA-256 token hash;
- bound to one worker/invitation;
- expires no later than onboarding close;
- leader/admin may revoke unused token;
- successful employee submit sets `usedAt`;
- used/revoked/expired token never works again.

Suggested fields:

```text
id
participantId
tokenHash
expiresAt
usedAt
revokedAt
createdByUserId
createdAt
```

Public onboarding routes must be rate limited.

Employees are not emailed by the platform; leader shares the URL.

---

## 15. Worker lifecycle

Suggested worker status semantics:

```text
DRAFT
AWAITING_EMPLOYEE
AWAITING_LEADER_REVIEW
LEADER_APPROVED
DUPLICATE_REVIEW_REQUIRED
REMOVED
REPLACED
```

Flow:

```text
Leader creates worker/slot
→ leader fills details OR creates one-time employee link
→ employee submits
→ token becomes unusable
→ worker = awaiting leader review
→ leader checks/edits
→ leader approves worker
```

If leader enters a worker directly, final company submission must still only include leader-approved complete workers.

AIA can see statuses throughout.

---

## 16. Final company submission state machine

Critical invariant.

Conceptual lifecycle:

```text
DRAFT
  ↓
AIA_REVIEW
  ├── APPROVED
  ├── RETURNED_FOR_CORRECTION
  └── REJECTED
```

### DRAFT
Leader can edit while onboarding is open.

### AIA_REVIEW
Created when leader clicks **Submit to AIA for final approval**.

Leader is locked out from modifying the package while AIA reviews.

### RETURNED_FOR_CORRECTION
Leader editing is re-enabled.
Leader fixes data and resubmits.
A new submission version is created.

### REJECTED
Final rejection state unless AIA explicitly changes course.
Requires reason category + mandatory admin comment.

### APPROVED
Locked.

If onboarding is still open and leader needs to change an approved submission:
- explicit **Reopen approved submission** action;
- strong warning;
- previous approval is invalidated;
- registration returns to editable state;
- next submit requires AIA review again;
- audit + AIA notification.

If onboarding has closed:
- no direct reopen;
- use Request system.

AIA admins always retain override power.

---

## 17. Submission versioning / snapshots

Do not rely only on a mutable status.

Use:

`CompanyEventRegistration` = current mutable workspace.

`CompanySubmission` = immutable snapshot created every time leader submits.

Each submission version should record:
- registration;
- version number;
- relevant company-event fields;
- requested zone IDs;
- vehicle request state;
- included workers/data snapshot or stable references plus snapshot;
- content hash if useful;
- submitted timestamp;
- review status/outcome;
- reviewing admin;
- return/rejection category;
- mandatory comment.

This lets AIA know exactly what was reviewed.

Use optimistic concurrency on important mutable records via a `version` integer or equivalent.

Stale writes must fail cleanly.

---

## 18. AIA review

AIA chooses:

- Approve
- Return for correction
- Reject

For Return/Reject:
- choose a reason category or Other;
- comment/instructions mandatory.

Suggested initial reason enum:

```text
ZONES
VEHICLE_PASS
PERSONNEL
PHOTO
DOCUMENT
WORK_DAYS
HEADCOUNT
DUPLICATE
OTHER
```

Comment appears:
- in leader portal;
- in bilingual email.

---

## 19. Onboarding deadline

After onboarding closes:

Employees:
- unused links no longer work;
- cannot submit/edit.

Company leaders:
- cannot add;
- cannot remove;
- cannot substitute;
- cannot edit;
- cannot change working days;
- cannot replace photos;
- cannot reopen directly.

All changes go through Requests.

AIA admins:
- retain full control;
- overrides are audited.

Enforce server-side.

---

## 20. Request system

First-class shared request engine.

Recommended `RequestType`:

```text
EXTRA_PERSONNEL
ADD_AFTER_DEADLINE
REMOVE_AFTER_DEADLINE
REPLACE_PERSON
EDIT_PERSON
CHANGE_WORK_DAYS
REPLACE_PHOTO
VEHICLE_PASS_CHANGE
OTHER
```

Statuses:

```text
PENDING
APPROVED
REJECTED
CANCELLED
```

Priority:

```text
NORMAL
URGENT
```

Fields:
- event/company registration;
- target participant optional;
- created-by leader;
- type;
- priority;
- reason;
- typed JSON payload;
- status;
- resolution comment;
- reviewing admin;
- timestamps.

Validate request payloads with Zod discriminated unions.

Decision creates:
- DB state change;
- audit;
- in-app notification;
- company-leader email when relevant.

---

## 21. Emergency substitution

Must work even after onboarding closure and immediately before/during event.

Explicit leader action:

**URGENT / LAST-MINUTE REPLACEMENT**

Flow:
- choose worker being replaced;
- provide/prepare replacement;
- enter reason;
- warning that onboarding is closed;
- clarify nothing takes effect until AIA approves;
- submit urgent request.

AIA **Action Required** queue must make urgent requests highly visible.

Never mutate old worker into new worker. Preserve history.

On approval:
- old worker is marked withdrawn/replaced;
- replacement becomes valid according to rules;
- QR consequences go through central QR service;
- audit everything.

---

## 22. Notifications

### Leader
Email is primary.

Also a simple notification bell.

Email-worthy events include:
- initial company invitation;
- final submission receipt;
- submission approved;
- submission returned;
- submission rejected;
- extra personnel request decision;
- vehicle pass decision;
- post-deadline request decision;
- urgent substitution decision;
- important deadline reminders;
- other major workflow events.

### AIA
Prominent **Action Required** counter/queue.

Aggregate:
- submissions awaiting review;
- resubmissions;
- extra-personnel requests;
- vehicle decisions;
- urgent substitutions;
- post-deadline requests;
- duplicate-ID issues.

PostgreSQL is truth. Redis may cache/push invalidations only.

---

## 23. Email design

All transactional emails:
- bilingual PT-PT + EN in same email;
- AIA design system;
- red / black / white / off-white;
- consistent header/logo;
- clear status;
- concise body;
- clear CTA;
- consistent footer.

Use:
- React Email;
- Postmark;
- transactional outbox.

Suggested templates:
- CompanyInvitationEmail
- SubmissionReceivedEmail
- SubmissionApprovedEmail
- SubmissionReturnedEmail
- SubmissionRejectedEmail
- RequestSubmittedEmail
- RequestApprovedEmail
- RequestRejectedEmail
- UrgentSubstitutionEmail
- DeadlineReminderEmail

Do not include unnecessary PII/full IDs/photos in email.

Configure SPF/DKIM/DMARC before production.

---

## 24. Internationalisation

Platform:
- Portuguese (Portugal);
- English.

Use `next-intl`.

Suggested routes:
- `/pt/...`
- `/en/...`

Store internal enums/codes only.

Emails remain bilingual regardless of selected UI locale.

---

## 25. WeBook QR model

WeBook controls actual passes/tickets/scanning.

Expected future flow:
- WeBook provides a pool, possibly 1000–1500 QR codes;
- platform imports/stores pool;
- approved workers get associated with codes;
- export tells WeBook which person is associated with which code.

**Open question: QR reassignment/reuse is unknown.**
Do not invent the rule.

Suggested states:

```text
AVAILABLE
RESERVED
ASSIGNED
EXPORTED
VOID
```

Suggested model:

```text
QRPoolItem
- eventId
- externalQrId
- qrValue
- status
- assignedParticipantId?
- assignedAt?
- exportedAt?
- voidedAt?
```

Central QR service only:

```text
assignQR()
releaseQR()
replaceQR()
voidQR()
```

Constraints:
- unique QR value;
- at most one active QR per participant;
- allocation transaction-safe;
- no automatic reuse until policy confirmed.

Likely safe interim behaviour: never silently reuse an exported QR.

---

## 26. Exports

There are two production export targets.

The real production templates are still pending, but the application must work **end-to-end now**. Therefore implement provisional, viable XLSX templates immediately. They must generate valid files, participate in normal export batching, be stored in MinIO, be downloadable by authorised admins, and be fully audited.

The provisional formats are intentionally replaceable. Do not let the rest of the application depend on their column positions.

### WeBook export

Known fields required by WeBook:
- Name
- Date of birth
- ID type
- ID number
- Phone
- Nationality
- Organisation
- Job role

The exact template is pending from WeBook/Yana.

Until it arrives, implement a deterministic provisional workbook:

```text
Sheet: WeBook Export

A: QR / External QR ID
B: Nome / Full Name
C: Data de Nascimento / Date of Birth
D: Tipo de ID / ID Type
E: Nº ID / ID Number
F: Telemóvel / Mobile
G: Nacionalidade / Nationality
H: Organização / Organisation
I: Função / Job Role
J: Dias de Trabalho / Working Days
```

The workbook should have:
- one clear header row;
- sane column widths;
- dates written consistently;
- stable row ordering;
- no merged cells or unnecessary formatting;
- exporter version recorded in the associated `ExportBatch`.

Suggested provisional exporter version:

```text
webook-provisional-v1
```

This is **not** the final production mapping. When the real WeBook file arrives, replace only the exporter adapter/mapping and preserve the core export workflow.

### Card-print export

Printer: **Matica MC210**

The exact AIA card-print spreadsheet/template is pending from a colleague.

Until it arrives, implement a deterministic provisional workbook:

```text
Sheet: Card Print

A: Photo
B: Nome / Full Name
C: Organização / Company
D: Função / Job Role
E: Tipo de ID / ID Type
F: Nº ID / ID Number
G: Nacionalidade / Nationality
H: Dias de Trabalho / Working Days
I: QR / External QR ID
```

Requirements for the provisional card-print workbook:
- embed the processed participant photo inline in column A;
- use a conservative readable photo size;
- set row height to fit the photo cleanly;
- keep the image anchored to the corresponding row;
- use sane column widths;
- generate a valid XLSX that can be opened and inspected reliably;
- do not pretend the provisional photo dimensions match the final Matica MC210 production requirements.

Suggested provisional exporter version:

```text
matica-mc210-provisional-v1
```

When the real Matica/AIA template arrives:
- inspect the actual workbook;
- reproduce its exact sheets/columns/ordering;
- determine exact photo dimensions and anchoring;
- verify the output physically with the Matica MC210 workflow;
- replace only the adapter implementation where possible.

### Adapter architecture

```text
Export Engine
├── WeBookExporter
└── CardPrintExporter
```

Initially implement working adapters:
- `ProvisionalWeBookExporter`
- `ProvisionalMaticaMC210Exporter`

Later replace/add:
- `WeBookV1Exporter`
- `MaticaMC210V1Exporter`

Use ExcelJS initially **behind interfaces**.

Do not build automatic arbitrary Excel-template inference in V1.

---

## 27. Export batches

Every export is tracked.

`ExportBatch`:
- type;
- event;
- creator admin;
- timestamp;
- status;
- exporter/template version;
- row count;
- generated object key;
- checksum if useful;
- error metadata.

`ExportBatchItem`:
- batch;
- participant;
- QR used if applicable;
- row number;
- immutable exported data snapshot;
- status/error.

Never overwrite prior exports.

Every export creates audit event.

PII-heavy export files must be included in retention/deletion policy even if audit metadata remains.

---

## 28. Privacy / retention

Important: GDPR has no universal 30-day rule.

Current operational preference:
- retain full accreditation data up to 30 days after event;
- then purge unnecessary sensitive data;
- exact policy must still be validated/approved by AIA.

Do **not** call a record anonymous if the person's name remains.

Likely purge candidates:
- full ID number;
- photo;
- phone;
- DOB if no longer required;
- other unnecessary PII;
- generated PII-heavy exports.

AIA may want a minimal historical record (e.g. name/company/event/status) for later incidents, but this remains personal data and requires an approved purpose/retention period.

Build configurable retention framework.

### Legal hold
Support admin-only legal/incident hold:
- event/person scope;
- reason;
- created by;
- timestamps;
- optional release.

Hold prevents automatic purge for affected record.

All hold actions audited.

### Privacy notice
Mariana will provide final text.
Until then:
- placeholder marked TODO;
- version the notice;
- store notice version + acknowledgement timestamp.

Do not invent legal-consent wording.

---

## 29. Audit log

First-class append-oriented `AuditEvent`.

Log:
- auth/session events where available;
- events;
- companies;
- zones;
- job roles;
- worker edits;
- submission transitions;
- approval/return/rejection;
- comments/categories;
- personnel limit changes;
- vehicle decisions;
- duplicate resolution;
- requests;
- urgent substitutions;
- QR actions;
- exports;
- export downloads if practical;
- template changes;
- retention jobs;
- legal holds;
- admin overrides.

Suggested fields:

```text
id
createdAt
actorType
actorUserId?
action
entityType
entityId
eventId?
companyId?
participantId?
requestId?
ipAddress?
userAgent?
metadataJson
```

`actorType`:
- ADMIN
- COMPANY_LEADER
- EMPLOYEE_LINK
- SYSTEM

Never store full ID/phone/photo/raw token in audit metadata.

Use masked diffs where useful.

Audit filtering:
- admin/user;
- date range;
- event;
- company;
- participant;
- action;
- entity;
- exports;
- authentication;
- approvals;
- requests;
- QR;
- retention.

No normal UI delete/edit for audit records.

---

## 30. ID-number security

Need:
1. authorised decrypt for detail/export;
2. duplicate detection without plaintext scans.

Recommended fields:

```text
documentNumberCiphertext
documentNumberIv
documentNumberAuthTag
documentNumberKeyVersion
documentNumberFingerprint
documentNumberLast3
```

Use:
- AES-256-GCM for encryption;
- HMAC-SHA-256 for fingerprint.

Encryption key and HMAC key must be separate.

Usually display:
`Passport •••123`

Decrypt only on explicitly authorised paths.

Never send decrypted value to:
- logs;
- Sentry breadcrumbs;
- audit metadata;
- URL;
- email.

---

## 31. Authentication and authorisation

Use Clerk.

Internal app roles:
- `ADMIN`
- `COMPANY_LEADER`

Map Clerk identity to internal `User`.

Company/event relationships belong in PostgreSQL.

Admin:
- invite-only;
- individually verified Clerk account with controlled internal admin mapping; no MFA requirement on the selected Clerk plan.

Leader:
- invite-only.

Recommended leader invite flow:
1. AIA enters company + leader email.
2. App creates secure invitation.
3. Branded email sends invitation link.
4. Leader signs in/signs up through Clerk.
5. App validates invitation and binds internal user to company/event.
6. Invitation consumed.

Employee token is separate from Clerk.

All mutations authorised server-side.

---

## 32. PostgreSQL / Prisma

Use:
- PostgreSQL;
- stable Prisma release;
- dedicated `aia_acreditacao` database/role in production.

PostgreSQL is business truth.

Use transactions for critical workflows.

Atomic example:
- submission becomes approved;
- audit created;
- notification created;
- outbox created.

Critical concurrent operations such as QR allocation must use proper constraints/isolation/locking.

---

## 33. Recommended entities

Identity/access:
- `User`
- `CompanyLeaderMembership`
- `LeaderInvitation`
- `WebhookEvent`

Core:
- `Company`
- `Event`
- `Zone`
- `EventZone`
- `JobRole`
- `CompanyEventRegistration`
- `CompanyZoneRequest`

Personnel:
- `EventParticipant`
- `ParticipantWorkDay`
- `EmployeeInvitationToken`

Workflow:
- `CompanySubmission`
- `Request`

Notifications:
- `Notification`
- `OutboxMessage`
- `EmailDelivery`

QR:
- `QRPoolItem`
- optional `QRAssignmentHistory`

Exports:
- `ExportBatch`
- `ExportBatchItem`

Governance:
- `AuditEvent`
- `LegalHold`
- `RetentionRun`

Important unique constraints:
- `CompanyEventRegistration(eventId, companyId)`
- `EventZone(eventId, zoneId)`
- `CompanyZoneRequest(companyEventRegistrationId, zoneId)`
- `ParticipantWorkDay(participantId, workDate)`
- `QRPoolItem(eventId, qrValue)`

Duplicate ID should use a resolvable conflict workflow rather than an inflexible DB unique constraint that prevents admin override.

---

## 34. Modular monolith

Do not use microservices.

Recommended pnpm workspace:

```text
apps/
  web/
  worker/

packages/
  database/
  domain/
  email/
  exports/
  i18n/
  config/
  ui/
```

Domain modules:

```text
auth/
events/
companies/
personnel/
submissions/
requests/
zones/
job-roles/
vehicle-passes/
notifications/
exports/
qr/
audit/
retention/
```

Business logic belongs in domain/application services.

Do not scatter workflow rules through React components/route handlers/Prisma calls.

Examples:
- `approveCompanySubmission()`
- `returnCompanySubmission()`
- `reopenApprovedSubmission()`
- `approveExtraPersonnelRequest()`
- `assignQrToParticipant()`
- `purgeExpiredEventData()`

---

## 35. Next.js

Use:
- App Router;
- strict TypeScript;
- Server Components where useful;
- thin Server Actions/route handlers;
- route handlers for webhooks/SSE/external endpoints;
- domain services for mutations.

No separate NestJS/Express backend unless a proven need appears.

No tRPC unless there is a concrete reason.

---

## 36. Forms/UI

Use:
- Tailwind;
- shadcn/ui;
- TanStack Table;
- React Hook Form;
- Zod;
- next-intl.

Server validates everything even if client validates first.

UI goals:
- operational;
- fast;
- clear;
- responsive;
- dense readable admin tables;
- strong filters;
- obvious statuses;
- obvious Action Required;
- simple leader portal;
- excellent mobile employee onboarding.

AIA visual scheme:
- red;
- black;
- white;
- off-white;
- neutral greys.

Do not over-design.

---

## 37. Redis

Use for:
- BullMQ;
- rate limiting;
- SSE/PubSub invalidation;
- short-lived dashboard count caching;
- distributed locks if needed;
- transient job state.

Never make Redis the only source of approvals/requests/submissions/notifications/QR assignments.

Use clear Acreditação prefixes if sharing Redis with Volunteers.

---

## 38. BullMQ worker

Dedicated worker app/container.

Suggested queues:
- email;
- exports;
- retention;
- notifications;
- image-processing;
- maintenance.

Jobs must be idempotent and retry-safe.

Large Excel/photo exports must not run synchronously inside web requests.

---

## 39. Transactional outbox

Important side effects should use DB outbox.

Example transaction:
- CompanySubmission approved;
- Notification inserted;
- AuditEvent inserted;
- OutboxMessage inserted.

Commit.

Worker later sends Postmark email and publishes realtime invalidation.

Do not couple successful business transaction to immediate external email API availability.

---

## 40. Realtime

Use:
- SSE;
- Redis Pub/Sub.

No heavy WebSocket architecture needed.

Use for:
- AIA Action Required count;
- new submissions/requests;
- urgent replacement;
- notification indicators;
- dashboard invalidation.

SSE should generally send non-sensitive invalidation/event metadata and cause authorised refetch.

---

## 41. Object storage

Use MinIO/S3 API.

Private storage only.

Separate buckets/policies/credentials from AIA Volunteers.

Suggested:
- `aia-acreditacao-photos`
- `aia-acreditacao-exports`
- `aia-acreditacao-templates`

Example keys:

```text
photos/{eventId}/{companyRegistrationId}/{participantId}/profile.jpg
exports/{eventId}/{batchId}/webook.xlsx
exports/{eventId}/{batchId}/card-print.xlsx
```

---

## 42. Observability

### Sentry
Use with aggressive PII scrubbing:
- no default PII;
- never send ID/phone/photo/raw token;
- tag with non-sensitive IDs.

### Pino
Structured JSON logs with:
- request/correlation ID;
- eventId;
- companyId;
- internal userId;
- job ID;
- action.

Never log PII/secrets.

### Infrastructure
Reuse existing Zabbix approach.

Monitor:
- CPU;
- RAM;
- disk;
- Docker;
- web health;
- worker health;
- PostgreSQL;
- Redis;
- MinIO;
- backup success.

---

## 43. Testing

Use:
- Vitest;
- Playwright.

Mandatory business tests:

### ID
- expiry before event end → blocked;
- expiry exactly event end → allowed;
- formatted duplicate → detected;
- leader cannot see other company's conflict details;
- admin override audited.

### Limit
- 10 allowed;
- 11th blocked without approved request;
- approved request raises limit.

### Token
- valid unused works;
- used blocked;
- revoked blocked;
- expired blocked;
- after onboarding close blocked.

### Locks
- draft edit allowed;
- AIA review edit blocked;
- returned edit allowed;
- approved edit blocked;
- pre-deadline reopen invalidates approval;
- post-deadline direct edit blocked.

### Requests
- post-deadline change requires request;
- urgent replacement appears in Action Required;
- decision produces notification/outbox/audit.

### Admin
- override allowed;
- override always audited.

### Exports
- creates ExportBatch;
- async generation;
- immutable item snapshots;
- new export creates new batch.

### QR
- no duplicate QR;
- one active QR/participant;
- concurrent allocation safe.

### Retention
- before retention deadline no purge;
- eligible data purged according to configured policy;
- legal hold blocks purge;
- purge audited.

---

## 44. Health endpoints

Provide:
- `/api/health/live`
- `/api/health/ready`

`live`: process alive.  
`ready`: required dependencies reachable with short timeouts.

No secrets/config dumps.

---

## 45. Production infrastructure

Final production is same Netcup server as AIA Volunteers.

Known environment:
- Debian 13 minimal;
- Docker Engine;
- `/opt/aia-volunteers`;
- PostgreSQL;
- Redis;
- MinIO;
- ClamAV;
- Docker Compose.

**Do not modify production yet.**

Preferred eventual separation:

```text
/opt/aia-infra
  shared postgres
  shared redis
  shared minio
  shared clamav
  reverse proxy

/opt/aia-volunteers
  volunteers web/worker

/opt/aia-acreditacao
  acreditacao web/worker
```

But do not refactor a working Volunteers stack just for neatness.

Before deployment:
1. inspect current Compose/networks;
2. identify safe shared services;
3. create separate Acreditação DB/role;
4. create separate MinIO credentials/buckets;
5. separate Redis prefixes/queues;
6. ensure Volunteers is not disrupted.

Do not expose PostgreSQL/Redis/MinIO publicly.

Reuse existing reverse proxy. If none exists, Caddy is a reasonable preferred option, but do not run two reverse proxies.

---

## 46. Secrets

No secrets in Git.

No production secrets in:
- compose files committed to repo;
- `.env.example`;
- docs;
- source.

Use protected server-side env/secret files or explicitly approved equivalent.

Important secrets:
- DB;
- Redis;
- MinIO;
- Clerk;
- Postmark;
- Sentry where relevant;
- ID encryption key;
- ID fingerprint HMAC key.

Encryption and HMAC keys are different.

Validate env at startup with Zod/mature env validation.

---

## 47. CI/CD

Use:
- GitHub Actions;
- GHCR;
- immutable image tags by Git SHA;
- Docker Compose.

Pipeline:
- install;
- lint;
- typecheck;
- tests;
- build;
- critical Playwright;
- Docker build;
- GHCR push.

Production release remains controlled/manual initially.

Do not use Watchtower for blind production updates.

---

## 48. Backups

Same-VPS backup is not sufficient.

Need off-site encrypted backups for:
- PostgreSQL;
- required MinIO objects;
- templates;
- recovery-critical production configuration.

Need:
- schedule;
- retention;
- monitoring;
- actual restore test.

Do not claim backups are proven until restore is tested.

---

## 49. Scale / non-goals

Expected:
- a few admins;
- company leaders;
- roughly 1000–2000+ workers for large events;
- onboarding spread over days/weeks.

Do not introduce without proven need:
- Kubernetes;
- microservices;
- Kafka;
- Elasticsearch;
- distributed DB.

---

## 50. Future AIA Volunteers integration

Do **not** implement now unless explicitly asked.

Future requirement:
AIA Volunteers must export volunteer information using the **same WeBook format** as AIA Acreditação.

For Volunteers:
`organisation/company = "VOLUNTEER"`

Keep WeBook export mapping clean enough to extract/reuse later.

---

## 51. Explicit V1 non-goals

Do not build:
- scanning app;
- access-control scanner;
- proprietary QR standard;
- native mobile app;
- reusable employee roster;
- DIDIT;
- automated ID verification;
- arbitrary Excel-template auto-detection;
- employee accounts;
- employee workflow emails;
- individual worker zones;
- complex admin role hierarchy;
- microservices/Kubernetes.

---

## 52. Open items — DO NOT GUESS

1. **WeBook QR reuse/reassignment**
   - unresolved;
   - must be confirmed with WeBook/Yana.

2. **Real WeBook import template**
   - pending in coming days;
   - use the working `webook-provisional-v1` exporter meanwhile;
   - replace only the adapter/mapping when the real file arrives.

3. **Matica MC210 AIA card template**
   - pending colleague access;
   - use the working `matica-mc210-provisional-v1` exporter meanwhile;
   - provisional photo dimensions/layout are acceptable until the real template arrives;
   - replace only the adapter/mapping when the real file arrives.

4. **Final retention/legal policy**
   - proposed operational period: event end +30 days;
   - exact purge/minimal retention needs AIA validation.

5. **Privacy notice wording**
   - Mariana will provide.

6. **Production zone catalogue**
   - admin-managed.

7. **Production job-role catalogue**
   - admin-managed.

Do not invent final values.

---

## 53. Suggested enums

```text
UserRole
- ADMIN
- COMPANY_LEADER

DocumentType
- PASSPORT
- CARTAO_CIDADAO
- CARTAO_RESIDENCIA

EventStatus
- DRAFT
- ONBOARDING_OPEN
- ONBOARDING_CLOSED
- ACTIVE
- COMPLETED
- ARCHIVED

CompanyRegistrationStatus
- DRAFT
- AIA_REVIEW
- RETURNED_FOR_CORRECTION
- REJECTED
- APPROVED

ParticipantStatus
- DRAFT
- AWAITING_EMPLOYEE
- AWAITING_LEADER_REVIEW
- LEADER_APPROVED
- DUPLICATE_REVIEW_REQUIRED
- REMOVED
- REPLACED

RequestType
- EXTRA_PERSONNEL
- ADD_AFTER_DEADLINE
- REMOVE_AFTER_DEADLINE
- REPLACE_PERSON
- EDIT_PERSON
- CHANGE_WORK_DAYS
- REPLACE_PHOTO
- VEHICLE_PASS_CHANGE
- OTHER

RequestStatus
- PENDING
- APPROVED
- REJECTED
- CANCELLED

RequestPriority
- NORMAL
- URGENT

ReviewReasonCategory
- ZONES
- VEHICLE_PASS
- PERSONNEL
- PHOTO
- DOCUMENT
- WORK_DAYS
- HEADCOUNT
- DUPLICATE
- OTHER

ExportType
- WEBOOK
- CARD_PRINT

ExportStatus
- PENDING
- PROCESSING
- READY
- FAILED
- EXPIRED

QRStatus
- AVAILABLE
- RESERVED
- ASSIGNED
- EXPORTED
- VOID

AuditActorType
- ADMIN
- COMPANY_LEADER
- EMPLOYEE_LINK
- SYSTEM
```

Refine names if repo conventions require it, but do not change semantics silently.

---

## 54. Critical domain invariants

Centralise and test:

1. No completed worker without photo.
2. No completed worker if ID expiry < event end.
3. ID type is one of exactly 3 allowed values.
4. Zones are company-wide in V1.
5. Default personnel limit = 10.
6. Above limit requires approved request.
7. Employee token is one-time and deadline-bound.
8. Employee cannot edit after first successful submission.
9. Leader edits only when state/deadline allow.
10. AIA_REVIEW locks leader.
11. APPROVED locks leader.
12. Reopening approved before deadline invalidates approval.
13. After deadline, leader changes require requests.
14. AIA override is always possible and always audited.
15. Return/reject requires reason category + non-empty comment.
16. Every export creates immutable batch history.
17. QR rules live in one QR domain service.
18. PostgreSQL is truth, never Redis.
19. Sensitive values never enter normal logs/audit/email.
20. Workers are event-specific and never reused across events.

---

## 55. Code quality rules

- TypeScript strict.
- Avoid `any`.
- No business rules in React components.
- No direct arbitrary Prisma access from UI modules.
- Domain services own state transitions.
- Zod on all mutation inputs.
- Server-side authorisation always.
- Critical mutations inside DB transactions.
- Idempotent webhooks/jobs.
- UTC timestamps internally; explicit calendar-date handling for event dates.
- Opaque IDs.
- No raw token/PII logs.
- No PII in URLs beyond unavoidable one-time random token.
- No destructive production migrations without explicit review.
- Migrations committed.
- fake data only in seeds/tests.
- never copy production PII into tests.

---

## 56. Documentation

Maintain:

```text
README.md
docs/ARCHITECTURE.md
docs/DOMAIN-RULES.md
docs/SECURITY.md
docs/DEPLOYMENT.md
docs/EXPORTS.md
docs/OPEN-QUESTIONS.md
docs/ADR/
```

Useful ADRs:
- modular monolith;
- Clerk;
- event-specific workers;
- submission snapshots;
- outbox;
- encrypted document numbers;
- exporter adapters;
- QR policy abstraction;
- retention engine.

---

## 57. Implementation phases

### Phase 0 — Bootstrap
- inspect repo;
- workspace;
- apps/web + apps/worker;
- packages;
- lint/typecheck/test;
- env validation;
- local Docker deps;
- architecture docs;
- no production deployment.

### Phase 1 — Data/domain foundation
- Prisma schema;
- migrations;
- users/auth mapping;
- companies;
- events;
- zones;
- job roles;
- company-event registration;
- domain state machine;
- audit foundation;
- workflow tests.

### Phase 2 — Auth + shells
- Clerk;
- verified-email admin bootstrap and database role mapping;
- leader invite binding;
- PT/EN routes;
- admin shell;
- leader shell.

### Phase 3 — Company/event setup
- event CRUD;
- zone CRUD/event activation;
- job-role CRUD;
- company CRUD;
- leader invite;
- personnel limit;
- vehicle request;
- zone selection.

### Phase 4 — Worker onboarding
- participants;
- one-time links;
- mobile form;
- ID validity;
- duplicate fingerprint;
- mandatory photo;
- MinIO;
- Sharp/ClamAV;
- working days;
- privacy acknowledgement;
- leader review.

### Phase 5 — Final submission/review
- immutable submission snapshots;
- locking;
- approve/return/reject;
- mandatory reasons/comments;
- pre-deadline reopen;
- optimistic concurrency;
- audit.

### Phase 6 — Requests
- generic request engine;
- extra personnel;
- after-deadline changes;
- urgent substitution;
- Action Required;
- leader notifications.

### Phase 7 — Email/outbox/realtime
- React Email;
- bilingual templates;
- Postmark;
- outbox;
- delivery tracking;
- SSE;
- Redis Pub/Sub;
- reminders.

### Phase 8 — QR foundation
- pool import;
- QR states;
- central allocation service;
- no reassignment rule until confirmed;
- concurrency tests.

### Phase 9 — Export engine
- ExportBatch/Item;
- BullMQ;
- working `ProvisionalWeBookExporter`;
- working `ProvisionalMaticaMC210Exporter` with inline photo;
- deterministic provisional workbook schemas;
- exporter/template version recorded in every batch;
- MinIO;
- download auth;
- audit;
- end-to-end export tests.

### Phase 10 — Real templates
Only after actual files arrive:
- inspect the real files instead of inferring them;
- replace provisional WeBook mapping with exact adapter;
- verify import with WeBook;
- replace provisional Matica MC210 mapping with exact adapter;
- verify exact photo dimensions/anchoring/printing;
- preserve historical export-batch versions.

### Phase 11 — Retention/security hardening
- configurable retention;
- legal hold;
- export cleanup;
- Sentry scrubbing;
- security headers/CSP;
- rate limiting;
- backup automation;
- restore test.

### Phase 12 — Production
- inspect Volunteers stack;
- safe shared infra plan;
- separate DB/roles/buckets;
- proxy/TLS;
- backup;
- migration;
- exact-image deploy;
- smoke/readiness;
- no Volunteers disruption.

---

## 58. Final stack

```text
Framework
- Next.js
- TypeScript strict
- pnpm workspace

UI
- Tailwind
- shadcn/ui
- TanStack Table
- React Hook Form
- Zod
- next-intl

Database
- PostgreSQL
- Prisma stable

Auth
- Clerk
- verified-email Clerk accounts with controlled internal admin mapping; no MFA requirement on the selected Clerk plan

Async / realtime
- Redis
- BullMQ
- SSE
- Redis Pub/Sub

Storage/media
- MinIO
- Sharp
- existing ClamAV where useful

Email
- React Email
- Postmark
- transactional outbox

Excel
- ExcelJS behind exporter interfaces

Observability
- Pino
- Sentry with PII scrubbing
- existing Zabbix

Testing
- Vitest
- Playwright

Deployment
- Docker Compose
- GitHub Actions
- GHCR
- immutable image tags
- controlled releases

Production
- same Netcup VPS as AIA Volunteers
- carefully shared infrastructure
- separate DB/roles/credentials/buckets/prefixes
- off-site backups
```

---

## 59. Primary engineering principle

> **PostgreSQL is the source of truth; domain services enforce workflow transitions; important async side effects go through durable outbox/worker processing; sensitive data is minimised/protected; and every important administrative action is auditable.**

This should behave like a mature controlled operations system, not a loose set of Next.js forms.

---

## 60. Codex operating instructions

Before coding:
1. Read this whole handoff.
2. Inspect the repository.
3. Identify existing code/conventions/dependencies.
4. Do not rewrite working code just because another style is preferred.
5. Report conflicts between repo and this document.
6. Map work to phases.
7. Propose Prisma model/module boundaries.
8. Explicitly preserve all open questions.
9. Do not invent unresolved business rules.
10. Do not touch production until instructed.

During implementation:
- work phase-by-phase;
- keep changes coherent;
- keep tests green;
- update docs;
- preserve security/audit rules;
- ask before contradicting product rules.

When WeBook/Matica templates arrive:
- inspect the real file;
- change exporter adapter layer first;
- avoid rewriting core domain logic unless genuinely required.
