-- Reviewed provisioning template. Run only against the explicitly scheduled target.
-- No passwords/login credentials are supplied. DBA provisions separate TLS logins
-- with membership in exactly one service role, using the secret manager.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='aia_runtime') THEN CREATE ROLE aia_runtime NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='aia_backup') THEN CREATE ROLE aia_backup NOLOGIN; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO aia_runtime,aia_backup;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO aia_runtime;
REVOKE INSERT,UPDATE,DELETE ON "_prisma_migrations" FROM aia_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO aia_backup;
REVOKE ALL ON FUNCTION execute_privacy_erasure(uuid),purge_privacy_operation_evidence(uuid) FROM PUBLIC,aia_runtime,aia_backup;
GRANT EXECUTE ON FUNCTION execute_privacy_erasure(uuid),purge_privacy_operation_evidence(uuid) TO aia_privacy_executor;
GRANT SELECT ON "BackupRun" TO aia_privacy_owner;
-- Never grant aia_privacy_owner or aia_privacy_executor membership to web runtime logins.
-- Reapply reviewed grants after every additive migration/restore. Do not use broad
-- default privileges: they would silently expose newly introduced privileged tables/functions.
