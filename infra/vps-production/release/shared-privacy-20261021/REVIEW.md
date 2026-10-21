# Shared privacy notice — prepared source change

Base: exact running production source material 7227a412c854c076fd4df178135bbd116be1cdcf9553e388333579709172308e.

- Workers and company leaders read and acknowledge the same WORKER notice. Historical LEADER notices and all acknowledgement rows remain untouched. Actor identity, original text, version and presented hash remain recorded.
- Publication and event retention no longer require a manually entered AIA reference. Authenticated admin action identifiers are generated internally; approval confirmation and admin authorisation remain.
- Everyday retention configuration has two dates: worker records and backups. New policies assign the worker-record date to the existing evidence and communications columns. Existing policies retain their original dates. No database migration or automatic data deletion is introduced.
- The simpler privacy screen removes the separate leader declaration, reference inputs, evidence/notification date inputs and advanced hold/erasure/metadata controls. Existing erasure, copy-verification and hold enforcement remain available to maintenance tooling.
- Company creation checks privacy readiness and validates the address before saving. Missing setup produces a specific message. Existing company registrations can invite a leader directly, without creating another company. An existing valid invitation blocks an additional send to that address.

## Validation

Local: TypeScript parsing and nine dependency-isolated behaviour checks. Real Zod/Prisma unit tests and full typechecks must pass in the existing pinned tools image on the builder PC. The local harness mocks framework/database boundaries; it does not substitute for those runtime tests.

check_pc.py builds only a disposable test image from the existing tools image, then runs the checks in a networkless, volumeless, memory-capped container. It uses no production environment files, keys, licences or database. It leaves existing PC containers untouched. It neither rebuilds application images nor deploys anything.

## Release constraints

All three application images must subsequently be built from the same new material because shared domain code changes. Use the production Clerk public build key unchanged. The tools target now copies the existing reviewed AIStor provisioning implementation from a separately verified named build context `reviewed-ops`; its operations material is unchanged. Supply `--build-context reviewed-ops=<bundle>/storage-ops` in addition to the existing pinned `storage-admin` client context.

No live compose.env, images.json, review.json, source manifest, runtime scripts, credentials, volumes, containers or host Nginx have been modified. The new images and source material require a separately reviewed activation of the kit's release bindings; do not merely replace image pointers. Keep holding-page rollback and take a fresh manual backup before activation. No commits or pushes were made.

Actual event notice wording still needs to be entered by an authorised admin after deployment. This change does not invent or publish privacy text.
