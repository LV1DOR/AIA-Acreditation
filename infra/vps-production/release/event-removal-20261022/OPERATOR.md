# Event removal release

1. Run the pinned prepare_pc.ps1 from Windows PowerShell with Docker Desktop running. BUILD-UPLOAD-PUSH approves only local synthetic/offline tests, isolated PostgreSQL tests, serial image builds, uploading to a fresh incoming directory and the verified Git push. Existing images/data/containers are preserved. The new test PostgreSQL has no network or published ports; only its separate test container joins its loopback network. Its synthetic data/volumes remain for diagnosis and both test services stop afterwards.
2. Continue only after EVENT_REMOVAL_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT and GITHUB_MASTER_VERIFIED. Stop on failed tests, missing images, checksums, memory pressure or transfer failure. Preserve the workspace; do not rebuild a completed bundle to solve transfer/deployment issues.
3. In VPS PuTTY, run:

    sudo python3 /home/luke/aia-accreditation-production-kit/release/event-removal-20261022/deploy_approved.py --approve-backup-additive-migration-and-application-update

Type DEPLOY-EVENT-REMOVAL only when ready for the brief application pause, encrypted backup, one additive migration and web/worker replacement. No production record is removed by deployment. PostgreSQL/Redis/AIStor containers, volumes, credentials, TLS and Nginx are retained; Volunteers/staging are untouched. The live memory gate and 1536 MiB host reserve still apply. No VPS builds.

Expected: ADDITIVE_MIGRATION_PASSED_EXISTING_ROWS_AND_HISTORY_RETAINED and EVENT_REMOVAL_RELEASE_DEPLOYED_PRIVATE_AND_PUBLIC_TLS_READY. Failure triggers previous application binding/image rollback while retaining the additive column; no schema reversal, volume deletion or automatic data restore. Do not rerun after a protected attempt exists; inspect the sanitized diagnostic and migration state first.

4. In Admin > Empresas or Pessoas select the intended event, choose Remover deste evento and confirm. A company removes that event's entire active team and pending invitations. An individual removes only that event record. Existing personal data/photos/immutable history remain; other events remain unchanged. Admin > Submissões retains the removed registration history. This is removal from participation, not privacy erasure. No automatic reinstate feature is introduced.
5. Check one approved synthetic test record and its leader notification. Do not replay old failed emails. Copy the fresh encrypted backup off-VPS using the established custody procedure.
