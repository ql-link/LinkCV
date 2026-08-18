-- Up migration for 0021: unify document parse tasks

CREATE TABLE document_parse_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '解析任务标识',
  source_type VARCHAR(32) NOT NULL COMMENT '任务来源：目前仅 resume_import，为未来消费方预留取值空间',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '所属用户标识',
  file_name VARCHAR(255) NOT NULL COMMENT '安全化后的用户源文件名',
  file_format VARCHAR(8) NOT NULL COMMENT '源文件格式：md、docx、pdf',
  object_name VARCHAR(512) NOT NULL COMMENT '私有对象存储中的源文件对象键',
  converted_object_name VARCHAR(512) NULL DEFAULT NULL COMMENT '转换后 Markdown 在对象存储中的对象键',
  upload_status VARCHAR(16) NOT NULL COMMENT '上传状态：uploading、succeeded、failed',
  upload_duration_ms INT UNSIGNED NULL DEFAULT NULL COMMENT '上传进入终态时的实际耗时毫秒',
  parse_status VARCHAR(16) NULL DEFAULT NULL COMMENT '解析状态：processing、succeeded、failed',
  parse_duration_ms INT UNSIGNED NULL DEFAULT NULL COMMENT '解析进入终态时的实际耗时毫秒',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_document_parse_tasks PRIMARY KEY (id),
  CONSTRAINT fk_document_parse_tasks_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT ck_document_parse_tasks_source_type
    CHECK (source_type IN ('resume_import')),
  CONSTRAINT ck_document_parse_tasks_file_format
    CHECK (file_format IN ('md', 'docx', 'pdf')),
  CONSTRAINT ck_document_parse_tasks_upload_status
    CHECK (upload_status IN ('uploading', 'succeeded', 'failed')),
  CONSTRAINT ck_document_parse_tasks_parse_status
    CHECK (parse_status IS NULL OR parse_status IN ('processing', 'succeeded', 'failed')),
  CONSTRAINT ck_document_parse_tasks_lifecycle CHECK (
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
  KEY idx_document_parse_tasks_user_created_id (user_id, created_at DESC, id DESC),
  KEY idx_document_parse_tasks_user_state (user_id, upload_status, parse_status)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='通用文档上传解析任务';

ALTER TABLE resumes
  ADD COLUMN parse_task_id BIGINT UNSIGNED NULL DEFAULT NULL
    COMMENT '来源解析任务标识，无数据库外键约束' AFTER template_id,
  ADD CONSTRAINT uk_resumes_parse_task_id UNIQUE (parse_task_id);

INSERT INTO document_parse_tasks (
  id,
  source_type,
  user_id,
  file_name,
  file_format,
  object_name,
  converted_object_name,
  upload_status,
  upload_duration_ms,
  parse_status,
  parse_duration_ms,
  created_at,
  updated_at
)
SELECT
  id,
  'resume_import',
  user_id,
  source_filename,
  source_file_format,
  source_object_key,
  NULL,
  upload_status,
  upload_duration_ms,
  parse_status,
  parse_duration_ms,
  created_at,
  updated_at
FROM resume_imports;

UPDATE resumes AS r
INNER JOIN resume_imports AS ri ON ri.result_resume_id = r.id
SET r.parse_task_id = ri.id;

DROP TABLE resume_imports;
