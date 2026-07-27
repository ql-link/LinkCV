-- Down migration for 0005: migrate legacy resume snapshots
ALTER TABLE resume_versions
  DROP COLUMN legacy_style_json_backup,
  DROP COLUMN legacy_data_json_backup;

ALTER TABLE resumes
  DROP COLUMN legacy_style_json_backup,
  DROP COLUMN legacy_data_json_backup;
