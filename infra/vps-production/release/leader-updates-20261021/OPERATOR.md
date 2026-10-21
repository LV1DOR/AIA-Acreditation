# Leader portal updates — operator sequence

Run the pinned prepare_pc.ps1 from Windows PowerShell. BUILD-UPLOAD-PUSH authorizes only PC checks/builds, bundle upload and verified GitHub push. The script then opens interactive PuTTY Plink SSH to the VPS. Enter the sudo password if requested and review the separate DEPLOY-LEADER-UPDATES confirmation before production changes. Any failed check prevents build/upload/deployment; any failed transfer/push stops before the SSH deployment prompt.

All three application images are built from one reviewed material. No VPS builds, migrations, database/storage replacements, credential changes or Nginx modifications. A fresh encrypted backup briefly pauses web/worker/ingress; then only web and worker are replaced. The unchanged capacity checker and bounded pressure settling checks remain, with automatic previous-code rollback. Volunteers and staging are untouched.

Expected: LEADER_UPDATES_RELEASE_DEPLOYED_PRIVATE_AND_PUBLIC_TLS_READY. If interrupted after upload, preserve the bundle and use VPS PuTTY without rebuilding:

    sudo python3 /home/luke/aia-accreditation-production-kit/release/leader-updates-20261021/deploy_approved.py --approve-import-backup-and-application-update

Browser acceptance: the leader banner uses the admin's existing event image and identical styling; one vehicle reason field and no Help sidebar; save a valid own worker record and confirm ready status without a second leader approval click. AIA final review and duplicate detection remain. Existing previously saved self records become ready on their next valid Save. Using an approved synthetic/test registration and controlled mailbox, verify a NEW vehicle/request decision produces one in-app notification and one matching branded email. Historical notifications are not resent. Normal outbox retries and scope/erasure guards remain; the access-removal email is restricted to a confirmed former member and grants no portal access.

Copy the fresh encrypted backup off-VPS using the existing custody workflow. No monitoring/backup timers or test messages are installed or sent by preparation/deployment.
