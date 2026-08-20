-- Down migration for 0024: remove the seeded template only when unused.
-- Existing resumes own copied snapshots, but their template source must remain traceable.
UPDATE resume_templates AS template
SET template.is_active = IF(
  EXISTS (
    SELECT 1
    FROM resumes AS resume
    WHERE resume.template_id = template.id
  ),
  NULL,
  0
)
WHERE template.`key` = 'classic-technical-cn';

DELETE FROM resume_templates
WHERE `key` = 'classic-technical-cn';
