# Phase 2 — operational workflows and internal staff import

Local implementation record, 13 October 2026. **This is not a production-readiness declaration.** No VPS deployment, operational database migration, real personnel edit, shared database reset, pass printing, QR/scanner integration or WeBook export was performed. Preserve the Phase 1 ingress, privacy, retention and recovery launch boundaries.

## Remediation status

| Requirement | Implemented behaviour |
| --- | --- |
| F10 | Shared server-derived participant/registration capabilities control writes and UI controls. Returned company zones/vehicle corrections work after the deadline. Person returns unlock the appropriate fields; other reviewed workers stay locked. Reopening an approved registration invalidates its effective approval. Cancel/non-draft Back navigates without draft writes; the existing draft Back-save behaviour remains. |
| F11 | All ten request categories are available. EDIT_PERSON and REPLACE_PHOTO issue scoped, unfulfilled completion grants. ADD_AFTER_DEADLINE and replacement drafts can be completed after the deadline. Work-day amendments require worker readiness again. Request effects invalidate prior approval and require a new reviewed submission. Request creation/decisions retain notifications, outbox messages and audit events. |
| F13, scoped | ADMIN can revoke/explicitly restore a company membership and reassign the primary responsible leader. Revocation clears that membership's primary assignments and revokes pending invitations for the company. Secondary leaders and memberships of other companies remain. Accepting an invitation never restores a revoked membership. Existing invitation acceptance supplies new replacement leaders. No roles were added. |
| F34 | Direct updates of REMOVED/REPLACED records remain forbidden. Explicit ADMIN reinstatement supports REMOVED only, checks capacity/current state, revokes old links, creates a completion grant and starts a draft. REPLACED reinstatement remains blocked pending an explicit cancellation-of-replacement policy. |
| Internal import/template | ADMIN-only event/organisation selection, controlled internal organisation creation, event-specific XLSX template and CSV header download, file preview, row validation, confirmation, transactional import and idempotent replay. |
| Access models | Internal workers have individual event-specific requested zones. External workers retain company/event-wide requested zones. Database triggers prohibit mixing these models; composite foreign keys prevent cross-event assignments. |

## Instructions for Nicole/Yana

1. Sign in as an administrator. Open **Trabalhadores / Workers**, select the event and click **Importar trabalhadores / Import Workers**.
2. Select the event and **AIA** or **PARKALGAR**. Select/create its internal registration. Initial capacity is explicitly configurable, defaults to 1,000, and is capped at 10,000. Existing registration capacity is changed on its internal Workers page. External capacity remains unchanged (normally ten).
3. Download **Descarregar modelo Excel / Download Excel template**. Open it in Excel and fill **Workers** without changing the column headings. Use actual UUIDs from **Roles** and **Zones**, rather than names or invented codes.
4. Use `YYYY-MM-DD` dates. Keep document numbers, telephone numbers and internal references as **text**, preserving leading zeroes. Nationality is a two-letter country code. Document type is PASSPORT, CARTAO_CIDADAO or CARTAO_RESIDENCIA. Documents must remain valid through the last event day.
5. Enter multiple work dates and zone UUIDs separated by `;`. Choose zones separately for every person. An empty zone cell means **no zones requested**, not all event zones. AIA/Parkalgar workers never inherit their colleagues' zones.
6. Prefer a stable **Referência Interna** for every worker, especially records with missing document data. **Fotografia** is an optional filename reference (e.g. `EMP001.jpg`). Photograph ZIP imports are not implemented; upload each photograph in the worker record using the existing secure image/crop flow.
7. Save as XLSX, or UTF-8 CSV with identical headings. Download the CSV headers if needed and keep the Excel Zones sheet as the event-specific reference. Quote CSV cells containing the delimiter, especially multiple zone UUIDs/dates.
8. Upload and click **Validar e pré-visualizar / Validate and preview**. Check every row's errors, outstanding data, masked document ending, working dates and individual zones. The summary lists complete/incomplete/invalid/duplicate rows, create/skip/update counts and zone assignment count.
9. Confirm explicitly. Invalid rows and existing workers are skipped; duplicate identities are created in DUPLICATE_REVIEW_REQUIRED for administrator investigation. No import automatically approves a person. Existing workers are **never silently updated** by a changed spreadsheet.
10. Open **Completar e rever trabalhadores / Complete and review workers**. Complete data, upload photos, record the person's privacy-notice acknowledgement and edit individual requested zones. Resolve duplicate matches through the existing duplicate review. Mark eligible workers **ready for submission**.
11. Submit the internal registration for AIA review, review each worker and their own zones in the existing submission screen, then record the final AIA decision. No artificial company-leader invitation is needed.
12. To correct approved records, reopen the internal registration with a reason. Saving new individual zones also invalidates approval automatically and records a reason. Effective access stays empty until a new version is reviewed and approved. Historical approved zones remain visible in the worker record.

