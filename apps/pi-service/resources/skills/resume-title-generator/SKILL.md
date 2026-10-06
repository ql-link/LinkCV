---
name: resume-title-generator
description: 根据当前授权简历和目标用途给出简短、可辨识的简历标题候选。
metadata:
  mode: read_only
---

# 简历标题建议

跨轮需要此前 @ 的个人画像、简历、资料文件、岗位、求职进程或面试记录时，先使用 `resolve_resource_reference(memory_ref, relation, referring_text)`，由服务端校验本轮指代、用户归属和当前版本并返回有界正文及来源收据。不能将记忆中的 ID 直接加入任务 context_refs，也不能根据上一轮答案假装核验了当前正文；多对象歧义先澄清。简历范围工具仍只操作已解析的本任务简历。

仅在 `career-assistant-router` 已选择标题工作流后使用。

需要简历正文时按路由规则确定本任务目标；本轮点名、可唯一理解的历史指代或背景选择使用 `resolve_resume_reference`，成功后读取当前正文。记忆不是默认目标，歧义先澄清；只解释以前建议或无关问题不读取简历，不绑定会话。

默认输出一个标题候选；用户明确要求数量时按该数量输出，最多五个，且每个候选应有不同且有依据的侧重点，不能用近义变体凑数。优先采用“方向/岗位 + 语言或场景”的结构，中文每个标题不超过 20 个字符，其他语言使用相当长度。只使用已知事实，不堆叠关键词，不自动修改简历。目标用途完全不明确时只问一个问题。

## canonical 节点范围

简历只使用当前 canonical 数据树，章节直接包含段落/列表/row 是合法表达，不要求必须有 entry。需要具体经历而尚未定位时先 resolve_resume_target(scope_hint="resume")、get_resume_context(scope="resume") 读取当前节点目录。只读任务同样可使用定位工具。可用 node_id 定位模块或节点，按 allowed_scopes 读取 section；已有实际 entry 可读 entry；没有 entry 时依据模块正文确定该段经历的起止节点，调用 resolve_resume_target(start_node_id,end_node_id) 冻结连续范围，再按 range 读取和诊断。不能把整章当成第一段，不能猜测 ID；范围不明先澄清。truncated=true 表示正文不完整，需要缩小范围，不能据此结束为已完成。定位新目标后重新读取、重新诊断，不能复用前一目标的指纹。

提案只使用当前读取返回的可编辑节点 ID；new_text 是正文，不携带 linkresume-block 标记，不伪造结构节点。修改授权、版本、节点归属和范围均由服务端复验。
