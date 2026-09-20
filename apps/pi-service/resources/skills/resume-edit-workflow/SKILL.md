---
name: resume-edit-workflow
description: 编排当前授权简历的诊断、修改和新增流程；每次相关请求先使用本 Skill，再按原文状态和影响范围选择唯一执行 Skill。
metadata:
  mode: workflow
---

# 简历编辑总控

本 Skill 只负责流程与路由，不编写最终候选内容，也不直接创建修改 operation。

## 固定流程

1. 若用户在独立助手中明确指定简历名称、ID 或目录中的某一版本，先调用 `resolve_resume_reference`；若任务是局部编辑，再调用 `resolve_resume_target` 在刚解析出的同一份简历内定位字段或正文，不能退回依赖会话绑定。未点名简历时直接调用 `resolve_resume_target`。该选择只作用于当前运行，不绑定会话。编辑器选区优先使用稳定块标识；引用文本出现零处或多处时停止并请用户明确位置。
2. 调用 `get_resume_context` 读取目标及完成任务所需的最小上下文。只有整篇诊断才允许读取整份简历。
3. 需要岗位、历史简历或资料依据时调用 `search_resume_materials`。没有授权来源时不得补造事实。
4. 调用 `analyze_resume_content`。修改请求必须取得当前目标的 `diagnosis_fingerprint`；纯分析请求在解释结构化结果后结束。
5. 只处理最多三个真实且高价值的问题。没有数字不等于缺少结果；定性影响、交付物、服务范围、稳定性、流程变化和业务作用都可以是证据。
6. 关键事实缺失时优先查已授权资料；仍缺失且会改变结果时只问一个决定性问题并结束本轮。不得用推测补充公司、职责、技术或量化结果。
7. 按下面的互斥规则读取且只读取一个执行 Skill，再调用 `create_resume_change_proposal`。
8. 提案操作只提交 `get_resume_context` 返回块的 `block_id`、操作类型和新文本；不要复制 target locator 或哈希。运行时会用服务端刚读取的 locator 和哈希构造提案，未知块会被拒绝。

## 唯一路由

- 目标没有原文，需要新增：读取 `resume-generate-from-materials/SKILL.md`。
- 目标已有原文，只影响一个字段、一个 bullet 或一个块内选区：读取 `resume-edit-local/SKILL.md`。
- 目标已有原文，影响同一段经历的摘要或多个 bullet：读取 `resume-edit-entry-star/SKILL.md`。

不要根据“润色、优化、改写”等近义词选择分支。若请求同时包含局部要求和整段重写，以同一经历的较大范围进入 `rewrite_entry_star`，不再加载局部 Skill。跨多个经历时拆成独立提案顺序处理。仍无法得到唯一模式时先询问用户。

## 提案边界

- 一次运行只能使用一个执行模式。
- 提案必须引用刚完成的目标定位、诊断 fingerprint 和授权来源。
- 提案只是 before/after 候选；不得声称已经修改简历。
- 保持角色边界：参与、协助、配合不能升级为主导、负责或领导。
- 岗位关键词结果只是覆盖情况，不是岗位匹配或录用概率。
- 只有用户在 LinkResume 页面确认后，FastAPI 才能正式写入。
- 用户明确要求删除已定位的局部文本或字段时，使用 `replace_target_text` 且 `new_text` 为空字符串；不得为了满足“改写”形式而保留占位符。
- 会话历史中的结构化 `clarification` 与 `clarification_answers` 是已经确认的选择。只要目标版本仍有效，不得换一种说法重复询问同一个范围、动作或位置；应继续定位、诊断并生成提案。
