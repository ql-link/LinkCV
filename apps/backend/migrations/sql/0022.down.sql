-- Down migration for 0022: remove dataset parse tasks.
-- Deleted legacy user_dataset rows cannot be restored by downgrade.

DELETE FROM user_dataset;
DELETE FROM document_parse_tasks WHERE source_type = 'dataset';

ALTER TABLE user_dataset
  DROP INDEX uk_user_dataset_parse_task_id,
  DROP COLUMN parse_task_id;

ALTER TABLE document_parse_tasks
  DROP CHECK ck_document_parse_tasks_source_type,
  DROP CHECK ck_document_parse_tasks_file_format,
  DROP COLUMN failure_reason,
  MODIFY COLUMN source_type VARCHAR(32) NOT NULL
    COMMENT '任务来源：目前仅 resume_import，为未来消费方预留取值空间',
  MODIFY COLUMN file_format VARCHAR(8) NOT NULL
    COMMENT '源文件格式：md、docx、pdf',
  ADD CONSTRAINT ck_document_parse_tasks_source_type
    CHECK (source_type IN ('resume_import')),
  ADD CONSTRAINT ck_document_parse_tasks_file_format
    CHECK (file_format IN ('md', 'docx', 'pdf'));
