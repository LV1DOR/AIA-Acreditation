# Phase 3 local operations

This workflow is implemented and validated locally. It does not authorise production use.

## Administrator

Open `/{locale}/admin/setup` with an internal `ADMIN` account.

1. Create the event with compact pop-up calendar selectors for its dates and clock-enabled date-time selectors for onboarding opening/closing instants. Only one selector can be open at once. The default IANA time zone is `Europe/Lisbon`.
2. Create or update zones and job roles. Their internal sort order is not a personnel limit and is no longer exposed in this setup form. Deactivation preserves historical references; a zone requested by a company cannot be deactivated.
3. Activate the required zones for the event. Event-zone deactivation is refused while a company still requests that zone.
4. Create the company, then create its event registration. The personnel limit defaults to 10 and can be changed only by an administrator.
5. Send the leader invitation to the intended verified Clerk email. The link is queued through the encrypted SMTP outbox and expires after the chosen number of days. Pending invitations can be revoked.
6. Keep an event as **Draft** while preparing it, then select **Published / live** when it should be usable. The application derives onboarding-open, onboarding-closed, active and completed phases from the configured dates; those internal lifecycle phases are not manually selectable.

Updates use record versions. If another operator saves first, the stale form is refused; reload before retrying.

## Company leader

After accepting the email-matched one-time invitation, open the company portal and choose **Configure registration**.

- Select only the zones required by the whole company. V1 does not support per-worker zones.
- If a vehicle pass is required, enter a positive quantity and a justification. Do not enter plates, vehicle identities or driver details.
- Saving replaces the company-wide zone selection and current vehicle request atomically.

Leaders can edit only during the event's open onboarding window and only while the registration is `DRAFT` or `RETURNED_FOR_CORRECTION`. They cannot change company membership, personnel limits, statuses or approval decisions.

## Email and local verification

Keep the web and worker running. Restart the worker after pulling or changing email-handler code so that it loads the current handlers. Local invitation email appears in Mailpit at `http://127.0.0.1:18025`. The raw invitation token is hashed in the invitation table and encrypted while pending in the email outbox; successful delivery scrubs the encrypted payload.

The **Pending** label in the administrator UI describes whether the invitation has been accepted; it is not an SMTP delivery status. Local delivery can be confirmed in Mailpit and by the processed outbox record.

Use only synthetic recipients locally. Resend remains the planned provider after domain purchase and verification; Postmark is not used.
