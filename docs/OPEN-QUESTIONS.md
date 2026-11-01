# Open questions

Do not invent answers or present suggested policies as approved.

- Confirm WeBook accepts AIA-generated stable UUID-based Base64 codes rather than requiring values from an issued pool; confirm external reuse/reassignment and replacement consequences.
- Which hard completion rules, if any, may be waived by explicit AIA override.
- Whether AIA approval should require an optional internal comment in a later refinement. Phase 5 intentionally requires reason and comment only for return/rejection, matching the approved handoff invariant.
- Final privacy text from Mariana. The Phase 4 acknowledgement mechanism is implemented with a versioned `TODO-v1` placeholder, but no live or production onboarding may use invented legal wording.
- Retention purpose, purge scope, deadline and minimal historical record. Event end +30 days is proposed, not approved.
- Actual WeBook import template and Matica MC210 spreadsheet/print layout. WeBook confirmed QR values are Base64 alphanumeric strings up to 255 characters and maps supplied zones to ticket types; exact import template remains unconfirmed.
- Production zone/job-role values: entered by AIA, no fabricated production seeds.
- Operational event/company values, personnel limits and leader recipients: entered by an authorised AIA administrator in the Phase 3 setup portal; no production values are seeded.
- Clerk development values are present locally and validate. The complete eight-scenario Playwright run passed, Invite-only mode is confirmed, Organization membership is non-mandatory, and the first individually authorised verified-email admin was bootstrapped on 2026-09-23. Clerk Dashboard signature delivery and the encrypted SMTP bridge to Mailpit are verified locally. Production Clerk, domain and SMTP evidence remain separate deployment requirements.
- Names/Clerk user IDs of any additional individually authorised AIA admins. Each must have a verified Clerk email before the controlled bootstrap command will map the account to the internal ADMIN role.
- SMTP server credentials, verified sender/return-path and DNS records for nonlocal mail. Local Mailpit needs no external account.
- Purchased/verified domain and Resend credentials before the separately reviewed future provider cutover. Postmark is excluded.
- Production reminder operating policy: the local implementation sends idempotent reminders at 7, 3 and 1 calendar days before onboarding close. Confirm whether those intervals and recipients should change before production.

Confirmed user amendment (2026-09-21): SMTP now; Resend after domain purchase. No Postmark integration.

The questions above do not block the local data/domain foundation. They block their respective dependent features.

Phase 6 is locally implemented. A leader may remove a person before the onboarding deadline while the registration is editable; removal preserves the record and audit history, revokes unused employee links and frees the active personnel place. An emergency replacement is AIA-approved first, retires the original and creates one linked draft without changing capacity; leader completion is followed by a new final submission and normal AIA review. Approved extra-personnel requests raise the formal limit atomically.

Phase 7 is locally implemented with React Email rendering, the current SMTP transport, durable delivery rows, bounded leases/retries, Redis Pub/Sub invalidation, authenticated SSE refresh and 7/3/1-day deadline reminders. Live production sender-domain, proxy and multi-instance evidence remains unresolved and is not implied by local Mailpit/Redis validation.
