# Phase 3 local operations

This workflow is implemented and validated locally. It does not authorise production use.

## Administrator

Open `/{locale}/admin/setup` with an internal `ADMIN` account.

1. Create the event with calendar dates, onboarding opening/closing instants and the intended IANA time zone. The default is `Europe/Lisbon`.
2. Create or update global zones and job roles. Deactivation preserves historical references; a zone requested by a company cannot be deactivated.
3. Activate the required zones for the event. Event-zone deactivation is refused while a company still requests that zone.
4. Create the company, then create its event registration. The personnel limit defaults to 10 and can be changed only by an administrator.
5. Send the leader invitation to the intended verified Clerk email. The link is queued through the encrypted SMTP outbox and expires after the chosen number of days. Pending invitations can be revoked.
6. Change the event status to `ONBOARDING_OPEN` only when leaders should be able to edit and the configured opening/closing instants include the current time.

Updates use record versions. If another operator saves first, the stale form is refused; reload before retrying.

## Company leader

After accepting the email-matched one-time invitation, open the company portal and choose **Configure registration**.

- Select only the zones required by the whole company. V1 does not support per-worker zones.
- If a vehicle pass is required, enter a positive quantity and a justification. Do not enter plates, vehicle identities or driver details.
- Saving replaces the company-wide zone selection and current vehicle request atomically.

Leaders can edit only during the event's open onboarding window and only while the registration is `DRAFT` or `RETURNED_FOR_CORRECTION`. They cannot change company membership, personnel limits, statuses or approval decisions.

## Email and local verification

Keep the web and worker running. Local invitation email appears in Mailpit at `http://127.0.0.1:18025`. The raw invitation token is hashed in the invitation table and encrypted while pending in the email outbox; successful delivery scrubs the encrypted payload.

Use only synthetic recipients locally. Resend remains the planned provider after domain purchase and verification; Postmark is not used.
