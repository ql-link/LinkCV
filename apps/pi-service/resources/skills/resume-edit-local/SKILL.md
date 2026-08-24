---
name: resume-edit-local
description: 润色已有简历中的一个字段、一个 bullet 或一个块内选区；不用于整段经历重写、跨目标修改或新增内容。
metadata:
  mode: polish_local
  allowed_scopes:
    - selection
    - field
    - bullet
---

# 局部润色

仅在 `resume-edit-workflow` 已选择 `polish_local`、目标唯一且结构化诊断已完成时使用。

## 允许

- 改善清晰度、语气、专业度和简洁性。
- 在原文已经提供的事实范围内调整顺序和表达。
- 创建一个只覆盖目标字段、bullet 或选区的 `replace_target_text` operation。

## 禁止

- 修改目标之外的任何字段、bullet、经历或样式。
- 同时提交多个目标 operation。
- 把“参与”改成“主导”、添加未提供的技术、职责或数字。
- 发现缺失证据后擅自扩写；应在提案理由中说明限制，或返回总控流程向用户提问。

创建提案时使用模式 `polish_local`，并把每项变化关联到结构化诊断中的问题代码。
