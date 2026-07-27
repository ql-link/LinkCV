-- Up migration for 0003: set resume template delete null
ALTER TABLE resumes
  DROP FOREIGN KEY fk_resumes_template;

ALTER TABLE resumes
  DROP CHECK ck_resumes_source_fields;

ALTER TABLE resumes
  ADD CONSTRAINT ck_resumes_source_fields CHECK (
    (source_type = 'blank'
      AND source_filename IS NULL
      AND source_object_key IS NULL
      AND extracted_markdown IS NULL)
    OR
    (source_type = 'template'
      AND source_filename IS NULL
      AND source_object_key IS NULL
      AND extracted_markdown IS NULL)
    OR
    (source_type = 'import'
      AND source_filename IS NOT NULL
      AND source_object_key IS NOT NULL
      AND extracted_markdown IS NOT NULL)
  );

ALTER TABLE resumes
  ADD CONSTRAINT fk_resumes_template FOREIGN KEY (template_id)
    REFERENCES resume_templates (id) ON DELETE SET NULL;
