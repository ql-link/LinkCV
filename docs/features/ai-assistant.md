# AI 求职助手功能

## 功能范围

AI 助手提供独立对话工作区和简历编辑器侧栏，允许用户组合简历、历史版本、岗位、求职进程、面试复盘和资料集作为上下文，执行分析、澄清和简历修改建议。它不绕过用户确认直接改写简历，也不向用户暴露模型密钥或 Pi 服务。

接口与 SSE 终态见 [HTTP 接口契约](../api/http-contracts.md)；服务拆分、内部工具和模型治理见 [Agent/LLM 运行时架构](../internals/agent-runtime.md)。

## 用户入口

- `/assistant`：会话列表、快捷任务、上下文选择、对话、停止和提案确认。
- `/resumes/:resumeId/edit` 的 `AgentPanel`：围绕当前简历或选中文本发起助手请求。
- `/admin/llm/models`：管理员维护模型候选和四项能力绑定；这是治理入口，不属于普通用户助手操作。

## 代码地图

| 层级 | 入口 | 职责 |
| --- | --- | --- |
| 用户 HTTP | `modules/agent/routes.py` | readiness、上下文、会话、消息 SSE、取消和提案动作 |
| 上下文 | `modules/agent/context_service.py` | 引用解析、所有权和版本检查 |
| 提案服务 | `modules/agent/service.py`、`resume_tools.py` | 工具结果、目标定位、提案创建与确认 |
| Pi 客户端 | `modules/agent/pi_client.py` | FastAPI 到 Pi 的请求、SSE 代理和终态映射 |
| Web | `features/assistant/`、`features/agent/` | 独立助手与编辑器侧栏 |
| 运行时 | `apps/pi-service`、`modules/llm/` | Agent loop、模型绑定、探针和计量 |

## 核心规则

- 浏览器只提交服务端签发的上下文引用和版本标记，不把受控对象全文拼入用户消息。
- 带编辑器选区的请求先保存当前草稿，确保后端能按块 ID、范围和内容摘要定位同一版本。
- Agent 运行可以定位、读取、诊断和生成提案；所有简历写入先形成 `resume_change_proposals`。
- 用户确认提案时再次校验所有权、`base_lock_version`、目标定位和内容前置条件；冲突或目标失效时保留当前简历。
- 停止、失败和异常 EOF 都有明确终态，不能把半条响应当作成功。

## 数据归属

会话、运行、消息、工具调用和提案分别由 `agent_sessions`、`agent_runs`、`agent_messages`、`agent_tool_calls` 与 `resume_change_proposals` 保存。模型候选、绑定、验证和计量属于技术治理数据，不是用户对话内容，详见运行时架构文档。

## 关键流程

1. Web 查询 readiness 和可选上下文，提交用户消息、幂等键及轻量引用。
2. FastAPI 校验上下文所有权与版本，创建 run/message 后调用 Pi，并把 Pi SSE 事件转换为浏览器协议。
3. Pi 只能通过内部工具读取受控材料、执行诊断或创建修改提案；工具调用和结果摘要写入审计数据。
4. 需要补充信息时返回结构化 clarification；继续对话复用同一 session，不静默替换已绑定简历。
5. 用户确认提案后，FastAPI 重新读取目标和简历锁版本，验证通过才调用简历应用服务写入。

## 权限与失败边界

- session、run、proposal、上下文引用和目标简历都必须同时校验当前用户，公开 ID 不能代替归属条件。
- 取消请求、Pi 不可用、模型失败、异常 EOF、提案过期、内容摘要不一致和锁冲突都有独立终态；失败不会把提案标为已应用。
- 对话正文不会写入 LLM 调用日志，模型凭据不会返回浏览器，内部工具不能接受任意 URL 或对象键。
- 助手对岗位、求职和资料集只有受控读取能力；业务写入仍回到对应领域服务。

## 修改联动与验证

修改 SSE 事件、上下文类型、提案 operation 或澄清结构时，需同步 `schemas.py`、Pi 协议、Web 两个客户端、接口契约和 Agent 测试；模型能力变化还需同步[运行时架构](../internals/agent-runtime.md)。主要验证入口为 `test_agent_routes.py`、`modules/agent/test_context_service.py`、`test_pi_client.py`、`test_service.py`，以及 Web `AssistantPage` 和 `AgentPanel` 测试。
