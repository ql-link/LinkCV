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

适用于修改方式为 `polish_local`、目标唯一的情形。

## 允许

- 改善清晰度、语气、专业度和简洁性。
- 在原文已经提供的事实范围内调整顺序和表达。
- 优先形成“动作 + 对象/方法 + 真实结果或交付物”的清晰表达；无法量化时保留准确的定性证据。
- 创建一个只覆盖目标字段、bullet 或选区的 operation：改写或清空字段使用 `replace_target_text`，删除 section/entry 正文中的完整 paragraph/list item 使用 `delete_target`。

## 禁止

- 修改目标之外的任何字段、bullet、经历或样式。
- 把多个目标合并成一张提案；多个目标应逐项列入同一份修改计划，系统会为每项创建独立提案。
- 把“参与”改成“主导”、添加未提供的技术、职责或数字。
- 为追求模板感强行添加百分比、规模或夸大的结果。
- 发现缺失证据后擅自扩写；应在修改理由中说明限制，或向用户提出一个关键问题。

每项修改都要用一句话说明理由。
