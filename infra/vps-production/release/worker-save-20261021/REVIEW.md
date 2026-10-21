# Worker save correction and company leader's own details

Base: the deployed branding release debe402c7cd85914213a0c02f45f084d34d2abdea91467e7d5cc6941dabd94ad.

## Confirmed save blocker

Both updateParticipantByLeader and saveParticipantDraft accept privacyNoticeHash, but omitted it when calling recordPrivacyAcknowledgement. The production guard requires the presented hash. Correctly completed first-time worker saves therefore fail with PRIVACY_NOTICE_CHANGED. The patch forwards the already submitted hash in both calls. It does not calculate a replacement hash on behalf of the user or relax the guard. A genuinely changed notice now has a clear refresh-and-read-again message.

## Leader's own data

After invitation acceptance/sign-in, company leaders with an editable active registration must complete My details before opening the company workspace. Administrators are exempt. The page uses the existing worker fields, encrypted document handling, photo processing, privacy notice and normal review workflow. The leader counts towards the normal personnel limit. An explicit claim form can link an existing team record instead of creating a duplicate.

A server-generated leader-self:<application user UUID> operational reference uses the existing per-registration unique index. Clients cannot choose the user ID or overwrite another reference. Repeated/concurrent starts reuse one record. Existing erasure SQL already clears this reference; no new personal-data store, schema column or migration is introduced. Membership, event edit rules, quota, photos, privacy evidence and final approval checks remain enforced. Closed/read-only events and withdrawn records do not trap accounts in an impossible onboarding step. Erased registrations are excluded.

My details remains available from company navigation. The form reads the worker ID from the authenticated server mapping, not a submitted participant ID. Own-data completion does not approve the worker or submit the company automatically.

## Validation and deployment

Local: reproduced the old save and draft failure using the actual production notice guard, then verified forwarding and rejection of missing/forged evidence. Fifteen privacy/session-flow behaviour checks and TypeScript syntax checks passed. Real production-mode Zod/Prisma worker-save and self-profile tests, existing email/privacy tests and complete email/domain/web/worker/test typechecks must pass in the networkless PC test container before serial immutable builds.

All three application images use the same reviewed source material and unchanged pinned AIStor tools/client. Deployment imports only missing images, checks live capacity without changing limits, takes a fresh encrypted backup, updates release bindings and replaces web/worker. Automatic code rollback is retained. PostgreSQL/Redis/AIStor, volumes, secrets, TLS, Nginx, Volunteers and staging are not replaced. The brief existing backup pause includes ingress. No migrations, participant tests against production, or external emails are run by deployment. Copy the fresh encrypted backup off-VPS manually afterwards.
