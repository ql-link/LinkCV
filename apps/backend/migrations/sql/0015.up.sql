-- Up migration for 0015: create resume imports

CREATE TABLE resume_imports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '导入记录标识',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '所属用户标识',
  result_resume_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '解析成功生成的正式简历标识',
  source_filename VARCHAR(255) NOT NULL COMMENT '安全化后的用户源文件名',
  source_file_format VARCHAR(8) NOT NULL COMMENT '源文件格式：md、docx、pdf',
  source_object_key VARCHAR(512) NOT NULL COMMENT '私有 MinIO 对象键',
  upload_status VARCHAR(16) NOT NULL COMMENT '上传状态：uploading、succeeded、failed',
  upload_duration_ms INT UNSIGNED NULL DEFAULT NULL COMMENT '上传进入终态时的实际耗时毫秒',
  parse_status VARCHAR(16) NULL DEFAULT NULL COMMENT '解析状态：processing、succeeded、failed',
  parse_duration_ms INT UNSIGNED NULL DEFAULT NULL COMMENT '解析进入终态时的实际耗时毫秒',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_resume_imports PRIMARY KEY (id),
  CONSTRAINT uk_resume_imports_result_resume UNIQUE (result_resume_id),
  CONSTRAINT fk_resume_imports_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_resume_imports_result_resume FOREIGN KEY (result_resume_id)
    REFERENCES resumes (id) ON DELETE RESTRICT,
  CONSTRAINT ck_resume_imports_source_format
    CHECK (source_file_format IN ('md', 'docx', 'pdf')),
  CONSTRAINT ck_resume_imports_upload_status
    CHECK (upload_status IN ('uploading', 'succeeded', 'failed')),
  CONSTRAINT ck_resume_imports_parse_status
    CHECK (parse_status IS NULL OR parse_status IN ('processing', 'succeeded', 'failed')),
  CONSTRAINT ck_resume_imports_lifecycle CHECK (
    (upload_status = 'uploading'
      AND upload_duration_ms IS NULL
      AND parse_status IS NULL
      AND parse_duration_ms IS NULL
      AND result_resume_id IS NULL)
    OR
    (upload_status = 'failed'
      AND upload_duration_ms IS NOT NULL
      AND parse_status IS NULL
      AND parse_duration_ms IS NULL
      AND result_resume_id IS NULL)
    OR
    (upload_status = 'succeeded'
      AND upload_duration_ms IS NOT NULL
      AND parse_status = 'processing'
      AND parse_duration_ms IS NULL
      AND result_resume_id IS NULL)
    OR
    (upload_status = 'succeeded'
      AND upload_duration_ms IS NOT NULL
      AND parse_status = 'failed'
      AND parse_duration_ms IS NOT NULL
      AND result_resume_id IS NULL)
    OR
    (upload_status = 'succeeded'
      AND upload_duration_ms IS NOT NULL
      AND parse_status = 'succeeded'
      AND parse_duration_ms IS NOT NULL
      AND result_resume_id IS NOT NULL)
  ),
  KEY idx_resume_imports_user_created_id (user_id, created_at DESC, id DESC),
  KEY idx_resume_imports_user_state (user_id, upload_status, parse_status)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='简历源文件导入任务';
