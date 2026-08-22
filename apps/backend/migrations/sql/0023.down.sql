-- Down migration for 0023: remove resume version names.

ALTER TABLE resume_versions
  DROP COLUMN name;