The current privacy/declaration content still uses the inherited **TODO-v1 provisional notice**. Recording this acknowledgement is a technical workflow check, not evidence of a legally sufficient notice. Replace and approve the actual notice before a real-data launch.

## Template and validation

**Workers** columns: Nome Completo, Data de Nascimento, Tipo de Documento, Número de Documento, Validade do Documento, Telemóvel, Nacionalidade, Organização, Função, Dias de Trabalho, Zonas de Acesso, Fotografia, Referência Interna (optional stable reference).

**Zones** lists only active global zones activated for the selected event, their actual UUIDs and names. **Roles** lists active job-role UUIDs/names. **Instructions** gives Portuguese/English filling guidance and the selected event/date range/organisation. Workers has frozen headers, column widths, text formats and document-type/organisation/job-role dropdowns. No invented zone catalogue, WeBook code or export field is introduced.

Limits: 4 MiB original file, 1,000 worker rows per import, 256 XLSX ZIP entries, 8 MiB actual decompressed bytes per entry and 32 MiB total decompressed content. ZIP central-directory inspection and bounded decompression precede ExcelJS. XML preflight also caps worksheets at 20,000 rows/indexes and the workbook at 50,000 cells before object allocation. Encrypted ZIPs, ZIP64/unsupported layouts, traversal paths, macros, embedded objects, external links, DTD/entity declarations and formulas are rejected. CSV is strict UTF-8 with bounded records. Formula-like values, unsupported structured cells and numeric Excel document/phone/reference cells are rejected. International `+` phone numbers are accepted only in the phone column. A numeric document cell cannot reliably recover leading zeroes.

Missing supported fields are saved as explicitly incomplete drafts, without invented values or default zones. A name and matching selected organisation are necessary to identify an import row. Malformed supplied fields, inactive/foreign/unknown/duplicate zone UUIDs, invalid roles/days, invalid dates, expired documents and unsafe photo references produce row-level errors. Import does not assert consent or attach photographs from untrusted filenames.

## Transactions, retries and approval evidence

The batch is keyed by `(registrationId, SHA-256(original file bytes))`. Confirm reparses/revalidates the original file in the chosen registration, checks its current version, capacity and catalogue, and creates personnel, work days, individual zones, batch record, registration version, audit and invalidation outbox in one serializable transaction. Retries of an already committed file return the original create/skip counts, including concurrent retries. No partially approved batch is possible. The result explicitly reports skipped rows. If the catalogue changes between preview and confirmation, current validation wins and affected invalid rows are skipped; the returned count must be checked.

Existing records are matched within the selected registration by document fingerprint or stable internal reference, including retired records, then skipped. Different-file imports lacking both usable identity and a reference cannot reliably identify an existing person; use a stable reference and review before confirming. Duplicate identities in the event are flagged for review. Raw spreadsheet bytes and preview rows are not retained in database/outbox/audit. Document numbers use the existing encrypted storage and keyed fingerprint. The batch retains only hash, actor, counts and timestamp.

Submission snapshots are schema version 2: explicit internal organisation identity and individual participant zones are captured alongside the existing external registration zones. Older snapshots remain readable and external by default. `workerEffectiveAccess` is the server-side calculation for future consumers: requested zones, current effective zones and historical approved snapshots are distinct. Only the latest currently approved submission, an active company, LEADER_APPROVED current worker with matching snapshot version, and active same-event catalogue entries produce effective zones. Internal effective zones come from that participant's snapshot; external effective zones come from the registration snapshot. This service is not an exporter.

## Request and membership policies

