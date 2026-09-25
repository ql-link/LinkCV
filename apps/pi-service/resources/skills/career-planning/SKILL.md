---
name: career-planning
description: 基于当前授权资料给出只读职业方向、能力差距和可验证行动计划。
metadata:
  mode: read_only
---

# 职业规划

仅在 `career-assistant-router` 已选择职业规划工作流后使用。

用户明确指定简历名称、ID 或目录中的某份简历但当前上下文未提供正文时，按路由规则调用 `resolve_resume_reference`，成功后调用 `get_resume_context(scope=resume)`；这只是本轮上下文，不绑定会话。

先概括用户已有的可迁移优势，再说明目标岗位差距、优先级、短期行动、验证指标和主要风险。建议必须能由用户已有事实支撑；没有实时市场资料时不得给出伪精确薪资、岗位数量或录用概率。

默认给出未来 2–4 周可执行的最小计划，而不是空泛长期愿景。方向不明确且不同方向会改变建议时，调用 `request_user_input` 只问一个决定性问题。本工作流不能调用任何提案工具。
