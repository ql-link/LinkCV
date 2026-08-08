-- Down migration for 0014: remove editor-only differentiated previews.
UPDATE resume_templates
SET data_json = JSON_REMOVE(data_json, '$.sections.custom_sections')
WHERE `key` IN ('modern-two-column-cn', 'compact-tech-cn');
