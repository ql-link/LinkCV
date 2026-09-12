-- Upgrade migration for 0047: bind current and historical resume snapshots to existing templates.
-- The revision preflight resolves all rows before these DDL statements run.

ALTER TABLE resume_versions
  ADD COLUMN template_id BIGINT UNSIGNED NULL
    COMMENT '版本使用的模板身份' AFTER resume_id;

ALTER TABLE document_parse_tasks
  ADD COLUMN selected_template_id BIGINT UNSIGNED NULL
    COMMENT '简历导入冻结模板；Dataset 任务为空' AFTER object_name,
  ADD COLUMN source_graph_object_name VARCHAR(512) NULL
    COMMENT '私有 SourceGraph 对象键' AFTER selected_template_id;

UPDATE resumes AS r
INNER JOIN resume_templates AS t
  ON t.`key` = COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(r.style_json, '$.template_snapshot.template_key')),
    JSON_UNQUOTE(JSON_EXTRACT(r.style_json, '$.template_key'))
  )
SET r.template_id = t.id
WHERE r.template_id IS NULL;

UPDATE resume_versions AS v
INNER JOIN resume_templates AS t
  ON t.`key` = COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(v.style_json, '$.template_snapshot.template_key')),
    JSON_UNQUOTE(JSON_EXTRACT(v.style_json, '$.template_key'))
  )
SET v.template_id = t.id
WHERE v.template_id IS NULL;

UPDATE document_parse_tasks AS d
INNER JOIN resumes AS r ON r.parse_task_id = d.id
SET d.selected_template_id = r.template_id
WHERE d.source_type = 'resume_import'
  AND d.parse_status = 'succeeded'
  AND d.selected_template_id IS NULL;

ALTER TABLE resumes
  DROP FOREIGN KEY fk_resumes_template;

ALTER TABLE resumes
  MODIFY COLUMN template_id BIGINT UNSIGNED NOT NULL
    COMMENT '当前绑定模板';

-- MySQL resolves foreign-key names before applying a compound ALTER.  Reusing
-- the old name in the same statement as DROP therefore raises error 1826.
-- Keep the reviewed name, but recreate it in a separate statement.
ALTER TABLE resumes
  ADD CONSTRAINT fk_resumes_template FOREIGN KEY (template_id)
    REFERENCES resume_templates (id) ON DELETE RESTRICT;

ALTER TABLE resume_versions
  MODIFY COLUMN template_id BIGINT UNSIGNED NOT NULL
    COMMENT '版本使用的模板身份',
  ADD CONSTRAINT fk_resume_versions_template FOREIGN KEY (template_id)
    REFERENCES resume_templates (id) ON DELETE RESTRICT,
  ADD KEY idx_resume_versions_template_id (template_id);

ALTER TABLE document_parse_tasks
  ADD CONSTRAINT fk_document_parse_tasks_selected_template
    FOREIGN KEY (selected_template_id)
    REFERENCES resume_templates (id) ON DELETE RESTRICT,
  ADD KEY idx_document_parse_tasks_selected_template (selected_template_id);