EDIT_PERSON scopes are IDENTITY (name, birth date, nationality/document), CONTACT (phone), ROLE (job role), or OTHER (explicit full-record correction). REPLACE_PHOTO allows a photo change only and cannot become ready while still using the previous photo. EDIT_PERSON requires a subsequent saved record before readiness. Grants close when fulfilled by a new submission. Competing unfulfilled edit/photo grants for the same person are rejected until the earlier grant is completed; grant supersession is not implemented. Scope does not permit removing the person. ADD_AFTER_DEADLINE requires available capacity; EXTRA_PERSONNEL increases capacity but does not independently authorise adding after the deadline. OTHER records a follow-up decision and supplies no automatic mutation permission.

Returned PHOTO/DOCUMENT/WORK_DAYS corrections unlock their respective fields. Selected person returns do not unlock company configuration or unrelated reviewed people. Returned company ZONES/VEHICLE_PASS corrections unlock the corresponding company configuration. New final review is mandatory.

Revoking a membership invalidates **all pending invitations of that company**, because invitations target email addresses rather than a trustworthy existing user identity. Administrators can send fresh invitations to legitimate new leaders. A revoked existing user still requires explicit membership restoration; a fresh invitation alone cannot resurrect access. Primary reassignment checks active same-company membership and current registration version. Secondary memberships remain untouched. Audit stores actor/action/version/reason and notifications inform affected leaders.

## Database changes and local migration boundary

Additive migrations: `packages/database/prisma/migrations/20261013000100_internal_staff_and_workflows/migration.sql` and `packages/database/prisma/migrations/20261013000200_registration_scope/migration.sql`.

- Nullable unique Company.internalOrganisation enum (AIA/PARKALGAR); existing companies remain external. Organisation identity is immutable by database trigger.
- ParticipantZoneRequest references the authoritative EventZone and a same-event EventParticipant through composite foreign keys; unique person/zone assignment.
- Database triggers reject individual zones on external workers and registration-wide zones on internal organisations, and prohibit moving participants or registrations between companies/events. The second migration adds the registration-scope guard without changing the already-applied first migration.
- InternalImportBatch unique registration/file hash and count/actor metadata.
- Optional worker internal/photo references and same-registration request completion grant; request baseline version/photo key; versioned leader memberships.
- Existing submissions/photos/reviews remain immutable; no old record is deleted or converted.

Applied only through `scripts/phase1-test-migrate.ts`, which verifies loopback host, port **16432**, database **aia_acreditacao_test**. Do not run the general migration/service-start command against the operational database without an explicitly scheduled migration.

## Changed implementation files

- Database: Prisma schema and both additive migrations above.
- Domain: new `internal/spreadsheet.ts`, `internal/service.ts`, `submissions/capabilities.ts`, `submissions/effective-access.ts`, `auth/memberships.ts`, `participants/reinstatement.ts`; extended participant/photo services, requests, authorisation/invitations, registration/submission/eligibility, catalogue/zone guards, portal queries/operations, audit/errors/exports and history-safe draft deletion.
- Web: new admin People import/preview/actions pages, internal organisation/worker pages/actions, authorised template route, leader membership controls/actions; shared participant fields/profile/review components; People/worker-zone display and existing leader correction/configuration/request/submission views/actions; scoped CSS extensions.
- Dependencies: ExcelJS 4.4.0, csv-parse 7.0.3, the existing interface's country-data-list 1.6.3 reused for nationality validation, and an ExcelJS-only UUID 11.1.1 override addressing [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Existing Phase 1 Prisma/security overrides remain. ExcelJS is loaded only for workbook operations, keeping unrelated endpoint/worker startup independent of its CommonJS dependencies. Workbook features use the [ExcelJS API](https://github.com/exceljs/exceljs); CSV limits use [csv-parse options](https://csv.js.org/parse/options/).
- Tests: new `tests/unit/phase2-spreadsheet.test.ts`, `tests/integration/phase2-internal.test.ts`, `tests/integration/phase2-workflows.test.ts`; Clerk browser extensions and stricter Phase 1 correction/request regression assertions.

This working tree already contained Phase 1 and user edits. No reset, checkout, commit, production deployment or unrelated workspace modification was performed.

## Validation record

