-- Up migration for 0022: add dataset parse tasks.
-- Before running this migration, use cleanup_legacy_user_datasets.py --execute
-- after confirming both database and object-storage backups.

ALTER TABLE document_parse_tasks
  DROP CHECK ck_document_parse_tasks_source_type,
  DROP CHECK ck_document_parse_tasks_file_format,
  MODIFY COLUMN source_type VARCHAR(32) NOT NULL
    COMMENT '任务来源：resume_import、dataset',
  MODIFY COLUMN file_format VARCHAR(8) NOT NULL
    COMMENT '源文件格式：md、txt、docx、pdf',
  ADD COLUMN failure_reason VARCHAR(32) NULL DEFAULT NULL
    COMMENT '解析失败分类原因' AFTER parse_duration_ms,
  ADD CONSTRAINT ck_document_parse_tasks_source_type
    CHECK (source_type IN ('resume_import', 'dataset')),
  ADD CONSTRAINT ck_document_parse_tasks_file_format
    CHECK (file_format IN ('md', 'docx', 'pdf', 'txt'));

DELETE FROM user_dataset;

ALTER TABLE user_dataset
  ADD COLUMN parse_task_id BIGINT UNSIGNED NULL DEFAULT NULL
    COMMENT '关联的解析任务标识，无数据库外键约束' AFTER user_id,
  ADD CONSTRAINT uk_user_dataset_parse_task_id UNIQUE (parse_task_id);
