Prepared staging update: unused event deletion and centred sidebar logo.

Run in normal PuTTY:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/events_release.py deploy
```

Expected final marker: `EVENTS_UPDATE_PASSED`. Stop on any `STOP:` or nonzero exit and inspect the named protected log; do not delete state, reset image references, rerun bootstrap or run migrations.

This builds a new cumulative immutable release (`events-ui-v1`) with the existing Dockerfile. It preserves the wizard links, privacy UI, communication cleanup and logger correction. It can upgrade directly from the original release, wizard fix, privacy v1 or corrected privacy v2; completing the superseded privacy build first is unnecessary. The prior active release is journalled for rollback. Existing base and previous-release secrets, source, image receipts and volumes stay intact. Completed new image builds are reused on retry.

Before activation: image-source proof, nine privacy UI/action scenarios, twelve cleanup scenarios, event deletion/action checks (using the image's locked Zod), actual worker type checking and existing Compose/auth/TLS/isolation validation. These test containers have no network or environment-secret mounts. They use mocked database boundaries; none deletes a live event or provisions a database. The normal Next build also checks the actual web source and types.

Only web and worker are replaced. PostgreSQL, Redis, AIStor, Mailpit and ingress container identities are checked and retained. No host Nginx/firewall, public exposure, database schema, migrations, credentials, license, certificate or storage policy changes. No container/volume removal or rebuild of storage dependencies.

Logs: `events-build-web.log`, `events-build-worker.log`, `events-build-tools.log`, `events-image-check.log`, `events-check-ui.log`, `events-check-cleanup.log`, `events-check-event-delete.log`, `events-check-worker-types.log` under the existing protected logs directory. Shared activation/recovery logs retain the names `wizard-activate.log`, `wizard-rollback.log`, `wizard-ingress-ready.log`.

On activation failure, expected recovery marker `EVENTS_UPDATE_FAILED_ROLLED_BACK` means the prior app release was restored. If recovery itself fails, preserve everything and inspect its protected log. No dependency/volume is removed to recover.

After success, hard-refresh the browser. In Setup, select an accidental event and choose **Delete event** below its event summary. Check the event name in the confirmation dialog before choosing **Delete permanently**. The server allows this only for an unused draft, with the current version and ADMIN authentication. A published event must first be returned to Draft through Edit event; any existing companies/people/protected history still blocks deletion even after unpublishing.

Deleting an eligible event removes only its event row and event-zone selections. It preserves shared zones, job roles, other events and the audit trail. Its own banner is queued for the existing verified worker storage cleanup, including version-aware erasure. Companies, participants, approved notices, privacy evidence/policy/holds, erasure/storage jobs, notifications or non-invalidation communications block this action. They are never cascade-deleted. Restore quarantine blocks deletion too. This is not a GDPR-erasure shortcut.

Synthetic verification after deploy: create an empty draft with an unmistakable synthetic name; select it; cancel deletion once and confirm it remains; then confirm deletion and check it disappears from Setup and the event selector. Other events and shared catalogues must remain. Do not test deletion on a real populated event. No deletion is automatically executed by the deployment command.

Explicit application rollback, if needed after activation:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/events_release.py rollback
```

Expected `EVENTS_ROLLBACK_PASSED`. This restores the previous application images; it cannot undo an event deletion you confirmed after deployment. There are no schema migrations to undo.

The sidebar logo is horizontally centred in its existing slot, including its contained image. No brand asset was changed.

This is a private staging update. Synthetic labels, Mailpit, Clerk development configuration and launch checks remain accurate. See [PUBLIC-LAUNCH.md](../../PUBLIC-LAUNCH.md) for operator inputs needed before a real public launch.