Validated locally using wholly synthetic personnel and local test resources. Integration tests include 120-person imports, concurrent retry, both access models, immutable historical zones, direct database guard violations, incomplete/duplicate rows, membership lifecycle, retired workers and post-deadline operational flows. Workbook tests inspect formats/dropdowns/UUID references and round-trip XLSX/CSV, malformed files/formulas/numeric IDs. Browser coverage exercises the template download and full internal photo/readiness/review/approval flow plus post-deadline corrections and Cancel.

The fresh Impeccable reviewer scored **ship for the three requested fixes**: consistent event context, selected-locale row diagnostics, and accessible validation completion feedback. Desktop/mobile and English/Portuguese invalid-preview captures were inspected. Internal worker pages were exercised through Clerk browser actions and source-inspected; they have no separate visual-review captures. Screen-reader announcements were checked structurally, not in an assistive-technology session. The documentation handoff checked `DESIGN.md`, `.impeccable/design.json`, `apps/web/PRODUCT.md`, incumbent CSS/components and screenshots. Existing governance remains unchanged; older card/breakpoint/product descriptions have documented pre-existing drift.

An existing full-suite browser check exposed clicks reaching a server-rendered deletion button before hydration on the large synthetic catalogue page. The deletion trigger now stays disabled until hydration, so a click always opens the required confirmation. The affected check passed in isolation and the complete 28-check suite subsequently passed with the fix. No deletion action was weakened.

- Prisma schema validation, workspace/test typechecking and ESLint: passed.
- Unit tests: **68 passed in 17 files**, including nine spreadsheet tests.
- Integration tests: **100 passed in 22 files** on the final full run, including stale-form/privacy assertions and all Phase 1 integration regressions.
- Full Playwright suite: **28 passed** (26 live Clerk checks, setup and the unconfigured-auth check). Follow-up coverage after correction-capability changes: **5 passed**. The final focused Phase 2 rerun after the stale-form/privacy guards also passed **3 checks** (two live scenarios plus setup).
- Production web/worker builds: passed using isolated Next build output. Built worker readiness: passed against guarded test DB/Redis with provider/email dispatch disabled.
- Production dependency audit: **no known vulnerabilities**.
- Final diff whitespace check: passed with CRLF-aware checking. Generated Next type references were restored and transient result logs moved into ignored review output, retaining result summaries without provider authentication URLs.

The final UI writes carry the rendered participant version into the transaction and reject stale forms. Narrow correction grants cannot change the privacy acknowledgement/version, including crafted submissions; redundant acknowledgement leaves its original timestamp intact. Shared capabilities also suppress new employee links after deadline when manual post-deadline addition is authorised. Genuine AIA returns remain completable alongside unrelated approved requests, without unlocking unaffected reviewed workers.

Internal worker pages show masked import preview details and a reason/actor/time/zone change history, alongside requested, effective and historical approved zones. Existing authenticated sessions resolve current user status on every access without repeated no-op session writes. Administrator notification/email fan-out now uses bounded bulk inserts within the same transaction, retaining all recipients and idempotent messages; this prevents correction/submission timeouts as the synthetic catalogue grows.

Empty final submissions remain blocked. Removing the last worker invalidates effective access, but closing an empty registration requires an operator policy or adding a new eligible worker; this phase does not invent a closure workflow.

## Remaining launch requirements

1. Schedule and back up the actual target database, inspect the additive SQL, apply migrations/generate client, deploy matching web/worker builds and restart services together only when authorised. The operational PM2 services and their database have not been migrated/restarted here.
2. Rehearse deployment/rollback and restore on isolated staging. Revalidate real ingress/source attestation, multipart/chunked limits, image CPU/memory behaviour and Linux dependencies from the Phase 1 ingress document.
3. Complete controller-approved privacy notices, lawful basis/retention/deletion, provider/DPA evidence, backup/restore and access review identified in the pre-production audit. This phase does not resolve those policy/operational blockers.
4. Confirm the stricter correction/request scopes, whole-company pending-invitation revocation, skip-only imports and REMOVED-only reinstatement with operators. REPLACED restoration requires a defined replacement-cancellation policy and remains fail-closed.
5. Test the generated template in the actual supported Excel installation. Native workbook round-trip/dropdown inspection is automated; a human Excel editing session is not claimed.
6. Photograph ZIP ingest, edits from spreadsheet to existing staff, exporter/card/QR/scanner work and physical pass/WeBook rules remain outside this phase. Manual secure photo uploads and in-app zone/data corrections are the supported workflows.
