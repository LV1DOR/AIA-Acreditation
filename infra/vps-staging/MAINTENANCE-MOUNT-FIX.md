Storage diagnostic update: follow [STORAGE-DIAGNOSTICS.md](STORAGE-DIAGNOSTICS.md) and rerun only `deploy.py storage-check`. The previous bulk failure label cannot identify the exact live operation; the updated test emits separate sanitized IAM/S3 results. No infrastructure restart, image build, database bootstrap or migration is required for diagnosis.

Maintenance startup correction, 17 October 2026.

Rerun only:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py storage-check
```

Expected: `VALIDATION_PASSED`, then `TOOL_PASSED /app/staging-scripts/storage.ts`, then `STORAGE_CHECK_PASSED`. Stop on any failure. The storage license/capability gate is unchanged: a version-specific erasure restriction still blocks bootstrap rather than being bypassed.

Do **not** rerun `build`, `aistor-prepare` or `infra`. Existing healthy PostgreSQL, Redis, AIStor and Mailpit remain running. No migration or database provisioning is performed by this command; its S3-only synthetic provisioning/test is the intended next operation.

Confirmed cause: the VPS kit was loaded third and changed `tools.read_only` back to true, masking `compose.staging.yaml`'s explicit false. The staging override also mounts repository `scripts` read-only at `/app/scripts`. The kit then tried to mount six new individual files beneath that directory. The reported acceptance file is absent from the repository parent bind, as are all other `vps-staging-*` destinations. A writable image root alone cannot repair missing mountpoints under a separate read-only bind. The tools image copies the original `/work/scripts` to `/app/scripts`; the repository staging bind overlays that image directory at runtime anyway.

Correction is limited to the staging kit:

- Preserve the intended `tools.read_only: false`. Read-only settings for web, worker, AIStor, Redis, Mailpit, ingress and the storage initializer are unchanged. PostgreSQL's existing setting is unchanged.
- Mount the whole existing kit `runtime` directory read-only at `/app/staging-scripts`. Docker can create that directory's mountpoint in the staging maintenance container's writable layer. There are no longer nested file mounts beneath `/app/scripts`.
- Route all six adapters through this directory: bootstrap/grants, acceptance, checks, webhook, admin and storage. Their `../packages`, `../tests` and `../apps` imports retain the same `/app` siblings. The admin adapter now imports the original `../scripts/bootstrap-admin.ts` explicitly.
- Keep `scripts/migrate.ts`, its helper directory, original admin bootstrap and all existing repository script/test/infra binds unchanged. The official `mc` override still targets `/usr/local/bin/mc`, which the Dockerfile already creates.
- Validate the directory bind and refuse any future file mount nested under `/app/scripts`. Web/worker read-only enforcement remains mandatory.
- Record a new protected `maintenance-mount-fix.json` review receipt only when the previous adapter, build and validation receipts match the exact frozen pre-correction fingerprints. Existing images, compose environment, credentials, certificates, license and prior receipts are preserved. No generic fingerprint bypass or app rebuild is introduced.

The failed maintenance container is retained. `tool()` uses a timestamp/PID job name and `docker compose run --no-deps --name ...` without `--rm`. The next invocation creates a different one-off maintenance container using the fixed mounts. It does not reuse/delete the failed container or recreate/restart dependencies.

Local verification: 14 tests passed, including real installed Compose parser merging the actual base/staging/VPS files with dummy inputs, all maintenance destinations and relative imports, read-only enforcement for unrelated services, command mapping/retry names, preserved receipts during an already-running stack's fingerprint transition, and existing sanitized-error/AIStor guards. Python compilation and the changed admin TypeScript syntax check passed. This session did not access the Docker daemon or run an OCI container; the operator command above supplies the actual runtime verification. No database operation or migration was executed. Production configuration, Volunteers resources, credentials and license contents were unchanged; credential/license contents were not read.

Only after `STORAGE_CHECK_PASSED`, use the existing runbook's bootstrap, migration preflight, migration and grants steps. Do not delete containers/volumes or change permissions on repository scripts to bypass a remaining error.
