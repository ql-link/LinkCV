-- 0034 升级迁移：删除已归档 JD，并彻底移除 JD 归档语义。
DELETE FROM job_descriptions
WHERE archived_at IS NOT NULL;

ALTER TABLE job_descriptions
  DROP INDEX idx_job_descriptions_user_archive_updated_id,
  DROP COLUMN archived_at;
