# Worker save and leader details release

Prepared source material: 3357a0ac5c73d43dfba4df9ecdd043be0d92ea085c6080413dcc6edf2ab13872.
Base: deployed branding release debe402c7cd85914213a0c02f45f084d34d2abdea91467e7d5cc6941dabd94ad.

1. On Windows PowerShell, download and hash-check prepare_pc.ps1, then execute it. Confirm BUILD-UPLOAD-PUSH. It checks the existing tools image by immutable ID, runs networkless unit/type checks, builds all three images serially, verifies the public pinned MC client offline, uploads into a new incoming directory, and verifies GitHub master after pushing. Enter only the existing Clerk **publishable** pk_live_ key when prompted; never the secret key.
2. Expected: WORKER_SAVE_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT and GITHUB_MASTER_VERIFIED=<commit>. If a check/build/hash/upload/push fails, stop and preserve the workspace. Nothing is deployed by this step. Do not bypass failed tests.
3. In VPS PuTTY, run:

   sudo python3 /home/luke/aia-accreditation-production-kit/release/worker-save-20261021/deploy_approved.py --approve-import-backup-and-application-update

   Confirm DEPLOY-WORKER-SAVE. This imports missing verified images, checks the unchanged memory budget, takes a fresh encrypted local backup with the existing brief web/worker/ingress pause, and replaces web/worker only. It preserves database/storage/Redis containers and all data, credentials, TLS, public Nginx, Volunteers and staging. No migrations or emails.
4. Expected: WORKER_SAVE_RELEASE_DEPLOYED_PRIVATE_AND_PUBLIC_TLS_READY. Any STOP means inspect the protected diagnostic; do not repeatedly deploy. If activation fails, previous code bindings/images are restored without restoring/deleting data.
5. With an authorised test company leader, sign in: an editable registration opens My details. Start a record, or explicitly select an existing record belonging to that person. Complete normal required fields/photo/workdays and confirm the current shared notice; Save and continue opens the company portal. The leader counts towards the personnel limit. Confirm ordinary worker save also works. Normal review/submission remains required; this does not auto-approve anyone.
6. Check admin sign-in still opens the admin portal without My details. Copy the fresh encrypted backup off-VPS using the existing custody workflow. No timers are installed.

# Add another administrator (existing Clerk login)

1. In Clerk select this application's **Production** instance and open Users, then the existing user.
2. Ensure the user has actually verified an email address. Copy the User ID starting user_. Do not copy an API key, password or session token.
3. In VPS PuTTY run:

   sudo python3 /home/luke/aia-accreditation-production-kit/release/runtime-review-20261020/acceptance_step.py admin --approve-single-operation

4. Type CREATE-ADMIN. Paste that user's Clerk Production ID at the hidden prompt. Expected: CREATED (or ALREADY_CONFIGURED), followed by ADMIN_BOOTSTRAP_PASSED_BROWSER_LOGIN_PENDING.
5. Have the user sign out and sign in again at https://app.joinaia.pt, then open /pt/admin (or /en/admin). Administrators do not need a company invitation or the company leader's worker profile.
6. If the Clerk identity is already assigned as COMPANY_LEADER or disabled, stop. The bootstrap deliberately refuses to silently promote/reactivate an existing account. Do not edit SQL or Clerk public metadata to bypass it.

The operator must execute privileged deployment/bootstrap commands. No production service has been changed by preparing this package.

The release wrapper permits at most three full capacity checks, 15 seconds apart,
only when HOST_MEMORY_PRESSURE is the sole blocker. Each attempt must pass the
original unmodified checker. Current host PSI averages are printed separately
from the checker's sampling window. Persistent pressure, other blockers, invalid
reports or child failures still stop deployment. No rebuild or image reload is
required for this operator-wrapper correction.
