---
name: resume-translation
description: 将当前授权简历完整翻译为目标语言，并创建一份保留原稿的独立简历提案。
metadata:
  mode: translate_resume
---

# 简历保真翻译

跨轮需要此前 @ 的个人画像、简历、资料文件、岗位、求职进程或面试记录时，先使用 `resolve_resource_reference(memory_ref, relation, referring_text)`，由服务端校验本轮指代、用户归属和当前版本并返回有界正文及来源收据。不能将记忆中的 ID 直接加入任务 context_refs，也不能根据上一轮答案假装核验了当前正文；多对象歧义先澄清。简历范围工具仍只操作已解析的本任务简历。

仅在 `career-assistant-router` 已选择翻译工作流后使用。

## 固定流程

1. 按路由规则确定本任务的翻译对象。显式引用且无冲突可直接定位；本轮点名、历史指代或背景选择先调用 `resolve_resume_reference`，解析成功后定位，不能默认翻译最近讨论的一份。该选择只作用于当前运行，不绑定会话。范围必须是整份简历；再调用 `get_resume_context(scope=resume)`。
2. 目标语言不明确时只问一个问题并结束本轮。
3. 翻译所有面向读者的自然语言文本；保持 JSON 结构、键、数组顺序、节点 ID、来源引用、日期、数字、联系方式、URL、枚举和样式不变。
4. 公司、学校、产品和证书没有可靠正式译名时，保留原名或使用“原名 + 常见译名”，不能猜测。
5. 调用 `create_resume_translation_proposal`，提供完整翻译后的 `data`、原样 `style`、目标语言和候选标题。

## 禁止

- 不润色、压缩、扩写、STAR 重写或新增事实。
- 不改变职责级别，不把参与升级为主导。
- 不调用普通 `create_resume_change_proposal`。
- 不声称已经创建新简历；只有用户确认提案后 FastAPI 才会创建。

## canonical 节点范围

简历只使用当前 canonical 数据树，章节直接包含段落/列表/row 是合法表达，不要求必须有 entry。需要具体经历而尚未定位时先 resolve_resume_target(scope_hint="resume")、get_resume_context(scope="resume") 读取当前节点目录。只读任务同样可使用定位工具。可用 node_id 定位模块或节点，按 allowed_scopes 读取 section；已有实际 entry 可读 entry；没有 entry 时依据模块正文确定该段经历的起止节点，调用 resolve_resume_target(start_node_id,end_node_id) 冻结连续范围，再按 range 读取和诊断。不能把整章当成第一段，不能猜测 ID；范围不明先澄清。truncated=true 表示正文不完整，需要缩小范围，不能据此结束为已完成。定位新目标后重新读取、重新诊断，不能复用前一目标的指纹。

提案只使用当前读取返回的可编辑节点 ID；new_text 是正文，不携带 linkresume-block 标记，不伪造结构节点。修改授权、版本、节点归属和范围均由服务端复验。
