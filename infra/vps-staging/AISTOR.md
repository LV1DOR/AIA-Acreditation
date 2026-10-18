Storage diagnostic update: follow [STORAGE-DIAGNOSTICS.md](STORAGE-DIAGNOSTICS.md) and rerun only `deploy.py storage-check`. The previous bulk failure label cannot identify the exact live operation; the updated test emits separate sanitized IAM/S3 results. No infrastructure restart, image build, database bootstrap or migration is required for diagnosis.

Maintenance startup update: infrastructure is already healthy. Follow [MAINTENANCE-MOUNT-FIX.md](MAINTENANCE-MOUNT-FIX.md) and rerun only `deploy.py storage-check`. Do not repeat build, AIStor preparation or infrastructure startup. The tools-only staging setting and script directory mounts are corrected; prior setup instructions below are historical.

TypeError recovery update: the failure after `PERMISSIONS_PASSED` was reproduced at `deploy.py:161`: Compose serializes `mem_limit` as a decimal string, which the validator compared with integer zero. The validator now converts it to an integer. Rerun the same `aistor-prepare` command below. When the existing adapter/permissions receipts are present, it resumes read-only validation without pulls, downloads, probe containers, ownership changes, or rewrites of original image/configuration receipts. A new protected review receipt binds the exact previous kit fingerprint to this correction. Future failures produce sanitized file/function/line tracebacks in `state/logs/failure-*.json` with mode 0600; exception text and runtime values are omitted. Nine focused local tests passed, including the actual validator with installed Compose-parser JSON and a partial-state retry.

Updated 17 October 2026. This supersedes storage selection and bootstrap ordering in the original PuTTY runbook. **Do not rerun application builds.** Existing web, worker and tools image IDs and their original release receipt are preserved.

The next PuTTY command is:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py aistor-prepare
```

Expected: `PERMISSIONS_PASSED`, `VALIDATION_PASSED`, then `AISTOR_PREPARED`. Stop on any `STOP:` or nonzero exit. This command does not start a storage server, provision a database, run migrations, rebuild the app or expose any port. It:

- Confirms the completed build receipt, source fingerprint, public-key hash and existing application image identities. It accepts only the recorded previous kit hashes or this exact adapter, rather than weakening the existing kit-change check.
- Resolves official `quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z` through registry metadata, then pulls and records its immutable digest for Linux amd64. A dated tag is only the resolution input; Compose uses the digest. The repository staging override retains `pull_policy: never`.
- Probes the actual server binary/version and required flags without mounting the license or starting a server.
- Downloads official AIStor `mc` `RELEASE.2026-09-19T15-24-59Z`, verifies the pinned SHA-256 `83938eded435e7c28c397ece1dc590b2a79626dd9354aae2107060fec559ae2b`, and checks it inside the unchanged tools image. The old community client stays inside that image but is covered by a read-only mount of the official binary. No app-image rebuild, installation on the host or Go build is needed.
- Uses the **existing** `/home/luke/.local/share/aia-accreditation-staging/licenses/minio.license` as a file-backed Compose secret mounted only into MinIO. It checks file metadata, sets UID 1000 and mode 0400 with a 0700 parent, and never decodes, copies, hashes, logs or prints the license contents. License values never enter image arguments, image layers, Compose environment, generated config or receipts.
- Uses an explicit staging entrypoint to read the root credential files privately, then executes `minio server /data --address :9000 --console-address 127.0.0.1:9001 --certs-dir /run/minio-certs --license /run/secrets/minio_license`. This avoids relying on the different image entrypoint's argument conventions or undocumented `_FILE` behavior. Root credentials are exported only inside the process container; the license stays a file.
- Keeps the private backend, dedicated volume, UID 1000, read-only root filesystem, dropped capabilities, bounded logs, existing `public.crt`/`private.key`/`CAs/ca.crt`, verified `https://minio:9000`, disabled browser and no published storage port. The health probe continues to verify the dedicated CA.

The adapter receipt is `state/aistor-adapter.json`; the original `images.json` is not rewritten. If the command rejects an unknown baseline or missing image, preserve the result for review. Do not run `build` just to clear the guard. Manifest resolution/pulls and downloads require normal outbound HTTPS; an unavailable pinned release/checksum is a stop condition, not permission to use `latest` or a community replacement. Build/probe containers are retained; no `--rm`, recreation, prune or deletion is used.

