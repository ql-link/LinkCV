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
- 优先形成“动作 + 对象/方法 + 真实结果或交付物”的清晰表达；无法量化时保留准确的定性证据。
- 创建一个只覆盖目标字段、bullet 或选区的 operation：改写或清空字段使用 `replace_target_text`，删除 section/entry 正文中的完整 paragraph/list item 使用 `delete_target`。

## 禁止

- 修改目标之外的任何字段、bullet、经历或样式。
- 在一张提案中同时提交多个目标 operation；复合请求应由总控流程形成完整任务清单，并通过 `execute_local_resume_edit_plan` 串行创建独立提案。
- 把“参与”改成“主导”、添加未提供的技术、职责或数字。
- 为追求模板感强行添加百分比、规模或夸大的结果。
- 发现缺失证据后擅自扩写；应在提案理由中说明限制，或返回总控流程向用户提问。

创建提案时使用模式 `polish_local`，并把每项变化关联到结构化诊断中的问题代码。

## canonical 节点范围

简历只使用当前 canonical 数据树，章节直接包含段落/列表/row 是合法表达，不要求必须有 entry。需要具体经历而尚未定位时先 resolve_resume_target(scope_hint="resume")、get_resume_context(scope="resume") 读取当前节点目录。只读任务同样可使用定位工具。可用 node_id 定位模块或节点，按 allowed_scopes 读取 section；已有实际 entry 可读 entry；没有 entry 时依据模块正文确定该段经历的起止节点，调用 resolve_resume_target(start_node_id,end_node_id) 冻结连续范围，再按 range 读取和诊断。不能把整章当成第一段，不能猜测 ID；范围不明先澄清。truncated=true 表示正文不完整，需要缩小范围，不能据此结束为已完成。定位新目标后重新读取、重新诊断，不能复用前一目标的指纹。

提案只使用当前读取返回的可编辑节点 ID；new_text 是正文，不携带 linkresume-block 标记，不伪造结构节点。修改授权、版本、节点归属和范围均由服务端复验。
