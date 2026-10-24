# Local development on Windows

Use this checkout for source changes and synthetic testing before preparing a
separate production release. Production runs separately on the VPS; the local
commands below do not deploy, publish images, connect by SSH, or push Git commits.

## Daily use

From the repository root in PowerShell:

```powershell
corepack pnpm service:dev
corepack pnpm service:status
```

Open <http://localhost:3100>. Test email is captured at
<http://127.0.0.1:18025>. Use the existing Clerk **development** account and local
admin mapping. Local and production users/data are separate.

`service:dev` starts the existing local Docker project, generates Prisma, applies
guarded migrations, and manages the web and worker through PM2. Next.js reloads
web changes. PM2 watches worker and imported package sources and drains the
worker before restarting it. The dev web output uses `.next-stale-dev`, separately
from compiled build output. Initial page visits compile on demand.

Rerun `service:dev` after changing `.env`, dependencies, or startup configuration.
Run `corepack pnpm install --frozen-lockfile` after pulling a changed lockfile.

```powershell
corepack pnpm service:logs       # follow app logs; Ctrl+C exits the log viewer
corepack pnpm service:stop       # stop apps, retain running data services
corepack pnpm service:shutdown   # stop apps and local containers, retain volumes
```

`service:start` and `service:restart` retain the existing compiled-build workflow.
Use `service:dev` to start or restart development mode. Both modes use port 3100,
the same local data, and the same Accreditation PM2 names, so run one mode at a
time. Other projects' PM2 processes are outside these commands' scope.

## Local isolation

The development preflight requires explicit `DEPLOYMENT_ENV=local` and
`AIA_SYNTHETIC_DATA=true`, `pk_test_` / `sk_test_` Clerk keys, loopback origins and
dependencies, and Mailpit. It rejects additional origins, live Clerk keys,
external services, and privileged database/ingress overrides. Keep secrets in
the ignored `.env`; keep existing encryption keys when retaining local data.

| Service | Local address |
| --- | --- |
| Web | `localhost:3100` |
| Worker readiness | `127.0.0.1:3102/api/health/ready` |
| Local database | `127.0.0.1:16432/aia_acreditacao_local` |
| Test database | `127.0.0.1:16432/aia_acreditacao_test` |
| Redis | `127.0.0.1:16379` |
| SMTP / Mailpit | `127.0.0.1:11025` / `127.0.0.1:18025` |
| MinIO API / console | `127.0.0.1:19000` / `127.0.0.1:19001` |

Git branches isolate code, not databases, volumes, or Clerk accounts. Use synthetic
people and companies here; changing branches does not undo schema migrations.
Do not copy production `.env` values or production data into this setup.

Clerk is still an external development identity service. Password sign-in can
work locally; Clerk-generated email/webhook flows require the separately
configured development webhook described in [AUTH-SETUP.md](AUTH-SETUP.md).
This setup does not start a public tunnel or change Clerk provider settings.

## Validation

```powershell
corepack pnpm check:local
# Run these sequentially: both use aia_acreditacao_test.
corepack pnpm test:integration
corepack pnpm test:e2e
```

The integration command selects `aia-phase1-synthetic` for its storage tests;
they create the bucket when needed. Tests retain synthetic fixtures/audit evidence. Browser tests use separate
web ports 3200/3201 and synthetic Clerk users. They do not test the VPS.

`lint:local` checks application, package, test, and local script sources while
excluding the standalone `infra/vps-production` and `infra/vps-staging` kits.
The original `lint` / `check` commands retain their wider scope; the pulled VPS
tooling currently has existing lint errors. Passing `check:local` does not certify
those deployment tools or constitute production release acceptance.

For new work, create a feature branch from the updated development branch before
editing, for example `git switch -c feature/my-change`. Commit and review that
feature normally, run the local checks, and prepare any production deployment as
a separate operation. A Git push alone does not update this running dev process.
Next.js's generated `next-env.d.ts` is ignored and no longer tracked, as required
by the installed Next.js documentation. Switching dev/test output directories
therefore does not create source changes for that file.

### Verified setup and current regression limit

- Prisma validation, local lint, workspace/test TypeScript checks, and 189 unit
  tests passed.
- All 119 integration tests passed using the isolated test database and synthetic
  storage bucket. The first run correctly refused the normal app bucket for one
  storage-security scenario; the integration command now selects its required
  synthetic bucket automatically.
- Web/worker readiness, the PT sign-in page, and Mailpit returned HTTP 200.
  A worker source timestamp change caused a watched restart and readiness returned
  HTTP 200 afterward; source content was unchanged.
- Browser suite: 9 passed, 1 failed, 19 did not run. The failure is the existing
  company-leader isolation scenario at `tests/e2e/clerk-live.spec.ts:287`. Its
  fixture has no completed leader profile and expects the company heading, while
  the current app correctly redirects to `/en/my-details`. The failure snapshot
  shows the expected new self-accreditation screen. The remaining serial cases
  require a fixture/scenario update before a full browser regression pass can be
  claimed. The development setup does not bypass this product requirement.

## Initial update, 24 October 2026

The clean local `master` advanced by 32 commits, from `4c3c3ea` to `92f4fb8`,
before creating `dev/local-2026-10-24`. Local `.env` settings now explicitly select
local synthetic mode; obsolete additional auth origins were cleared. Existing
development credentials and encryption keys were retained.

Before applying the nine missing local migrations, a coordinated encrypted
backup captured the database and 104 objects; ciphertext, key bundle, and hashes
were verified. The local and test databases now have all 23 migrations. No
production connection or deployment was performed.

Private recovery material, the previous `.env`, and validation logs are under
`.impeccable/releases/local-dev-20261024/` (ignored by Git). Its `backups/` folder
contains the coordinated backup/receipt and the test database dump. Keep
`archive.key`, `custody.key`, and the previous environment file with that local
recovery material. This same-PC copy protects the local migration; it is not an
off-site disaster recovery backup. No automated deletion was configured.
