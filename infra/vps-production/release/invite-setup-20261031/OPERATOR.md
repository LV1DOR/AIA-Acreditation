# Invitation account setup update

Run the pinned prepare_pc.ps1 from Windows PowerShell with Docker Desktop running. BUILD-UPLOAD-PUSH approves a read-only live HTTPS/current release baseline check, synthetic offline UI/auth tests, an isolated networkless PostgreSQL invitation/export/removal test, serial immutable web/worker/tools builds, verified upload and the prepared Git push. Enter only the existing Clerk pk_live_ publishable key. Existing credentials, Clerk Production invite-only mode and DNS require no change.

No real Clerk invitation, production database operation, email or application startup is performed by PC tests. Live Clerk/password browser acceptance is separate. Stop on failure and preserve the workspace; do not rebuild completed images to solve a transfer or deployment problem.

Continue only after INVITE_SETUP_TESTED_BUILT_UPLOADED_VERIFIED_NO_DEPLOYMENT and GITHUB_MASTER_VERIFIED. Run the printed NEXT_PUTTY_COMMAND in the normal VPS PuTTY session. DEPLOY-INVITE-SETUP approves only importing the verified bundle, a fresh encrypted backup and replacing web/worker. No migrations, Compose/Nginx/TLS/credential changes or dependency-container replacement. The existing private disk export scratch directory and exports remain. Volunteers and staging are untouched. Rollback restores the previous application images/bindings without data restore/deletion.

Expected success: INVITE_SETUP_RELEASE_DEPLOYED_PRIVATE_AND_PUBLIC_TLS_READY. Using an approved test leader identity, sign out and open a valid AIA invitation link; confirm it proceeds directly to account/password setup. Invalid/expired/revoked links must not grant access. An already signed-in matching leader must retain explicit invitation acceptance. Use the retry button if ticket creation fails. No bulk invitation resend or real-person test is needed.

Copy the fresh encrypted backup off-VPS using the established manual custody workflow. No new timers or monitoring are installed.
