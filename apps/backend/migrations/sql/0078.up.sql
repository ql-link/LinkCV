-- Two independent layout adaptations from the user-selected visual reference.
-- Reuse the already-validated fictional product-manager sample from 0077; only the
-- presentation snapshot changes. Existing templates, resumes and versions stay intact.
INSERT INTO resume_templates (`key`, name, description, data_json, style_json, is_active)
SELECT
  'featured-card-dashed-cn',
  '卡片虚线',
  '蓝色圆角身份卡配虚线章节分隔，单栏信息密度高，适合强调连续职业成果。',
  source.data_json,
  CAST('{"schema_version":"template-definition.v1","template_key":"featured-card-dashed-cn","semantic_labels":{"profile":"个人总结","work":"工作经历","education":"教育经历","project":"荣誉奖项","skills":"技能","activity":"实践经历","interests":"兴趣爱好","certificates":"证书","awards":"荣誉奖项","languages":"语言能力"},"regions":[{"region_id":"header","region_kind":"header","order":0},{"region_id":"main","region_kind":"main","order":1}],"slots":[{"slot_id":"identity","region_id":"header","accepts":["identity"],"universal_fallback":false,"order":0},{"slot_id":"content","region_id":"main","accepts":["identity","profile","work","education","project","skills","activity","interests","certificates","awards","languages","custom"],"universal_fallback":true,"order":10}],"tokens":{"font_family":"system-ui","font_size_pt":9.5,"line_height":1.42,"accent_color":"#2864e8","page_margin_mm":12},"avatar":{"visibility":"show","fallback_asset":"system-default","size_px":68,"region_id":"header"}}' AS JSON),
  1
FROM resume_templates AS source
WHERE source.`key` = 'featured-product-cn'
ON DUPLICATE KEY UPDATE
  is_active = IF(
    resume_templates.name = VALUES(name)
    AND resume_templates.description = VALUES(description)
    AND resume_templates.data_json = VALUES(data_json)
    AND resume_templates.style_json = VALUES(style_json),
    resume_templates.is_active,
    NULL
  );

INSERT INTO resume_templates (`key`, name, description, data_json, style_json, is_active)
SELECT
  'featured-card-rail-cn',
  '卡片分栏',
  '蓝色圆角身份卡配左侧章节索引，右侧承载完整履历，适合快速扫描时间与经历。',
  source.data_json,
  CAST('{"schema_version":"template-definition.v1","template_key":"featured-card-rail-cn","semantic_labels":{"profile":"个人总结","work":"工作经历","education":"教育经历","project":"荣誉奖项","skills":"技能","activity":"实践经历","interests":"兴趣爱好","certificates":"证书","awards":"荣誉奖项","languages":"语言能力"},"regions":[{"region_id":"header","region_kind":"header","order":0},{"region_id":"main","region_kind":"main","order":1}],"slots":[{"slot_id":"identity","region_id":"header","accepts":["identity"],"universal_fallback":false,"order":0},{"slot_id":"content","region_id":"main","accepts":["identity","profile","work","education","project","skills","activity","interests","certificates","awards","languages","custom"],"universal_fallback":true,"order":10}],"tokens":{"font_family":"system-ui","font_size_pt":9.5,"line_height":1.42,"accent_color":"#2864e8","page_margin_mm":12},"avatar":{"visibility":"show","fallback_asset":"system-default","size_px":68,"region_id":"header"}}' AS JSON),
  1
FROM resume_templates AS source
WHERE source.`key` = 'featured-product-cn'
ON DUPLICATE KEY UPDATE
  is_active = IF(
    resume_templates.name = VALUES(name)
    AND resume_templates.description = VALUES(description)
    AND resume_templates.data_json = VALUES(data_json)
    AND resume_templates.style_json = VALUES(style_json),
    resume_templates.is_active,
    NULL
  );
