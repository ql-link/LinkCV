# Agent 与统一 LLM 运行时架构

## 运行时边界

Agent 系统由 FastAPI `agent` 模块、独立 `apps/pi-service` 和 FastAPI `llm` 模块组成：`agent` 管理持久化会话、会话展示状态与提案，Pi 执行 agent loop，`llm` 管理模型选择、凭据、验证与计量。普通用户功能见 [AI 求职助手](../features/ai-assistant.md)，第三方 Pi 包边界见 [third_party/pi](third-party-pi.md)。

## 组件入口

- `modules/agent/routes.py`：用户会话、当前模型摘要、消息 SSE、取消和提案确认。
- `modules/agent/internal_routes.py`：只供 Pi 调用的受控上下文与简历工具。
- `apps/pi-service`：独立无头 Node 服务，执行 loop、转发模型调用并调用内部工具。
- `modules/llm/service.py`：能力绑定解析、调用记录和稳定失败映射。
- `modules/llm/gateway.py`、`crypto.py`：LiteLLM 调用与版本化凭据解密。
- `modules/llm/pi_probe.py`：Pi Agent 能力的固定工具探针。

## 调用链

1. FastAPI 创建 Agent session/run/message；发送前重新解析浏览器选择的简历、资料库文件等轻量引用，再以服务 token 调用 Pi。Web 持久化并回读消息时仍以结构化 `contexts` 识别引用，在用户气泡正文的原位置渲染内联文件单元，不依赖或重复展示文件名标签。
2. 登录后的 Web 可通过 `/api/agent/model` 读取当前 `pi_agent` 绑定的非敏感 `adapter/name` 摘要；此查询只解析绑定配置，不解密凭据。
3. Pi 通过另一枚 token 调用 `/internal/agent`，读取当前用户被授权的简历、岗位、进程、面试或资料集上下文；公开选择的 `dataset` 仅限解析成功且转换对象键属于当前用户前缀的资料。
4. 模型调用按 `llm_capability_bindings` 选择候选，解密运行凭据并写入 `llm_call_logs`。
5. 简历上下文通过统一的 persisted canonical 解析边界读取；结构化 `InlineIcon/title_icon` 只在 Agent Markdown 边界序列化为白名单 `:icon[Name]:`，不降级为可编辑普通文本。简历改动只保存为 canonical 提案，确认后回到 FastAPI 简历应用服务执行乐观锁写入并重新编译模板 `LayoutPlan`。

## 进程与信任边界

| 调用方 | 被调用方 | 身份材料 | 可执行范围 |
| --- | --- | --- | --- |
| Web | FastAPI `/api/agent/*` | 用户 Cookie | 当前用户会话、模型摘要、上下文、运行和提案 |
| FastAPI | Pi Service | `PI_SERVICE_TOKEN` | 创建/继续/取消 Agent 运行 |
| Pi Service | FastAPI `/internal/agent/*` | `LINKCV_INTERNAL_AGENT_TOKEN` | 受控上下文、模型和简历提案工具 |
| FastAPI LLM service | 模型供应商 | 运行时解密凭据 | 当前绑定能力的一次模型调用 |

两枚服务 token 方向不同且不能复用。Pi Service 默认只监听内部地址；浏览器、插件和小程序都不应感知 Pi URL。

## 治理数据

- `llm_model_configs`：能力中立的模型连接配置和版本化密文。
- `llm_capability_bindings`：Chat、简历结构化、Pi Agent、JD 图片解析四项能力到当前候选的绑定。
- `llm_model_validations`：按候选版本、能力和探针版本保存验证证据。
- `llm_call_logs`：调用状态、模型快照、Token、计量完整性和估算成本，不保存消息正文。

绑定 Pi Agent 或 JD 图片解析前必须通过对应真实探针，不能用普通连接测试替代。FastAPI→Pi 与 Pi→FastAPI 使用相反方向的 URL 和两枚独立 token；浏览器不能直连 Pi 或读取模型密钥。

## 扩展边界

新增 Agent 工具必须限制资源类型、动作和用户归属，并保持提案确认边界。简历工具只能操作 canonical 内容节点，不得直接持久化模板 region、slot、CSS 或分页投影；读取和保存必须复用简历应用服务的严格解析与校验入口。新增模型能力需同步能力目录、数据库约束、探针、管理端、调用来源和 HTTP 契约。

## 故障与降级

- Pi readiness 失败时 FastAPI 仍可提供非 Agent 业务，但助手入口显示不可用且不能创建假成功运行。
- 会话标题和置顶状态由 FastAPI 在用户归属校验后直接持久化；这些 PATCH 操作不进入消息/模型调用链。删除会话会锁住目标会话及其运行，运行中时返回 `AGENT_RUN_IN_PROGRESS`，否则按 proposal、tool call、message、run、session 顺序事务清理。
- `/api/agent/model` 未绑定模型时返回 `503 LLM_MODEL_NOT_CONFIGURED`；成功时只返回当前绑定的 `adapter` 和 `name`，不触发凭据解密。
- 模型未绑定、凭据不可解密、探针失败、供应商超时和计量缺失分别保留稳定状态；调用日志只记录非敏感错误码。
- SSE 在正常终态前断开时标记连接中断；取消和失败不会生成可确认提案。
- 内部工具失败只影响当前调用；数据库事务由 FastAPI 控制，Pi 不能直接连接 MySQL、Redis 或对象存储。
- 删除未绑定模型可清理配置、密钥和验证证据，但历史调用日志保留模型快照；已绑定候选不能编辑或删除。

## 修改联动与验证

修改服务间协议时同步 FastAPI `pi_client/internal_routes`、`apps/pi-service`、Compose/Jenkins、运行时契约和 [HTTP 契约](../api/http-contracts.md)。修改能力治理时同步 catalog、schema、模型 CHECK、管理端和探针。主要验证入口为 Agent 路由/服务/context/Pi client 测试、LLM catalog/crypto/gateway/service/Pi probe 测试、`test_llm_admin.py`、Web `AssistantPage`/`AgentPanel`/`AdminLlmPanels` 测试，以及 `npm run check:contracts`。
