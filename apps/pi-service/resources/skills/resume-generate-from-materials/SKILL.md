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
- 只表达来源能证明的角色、动作、交付物和影响；定性证据有效，不强求数字。
- 按目标岗位组织表达，但不能把岗位要求写成用户已经具备的经历。

## 禁止

- 替换或润色任何已有简历内容。
- 使用其他用户、未授权或不存在的资料。
- 在来源中找不到事实时根据常识补造公司、项目、技术、职责或数字。
- 把岗位要求当作用户事实，或把团队/参与经历升级为个人主导。
- 在一个提案中向多个父级新增内容。

证据不足时停止并列出需要用户补充的事实。创建提案时使用模式 `generate_from_materials`，只提交 `insert_after_target` operation，并为事实提供来源标识。

## canonical 节点范围

简历只使用当前 canonical 数据树，章节直接包含段落/列表/row 是合法表达，不要求必须有 entry。需要具体经历而尚未定位时先 resolve_resume_target(scope_hint="resume")、get_resume_context(scope="resume") 读取当前节点目录。只读任务同样可使用定位工具。可用 node_id 定位模块或节点，按 allowed_scopes 读取 section；已有实际 entry 可读 entry；没有 entry 时依据模块正文确定该段经历的起止节点，调用 resolve_resume_target(start_node_id,end_node_id) 冻结连续范围，再按 range 读取和诊断。不能把整章当成第一段，不能猜测 ID；范围不明先澄清。truncated=true 表示正文不完整，需要缩小范围，不能据此结束为已完成。定位新目标后重新读取、重新诊断，不能复用前一目标的指纹。

提案只使用当前读取返回的可编辑节点 ID；new_text 是正文，不携带 linkresume-block 标记，不伪造结构节点。修改授权、版本、节点归属和范围均由服务端复验。
