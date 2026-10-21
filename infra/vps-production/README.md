# Reviewed VPS production operator code

Code-only export of the existing isolated production kit. Private state, images,
archives, approvals, configuration values, keys, TLS and licences are excluded.
Use the installed `/home/luke/aia-accreditation-production-kit`; copying this folder
does not authorise deployment or recreate its protected operator state.

The branding release reuses the exact public PNG already in the portal sidebar.
`packages/email/src/logo.ts` is a generated base64 representation of that public
artwork; a unit test compares its decoded bytes with the original PNG. SMTP uses
an inline CID attachment, without remote image loading or tracking pixels.

Invitations, all ten business templates and other messages sent through the
application SMTP adapter use the branded layout. Existing plaintext, verification
codes, invitation capabilities, encryption, deduplication and TLS remain intact.
Messages delivered directly by Clerk must be branded in Clerk's dashboard.
No Clerk delivery setting is changed by this release.

The PC workflow runs real template/JSON-transport unit tests and email/domain/web/
worker/test typechecks in a new networkless test container before serial builds.
It exports three immutable images, verifies the bundle after transfer, then pushes
prepared Git commits without force. No VPS service is changed by the PC workflow.

The separately approved VPS wrapper imports the images, takes a fresh encrypted
backup with a brief writer/ingress pause, updates release bindings and replaces
only web and worker. It verifies private/public TLS readiness and restores the
previous code release on failure. Database schema, migrations, persistent data,
credentials, host Nginx, Volunteers and staging are unchanged. New encrypted
backups still require manual off-VPS custody. No monitoring timers are installed.

The build context retains the reviewed production source material, including
earlier launch fixes. `review/branding-20261021` records exact file hashes and a
patch against its named Git commit so it can be reproduced without silently
reverting newer repository-only work. The reviewed AIStor IAM files are preserved
in `reviewed-storage-ops` for the Dockerfile's named `reviewed-ops` context.

Local validation: all TypeScript files parsed, nine existing privacy behaviour
checks passed, logo bytes matched, schema/migration hashes matched, and nine
offline deployment transaction tests passed. Real email/type tests and image
builds run on the operator PC; their success is not claimed until their receipt
exists. Production deployment and inbox rendering require operator verification.
