-- Up migration for 0014: seed four official resume templates.
-- Existing rows are only re-enabled when every published field still matches.
-- A conflicting stable key attempts to write NULL into is_active and therefore
-- aborts the statement without overwriting the existing template.
INSERT INTO resume_templates (
  `key`, name, description, data_json, style_json, is_active
) VALUES
  (
    'blank-cn',
    '空白简历',
    '从空白内容开始，自由填写个人经历。',
    '{"schema_version":"1.0","basics":{"name":""},"sections":{}}',
    '{"schema_version":"1.0","template_key":"blank-cn","font_family":"source-han-serif","font_size":14,"line_height":1.55,"accent_color":"#2F4858","smart_one_page":false,"page":{"size":"A4","margin_top_mm":14,"margin_right_mm":16,"margin_bottom_mm":14,"margin_left_mm":16},"section_order":["basics","work_experiences","projects","educations","skills"]}',
    1
  ),
  (
    'classic-cn',
    '经典单栏',
    '清晰稳重的单栏结构，适合通用求职场景。',
    '{"schema_version":"1.0","basics":{"name":"张三","headline":"产品经理","email":"zhangsan@example.com","phone":"13800000000","location":"上海","summary":{"format":"markdown","content":"5 年互联网产品经验，擅长从用户问题出发推动跨团队交付。"}},"sections":{"work_experiences":[{"id":"work_classic","start_date":"2022-03","end_date":null,"current":true,"source_refs":[],"organization":"星河科技有限公司","position":"高级产品经理","location":"上海","summary":{"format":"markdown","content":"负责企业协作产品的规划与迭代。"},"highlights":[{"id":"highlight_classic","content":{"format":"markdown","content":"推动核心流程改版，显著降低新用户上手成本。"}}]}],"educations":[{"id":"education_classic","start_date":"2014-09","end_date":"2018-06","current":false,"source_refs":[],"institution":"示例大学","area":"信息管理","study_type":"本科","score":null,"summary":null,"highlights":[]}],"skills":[{"id":"skill_classic","name":"产品设计","level":"熟练","keywords":["需求分析","原型设计","数据分析"]}]} }',
    '{"schema_version":"1.0","template_key":"classic-cn","font_family":"source-han-serif","font_size":14,"line_height":1.55,"accent_color":"#2F4858","smart_one_page":false,"page":{"size":"A4","margin_top_mm":14,"margin_right_mm":16,"margin_bottom_mm":14,"margin_left_mm":16},"section_order":["basics","work_experiences","educations","skills"]}',
    1
  ),
  (
    'modern-two-column-cn',
    '现代双栏',
    '强调个人信息与能力标签的现代双栏布局。',
    '{"schema_version":"1.0","basics":{"name":"张三","headline":"视觉设计师","email":"zhangsan@example.com","phone":"13800000000","location":"杭州","summary":{"format":"markdown","content":"关注品牌体验与数字产品的一致性，能够独立完成从概念到交付的设计。"}},"sections":{"work_experiences":[{"id":"work_modern","start_date":"2021-07","end_date":null,"current":true,"source_refs":[],"organization":"远山设计工作室","position":"资深视觉设计师","location":"杭州","summary":{"format":"markdown","content":"负责品牌视觉与产品界面设计。"},"highlights":[{"id":"highlight_modern","content":{"format":"markdown","content":"建立跨端视觉规范并支持多个业务团队落地。"}}]}],"projects":[{"id":"project_modern","start_date":"2024-01","end_date":"2024-06","current":false,"source_refs":[],"name":"品牌焕新项目","role":"设计负责人","url":null,"summary":{"format":"markdown","content":"完成品牌识别、官网与产品界面的统一升级。"},"highlights":[]}],"skills":[{"id":"skill_modern","name":"设计能力","level":"熟练","keywords":["品牌设计","界面设计","设计系统"]}],"languages":[{"id":"language_modern","name":"英语","fluency":"熟练"}]}}',
    '{"schema_version":"1.0","template_key":"modern-two-column-cn","font_family":"source-han-serif","font_size":13.5,"line_height":1.5,"accent_color":"#315C6B","smart_one_page":false,"page":{"size":"A4","margin_top_mm":12,"margin_right_mm":14,"margin_bottom_mm":12,"margin_left_mm":14},"section_order":["basics","skills","languages","work_experiences","projects"]}',
    1
  ),
  (
    'compact-tech-cn',
    '紧凑技术型',
    '信息密度较高，适合突出技术栈与项目成果。',
    '{"schema_version":"1.0","basics":{"name":"张三","headline":"后端开发工程师","email":"zhangsan@example.com","phone":"13800000000","location":"深圳","summary":{"format":"markdown","content":"专注高可用后端服务与工程效率，重视清晰边界和可验证交付。"}},"sections":{"work_experiences":[{"id":"work_tech","start_date":"2020-07","end_date":null,"current":true,"source_refs":[],"organization":"云帆网络有限公司","position":"高级后端开发工程师","location":"深圳","summary":{"format":"markdown","content":"负责核心业务服务和基础设施建设。"},"highlights":[{"id":"highlight_tech","content":{"format":"markdown","content":"重构异步任务链路并建立幂等与可观测性规范。"}}]}],"projects":[{"id":"project_tech","start_date":"2023-08","end_date":"2024-03","current":false,"source_refs":[],"name":"任务调度平台","role":"核心开发者","url":null,"summary":{"format":"markdown","content":"设计可扩展的任务状态机和失败恢复机制。"},"highlights":[]}],"educations":[{"id":"education_tech","start_date":"2016-09","end_date":"2020-06","current":false,"source_refs":[],"institution":"示例理工大学","area":"软件工程","study_type":"本科","score":null,"summary":null,"highlights":[]}],"skills":[{"id":"skill_tech","name":"后端技术","level":"熟练","keywords":["Python","FastAPI","MySQL","Redis","消息队列"]}]}}',
    '{"schema_version":"1.0","template_key":"compact-tech-cn","font_family":"source-han-serif","font_size":12.5,"line_height":1.38,"accent_color":"#263238","smart_one_page":true,"page":{"size":"A4","margin_top_mm":10,"margin_right_mm":12,"margin_bottom_mm":10,"margin_left_mm":12},"section_order":["basics","skills","work_experiences","projects","educations"]}',
    1
  )
ON DUPLICATE KEY UPDATE
  is_active = IF(
    name = VALUES(name)
      AND description <=> VALUES(description)
      AND data_json = VALUES(data_json)
      AND style_json = VALUES(style_json),
    VALUES(is_active),
    NULL
  );
-- Add reviewed MySQL 8.4 statements below.
