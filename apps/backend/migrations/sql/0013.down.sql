-- Down migration for 0013: keep source records and existing resumes intact.
UPDATE resume_templates
SET is_active = 0
WHERE `key` IN (
  'blank-cn',
  'classic-cn',
  'modern-two-column-cn',
  'compact-tech-cn'
);
-- Add reviewed MySQL 8.4 statements below.
