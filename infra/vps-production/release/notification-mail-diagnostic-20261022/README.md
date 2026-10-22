# Notification mail delivery diagnosis

Run in VPS PuTTY:

    sudo python3 /home/luke/aia-accreditation-production-kit/release/notification-mail-diagnostic-20261022/diagnose.py

Enter the test leader mailbox at the hidden prompt. One bounded 384 MiB maintenance diagnostic uses the existing backup-reader credentials, verified PostgreSQL TLS, a READ ONLY transaction and documented Clerk GET user lookup. It does not claim/retry messages, send email, change configuration, or restart services. Reports contain only runtime metadata, booleans, counts, timestamps and allowlisted codes; no mailbox, user ID, credentials, notification content, provider message IDs or license contents. Original capacity admission remains enforced. Failed Clerk lookup falls back to an unambiguously accepted invitation mapping for DB inspection.

The report distinguishes notifications predating the current worker, missing email fanout, queued/unclaimed jobs, delivery failure, recipient scope/verification/routing and recorded provider acceptance. Provider acceptance is not inbox delivery. Do not resend uncertain or already accepted messages. Four local Python tests and TypeScript syntax validation passed; Docker/live runtime must be executed by the operator.

## Isolate delivery stages after confirmed terminal failures

    sudo python3 /home/luke/aia-accreditation-production-kit/release/notification-mail-diagnostic-20261022/probe_stages.py

This copies only /app/dist/main.js from the exact reviewed running worker image,
then uses one bounded tools diagnostic container. A TypeScript AST guard requires
the exact final main().catch startup expression and its known failure handler,
rejects other eager main invocations/public exports, preserves all other bundle
statements, and exports only the existing renderer/message-preparation/options
functions in a disposable tools-container file. Production image/code is never
patched and its startup is never executed by the probe. Synthetic rendering runs
in production mode against the actual built worker bundle, not just source tests.

Separately, it performs one SMTP implicit-TLS/auth verify (no MAIL FROM/sendMail)
and Clerk GET recipient lookup using the worker's existing read-only-mounted
configuration. SMTP verification does not establish sender acceptance or inbox
delivery: https://nodemailer.com/smtp . No DB connection, message claim/retry or
application restart occurs. A new protected report and public-code copy are kept;
no plaintext secrets are archived. Original memory admission remains enforced.

Local AST guard tests reject altered/missing tails and eager calls; error tests
ensure credentials cannot enter sanitized output. Root/scope/mount/no-send and
syntax checks passed. Operator execution is required for runtime results.
