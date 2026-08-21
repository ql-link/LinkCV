-- Remove the seeded templates only while none is referenced by a resume.
UPDATE resume_templates AS template
SET template.is_active = IF(
  EXISTS (SELECT 1 FROM resumes AS resume WHERE resume.template_id = template.id),
  NULL,
  0
)
WHERE template.`key` IN (
  'administrative-sidebar-cn',
  'campus-professional-cn',
  'civic-service-cn',
  'creative-orange-cn'
);

DELETE FROM resume_templates
WHERE `key` IN (
  'administrative-sidebar-cn',
  'campus-professional-cn',
  'civic-service-cn',
  'creative-orange-cn'
);