Only after `AISTOR_PREPARED`, run these **one at a time**:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py infra
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py storage-check
```

Expected: `INFRA_PASSED`, then **`STORAGE_CHECK_PASSED`**. `infra` starts only the already-isolated staging PostgreSQL/Redis/MinIO/Mailpit dependencies. The PostgreSQL cluster is still empty; no schema or app starts. `storage-check` uses only the dedicated MinIO endpoint, aligned `mc`, and the actual application's S3 SDK/storage routines. It:

1. Connects with CA/hostname verification, exercises `mc license info` without retaining or printing its output, and verifies writable licensed S3 operations. A health endpoint alone cannot establish license validity: AIStor can serve health checks with S3 access disabled by licensing.
2. Refuses unrelated buckets. Creates the dedicated new private, **unversioned** photos bucket and a synthetic provisioning marker. Retries require that marker; no existing bucket's versioning/policy is changed. No bucket is deleted.
3. Creates/attaches the bucket-only policy and separate `aia_staging_web`/`aia_staging_worker` users using the generated credentials. Scoped credentials must be unable to create another bucket. Anonymous object reads must return 403.
4. Verifies HeadBucket/GetBucketPolicy/GetBucketVersioning, Put/Get/Head/List, ordinary deletion and immutable conditional writes (`If-None-Match: *` must reject a duplicate with 412 and preserve the original object).
5. Runs the **unchanged application `erasePhotoAndVerify`** for both scoped identities. This includes listing versions, deleting exact-key versions/markers and proving absence. It never substitutes a plain deletion or suppresses a licensing error.

The only saved test evidence is a sanitized pass/fail/step report at `state/backups/storage-check.json`. Synthetic probe objects may remain after a failed test for inspection. No credentials, raw CLI responses, account metadata or license data go into that report. No database connection occurs in this test. Bootstrap has been split so bucket/client/license failures cannot leave a partly provisioned database. It now requires a passing storage check both in the operator script and inside the database bootstrap adapter.

**Free-license compatibility is not yet established for the whole application.** Official licensing documentation explicitly excludes **version-specific object deletion** from Free. The application's existing erasure implementation passes each returned `VersionId` to DeleteObject, including the `"null"` version that an unversioned bucket can return. The documentation does not promise a Free exception for that `null` case. The operator test above checks that precise behavior on the selected dated release and your server-validated license. A failure may print:

```text
STORAGE_CHECK_FAILED_APPLICATION_VERSION_SPECIFIC_ERASURE_PAID_TIER_REQUIRED
```

Stop there. Keep web/worker/ingress stopped and do not run database bootstrap or migrations. A license entitlement change or a separately reviewed application change for genuinely unversioned storage would be needed; this kit does not make that business-logic change or bypass a paid feature. No purchase is assumed or required merely to run the test. A generic license/IAM failure at an earlier step also stops deployment and is not mislabeled as a Free feature refusal.

Free supports the single-node topology used here, TLS and ordinary object APIs, but has no vendor SLA/support and disallows replication, object tiering/lifecycle transitions, version-specific deletion, server-side encryption at rest and selected enterprise diagnostics. The app does not request server-side encryption in its current synthetic storage configuration. **Photos remain unencrypted at rest in MinIO**; TLS is preserved and application-level document encryption is unchanged. No real-person data is permitted. The blanket pricing-page phrase “full feature set” must not be used to override the explicit license feature exclusions. Raw license signature/expiry/entitlement verification is performed by AIStor, not by parsing an unverified JWT in this kit; the final writable SDK test is still necessary.

MinIO's general published memory sizing is intended for much larger deployments. For this bounded synthetic single-node test, AIStor is capped at 1536 MiB, Go's soft memory target is 1 GiB, `GOMAXPROCS=2`, API concurrency is 16, CPU is 1 and PIDs are capped at 128. Persistent container caps total **3712 MiB**; a tools job adds at most 768 MiB, leaving room on the approximately 8 GiB host. This envelope must pass the real test; OOM or unhealthy startup is a stop condition. It is not a production capacity/support claim. The app build is already complete and is not repeated alongside running services.

If and only if `STORAGE_CHECK_PASSED`, continue the existing workflow:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py bootstrap
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py migration-preflight
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py migrate
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py grants
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py migration-preflight
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py start
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py check
```

Stop at the first failure. Each maintenance step must print `TOOL_PASSED`; the final migration preflight must have zero pending, startup must print `START_PASSED`, and readiness must print `READINESS_PASSED`. Existing private SSH-tunnel access and synthetic browser/upload/email acceptance instructions remain in [PUTTY.md](PUTTY.md). No Clerk configuration, auth/TLS readiness checks, Nginx host configuration or firewall is changed. Volunteers and production data remain outside every target.

Safe stop remains:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py stop
```

Expected: `STOPPED`; only the staging project stops, preserving all containers/volumes/configuration/license. Do not delete or prune to recover from a test failure.

Local checks performed: Python compilation, TypeScript/shell syntax, YAML parsing/merge assertions and four isolated mocked adapter regressions (preserved app IDs/no rebuild/license non-disclosure; unknown baseline rejection; checksum rejection; public/symlink license rejection). The actual uploaded license was inspected by metadata only. This session did not invoke Docker, read the license contents, run live S3 tests, start services or migrate databases. The original build receipts exist but are protected from this session; the PuTTY command verifies them as root.

Official references checked 17 October 2026:

- [Container command and license](https://docs.min.io/aistor/installation/container/install/)
- [TLS paths and CA trust](https://docs.min.io/aistor/installation/container/network-encryption/)
- [License states and explicit Free exclusions](https://docs.min.io/aistor/operations/licenses/)
- [S3 APIs and conditional headers](https://docs.min.io/aistor/developers/s3-api-compatibility/)
- [IAM policy actions](https://docs.min.io/aistor/administration/iam/access/)
- [Client/server date alignment](https://docs.min.io/aistor/reference/cli/)
- [Official pinned client checksum](https://dl.min.io/aistor/mc/release/linux-amd64/mc.RELEASE.2026-09-19T15-24-59Z.sha256sum)
- [Published server artifacts](https://dl.min.io/aistor/minio/release/linux-amd64/)
- [Memory/concurrency sizing](https://docs.min.io/aistor/reference/aistor-server/requirements/memory/)

Conclusion: **AIStor staging adapter prepared; full staging remains BLOCKED pending operator storage/license compatibility validation, especially exact-version erasure.**
