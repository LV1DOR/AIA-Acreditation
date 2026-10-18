Latest UI update: [review/event-ui/DEPLOY.md](review/event-ui/DEPLOY.md). Run `sudo python3 /home/luke/aia-accreditation-staging-kit/events_release.py deploy` to deploy confirmed unused-draft event deletion and centre the sidebar logo, including all earlier fixes. No migration, credential rotation, infrastructure restart or public exposure. For the separate public-launch setup, see [PUBLIC-LAUNCH.md](PUBLIC-LAUNCH.md).

Worker type-check fix prepared (2026-10-18): the retry deploys `privacy-ui-v2`, correcting the invalid logger code. It first checks the corrected worker file in the retained tools image with network disabled. It then builds matching-source immutable images, preserving v1 images/receipts and all healthy staging dependencies. Use the same deploy command below; do not rerun bootstrap or migrations.

Latest authorized application update: simplify the privacy UI and schedule approved communication cleanup using [review/privacy-ui-v2/DEPLOY.md](review/privacy-ui/DEPLOY.md). Run `sudo python3 /home/luke/aia-accreditation-staging-kit/privacy_release.py deploy` in normal PuTTY. It includes the previous navigation fix, builds matching application images and replaces only web/worker. No infrastructure restart, migration or credential change is needed. Retention dates/holds/manual metadata controls are removed from the client UI; automatic cleanup still requires an approved server policy and never invents a retention duration.

Previous application update: [review/setup-wizard-links/DEPLOY.md](review/setup-wizard-links/DEPLOY.md) documents the wizard navigation fix, retained in the latest release. Do not repeat the first-deployment build/bootstrap sequence below for an application update.

Historical storage fix: [BUCKET-NAME-FIX.md](BUCKET-NAME-FIX.md) corrects the two denial tests' invalid 67-character bucket names. Corrected probes use 49 characters and still require AccessDenied/403.

Historical storage diagnostic update: [STORAGE-DIAGNOSTICS.md](STORAGE-DIAGNOSTICS.md) describes the separate sanitized IAM/S3 results.

Maintenance startup update: infrastructure is already healthy. Follow [MAINTENANCE-MOUNT-FIX.md](MAINTENANCE-MOUNT-FIX.md) and rerun only `deploy.py storage-check`. Do not repeat build, AIStor preparation or infrastructure startup. The tools-only staging setting and script directory mounts are corrected; prior setup instructions below are historical.

Updated 17 October: the completed application build must be reused. Follow [AISTOR.md](AISTOR.md) for the next command, licensed AIStor selection, client alignment and the mandatory storage capability gate before bootstrap. Its storage instructions supersede steps 5–8 below and the old MinIO blocker. The Free-license exact-version deletion limitation is still a genuine compatibility gate.

Prepared on 16 October 2026 for `/opt/aia-accreditation`, `master`, commit `4c3c3eaa62db13e3dde0008df99661e02f5fd8db`.

**BLOCKED for actual startup:** a supported, compatible MinIO image has not been selected, and Clerk development credentials have not been supplied. Local configuration and TLS are already prepared. Docker, image pulls/builds, database provisioning, migrations and startup have NOT been executed.

The kit lives outside `/opt` because this Codex session can only write under `/home/luke` and `/tmp`. It reuses the checked-out Dockerfile, base Compose, staging override, migration guard, runtime grants and admin bootstrap. No repository edits, business-logic changes, commits or pushes were made. All commands below run on the VPS in a normal PuTTY session, unless marked Windows. Run one step at a time; any nonzero exit or `STOP:` means stop there. Do not paste a whole sequence past a failing command.

1. Inspect host prerequisites and ports.

```bash
cd /opt/aia-accreditation
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py host
timedatectl show -p NTPSynchronized --value
date -u -Is
sudo ss -ltnp '( sport = :18880 or sport = :18443 or sport = :18025 )'
```

