# Agent 与统一 LLM 运行时架构

## 运行时边界

Agent 系统由 FastAPI `agent` 模块、独立 `apps/pi-service` 和 FastAPI `llm` 模块组成：`agent` 管理持久化会话、会话展示状态与提案，Pi 执行 agent loop，`llm` 管理模型选择、凭据、验证与计量。普通用户功能见 [AI 求职助手](../features/ai-assistant.md)，第三方 Pi 包边界见 [third_party/pi](third-party-pi.md)。

Web 运行时的浅色页面背景由共享暖白 Token 提供；该视觉 Token 不进入 Agent、消息或模型调用契约。

## 组件入口

- `modules/agent/routes.py`：用户会话、当前模型摘要、消息 SSE、运行重连、取消和提案确认。
- `modules/agent/run_stream.py`：在 FastAPI 进程内独立消费并缓冲每个 run 的可见事件，使浏览器订阅断开时后台生成继续。
- `modules/agent/internal_routes.py`：只供 Pi 调用的受控上下文与简历工具。
- `apps/pi-service`：独立无头 Node 服务，执行 loop、转发模型调用并调用内部工具。
- `modules/llm/service.py`：能力绑定解析、调用记录和稳定失败映射。
- `modules/llm/gateway.py`、`crypto.py`：LiteLLM 调用与版本化凭据解密。
- `modules/llm/pi_probe.py`：Pi Agent 能力的固定工具探针。

Pi Service 通过单一 `systemPromptOverride` 组合 Agent 业务策略和用户可见回复风格。身份、授权资料、工具顺序、结构化澄清与提案确认属于高优先级运行约束；表达规则只作用于最终自然语言，不改变工具参数、结构化事件或提案字段。回复风格按请求复杂度控制整条回复和单个列表项的句数，把用户指定的事项数量作为硬上限，并要求并列内容使用真实 Markdown 列表而不是序数词段落。工具阶段的可见自然语言被标记为临时活动；全部业务工具完成后，Agent 必须调用内部 `begin_final_response` 切换工具，该控制工具不写入业务工具审计，执行时清空临时活动并通过 Pi 的 active-tools API 关闭后续工具。之后的新 assistant turn 才是最终回复；若未切换就结束或切换后没有正文，运行失败收口，临时活动不会被误存成答案。

## 调用链

FastAPI 使用进程内后台任务独立消费 Pi 流，浏览器的初始 POST 和后续 `GET /runs/:runId/events` 都只是缓冲流订阅者；切页或刷新只关闭订阅，不取消 run。Web 返回会话时通过 `GET /sessions/:sessionId/active-run` 找到运行并重放事件，终态后再回读持久化消息。

