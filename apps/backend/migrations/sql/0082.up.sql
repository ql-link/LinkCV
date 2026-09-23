-- Upgrade migration for 0082: unify interview assets into user_dataset
ALTER TABLE user_dataset
  DROP CHECK ck_user_dataset_file_format,
  ADD COLUMN asset_kind VARCHAR(16) NOT NULL DEFAULT 'document'
    COMMENT '资料种类:document/audio/video' AFTER sha256,
  ADD COLUMN interview_session_id BIGINT UNSIGNED NULL
    COMMENT '关联面试场次;NULL 为普通资料' AFTER asset_kind,
  ADD COLUMN interview_source_type VARCHAR(24) NULL
    COMMENT '面试素材来源:recorded/uploaded;NULL 为普通资料'
    AFTER interview_session_id,
  ADD COLUMN duration_ms BIGINT UNSIGNED NULL
    COMMENT '音视频时长毫秒' AFTER interview_source_type,
  ADD COLUMN legacy_interview_asset_id BIGINT UNSIGNED NULL
    COMMENT '迁移来源 interview_assets.id' AFTER duration_ms,
  ADD CONSTRAINT ck_user_dataset_file_format CHECK (
    file_format IN (
      'docx', 'pdf', 'md', 'txt',
      'webm', 'm4a', 'mp3', 'wav', 'ogg', 'mp4', 'mov'
    )
  ),
  ADD CONSTRAINT ck_user_dataset_asset_kind CHECK (
    asset_kind IN ('document', 'audio', 'video')
  ),
  ADD CONSTRAINT ck_user_dataset_kind_format CHECK (
    (asset_kind = 'document'
      AND file_format IN ('docx', 'pdf', 'md', 'txt')) OR
    (asset_kind IN ('audio', 'video')
      AND file_format IN ('webm', 'm4a', 'mp3', 'wav', 'ogg', 'mp4', 'mov'))
  ),
  ADD CONSTRAINT ck_user_dataset_interview_context CHECK (
    interview_source_type IS NULL
      OR interview_source_type IN ('recorded', 'uploaded')
  ),
  ADD CONSTRAINT ck_user_dataset_interview_source CHECK (
    interview_session_id IS NULL OR interview_source_type IS NOT NULL
  ),
  ADD CONSTRAINT ck_user_dataset_duration CHECK (
    duration_ms IS NULL
      OR (asset_kind IN ('audio', 'video') AND duration_ms > 0)
  ),
  ADD CONSTRAINT uk_user_dataset_legacy_asset
    UNIQUE (legacy_interview_asset_id),
  ADD CONSTRAINT fk_user_dataset_interview_session
    FOREIGN KEY (interview_session_id)
    REFERENCES interview_sessions (id)
    ON DELETE SET NULL,
  ADD INDEX idx_user_dataset_session_created
    (interview_session_id, created_at, id);

ALTER TABLE document_parse_tasks
  DROP CHECK ck_document_parse_tasks_file_format,
  ADD CONSTRAINT ck_document_parse_tasks_file_format CHECK (
    file_format IN (
      'md', 'docx', 'pdf', 'txt',
      'webm', 'm4a', 'mp3', 'wav', 'ogg', 'mp4', 'mov'
    )
  );
