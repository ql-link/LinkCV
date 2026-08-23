---
name: resume-generate-from-materials
description: 在目标位置没有原文时，根据当前用户授权的岗位、资料或明确补充事实新增简历内容；不用于替换或润色已有内容。
metadata:
  mode: generate_from_materials
  allowed_scopes:
    - insertion
---

# 从资料生成简历内容

仅在 `resume-edit-workflow` 已选择 `generate_from_materials`、新增位置唯一且资料召回已完成时使用。

## 允许

- 根据 `search_resume_materials` 返回的授权来源，向已定位父级新增一个指定类型的条目或字段。
- 合并多个来源中一致且可追溯的事实，并在提案中保留 `source_ids`。
- 按目标岗位组织表达，但不能把岗位要求写成用户已经具备的经历。

## 禁止

- 替换或润色任何已有简历内容。
- 使用其他用户、未授权或不存在的资料。
- 在来源中找不到事实时根据常识补造公司、项目、技术、职责或数字。
- 在一个提案中向多个父级新增内容。

证据不足时停止并列出需要用户补充的事实。创建提案时使用模式 `generate_from_materials`，只提交 `insert_after_target` operation，并为事实提供来源标识。
