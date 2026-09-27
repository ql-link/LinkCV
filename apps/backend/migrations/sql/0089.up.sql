-- Upgrade migration for 0089: remove dataset replacement and cleanup tables
-- The revision preflight requires empty legacy operation tables.
-- IF EXISTS permits retry after MySQL commits only the first DROP.
DROP TABLE IF EXISTS dataset_replacements;
DROP TABLE IF EXISTS dataset_object_cleanup;
