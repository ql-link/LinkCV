-- Up migration for 0014: differentiate official resume templates
UPDATE resume_templates
SET data_json = JSON_SET(
  data_json,
  '$.sections.custom_sections',
  JSON_ARRAY(
    JSON_OBJECT(
      'id', 'custom_section_editor',
      'title', '简历正文',
      'items', JSON_ARRAY(
        JSON_OBJECT(
          'id', 'custom_item_editor',
          'title', NULL,
          'subtitle', NULL,
          'content', JSON_OBJECT(
            'format', 'markdown',
            'content', '# 张三

视觉设计师

::: left
杭州 · 13800000000
:::

::: right
zhangsan@example.com
:::

关注品牌体验与数字产品的一致性，能够独立完成从概念到交付的设计。

## 核心能力

::: left
品牌设计 · 界面设计
:::

::: right
设计系统 · 跨端规范
:::

## 工作经历

::: left
远山设计工作室
:::

::: right
2021.07 - 至今
:::

### 资深视觉设计师

负责品牌视觉与产品界面设计，建立跨端视觉规范并支持多个业务团队落地。

## 项目经历

::: left
品牌焕新项目
:::

::: right
设计负责人 · 2024.01 - 2024.06
:::

完成品牌识别、官网与产品界面的统一升级。'
          ),
          'source_refs', JSON_ARRAY()
        )
      )
    )
  )
)
WHERE `key` = 'modern-two-column-cn';

UPDATE resume_templates
SET data_json = JSON_SET(
  data_json,
  '$.sections.custom_sections',
  JSON_ARRAY(
    JSON_OBJECT(
      'id', 'custom_section_editor',
      'title', '简历正文',
      'items', JSON_ARRAY(
        JSON_OBJECT(
          'id', 'custom_item_editor',
          'title', NULL,
          'subtitle', NULL,
          'content', JSON_OBJECT(
            'format', 'markdown',
            'content', '# 张三

后端开发工程师 ｜ 深圳 ｜ 13800000000 ｜ zhangsan@example.com

专注高可用后端服务与工程效率，重视清晰边界和可验证交付。

## 技术栈

**语言与框架：** Python、FastAPI、SQLAlchemy

**数据与基础设施：** MySQL、Redis、容器化部署

**工程能力：** 幂等设计、可观测性、自动化测试

## 工作经历

::: left
云帆网络有限公司 · 高级后端开发工程师
:::

::: right
2020.07 - 至今
:::

- 负责核心业务服务和基础设施建设。
- 优化批处理链路，建立幂等与可观测性规范。

## 项目经历

::: left
服务治理平台 · 核心开发者
:::

::: right
2023.08 - 2024.03
:::

设计可扩展的服务治理能力和失败恢复机制。

## 教育经历

::: left
示例理工大学 · 软件工程
:::

::: right
2016.09 - 2020.06
:::'
          ),
          'source_refs', JSON_ARRAY()
        )
      )
    )
  )
)
WHERE `key` = 'compact-tech-cn';
