-- Current resume links were backfilled by 0084. Remove the obsolete audit link.
ALTER TABLE job_applications
  DROP FOREIGN KEY fk_job_applications_resume_version,
  DROP INDEX idx_job_applications_resume_version,
  DROP COLUMN resume_version_id;

DROP TABLE IF EXISTS resume_versions;
DROP TABLE IF EXISTS interview_assets;
