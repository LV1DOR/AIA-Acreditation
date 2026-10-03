# Authentication setup and verification

Phase 2 uses Clerk for identity and PostgreSQL for all application roles and company authority. Clerk metadata never assigns an AIA role or company. This document covers local/development setup only; it does not authorise production deployment.

Current implementation was checked against Clerk's current Next.js middleware, session-token, restricted-access, webhook, self-delivery and Playwright guidance:

- https://clerk.com/docs/reference/nextjs/clerk-middleware
- https://clerk.com/docs/guides/sessions/session-tokens
- https://clerk.com/docs/guides/secure/restricting-access
- https://clerk.com/docs/guides/development/webhooks/syncing
- https://clerk.com/docs/guides/development/troubleshooting/email-deliverability
- https://clerk.com/docs/guides/development/testing/playwright/overview

## 1. Create and restrict the development instance

In a Clerk development instance:

1. Set Access mode to **Invite-only** (`restricted`).
2. Require an email address and enable a supported sign-in method. Email plus password is the documented Playwright baseline; email-code testing is also supported.
3. Disable self-service email-address changes if AIA wants the invited identifier fixed after onboarding. Regardless of this setting, invitation acceptance uses only a Clerk-verified matching email.
4. Keep every admin on an individual Clerk account. Do not create a shared AIA account.
5. Keep Clerk Organizations disabled. If the feature is needed for another reason, set Organization membership to optional and prevent user-created Organizations. AIA company authority comes only from PostgreSQL membership created through the internal invitation flow; requiring a Clerk Organization blocks synthetic and invited users on Clerk's `choose-organization` session task.

The app also hides sign-up unless a valid internal invitation token is present. Clerk Invite-only mode is still mandatory because it is the identity-provider control against direct sign-up attempts.

## 2. Add local secrets without committing them

Copy the four values into the existing untracked root `.env`; never add them to `.env.example`, source, docs or screenshots:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
AUTH_EMAIL_ENCRYPTION_KEY=<64 lowercase hex characters>
```

Generate the email payload key in PowerShell:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
```

`APP_ORIGIN` must be the canonical origin used for application links and email delivery. HTTP is accepted only for `localhost` or `127.0.0.1`; nonlocal origins require HTTPS. For a temporary development tunnel, add its exact origin to the comma-separated `AUTH_ADDITIONAL_ORIGINS` value. These origins are accepted only as additional Clerk authorised parties; they do not replace the canonical application origin. Missing, partial or malformed authentication configuration leaves the portal visibly unavailable and makes `/api/health/ready` return 503.

```text
APP_ORIGIN=http://localhost:3100
AUTH_ADDITIONAL_ORIGINS=https://your-current-tunnel.trycloudflare.com
```

Keep this list explicit and short. Remove expired tunnel origins, and set production `APP_ORIGIN` to the real public HTTPS origin rather than using a tunnel value.

## 3. Configure the signed email webhook

Expose the local web server through a temporary HTTPS tunnel approved for development, then add a Clerk webhook endpoint ending in:

```text
/api/webhooks/clerk
```

Subscribe only to `email.created` for this bridge and copy that endpoint's signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`. The route is intentionally public because Clerk webhooks have no user session; the Clerk Standard Webhooks signature is the authentication mechanism.

Do not disable Clerk delivery yet. First use the Clerk Dashboard webhook tester and confirm a signed example receives a 2xx response. Unsigned/modified payloads must return 400 and payloads larger than 1,000,000 bytes must return 413.

For each Clerk authentication template that AIA chooses to self-deliver, turn off **Delivered by Clerk** only after the web process, worker and SMTP destination are all running. Clerk then emits `email.created`; the app stores an encrypted, deduplicated outbox payload and the worker delivers it using the existing SMTP transport. For local verification, inspect only synthetic messages in Mailpit at http://127.0.0.1:18025.