Expected: `HOST_PASSED`, working local Docker daemon, Compose v2 with `up --wait`, Buildx/named-build-context support, at least 7 GiB RAM and 20 GiB free in Docker's data directory. NTP should report `yes`; UTC should agree closely with Windows. The socket table must have no matching listeners. The sandbox could not check these ports; the kit checks them again before initial startup. Stop for occupied ports, clock drift, missing Docker/Buildx, inactive daemon or inadequate space. Report the result; this procedure does not install packages, start the host daemon, alter time services or change ports silently.

2. Protected configuration is already generated.

State is `/home/luke/.local/share/aia-accreditation-staging` (directories 0700, initial secret files 0600). It contains distinct cluster, migrator, web, worker, Redis, MinIO root and scoped S3 passwords, separate document/fingerprint/auth-mail/proxy keys, and a private CA. Leaf certificates expire 30 days after preparation; CA expires after 90 days. Never regenerate configuration over an existing deployment. No `.env` was created in the Git checkout: `.env.*` and `.impeccable/review` ignore rules were checked first, and actual secrets live outside Git and the Docker build context.

Only on a fresh installation where that state directory does not yet exist:

```bash
python3 /home/luke/aia-accreditation-staging-kit/prepare.py
```

Expected: `PREPARED`. On this VPS it should instead refuse with `STATE_ALREADY_EXISTS_DO_NOT_REGENERATE_SECRETS`; skip it. Never delete the directory to defeat this check. If TLS generation ever fails partway through preparation, preserve the directory for inspection.

3. Configure the separate Clerk development instance.

Create/use an Accreditation-only Clerk application **development** instance. Enable email verification codes and test mode. Use only disposable `+clerk_test` addresses, for example `admin+clerk_test@example.com`; OTP is `424242`. Email verification **links** can still send mail: use codes. Avoid real addresses, phone numbers, social accounts, production keys and the Volunteers Clerk application. Test-account sign-up remains real Clerk authentication; no testing-token/session bypass is enabled. Clerk's browser API and backend API need normal outbound HTTPS, and Windows needs internet access.

Supply the matching `pk_test_...`, `sk_test_...`, and `whsec_...` from this development instance privately:

```bash
python3 /home/luke/aia-accreditation-staging-kit/deploy.py credentials
```

Expected: three hidden prompts, then `CLERK_CONFIGURED`; nothing is echoed. Stop on invalid keys. The auth-email encryption key is already generated and shared correctly between web and worker. The publishable key is a build input; changing it requires rebuilding all three images before startup. Do not put secrets on the command line or paste them into chat. Complete this step **before** the Linux ownership step below.

Clerk readiness requires all four auth/bridge values even for private staging. Supply a real development endpoint signing secret. An endpoint in the dedicated instance can remain inactive/unreachable for the portal test; do not expose a webhook endpoint just to satisfy readiness. The authenticated portal works through `https://localhost:18443`; it does not need public DNS or a production HTTPS hostname. A live provider-to-app `email.created` delivery cannot traverse an SSH local forward. Keep provider email delivery disabled for non-test addresses. Full live webhook testing needs separately approved reachable HTTPS ingress or a separately approved private relay. The local signed webhook test below exercises the actual verifier/outbox/worker/Mailpit without public exposure; it does not claim Clerk delivery was tested.

