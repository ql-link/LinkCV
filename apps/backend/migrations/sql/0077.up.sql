-- Upgrade migration for 0077: retire three legacy resume templates
-- Retain template identities and snapshots for existing resumes and versions.
UPDATE resume_templates
SET is_active = 0
WHERE `key` IN ('classic-cn', 'modern-two-column-cn', 'compact-tech-cn')
  AND is_active = 1;
