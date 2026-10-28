-- CP60.1 M1 rollback: remove the archive copy. Public tables were never
-- changed by M1, so nothing else needs restoring.
DROP SCHEMA IF EXISTS legacy_archive CASCADE;
