-- Up migration for 0011: drop legacy resume backups
-- The legacy JSON values are intentionally discarded and cannot be reconstructed.
ALTER TABLE resume_versions
  DROP COLUMN legacy_style_json_backup,
  DROP COLUMN legacy_data_json_backup;

ALTER TABLE resumes
  DROP COLUMN legacy_style_json_backup,
  DROP COLUMN legacy_data_json_backup;
