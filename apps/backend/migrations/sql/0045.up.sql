-- Upgrade migration for 0045: make dataset uploads idempotent and recoverable.
-- New columns are added nullable so existing rows can be filled before the
-- NOT NULL and user-scoped uniqueness constraints are enforced.

ALTER TABLE user_dataset
  ADD COLUMN idempotency_key VARCHAR(64) NULL DEFAULT NULL
    COMMENT '用户范围内上传幂等键' AFTER user_id,
  ADD COLUMN request_fingerprint CHAR(64) NULL DEFAULT NULL
    COMMENT '规范化文件名、检测格式、大小和 SHA-256 的请求指纹' AFTER idempotency_key;

UPDATE user_dataset
SET idempotency_key = COALESCE(idempotency_key, CONCAT('legacy-', id)),
    request_fingerprint = COALESCE(request_fingerprint, sha256)
WHERE idempotency_key IS NULL OR request_fingerprint IS NULL;

ALTER TABLE user_dataset
  MODIFY COLUMN content_type VARCHAR(128) NOT NULL
    COMMENT '服务端规范化内容类型',
  MODIFY COLUMN idempotency_key VARCHAR(64) NOT NULL
    COMMENT '用户范围内上传幂等键',
  MODIFY COLUMN request_fingerprint CHAR(64) NOT NULL
    COMMENT '规范化文件名、检测格式、大小和 SHA-256 的请求指纹',
  ADD CONSTRAINT uk_user_dataset_user_idempotency
    UNIQUE (user_id, idempotency_key);

ALTER TABLE document_parse_tasks
  DROP CHECK ck_document_parse_tasks_parse_status,
  DROP CHECK ck_document_parse_tasks_lifecycle,
  ADD COLUMN parse_attempt_count INT UNSIGNED NULL DEFAULT NULL
    COMMENT '实际开始解析的累计次数，同时作为尝试版本' AFTER parse_duration_ms,
  ADD COLUMN last_dispatched_at DATETIME(6) NULL DEFAULT NULL
    COMMENT '最近一次确认消息发布的时间（UTC）' AFTER parse_attempt_count;

UPDATE document_parse_tasks
SET parse_attempt_count = 0
WHERE parse_attempt_count IS NULL;

ALTER TABLE document_parse_tasks
  MODIFY COLUMN parse_attempt_count INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT '实际开始解析的累计次数，同时作为尝试版本',
  MODIFY COLUMN parse_status VARCHAR(16) NULL DEFAULT NULL
    COMMENT '解析状态：queued、processing、succeeded、failed',
  ADD CONSTRAINT ck_document_parse_tasks_parse_status
    CHECK (parse_status IS NULL OR parse_status IN ('queued', 'processing', 'succeeded', 'failed')),
  ADD CONSTRAINT ck_document_parse_tasks_lifecycle CHECK (
    (upload_status = 'uploading'
      AND upload_duration_ms IS NULL
      AND parse_status IS NULL
      AND parse_duration_ms IS NULL)
    OR
    (upload_status = 'failed'
      AND upload_duration_ms IS NOT NULL
      AND parse_status IS NULL
      AND parse_duration_ms IS NULL)
    OR
    (upload_status = 'succeeded'
      AND upload_duration_ms IS NOT NULL
      AND parse_status = 'queued'
      AND parse_duration_ms IS NULL)
    OR
    (upload_status = 'succeeded'
      AND upload_duration_ms IS NOT NULL
      AND parse_status = 'processing'
      AND parse_duration_ms IS NULL)
    OR
    (upload_status = 'succeeded'
      AND upload_duration_ms IS NOT NULL
      AND parse_status = 'failed'
      AND parse_duration_ms IS NOT NULL)
    OR
    (upload_status = 'succeeded'
      AND upload_duration_ms IS NOT NULL
      AND parse_status = 'succeeded'
      AND parse_duration_ms IS NOT NULL)
  ),
  ADD INDEX idx_document_parse_tasks_dispatch
    (source_type, parse_status, last_dispatched_at, id);
