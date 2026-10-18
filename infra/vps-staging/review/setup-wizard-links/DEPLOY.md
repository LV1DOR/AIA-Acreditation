Deploy the reviewed wizard-link fix to the existing private staging installation.

The user authorized deployment. This Codex session cannot access privileged Docker or write the original `/opt` checkout. All privileged work is packaged in a staging-only operator command. The updater reuses the existing Dockerfile, three Compose files and `aia-accreditation-staging` project. It leaves the Git checkout clean and makes no commits or pushes.

Run in normal PuTTY and keep the session open:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/wizard_release.py deploy
```

This command:

1. Checks the existing staging target, readiness marker, original build/source identity, current images, protected configuration and the exact reviewed kit transition. It refuses concurrent updater runs.
2. Copies **only the recorded application build inputs** into a protected candidate under `state/releases/wizard-links-v1/source`. It changes exactly four redundant query parameters in one file and verifies the expected file hashes. No environment, secret, license, Git metadata or unrelated VPS data enters that build context.
3. Builds web, worker and tools with the existing pinned Dockerfile and frozen dependency lock. All three use the same reviewed source hash and immutable image IDs. The unchanged build stages are cached across targets; the application build is not repeated unnecessarily. Previously completed role builds are reused on retry. No MinIO/mc selection or download is repeated.
4. Verifies the patched file's hash inside the newly built tools image in a network-disabled retained utility container. It validates the candidate Compose configuration with the existing isolation/authentication/TLS/resource checks before application replacement.
5. Replaces **only web and worker containers**, as authorized by the deployment request, through scoped Compose `up --no-deps`. Their previous images remain available for rollback. PostgreSQL, Redis, AIStor, Mailpit and ingress are not restarted or recreated; their container IDs must remain unchanged. Existing nginx resolves Docker DNS dynamically, so no proxy reload is needed.
6. Checks actual running image IDs, web/worker/container readiness, the existing synthetic database marker/restricted roles through the existing read-only maintenance check, Mailpit and the private HTTPS readiness endpoint with certificate verification. No database creation, migration, storage provisioning or acceptance fixtures are executed.

Expected progress: `VALIDATION_PASSED`, `BUILDING web/worker/tools` (unless a completed build is reused), `WIZARD_CANDIDATE_PASSED`, another `VALIDATION_PASSED`, `ACTIVATING_WEB_AND_WORKER`, and finally **`WIZARD_UPDATE_PASSED`**. Build output is in protected `state/logs/wizard-build-ROLE.log`; it is not printed. The image-proof job and maintenance jobs are retained.

Before `ACTIVATING_WEB_AND_WORKER`, any failure stops with the existing services running. A failure during activation automatically selects the original images again, replaces only the application containers, and checks recovery. Expected failure recovery: `WIZARD_UPDATE_FAILED_ROLLED_BACK`. If `WIZARD_ROLLBACK_REQUIRES_ATTENTION` appears, stop and inspect the named protected logs; do not start infrastructure, prune Docker resources, delete volumes or run migrations. Never paste raw configuration or unreviewed logs into chat.

After an interrupted build or activation, rerun the same `deploy` command. Completed role builds and recorded candidate source are verified and reused. A successful deployment repeated later performs readiness checks without rebuilding or restarting the healthy application. A still-running updater refuses a second invocation.

After success, hard-refresh the browser with Ctrl+Shift+R, return to the saved event's Catalogues page, and click Continue. Expected: Review, step 3, with exactly one `eventId`. Test Review's catalogue Edit links and Previous as well. Saved event/catalogue data and Clerk identity remain in the existing staging database. This final authenticated browser check remains an operator check; HTTP readiness alone does not claim to exercise that UI.

Additional private readiness check:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/wizard_release.py check
```

Expected: `WIZARD_RELEASE_READINESS_PASSED`. Existing `deploy.py check`, `status`, `start`, `stop`, tools and validation also select the active release automatically. Original `images.json`, `compose.env`, materials/AIStor receipts and the base release manifest are preserved. The release has its own immutable receipt/environment file and an atomic active pointer; this does not relabel or rewrite the original images as a new build.

Explicit rollback, if the UI still has a problem:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/wizard_release.py rollback
```

Expected: `WIZARD_ROLLBACK_PASSED`; the original application images and readiness are restored. Both release images, source, logs and all persistent data remain. The navigation bug will return on the original version. No database rollback is performed or needed for this UI-only change.

Local validation: 27 Python regression tests, Python compilation and the English/Portuguese route-expression regression passed without Docker infrastructure, privileged operations or live data access. Tests cover exact source delta, preserving original receipts/configuration, selecting the active release, rejecting storage configuration changes, partial-build reuse, interrupted activation, failure rollback and limiting service replacement to web/worker.
