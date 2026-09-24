---
name: resume-title-generator
description: 根据当前授权简历和目标用途给出简短、可辨识的简历标题候选。
metadata:
  mode: read_only
---

# 简历标题建议

仅在 `career-assistant-router` 已选择标题工作流后使用。

用户明确指定简历名称、ID 或目录中的某份简历但当前上下文未提供正文时，按路由规则调用 `resolve_resume_reference`，成功后调用 `get_resume_context(scope=resume)`；这只是本轮上下文，不绑定会话。

默认输出一个标题候选；用户明确要求数量时按该数量输出，最多五个，且每个候选应有不同且有依据的侧重点，不能用近义变体凑数。优先采用“方向/岗位 + 语言或场景”的结构，中文每个标题不超过 20 个字符，其他语言使用相当长度。只使用已知事实，不堆叠关键词，不自动修改简历。目标用途完全不明确时只问一个问题。
