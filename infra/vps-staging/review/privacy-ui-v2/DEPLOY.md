Privacy interface simplification and automatic communication metadata cleanup — corrected release `privacy-ui-v2`.

The user authorized rebuilding and staging deployment. Docker and privileged execution remain unavailable in this Codex session. All application work is in the reviewed overlay; the original `/opt/aia-accreditation` checkout and running infrastructure are unchanged during preparation.

Run this in normal PuTTY:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/privacy_release.py deploy
```

Expected final marker: **`PRIVACY_UPDATE_PASSED`**. Keep the SSH session open during the build. Stop for any nonzero exit or `STOP:`; do not run bootstrap, storage provisioning or migrations.

The previous `privacy-ui-v1` candidate built all three images but failed worker TypeScript checking: its `COMMUNICATION_CLEANUP_FAILED` logger argument was not in `LogCode`. The only application-source difference in v2 is using the existing `CLEANUP_FAILED` logger code; the detailed operational heartbeat is unchanged. The failed v1 candidate, images and receipts are preserved. A separate v2 source directory and image receipts prevent overwriting immutable references. The additional kit transition is recorded in a new protected `privacy-logger-fix-kit.json`, preserving earlier receipts.

Before any new build, the updater uses the retained v1 tools image with the corrected worker source file mounted read-only to run the real worker type check. This container has no network, no database access and no environment-secret mounts. Failure stops before builds/activation; inspect `privacy-logger-preflight.log`. The rest of the source must match v1 exactly. New matching-source immutable web/worker/tools images are required because the application source changed; existing Docker build cache is retained.

The updater reuses the previous staging release mechanism, the same pinned Dockerfile and the existing three Compose files/project. It builds web, worker and tools from one cumulative reviewed source snapshot, including the earlier wizard navigation correction. Completed role builds are reused on retry. Before activation it verifies image source hashes, runs the UI/action and cleanup checks in network-disabled utility containers, type-checks the worker, and performs the existing Compose/auth/TLS/isolation validation. Next's normal web build performs its build/type validation.

Only web and worker containers are replaced. PostgreSQL, Redis, AIStor, Mailpit and ingress are preserved and their container IDs checked. No host Nginx, firewall, secret, certificate, bucket, license or volume change is performed. There are no database schema changes or migrations. Normal staging commands continue to select the active release through the protected pointer.

The previous active release is recorded before activation. A failed activation restores that release (normally `wizard-links-v1`, rather than unnecessarily reverting to the original unpatched application). Expected recovery marker: `PRIVACY_UPDATE_FAILED_ROLLED_BACK`. Old application images, release receipts and source remain available. The exact software transition has its own private receipt; earlier build/AIStor/wizard receipts are preserved. Do not edit image IDs or review receipts to bypass a failure.

Relevant protected logs are under `/home/luke/.local/share/aia-accreditation-staging/logs/`:

- `privacy-build-web.log`, `privacy-build-worker.log`, `privacy-build-tools.log`.
- `privacy-image-check.log`, `privacy-check-ui.log`, `privacy-check-cleanup.log`, `privacy-check-worker-types.log`.
- The shared updater still uses `wizard-activate.log`, `wizard-rollback.log` and `wizard-ingress-ready.log` for application activation/recovery/readiness.

Do not paste raw configuration, secrets or unreviewed logs into chat. Python failures emit a sanitized protected traceback. A browser build or type error stops before application replacement; inspect its named build/check log privately.

After success, Ctrl+Shift+R and open:

```
https://localhost:18443/en/admin/operations
```

Expected UI: Privacy notices and Service status cards, delivery issues collapsed until needed, and a short cleanup history. There are no retention-date inputs, hold controls, manual communication-purge buttons or complicated per-copy erasure controls. Notice publication still requires ADMIN access and approved bilingual wording. The page no longer accepts the removed destructive action intents through crafted form submissions.

Routine communication cleanup checks hourly; its first run is after one hour, allowing deployment checks to finish first. It uses only already-approved event-policy dates and the existing global authentication-metadata cutoff/reference. No legal period or arbitrary TTL is invented. If no approved policy/cutoff exists, corresponding records are left untouched and the page honestly shows that the AIA policy is pending. The policy is operator-managed; clients do not configure dates. No actual deletion rule was supplied during this change.

Cleanup is restricted to old, completed/terminal communication records and their delivery identifiers; active leases, queued messages, newer data and other events are preserved. Each batch is bounded and idempotent, and records a SYSTEM audit entry without message contents. Existing internal holds, synthetic/production scope and restore quarantine remain enforced. It does not erase participant records, photos, backups, accounts or external-provider copies. Those existing safeguards and separately privileged erasure workflows are unchanged. The client can see simple cleanup results without managing those controls.

Approved notices remain the place for AIA's actual retention information/criteria. The new concise administrative helper text is not a substitute for AIA-approved privacy wording and does not assert an indefinite legal retention right.

Additional readiness check:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/privacy_release.py check
```

Expected: `RELEASE_READINESS_PASSED`.

Explicit image rollback:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/privacy_release.py rollback
```

Expected: `PRIVACY_ROLLBACK_PASSED`. It restores the recorded previous images, without touching infrastructure or volumes. Image rollback does not recover metadata already cleaned under an approved policy; scheduled cleanup intentionally starts after the first hour. A successful repeated deploy checks readiness without rebuilding/restarting healthy services. An interrupted build/activation can be resumed using the same deploy command.

Local checks passed: 39 Python regression tests (including the exact logger-contract regression and additive receipt upgrade), nine actual view/controller/action scenarios in English/Portuguese, twelve communication-cleanup scenarios, and the wizard routing regression. Original source hashes and the exact overlay delta were verified. TypeScript syntax was checked locally; full framework/worker type checking and live readiness run in the operator build. A static preview rendered from the actual view code is available in `preview.html`; local browser screenshot execution was unavailable because the cached Chromium lacks the host `libnspr4.so` dependency. No host packages were installed, and no live Docker/database operation was attempted here.
