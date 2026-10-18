# Accreditation VPS staging source and recovery kit

This directory versions the source-only kit prepared for the first isolated Accreditation staging installation. It contains scripts, Compose overrides, diagnostics, tests, operator runbooks and reviewed release overlays. It contains no deployed state, environment secrets, TLS private material, MinIO license, backup archives or actual job logs.

The cumulative application changes from `review/event-ui/overlay/` have also been applied to the normal `apps/` and `packages/` source paths in this repository. New builds use those normal source paths. The reviewed overlays and SHA-256 baselines remain here to explain and recover the already-prepared VPS upgrades; earlier snapshots are historical evidence, not the current application implementation.

## The existing VPS remains pinned

The running deployment workflow deliberately uses the original `4c3c3eaa62db13e3dde0008df99661e02f5fd8db` checkout at `/opt/aia-accreditation`, the operator kit at `/home/luke/aia-accreditation-staging-kit`, and private state outside both locations. The release scripts create separately fingerprinted source/image candidates and retain original receipts. This publication was prepared in a separate checkout; it does not change those live paths, start containers or perform a deployment.

**Do not pull this branch over the frozen `/opt/aia-accreditation` checkout or overwrite the operator kit as a side effect of publishing.** Its existing original-source/commit and kit-hash checks would correctly reject an unreviewed replacement. A fresh installation or move to a later Git commit needs an explicit reviewed baseline transition; changing a recorded hash or disabling a guard is not a migration procedure.

The absolute VPS paths in the archived operator scripts are intentional target guards. The scripts are not a portable general-purpose production installer. Restore/copy them only under an explicit review of the exact target and current private receipts. Do not run `prepare.py` against an existing installation: it refuses existing state to prevent credential/certificate regeneration. Do not use Volunteers resources.

## Current operator documents

- [Latest staging update: unused-draft event deletion and sidebar logo](review/event-ui/DEPLOY.md).
- [Public launch inputs and remaining setup](PUBLIC-LAUNCH.md).
- [Full staged PuTTY workflow](PUTTY.md).
- [AIStor setup and compatibility checks](AISTOR.md), [storage diagnostics](STORAGE-DIAGNOSTICS.md), [bucket-name correction](BUCKET-NAME-FIX.md).
- [Maintenance mount correction](MAINTENANCE-MOUNT-FIX.md) and [read-only event diagnostics](EVENT-DIAGNOSTIC.md).
- [Previous corrected privacy release](review/privacy-ui-v2/DEPLOY.md) and [wizard link correction](review/setup-wizard-links/DEPLOY.md).

Recorded `CHECKS.json` files describe the preparation stage at which they were written. They are not attestations about the current VPS or public-production readiness. The latest event release still requires its real image build/type checks and live readiness to pass in the operator session. Resend external delivery and public routing are not enabled by these commits.

## Offline checks

From the repository root, Node 22.23.3 supports the following dependency-free source/behaviour checks. They do not connect to Docker, a database, protected state or email providers:

```bash
node infra/vps-staging/check-published-source.mjs
node --experimental-vm-modules infra/vps-staging/review/event-ui/checks.mjs
node --experimental-vm-modules infra/vps-staging/review/event-ui/cleanup-checks.mjs
node --experimental-vm-modules infra/vps-staging/review/event-ui/event-checks.mjs --local-fixtures
node --experimental-vm-modules infra/vps-staging/test_event_diagnostic.mjs
node --experimental-vm-modules infra/vps-staging/test_storage_runtime.mjs
node --test infra/vps-staging/test_storage_diagnostics.mjs
```

The source check proves the promoted application files match the cumulative reviewed overlay. The local event fixtures check domain/action behaviour; the image check requires its actual locked Zod validator and performs additional invalid-input cases, with no automatic validator fallback. Full Next/worker type checks and normal repository tests require the locked installed dependencies; they are not replaced by the VM fixtures.

The archived Python suite uses the retained `/opt/aia-accreditation` base source as its original-release fixture and requires Python PyYAML and the installed standalone Compose config parser. It mocks Docker/service operations and uses temporary state. It is a VPS recovery-kit test suite, not a new portable replacement for the repository's existing tests:

```bash
python3 -m unittest discover -s infra/vps-staging -p 'test_*.py'
```

Generated Python caches and private staging material are ignored by Git and excluded from Docker build context. Keep secrets/licenses outside the repository even when ignored.
