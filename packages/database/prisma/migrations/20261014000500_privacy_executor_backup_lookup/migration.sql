-- The evidence-expiry definer may read copy status, but cannot delete or alter archives.
GRANT SELECT ON "BackupRun" TO aia_privacy_owner;
