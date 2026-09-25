-- Keep the existing ID order until an administrator assigns explicit values.
ALTER TABLE resume_templates
  ADD COLUMN sort_order INT NOT NULL DEFAULT 1000 COMMENT '模板展示顺序，数字越小越靠前；相同值按 ID 排序',
  ADD CONSTRAINT ck_resume_templates_sort_order CHECK (sort_order BETWEEN 0 AND 1000000);
