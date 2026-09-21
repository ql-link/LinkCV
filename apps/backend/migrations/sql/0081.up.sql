-- Two independent layout adaptations from the user-selected visual references.
-- Reuse the validated fictional product-manager sample from 0079; only the
-- presentation snapshot changes. Existing templates, resumes and versions stay intact.
INSERT INTO resume_templates (`key`, name, description, data_json, style_json, is_active)
SELECT
  'featured-classic-business-cn',
  '经典商务',
  '浅蓝居中肖像页眉配细蓝章节线，结构克制、信息完整，适合通用商务履历。',
  source.data_json,
  CAST('{"schema_version":"template-definition.v1","template_key":"featured-classic-business-cn","semantic_labels":{"profile":"个人总结","work":"工作经历","education":"教育经历","project":"荣誉奖项","skills":"技能","activity":"实践经历","interests":"兴趣爱好","certificates":"证书","awards":"荣誉奖项","languages":"语言能力"},"regions":[{"region_id":"header","region_kind":"header","order":0},{"region_id":"main","region_kind":"main","order":1}],"slots":[{"slot_id":"identity","region_id":"header","accepts":["identity"],"universal_fallback":false,"order":0},{"slot_id":"content","region_id":"main","accepts":["identity","profile","work","education","project","skills","activity","interests","certificates","awards","languages","custom"],"universal_fallback":true,"order":10}],"tokens":{"font_family":"system-ui","font_size_pt":9.5,"line_height":1.4,"accent_color":"#3267e8","page_margin_mm":12},"avatar":{"visibility":"show","fallback_asset":"system-default","size_px":68,"region_id":"header"}}' AS JSON),
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
  'featured-vitality-cn',
  '活力',
  '暖橙身份卡、经历卡片与右侧技能栏组成轻快双栏，适合强调能力组合与职业成果。',
  source.data_json,
  CAST('{"schema_version":"template-definition.v1","template_key":"featured-vitality-cn","semantic_labels":{"profile":"个人总结","work":"工作经历","education":"教育经历","project":"荣誉奖项","skills":"技能","activity":"实践经历","interests":"兴趣爱好","certificates":"证书","awards":"荣誉奖项","languages":"语言能力"},"regions":[{"region_id":"header","region_kind":"header","order":0},{"region_id":"main","region_kind":"main","order":1},{"region_id":"sidebar","region_kind":"sidebar","order":2}],"slots":[{"slot_id":"identity","region_id":"header","accepts":["identity","profile"],"universal_fallback":false,"order":0},{"slot_id":"support","region_id":"sidebar","accepts":["skills","certificates","languages","interests"],"universal_fallback":false,"order":1},{"slot_id":"content","region_id":"main","accepts":["identity","profile","work","education","project","skills","activity","interests","certificates","awards","languages","custom"],"universal_fallback":true,"order":10}],"tokens":{"font_family":"system-ui","font_size_pt":9.5,"line_height":1.42,"accent_color":"#f06b32","page_margin_mm":12},"avatar":{"visibility":"show","fallback_asset":"system-default","size_px":64,"region_id":"header"}}' AS JSON),
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
