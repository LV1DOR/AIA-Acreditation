Public launch: not ready merely by configuring Resend.

This installation was intentionally created as private, synthetic-only staging. The code includes a production configuration path, but the current deployment kit enforces staging, development Clerk, synthetic DB identity, localhost origin and capture-only email. Do not turn off those checks or promote the staging environment by changing a few flags. Public launch remains a separate deployment step, with a fresh isolated production database/storage/credentials and a real-domain build, using the existing Compose architecture. Do not copy synthetic accounts, test registrations or test notices into it. Volunteers remains untouched.

What the labels mean:

| Label | Actual condition | What resolves it |
| --- | --- | --- |
| Test environment · synthetic data only | `syntheticMode()` is true in this deployment. | A separately configured, verified production installation. Staging should retain this label. |
| Operator setup needed | The application has no recorded verified, undeleted Accreditation backup. It does not establish whether unrelated/external backup files exist. | Configure Accreditation backups, verify one, copy it off this VPS and successfully restore to an isolated target. Volunteers backups and acceptance JSON do not count. |
| Test notice in use | No published version is supplied for that notice; synthetic mode permits fallback development wording. | AIA-approved Portuguese and English worker notice and leader declaration, published in production. Notices published in staging are tagged synthetic. |
| Awaiting AIA policy | No matching approved event retention policy is configured. | An operator records AIA's approved retention policy outside the client-facing UI. Do not invent legal dates or silently enable deletion. Production collection requires this policy as well as approved notices. |

Your tasks, in order:

1. Choose the website address.
   Send the intended public hostname, for example `accreditation.example.com`, and say who controls its DNS. Have access to that DNS account. A real HTTPS certificate and renewal must be configured before public access; the current private CA/SSH tunnel is for staging. Do not change DNS/host Nginx/firewall yet: the exact routing must first be prepared for the approved hostname, preserving other services.

2. Prepare production sign-in in Clerk.
   Open the dedicated Accreditation app in Clerk Dashboard. Open the Development/Production selector, create a production instance and follow its domain/DNS setup. Keep account creation invitation-only according to the app's workflow. The production instance has different users and keys; the synthetic test administrator is not a real production administrator. Supply the approved initial admin email/identity. Live publishable/secret keys and a separate webhook signing secret must be stored in protected files; never paste secret keys here. We configure the actual public origin, redirects and signed Clerk webhook together. A new web image must be built with the live publishable key; an environment edit cannot replace the key embedded in a staging build.

3. Prepare Resend.
   Add/verify the desired sending domain in Resend, add exactly the DNS records it supplies, choose the sender address and create a dedicated sending API key (restricted to that domain where available). Store the key privately on the VPS. Tell me the domain and sender address, without the key. Approve a test recipient you control so we can check one actual delivered message and its authentication results. Existing SMTP/template/queue/worker logic can use Resend; the staging kit must keep Mailpit as its default. Enabling external delivery needs an explicit scoped configuration; do not route accumulated synthetic jobs to real mailboxes. Sign-in messages handled directly by Clerk require the corresponding Clerk email-delivery setup too; the worker SMTP setting does not automatically change Clerk's dashboard configuration.

4. Obtain AIA's actual privacy wording and retention decision.
   Have AIA supply/approve both PT/EN texts: worker privacy notice and company-leader declaration, with the correct AIA contact and approval reference. The existing Privacy & system status page is where an administrator publishes the approved wording, per event. Production must publish new non-synthetic versions. AIA must also approve its internal retention/cleanup and backup policy. This remains operator-managed; clients do not enter dates or manage holds. A generic statement about legal retention cannot replace these required production records. No legal period is guessed by the software or this deployment work.

5. Choose backup storage and an alert recipient.
   Supply an off-VPS backup destination you control, approved backup frequency/retention, and who should receive operational alerts. Encryption/recovery keys must be recoverable separately from the VPS. I can prepare the existing backup/monitor templates for the selected target; you run the necessary sudo installation steps. A successful encrypted backup and isolated restore must be demonstrated before accepting real data. Alerts should cover unavailable web/worker, failed mail, old/failed backups, storage/disk capacity and TLS expiry. An occasional manual copy is not a verified scheduled backup system.

6. Complete one real deployment acceptance flow.
   Once the above inputs are ready, we prepare exact production configuration/commands using the existing Dockerfile and Compose architecture, a dedicated project and fresh production resources; we do not convert staging data. Before public cutover, verify the real admin sign-in, company invitation, worker entry/photo upload, company submission, administrator approval, email receipt, failed-send handling and backup/restore. Test actual upload scanning/configuration on the selected target as part of the flow. Keep internal service ports private. Review the final URL, source/image IDs and rollback plan, then give explicit approval for public routing and real-data collection. No public exposure is authorised or performed by the event UI update.

What I can prepare without external account access: application/UI fixes, reviewed release files, protected configuration helpers, exact scoped PuTTY commands and deployment/verification steps. Your unavoidable inputs are DNS/provider account actions, approved AIA wording/policy, backup/alert choices, private credentials and the privileged commands this sandbox cannot execute. There is no need for you to edit application source or modify unrelated services.

First response needed: the intended public hostname, Resend sender domain/address, and whether you already have a Clerk production instance. Share names/status only, never secrets. Missing inputs are specific setup work, not a request for another broad audit. The public-readiness conclusion remains BLOCKED pending this production setup and actual acceptance; passing staging readiness alone is insufficient.

References: [Clerk production deployment](https://clerk.com/docs/guides/development/deployment/production), [Resend SMTP setup](https://resend.com/docs/send-with-smtp). Local implementation: `packages/config/src/deployment-env.ts`, `packages/domain/src/privacy/notices.ts`, `packages/domain/src/operations/monitoring.ts`, existing production Compose/environment/backup/monitor templates. Earlier repository acceptance/runbook documents remain available; this page lists the immediate operator work rather than repeating their full audit.
