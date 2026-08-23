---
name: resume-edit-entry-star
description: 重组一段已有工作或项目经历的摘要与多个 bullet，使其更符合 STAR；不用于单句润色、跨经历修改或从零生成。
metadata:
  mode: rewrite_entry_star
  allowed_scopes:
    - entry
---

# 经历整体 STAR 优化

仅在 `resume-edit-workflow` 已选择 `rewrite_entry_star`、目标经历唯一且结构化诊断已完成时使用。

## 允许

- 在同一个 `entry_id` 内重组摘要和多个 bullet。
- 减少重复内容，把已有的情境、任务、行动和结果组织成清晰结构。
- 根据授权岗位突出原文已经具备的相关关键词。
- 为同一经历提交多个 `replace_target_text` operation。

## 禁止

- 修改其他经历、模块或样式。
- 把局部润色再交给 `resume-edit-local`，同一运行不得加载第二个执行 Skill。
- 编造 STAR 中缺失的情境、职责、行动或结果。
- 在没有用户或授权资料证据时生成量化数据。

缺少影响改写的 S/T/A/R 事实时停止创建提案，交回总控流程提出具体问题。创建提案时使用模式 `rewrite_entry_star`，且所有 operation 必须属于同一 `entry_id`。