4. Build the exact application release.

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py build
```

Expected: three `BUILDING` messages then `BUILD_PASSED`. This follows `scripts/phase4a-build.ts`: builds the maintenance `mc` binary from its pinned official Go module/tag with the same pinned Go image (2 CPUs/1536 MiB), supplies it as the Dockerfile's **named `storage-admin` build context**, builds web/worker/tools sequentially with the frozen pnpm lockfile, and labels each with the same 64-character release-material fingerprint. No host pnpm install is needed. A plain Dockerfile build without that context is insufficient for tools.

The reviewed commit remains `4c3c3ea`; the separate source-material fingerprint is `bc2797870f4e29bd4c7c8295f606a35e78354fb7316ff212db92df7f4e2538b4`. Both are recorded. Compose receives immutable local `sha256:...` image IDs and `pull_policy: never`, not mutable build tags. This is the existing staging model; production registry publication is not part of it. Private keys never enter build arguments. Build logs are protected under `state/logs`, and an image/kit receipt is recorded. No registry push occurs. Ordinary registry/Go/pnpm downloads must work. Stop on any failed build, digest pull failure, OOM or source/public-key mismatch. Builds run before runtime services to preserve RAM headroom; do not start other workloads while building. Do not replace pinned bases or dependencies to hide a pull failure.

5. Resolve storage before dependencies or migrations.

**This step currently has no approved image value. Do not execute its placeholders.** The repository's old `quay.io/minio/minio@sha256:14cea493...` is unsupported and is deliberately rejected. Do not copy a Volunteers image or substitute a fork.

Once an actually supported image is reviewed for the existing command, UID 1000, TLS paths, root-secret-file variables, `curl` health probe, scoped `mc` administration, conditional PUT and unversioned private bucket behavior:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py storage --image 'REVIEWED_REGISTRY/IMAGE@sha256:FULL_64_HEX_DIGEST' --reference 'REVIEWED_SUPPORT_AND_COMPATIBILITY_REFERENCE' --compatibility REVIEWED_COMPOSE_COMPATIBLE
```

Expected: `STORAGE_SELECTED` after explicit pull and isolated executable probe. Image startup/S3 acceptance is checked later. `--compatibility` records an actual prior review; it does not perform that review. The staging override's `pull_policy: never` remains intact; the image must be locally present first. Stop on absent support evidence, license/entrypoint differences, missing curl/shell, unavailable digest or incompatible client. A licensed AIStor choice needs a reviewed license mount/command and client adapter before this kit accepts it; those are not guessed here.

6. Set per-service Linux ownership and validate merged Compose.

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py permissions
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py validate
```

Expected: `PERMISSIONS_PASSED`, then `VALIDATION_PASSED`. Secrets are individually readable by their container UID: 1000 for app/tools/MinIO/Mailpit, 101 for ingress, and the Redis UID discovered from the pinned image. Parent directories remain 0700; private files become 0400. Only public certificates are 0444. PostgreSQL's existing root entrypoint copies its TLS key to postgres ownership. This avoids globally readable synthetic secrets used by the Windows rehearsal.

Validation runs real Docker Compose merging and checks all three source labels/image IDs, kit fingerprint, non-root applications, read-only filesystems, dropped capabilities, private backend, dedicated names/volumes/networks, loopback-only mappings, configured capture-only SMTP and TLS expiry. `validated-compose.json` is protected. Stop for any failure. Application env schemas, runtime-role restrictions and auth readiness get their additional checks after schema provisioning; a Compose success alone is not application readiness.

With the AIStor adapter, persistent service memory caps total 3712 MiB: web 768, worker 384, PostgreSQL 512, Redis 256, AIStor 1536, ingress 128, Mailpit 128. A maintenance container adds up to 768 MiB; the short storage-volume initializer adds 128 MiB. Redis logical memory is capped at 192 MiB with noeviction. CPU/PID limits and bounded logging/tmpfs are retained or added. All staging restart policies are `no` so a reboot does not silently reactivate it. This is the tested initial single-instance envelope, not capacity for real participant traffic.

7. Start only isolated dependencies.

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py infra
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py status
```

Expected: `INFRA_PASSED`; PostgreSQL, Redis and MinIO healthy; Mailpit running; storage-volume-init exited 0. Before the first attempt the script refuses existing containers, volumes or networks in this namespace. Volumes are exactly `aia-accreditation-staging_postgres-data`, `_redis-data`, `_minio-data`; networks are this project's `_backend`, `_egress`, `_mailpit-ui`. Container names use the project prefix. No backend port is published. Only ingress 18880/18443 and Mailpit UI 18025 are reserved on 127.0.0.1.

Stop if any dependency fails. Inspect only protected staging logs. No schema or application has started yet. Preserve an unsuccessful startup and its attempt marker for inspection; do not rename/adopt preexisting resources or delete volumes to retry.

