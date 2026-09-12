-- Restore the production-reviewed A4 margins for the classic technical theme.
UPDATE resume_templates
SET style_json = JSON_SET(
  style_json,
  '$.page.margin_top_mm', 9.0,
  '$.page.margin_right_mm', 11.0,
  '$.page.margin_bottom_mm', 9.0,
  '$.page.margin_left_mm', 11.0
)
WHERE `key` = 'classic-technical-cn';

UPDATE resumes
SET style_json = JSON_SET(
  style_json,
  '$.page.margin_top_mm', 9.0,
  '$.page.margin_right_mm', 11.0,
  '$.page.margin_bottom_mm', 9.0,
  '$.page.margin_left_mm', 11.0
)
WHERE JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.template_key')) = 'classic-technical-cn';

UPDATE resume_versions
SET style_json = JSON_SET(
  style_json,
  '$.page.margin_top_mm', 9.0,
  '$.page.margin_right_mm', 11.0,
  '$.page.margin_bottom_mm', 9.0,
  '$.page.margin_left_mm', 11.0
)
WHERE JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.template_key')) = 'classic-technical-cn';

-- Existing resumes keep their own complete snapshots. The foreign key clears
-- only template_id so the retired product entry can be removed safely.
DELETE FROM resume_templates WHERE `key` = 'blank-cn';
