---
name: resource-catalog
description: 仅在用户明确要求盘点自己的简历、资料或面试记录时列出轻量目录。
metadata:
  mode: read_only
---

# 资料目录查询

先读取 career-assistant-router。仅当用户明确要求“有哪些简历/资料/面试记录”时进入本工作流，调用 list_user_resources 后回答。

“修改当前简历”不能进入本工作流。本轮已有 resume 上下文时，不得查询目录来重新选择编辑对象。不同 resume ID 表示独立简历，同名时称为“同名简历”，不是历史版本。目录查询不改变本轮编辑目标，也不创建修改提案。
