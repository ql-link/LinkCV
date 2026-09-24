-- Upgrade migration for 0084: expand current resume and application resume association
ALTER TABLE resumes
  ADD COLUMN creation_request_id VARCHAR(36) NULL COMMENT '复制操作请求 UUID',
  ADD COLUMN creation_request_hash CHAR(64) NULL COMMENT '复制参数 SHA-256',
  ADD CONSTRAINT uk_resumes_user_creation_request UNIQUE (user_id, creation_request_id),
  ADD CONSTRAINT ck_resumes_creation_request_pair CHECK (
    (creation_request_id IS NULL AND creation_request_hash IS NULL) OR
    (creation_request_id IS NOT NULL AND creation_request_hash IS NOT NULL));

ALTER TABLE resume_change_proposals
  MODIFY COLUMN proposed_data_json JSON NULL,
  MODIFY COLUMN proposed_style_json JSON NULL,
  ADD COLUMN preview_json JSON NULL COMMENT '范围化提案有界前后对比';

ALTER TABLE job_applications
  ADD COLUMN resume_id BIGINT UNSIGNED NULL COMMENT '关联当前简历',
  ADD CONSTRAINT fk_job_applications_resume FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE SET NULL,
  ADD INDEX idx_job_applications_resume (resume_id);

-- Preserve old references for audit. Never link another owner's resume.
UPDATE job_applications
SET resume_id = (
  SELECT r.id FROM resume_versions AS v
  JOIN resumes AS r ON r.id = v.resume_id
  WHERE v.id = job_applications.resume_version_id
    AND r.user_id = job_applications.user_id
)
WHERE resume_id IS NULL AND resume_version_id IS NOT NULL;
