-- Upgrade migration for 0049: freeze TemplateDefinition for active imports.
-- The Python revision validates every active task before this DDL and writes
-- normalized snapshots only after the column exists.

ALTER TABLE document_parse_tasks
  ADD COLUMN selected_template_style_json JSON NULL DEFAULT NULL
    COMMENT '简历导入受理时冻结的 TemplateDefinition；Dataset 任务为空'
    AFTER selected_template_id;