8. Provision and migrate **only** the new staging database.

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py bootstrap
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py migration-preflight
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py migrate
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py grants
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py migration-preflight
```

Expected: each prints `TOOL_PASSED`; preflight log initially lists pending migrations, final log says zero pending. Bootstrap refuses a nonempty cluster, creates only `aia_accreditation_staging`, marks it synthetic, provisions non-superuser migrator/web/worker/erasure logins and the existing privacy/runtime role structure, and creates a **new private unversioned** `aia-accreditation-staging-photos` bucket with scoped web/worker S3 users. The continuously running worker has no privileged privacy URL. The maintenance guard targets host `postgres`, port 5432, database `aia_accreditation_staging`, using its distinct migrator credentials and CA verification. Runtime grants reuse `infra/production/runtime-roles.sql`; web and worker receive no schema ownership.

No `prisma db push`, reset, migration resolution or test/restore database is used. The existing `scripts/migrate.ts` handles checksums/history, empty initial target and destructive/upgrade gates. The first empty database does not require a backup receipt; later pending migrations over an applied schema require the existing fresh-backup and compatibility gates. This kit prepares first deployment, not an automatic upgrade system.

Stop on any failure. A partially completed bootstrap is intentionally not automatically rerun: inspect exactly what succeeded. Never delete resources or force migration history to get past a refusal. Completed bootstrap is marked and is not repeated after shutdown/restart.

9. Start applications and private ingress; verify readiness.

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py start
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py check
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py status
```

Expected: `START_PASSED`, `READINESS_PASSED`, and all six healthchecked persistent services healthy. This checks env/auth schemas, synthetic DB marker, restricted web/worker DB roles, web/worker HTTP readiness, Mailpit and TLS ingress with certificate verification. Readiness does not prove that Clerk accepts the supplied secret key; the synthetic admin/browser test does that. Ingress starts only after web and worker health pass. All `up` commands use `--no-recreate`; no containers are automatically replaced or removed.

Stop on HTTP 503, auth/key mismatch, worker errors or unhealthy containers. Run `stop` below if startup is partial. Do not disable auth, TLS verification, readiness or origin checks.

10. Access privately from Windows.

In PuTTY Connection > SSH > Tunnels add local forwards, with **Local** selected and “Local ports accept connections from other hosts” **unchecked**:

| Source port | Destination |
| --- | --- |
| 18443 | 127.0.0.1:18443 |
| 18025 | 127.0.0.1:18025 |

Expected: connect to the VPS normally; browse `https://localhost:18443/en` and `http://localhost:18025`. Do not use the VPS public address or switch between localhost and 127.0.0.1: the exact application origin is localhost. Mailpit contains synthetic test messages only and loses messages at container shutdown because its DB is in bounded tmpfs.

Download **only** `/home/luke/.local/share/aia-accreditation-staging/tls/ca.crt` using WinSCP. Never copy `ca.key`, runtime env or TLS keys for browser access. Verify its SHA-256 certificate fingerprint against this PuTTY command:

```bash
openssl x509 -in /home/luke/.local/share/aia-accreditation-staging/tls/ca.crt -noout -fingerprint -sha256
```

Expected: one public certificate fingerprint. On Windows, after verifying the fingerprint, trust this dedicated temporary CA in the current user's Trusted Root Certification Authorities using `certmgr.msc` (or the certificate import wizard). Remove that trust after staging is retired. Stop if certificate/hostname validation fails; do not use browser interstitial bypasses or `--insecure`. Windows localhost ports must be free too.