Resend remains the planned future provider after domain purchase and verification. Do not add Postmark.

## 4. Bootstrap an individual admin

Create the admin in Clerk and verify their email. Then run the controlled mapper with the Clerk user ID (not an email address):

```powershell
$env:CLERK_ADMIN_USER_ID = 'user_...'
$env:ADMIN_BOOTSTRAP_CONFIRM = 'CREATE_VERIFIED_ADMIN'
corepack pnpm auth:bootstrap-admin
Remove-Item Env:CLERK_ADMIN_USER_ID
Remove-Item Env:ADMIN_BOOTSTRAP_CONFIRM
```

The command verifies the Clerk email through Clerk's Backend API, creates only the internal ADMIN mapping, and appends a SYSTEM audit event. It refuses to promote an existing company leader or revive a disabled user.

## 5. Run live Phase 2 verification

Prepare the isolated `aia_acreditacao_test` database and apply migrations, then install Chromium once if needed:

```powershell
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
corepack pnpm test:e2e:clerk
```

The ordinary E2E command always tests the no-Clerk fail-closed state. When all live values exist it also runs Clerk-backed tests for unauthenticated redirects, mapped admin access, Phase 3 setup mutations, company-leader access/configuration, one-time invitation acceptance, expired/revoked invitations and company isolation. `test:e2e:clerk` deliberately fails immediately when live configuration is absent, so missing external verification cannot be reported as a pass.

The live suite accepts only Clerk development (`pk_test_` / `sk_test_`) keys, creates unique synthetic Clerk test users with verified `+clerk_test` emails, removes those Clerk users afterward, and writes synthetic fixtures only to the loopback `aia_acreditacao_test` database. It refuses production keys/databases and must never use real people.

Company invitations must be accepted with a separate company-leader identity whose verified Clerk email exactly matches the invited address. An internal `ADMIN` identity cannot accept a company invitation or change itself into a leader. To test both roles, use two different verified email addresses/Clerk users. If a new invitation was generated after revocation, use the newest email link; earlier links remain unavailable by design.

Direct account creation is disabled. A new leader first opens the AIA email link, then chooses **Create an invited account**. The server validates the hashed AIA invitation cookie and creates a non-emailing Clerk application invitation whose ticket opens the localised sign-up route. The sign-up component renders only when both that valid cookie and Clerk's `__clerk_ticket` are present. Existing invited leaders choose **Sign in** instead. Clerk remains in Invite-only access mode; do not enable public sign-up.

## Phase 2 completion gate (satisfied locally)

- Clerk development instance is Invite-only.
- Clerk Organizations are disabled, or membership is optional with user-created Organizations disabled.
- At least one individual admin has a verified Clerk email and has been mapped through the controlled bootstrap.
- All four local values validate without entering Git.
- Live Clerk Playwright suite passes.
- A signed `email.created` example is accepted, appears encrypted in the outbox, is delivered by the worker to local Mailpit, and is scrubbed after delivery.
- An unsigned/modified webhook is rejected and an oversized body returns 413.

These items remain mandatory for any new environment. The evidence below satisfies the gate only for the current local Clerk development instance.

## Local Phase 2 evidence — 23 September 2026

- Invite-only access was confirmed in the Clerk development instance.
- Clerk Organization membership was made non-mandatory and the current 11-test Playwright run passed.
- The first individually authorised administrator was verified through Clerk and mapped by the guarded bootstrap command.
- Clerk Dashboard successfully delivered a signed `email.created` example to the exact public webhook route.
- The already-delivered Clerk example was not duplicated. A signed undelivered example was encrypted in the outbox, delivered through SMTP to local Mailpit and scrubbed after processing.
- Modified signatures and oversized request bodies are rejected by automated integration coverage.

This completes local Phase 2 evidence. It does not establish production readiness or replace the production requirements in `docs/DEPLOYMENT.md` and `docs/SECURITY.md`.
