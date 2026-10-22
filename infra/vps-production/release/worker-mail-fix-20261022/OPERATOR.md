# Confirmed worker mail rendering fix

Run the pinned prepare_pc.ps1 on Windows PowerShell and confirm BUILD-UPLOAD-PUSH. The PC must reproduce the deployed old util rendering error, verify the corrected actual worker bundle and all existing focused unit/type checks, then build the matching immutable web/worker/tools release serially. No VPS build. Enter only the existing Clerk publishable pk_live_ key when requested.

After builds, the workflow verifies rendering/message preparation for every business template and both pre-rendered invitation languages inside the actual new worker image, using native production-mode Node, no network/secrets/host volumes, and the existing 384 MiB worker cap. Only then does it export/upload the verified archive and push/verify all prepared Git commits. Stop on any failure; retain the workspace. No deployment or failed-message recovery occurs on the PC.

In your EXISTING VPS PuTTY session run:

    sudo python3 /home/luke/aia-accreditation-production-kit/release/worker-mail-fix-20261022/deploy_approved.py --approve-import-backup-and-application-update

Type DEPLOY-WORKER-MAIL-FIX. This checks release/image proof and capacity, takes a fresh encrypted backup with the existing brief web/worker/ingress pause, and replaces web/worker with automatic code rollback. PostgreSQL/Redis/AIStor, credentials/TLS, Nginx, volumes, Volunteers and staging are preserved. No migrations or email tests. Expected: WORKER_MAIL_FIX_RELEASE_DEPLOYED_PRIVATE_AND_PUBLIC_TLS_READY.

Then use the controlled test leader/registration for ONE NEW notification and confirm its corresponding email arrives. Existing terminal failures are deliberately not resent. Their neutral status-update recovery is a separate authorised operation after the fix is verified; do not replay old approval/rejection payloads or blindly retry uncertain deliveries. Copy the fresh encrypted backup off-VPS manually.