Optional Windows OpenSSH equivalent (replace only the VPS hostname):

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18443:127.0.0.1:18443 -L 127.0.0.1:18025:127.0.0.1:18025 luke@YOUR_VPS_HOST
```

Expected: SSH remains connected, no bind/forward failure; the same two browser URLs work. Stop on a bind error. No host Nginx, firewall, DNS or public listener changes are needed.

11. Test actual authentication, uploads, worker and email.

The application's `/en/sign-up` page requires a company invitation and cannot create the initial administrator. In the dedicated Accreditation **development** Clerk Dashboard, select **Users > Create user** and create `admin+clerk_test@example.com` (or use that existing synthetic account). Confirm its email is verified and copy its `user_...` ID. Every email on this identity must contain `+clerk_test@`. Run the admin command below and enter that ID at the hidden prompt. Then sign in at `https://localhost:18443/en/sign-in`; for the development email-code flow use `424242`. Open `https://localhost:18443/en/admin`. No company invitation or Clerk role metadata is needed; the bootstrap creates the application ADMIN role in the staging database.

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py admin
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py acceptance
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py webhook
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py check
```

Expected: hidden user-ID prompt; `TOOL_PASSED` for each test and `READINESS_PASSED`. Admin wraps the existing bootstrap and refuses an identity with non-`+clerk_test` email addresses. Refresh/sign in again and confirm the admin portal opens. Sign out and confirm protected portal actions require authentication.

The acceptance command reuses the existing Linux synthetic workflow: generated JPEG through real multipart ingress, stored-photo readback, participant approval/access, restricted DB roles, bounded upload/rejection/recovery, and encrypted outbox email delivered by the real worker over verified TLS to Mailpit. It creates only synthetic fixtures in the new DB. Evidence is `state/backups/acceptance.json`; this is **test evidence, not a data backup**. The signed webhook test rejects an invalid signature, then posts a valid local synthetic `email.created` event through the real route/verifier and waits for the worker's captured email. Check the Mailpit UI for both synthetic messages. Stop on any failed assertion, unexpected recipient/delivery, missing capture, upload failure or portal-auth failure. These checks do not send SMTP outside the VPS, and do not claim end-to-end live Clerk webhook delivery.

12. Safe shutdown and recovery.

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py logs
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py stop
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py status
```

Expected: protected `state/logs/service-tail.log`, `STOPPED`, then persistent containers exited; all volumes, networks, configs and images retained. The worker gets up to 60 seconds for graceful shutdown. Never paste raw logs/configuration into chat before checking for secrets. Maintenance/probe/builder containers are also retained after exit: no `--rm`, `down`, volume deletion or prune is used. Do not remove them automatically.

For a successfully bootstrapped installation stopped with unchanged images/configuration, resume with:

```bash
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py infra
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py start
sudo python3 /home/luke/aia-accreditation-staging-kit/deploy.py check
```

Expected: same isolated data and images healthy. Do not rerun bootstrap or regenerate passwords. If first dependency startup partially failed, preserve and inspect state/logs; once the actual cause is fixed, use the scoped `stop` command before retrying `infra` so Mailpit's existing listener does not fail the free-port check. Resume only the missing step. If bootstrap/migrations partly failed, or image/config/schema must change, stop and review that specific state before proceeding. There is no automatic rollback/reset/recreate. A build failure leaves application data untouched. A migration failure preserves schema/history for forward recovery. Expired TLS needs deliberate certificate renewal with the same private CA, not a whole-state reset.

External inputs still needed: separate Clerk development keys and a synthetic admin identity; a reviewed supported MinIO image/support/license/compatibility decision; operator Docker access, port/time checks and execution of the commands above. If supported storage changes the license mount, command or maintenance client, prepare/review that specific adapter first. No public deployment approval is assumed.

Sources checked: [Clerk development instances](https://clerk.com/docs/guides/development/managing-environments), [test emails and codes](https://clerk.com/docs/guides/development/testing/test-emails-and-phones), [webhook reachability](https://clerk.com/docs/guides/development/webhooks/overview), [Clerk email delivery](https://clerk.com/docs/guides/development/troubleshooting/email-deliverability), [upstream MinIO maintenance notice](https://github.com/minio/minio), [AIStor container/license requirements](https://docs.min.io/aistor/installation/container/install/). Upstream community MinIO is unmaintained. AIStor needs a license; the free license explicitly excludes support. Neither is silently selected.
