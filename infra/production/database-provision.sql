-- DBA-only INITIAL provisioning of the NEW accreditation-only Compose cluster.
-- Never point this at a shared/existing operational cluster. No passwords in SQL.
\set ON_ERROR_STOP on
SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=:'database_name') AS target_exists \gset
\if :target_exists
  \echo 'REFUSED: target already exists; inspect rather than overwrite.'
  \quit 1
\endif
CREATE ROLE aia_privacy_owner NOLOGIN;
CREATE ROLE aia_privacy_executor NOLOGIN;
CREATE ROLE aia_runtime NOLOGIN;
CREATE ROLE aia_backup NOLOGIN;
CREATE ROLE aia_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE aia_web LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE aia_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE aia_erasure LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT aia_privacy_owner TO aia_migrator;
GRANT aia_privacy_executor TO aia_erasure;
ALTER ROLE aia_migrator SET lock_timeout='5s';
ALTER ROLE aia_migrator SET statement_timeout='10min';
CREATE DATABASE :"database_name" OWNER aia_migrator;
\connect :database_name
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO aia_privacy_owner;
-- Set the four login passwords through masked \password prompts or the approved
-- secret-management mechanism. They intentionally cannot authenticate yet.
-- After migrations, DBA runs runtime-roles.sql in this database, grants
-- aia_runtime TO aia_web,aia_worker, and revokes CREATE from aia_privacy_owner.
-- Restore temporary schema CREATE only for a reviewed function-owner migration.
