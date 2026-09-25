# Open questions

Do not invent answers or present suggested policies as approved.

- WeBook QR reuse/reassignment, QR value uniqueness scope, and replacement consequences for assigned/exported QR codes.
- Which hard completion rules, if any, may be waived by explicit AIA override.
- Whether AIA approval should require an optional internal comment in a later refinement. Phase 5 intentionally requires reason and comment only for return/rejection, matching the approved handoff invariant.
- Whether removed/replaced participants free capacity; how pending replacements reserve slots.
- Final privacy text from Mariana. The Phase 4 acknowledgement mechanism is implemented with a versioned `TODO-v1` placeholder, but no live or production onboarding may use invented legal wording.
- Retention purpose, purge scope, deadline and minimal historical record. Event end +30 days is proposed, not approved.
- Actual WeBook import template and Matica MC210 spreadsheet/print layout. Provisional adapters remain required.
- Production zone/job-role values: entered by AIA, no fabricated production seeds.
- Operational event/company values, personnel limits and leader recipients: entered by an authorised AIA administrator in the Phase 3 setup portal; no production values are seeded.
- Clerk development values are present locally and validate. The complete eight-scenario Playwright run passed, Invite-only mode is confirmed, Organization membership is non-mandatory, and the first individually authorised verified-email admin was bootstrapped on 2026-09-23. Clerk Dashboard signature delivery and the encrypted SMTP bridge to Mailpit are verified locally. Production Clerk, domain and SMTP evidence remain separate deployment requirements.
- Names/Clerk user IDs of any additional individually authorised AIA admins. Each must have a verified Clerk email before the controlled bootstrap command will map the account to the internal ADMIN role.
- SMTP server credentials/sender for nonlocal mail. Local Mailpit needs no external account.
- Purchased/verified domain and Resend credentials before provider cutover.

Confirmed user amendment (2026-09-21): SMTP now; Resend after domain purchase. No Postmark integration.

The questions above do not block the local data/domain foundation. They block their respective dependent features.

Phase 5 is locally implemented. It does not resolve whether removed/replaced participants free capacity, because those transitions are not exposed yet; that decision must be made before Phase 6 replacement/removal workflows. An administrator can raise a personnel limit through the Phase 3 control, while the formal requested-and-approved extra-person workflow belongs to Phase 6.
