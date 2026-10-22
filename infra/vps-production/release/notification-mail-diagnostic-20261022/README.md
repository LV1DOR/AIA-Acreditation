# Notification mail delivery diagnosis

Run in VPS PuTTY:

    sudo python3 /home/luke/aia-accreditation-production-kit/release/notification-mail-diagnostic-20261022/diagnose.py

Enter the test leader mailbox at the hidden prompt. One bounded 384 MiB maintenance diagnostic uses the existing backup-reader credentials, verified PostgreSQL TLS, a READ ONLY transaction and documented Clerk GET user lookup. It does not claim/retry messages, send email, change configuration, or restart services. Reports contain only runtime metadata, booleans, counts, timestamps and allowlisted codes; no mailbox, user ID, credentials, notification content, provider message IDs or license contents. Original capacity admission remains enforced. Failed Clerk lookup falls back to an unambiguously accepted invitation mapping for DB inspection.

The report distinguishes notifications predating the current worker, missing email fanout, queued/unclaimed jobs, delivery failure, recipient scope/verification/routing and recorded provider acceptance. Provider acceptance is not inbox delivery. Do not resend uncertain or already accepted messages. Four local Python tests and TypeScript syntax validation passed; Docker/live runtime must be executed by the operator.
