# Production exports deployment

Run the pinned prepare_pc.ps1 in Windows PowerShell with Docker Desktop running. It performs a read-only public TLS/current source baseline check through SSH before building anything. BUILD-UPLOAD-PUSH authorizes only synthetic PC tests, isolated networkless PostgreSQL tests, serial web/worker/tools builds, verified upload into a new incoming folder, and the prepared Git fast-forward push. Enter only the existing pk_live_ publishable key, never the Clerk secret. No new SMTP, S3, WeBook or license input is needed.

Stop on a failed source, unit, type, database, image, archive, transfer or Git check. Preserve the workspace. No application image is built until synthetic tests pass. No VPS builds, production queries, emails or real participant exports occur in PC tests.

After EXPORTS_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT and GITHUB_MASTER_VERIFIED, run the exact printed NEXT_PUTTY_COMMAND. It requires DEPLOY-EXPORTS before importing images, taking a fresh encrypted backup, preparing a private disk-backed /tmp for web and replacing web/worker. It validates that database files are identical and refuses any migration change. Database/Redis/AIStor containers, volumes, TLS, credentials, RAM limits, host Nginx, Volunteers and staging are preserved. No public routing change.

The /tmp bind uses the pre-existing mountpoint in the immutable image, preserving a read-only web root. Only the production state/export-tmp directory is owned by UID/GID1000 and mode0700. It is not public. Normal downloads, cancellations and errors clean up their generated ZIP. Crash leftovers remain private for inspection. Rollback restores old Compose/source/images, keeps the scratch directory and never deletes volumes or restores data automatically.

Expected success: EXPORTS_RELEASE_DEPLOYED_PRIVATE_AND_PUBLIC_TLS_READY. In Admin > Exports select the event. Test both downloads with approved synthetic records. ID-ALL ZIP contains the staff workbook and matching photos; WeBook XLSX has blank text QR fields for manual values. Validate import/photo matching and any QR/physical-print behavior separately on the actual printing PC. The app does not contact the WeBook service or manufacture QR values.

Copy the fresh encrypted backup off-VPS using the established manual custody process. No monitoring/backup timers are installed by this release.