1. FastAPI 创建 Agent session/run/message；发送前重新解析浏览器选择的简历、资料库文件等轻量引用，再以服务 token 调用 Pi。Web 持久化并回读消息时仍以结构化 `contexts` 识别引用，在用户气泡正文的原位置渲染内联文件单元，不依赖或重复展示文件名标签；运行阶段只在当前消息附近呈现，不在消息区顶部复制状态标题。已有对话的 Web 输入框最多随草稿增长到 6 行，超出后仅在编辑区内滚动；新建对话继续使用独立的大输入框布局。这些输入框尺寸和位置只属于客户端呈现，不进入消息协议或持久化数据。成功终态清空下一轮输入草稿与引用，失败或停止终态保留；独立助手把请求、运行和提案失败投影到页面根层的统一顶部反馈浮层，不改变服务端错误码或终态。助手 Markdown 在共享渲染边界处理标题、软换行、分隔线、表格、列表、引用、链接和代码等常见语法，围栏代码提供复制操作，禁用原始 HTML，并把远程图片降级为文字占位。独立助手和简历编辑器侧栏的用户消息、AI 回复正文与周边 UI 统一使用随应用发布的思源黑体；用户消息气泡与无气泡 AI 正文的呈现差异不进入消息协议或持久化数据。
2. 登录后的 Web 可通过 `/api/agent/model` 读取当前 `pi_agent` 绑定的非敏感 `adapter/name` 摘要；此查询只解析绑定配置，不解密凭据。
3. Pi 通过另一枚 token 调用 `/internal/agent`，读取当前用户被授权的简历、岗位、进程、面试或资料集上下文。工具阶段的可见 `text_delta` 逐个转换为 `assistant.activity.delta`，跨多次工具调用累计在临时活动区；隐藏思考和工具调用 delta 不进入用户正文。`begin_final_response` 执行时发送 `assistant.activity.clear` 并关闭工具，下一轮可见 `text_delta` 才逐个转换为 `assistant.delta`。`list_user_resources` 可从当前 run 反查用户，并列出其简历、已解析资料和面试记录的轻量目录；目录不包含正文。用户明确指定简历名称、ID 或目录中的某一版本后，`resolve_resume_reference` 按当前用户归属解析本轮目标；同名返回候选，已明确版本可使用候选 ID 精确解析。目标 locator 随后传给范围读取、诊断和提案接口，不写入会话的默认简历。求职进程的阶段摘要以追加式当前阶段和生命周期为真值，旧扁平字段只作迁移兼容；公开选择的 `dataset` 仅限解析成功且转换对象键属于当前用户前缀的资料。
4. 模型调用按 `llm_capability_bindings` 选择候选，解密运行凭据并写入 `llm_call_logs`。
5. Pi 每轮先加载 `career-assistant-router`，再选择唯一主工作流。简历上下文通过统一的 persisted canonical 解析边界读取；结构化 `InlineIcon/title_icon` 只在 Agent Markdown 边界序列化为白名单 `:icon[Name]:`。普通简历改动保存为范围化 canonical 提案；整篇翻译保存为独立 `translate_resume` 提案，服务端复验结构、节点、日期、数字、链接、联系方式和样式不变。确认普通提案时更新当前快照；确认翻译提案时创建新 Resume 与初始版本，并复制源 Resume 私有图片。图片缺失、不支持、复制失败或超过限额时不应用提案，已复制对象在事务失败时补偿删除。

## 进程与信任边界

| 调用方 | 被调用方 | 身份材料 | 可执行范围 |
| --- | --- | --- | --- |
| Web | FastAPI `/api/agent/*` | 用户 Cookie | 当前用户会话、模型摘要、上下文、运行和提案 |
| FastAPI | Pi Service | `PI_SERVICE_TOKEN` | 创建/继续/取消 Agent 运行 |
| Pi Service | FastAPI `/internal/agent/*` | `LINKRESUME_INTERNAL_AGENT_TOKEN` | 受控上下文、模型和简历提案工具 |
| FastAPI LLM service | 模型供应商 | 运行时解密凭据 | 当前绑定能力的一次模型调用 |

两枚服务 token 方向不同且不能复用。Pi Service 默认只监听内部地址；浏览器、插件和小程序都不应感知 Pi URL。

## 治理数据

- `llm_model_configs`：能力中立的模型连接配置和版本化密文。
- `llm_capability_bindings`：Chat、简历结构化、Pi Agent、JD 图片解析四项能力到当前候选的绑定。
- `llm_model_validations`：按候选版本、能力和探针版本保存验证证据。
- `llm_call_logs`：调用状态、模型快照、Token、计量完整性和估算成本，不保存消息正文。

绑定 Pi Agent 或 JD 图片解析前必须通过对应真实探针，不能用普通连接测试替代。FastAPI→Pi 与 Pi→FastAPI 使用相反方向的 URL 和两枚独立 token；浏览器不能直连 Pi 或读取模型密钥。

## 扩展边界

