-- Restore the compact density used by future classic technical snapshots.
-- The expected current tokens are part of the predicate so a changed or
-- customized official row fails closed instead of being silently overwritten.
UPDATE resume_templates
SET style_json = JSON_SET(
  style_json,
  '$.font_size', 9.5,
  '$.line_height', 1.25,
  '$.accent_color', '#202632',
  '$.page.margin_top_mm', 9.0,
  '$.page.margin_right_mm', 11.0,
  '$.page.margin_bottom_mm', 9.0,
  '$.page.margin_left_mm', 11.0
)
WHERE `key` = 'classic-technical-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.template_key')) <=> 'classic-technical-cn'
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.font_size')) AS DECIMAL(10, 4)) = 11.5
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.line_height')) AS DECIMAL(10, 4)) = 1.42
  AND JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.accent_color')) <=> '#2F4858'
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.page.margin_top_mm')) AS DECIMAL(10, 4)) = 9.0
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.page.margin_right_mm')) AS DECIMAL(10, 4)) = 11.0
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.page.margin_bottom_mm')) AS DECIMAL(10, 4)) = 9.0
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.page.margin_left_mm')) AS DECIMAL(10, 4)) = 11.0;