`resume_tools.replace_editor_markdown` 在修改结构化字段的 `value` 时同步清除该字段的旧 `runs`，随后仍走 canonical 校验；字段样式模型见 [语义简历契约](../api/http-contracts.md#语义简历契约)。

新增 Agent 工具必须限制资源类型、动作和用户归属，并保持提案确认边界。资源目录查询只允许 `resume/dataset/interview`，必须从 run 反查用户且只返回轻量元数据；按名称解析简历仍只能接受本轮用户原文中明确出现的完整名称，目录结果本身不能授权读取正文。面试、职业规划和标题工作流只有只读能力；普通编辑和整篇翻译使用不同提案工具。简历工具只能操作 canonical 内容节点，不得直接持久化模板 region、slot、CSS 或分页投影；读取和保存必须复用简历应用服务的严格解析与校验入口。新增模型能力需同步能力目录、数据库约束、探针、管理端、调用来源和 HTTP 契约。

## 故障与降级

- Pi readiness 失败时 FastAPI 仍可提供非 Agent 业务，但助手入口显示不可用且不能创建假成功运行。
- 会话标题和置顶状态由 FastAPI 在用户归属校验后直接持久化；这些 PATCH 操作不进入消息/模型调用链。Web 根据返回的 `pinned` 状态把置顶会话投影到独立 `Pinned` 分组；选择会话时只原位刷新详情，发起新用户消息时才把会话提升到所在分组首位。资料库工作区切换、简历选择与工作台嵌入、整块侧栏显隐，以及桌面端会话栏宽度拖动和 `Pinned` 与“最近对话”的独立展开或收起都只属于客户端呈现。它们复用既有资料、简历和求职接口，不改变 Agent API、PATCH 或 DELETE 契约。删除会话会锁住目标会话及其运行，运行中时返回 `AGENT_RUN_IN_PROGRESS`，否则按 proposal、tool call、message、run、session 顺序事务清理。
- `/api/agent/model` 未绑定模型时返回 `503 LLM_MODEL_NOT_CONFIGURED`；成功时只返回当前绑定的 `adapter` 和 `name`，不触发凭据解密。
- 模型未绑定、凭据不可解密、探针失败、供应商超时和计量缺失分别保留稳定状态；调用日志只记录非敏感错误码。
- 单个浏览器 SSE 订阅断开不改变 run；后端进程重启导致运行中缓冲不存在时以 `AGENT_STREAM_INCOMPLETE` 收口。取消和失败不会生成可确认提案。
- 内部工具失败只影响当前调用；数据库事务由 FastAPI 控制，Pi 不能直接连接 MySQL、Redis 或对象存储。
- 删除未绑定模型可清理配置、密钥和验证证据，但历史调用日志保留模型快照；已绑定候选不能编辑或删除。

## 修改联动与验证

修改服务间协议时同步 FastAPI `pi_client/internal_routes`、`apps/pi-service`、Compose/Jenkins、运行时契约和 [HTTP 契约](../api/http-contracts.md)。修改能力治理时同步 catalog、schema、模型 CHECK、管理端和探针。主要验证入口为 Agent 路由/服务/context/Pi client 测试、LLM catalog/crypto/gateway/service/Pi probe 测试、`test_llm_admin.py`、Web `AssistantPage`/`AgentPanel`/`AdminLlmPanels` 测试，以及 `npm run check:contracts`。根级 `npm run check:pi` 会由 Node 递归发现并检查 Pi Service 的全部 `.js` 源文件，不依赖 Unix shell 展开通配符。

## 资料正文引用一致性

`modules/agent/resume_tools.py` 的资料检索优先读取 `user_dataset.content_object_name`，没有当前覆盖指针的历史资料回退到成功解析任务对象。来源 ID 使用 `dataset:<id>:content-<content_revision>`；序号为 0 的历史资料继续兼容原源文件摘要。引用校验使用同一规则，因此手动保存后旧来源 ID 失效，不能以未改变的源文件 SHA-256 冒充正文仍未变化。该读取与资料页面使用同一正文真值，详细写入和替换规则见[资料集功能](../features/datasets.md)。
