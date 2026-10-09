# Agent 与统一 LLM 运行时架构

Agent 消息操作由会话 ID 与幂等键生成稳定公共 ID。`agent_operations` 在上下文预检前落库，保存运行创建前失败摘要；`agent_stage_events` 按同一操作记录阶段转换。运行创建后状态仍以 `agent_runs` 为真值，工具终态仍以 `agent_tool_calls` 为真值，提案状态仍以 `resume_change_proposals` 为真值。`agent_runs.model_name` 保存本轮逻辑模型展示名快照，后续改名不改变它；无法可靠还原的旧运行保持空值。新表只提供安全排障时间线，不复制提示词、简历正文、上下文或工具参数；管理员通过 `/api/admin/agent-operations` 查询（`operationId`、`userId` 在 31 天时间窗内精确匹配），删除会话时同步清理。列表与 `modules/admin_insights` 的 Agent 健康统计共用 `agent/admin_routes.py` 的 `operation_rows()`，保证两处状态口径一致；统计的 P95 耗时取已完成运行的 `completed_at - started_at`。`/api/admin/llm/calls` 的 `callId`、`userId` 筛选分别落在 `uk_llm_call_logs_call_id` 与 `idx_llm_calls_user_created` 上。LLM 用量、厂商与模型健康统计只读 `llm_call_logs` 并经线路关联到模型与连接，验证是否有效复用 `resolver.probe_valid`，不另立规则。

普通提案确认的事务边界为当前 Resume 与提案状态，不调用历史版本追加服务。scoped 模式始终在最新 canonical 内容重放 operation 并保留当前 presentation；旧完整快照模式继续严格检查内部锁。翻译需要检查新简历额度，锁顺序为 User、Proposal、源 Resume，与创建简历的 User-before-Resume 顺序一致。普通提案提交失败显式 rollback，幂等确认直接返回当前结果而不重放。


Skill 读取通过既有 `assistant.activity.status` 输出注册名称、独立 callKey 与 running/succeeded/failed 状态，并以 `read_skill` 写入工具审计；审计目标为 skill 和注册名，日志记录 `skill_name`，不记录任意路径或文件正文。Web 按文本与工具事件首次到达的顺序展示，终态更新原位置；重复读取保留独立记录，最终回复开始时清空临时过程。范围读取在成功与 ApiError 失败时记录 scope、目标 surface、section 类型（resume/other/none）、entry/section 是否存在及选区是否存在，不记录简历正文、选区原文或哈希。

## 运行时边界

Web 侧栏根据本地当前会话 ID 区分首页和历史对话的选中状态，不新增请求或持久化字段；呈现规则见 [AI 求职助手](../features/ai-assistant.md#功能范围)。

历史对话输入区的底部定位由 Web 的 `assistant.css` 控制，输入框与添加资料、模型选择作为整体布局；底部间距与设备安全区域规则见 [AI 求职助手](../features/ai-assistant.md#功能范围)。

Web 文件预览的关闭标签状态按会话保存在客户端，文件入口按去重后未关闭的文件计数；展开面板不重新加入已关闭标签，显式点击消息引用可以恢复预览，不修改服务端文件或上下文。

独立 Web 助手允许在主动询问期间发送普通消息以跳过询问，沿用普通消息接口，不附加澄清回复序号或结构化答案；询问的历史记录仍由服务端保存，Web 不再展示旧询问卡片或正文。

两个 Web 助手入口共用 Markdown 渲染器，对模型输出中带空格或中文标点的 `**` 闭合标记做展示兼容；消息保存值、代码原文和复制内容不变，原始 HTML 与危险链接仍不执行。

独立助手和编辑器侧栏复用本地 `MessageActions` 展示消息已有的 `created_at`，并通过 Web 共用的 `copyText()` 将该条 `content` 写入浏览器剪贴板；消息与代码块共用 [HTTP 复制兼容](web.md#浏览器能力兼容)，悬停显隐和复制反馈只发生在 Web，不新增 Agent 请求或持久化字段。

Web 不再将用户消息中的 `tasks` 渲染为消息下方的摘要列表；服务端仍保存并返回任务结果，任务执行链路不受这一呈现调整影响。

两个 Web 助手入口按当前运行状态互斥显示停止或发送按钮，不挂载本机消息队列或排队状态栏；取消运行接口保持不变。具体操作见[消息排队与插入](../features/ai-assistant.md#消息排队与插入)。

独立助手在发送层统一简历标签与正文 `@` 的文字指向，继续通过同一消息接口提交结构化引用；标签呈现和输入草稿不承担权限判断。具体行为见[助手核心规则](../features/ai-assistant.md#核心规则)。

新 scoped 提案保存有界 preview 与操作，不再保存整篇 data/style；旧快照与翻译仍保留完整内容。新上下文目录不列出 resume_version，显式请求或澄清继承这种退休引用时返回 409 AGENT_CONTEXT_RETIRED，不能悄悄替换为当前简历；历史消息中的展示快照继续可读。

Agent 系统由 FastAPI `agent` 模块、独立 `apps/pi-service` 和 FastAPI `llm` 模块组成：`agent` 管理持久化会话、会话展示状态与提案，Pi 执行 agent loop，`llm` 管理模型选择、凭据、验证与计量。普通用户功能见 [AI 求职助手](../features/ai-assistant.md)，第三方 Pi 包边界见 [third_party/pi](third-party-pi.md)。

Web 的共享侧栏、首页任务卡与右侧预览属于客户端呈现；预览中的简历继续复用保存和提案确认队列，模型选择与消息发送仍调用既有 Agent API。明确的文档请求通过既有 Agent 消息运行，生成完成的 Markdown 回复在客户端映射为文档卡片，正文来自模型回复且可从历史消息恢复；`GeneratedDocumentSaveDialog` 复用现有文件夹与 `POST /api/datasets` 接口上传 `.md` 文件，只在上传成功后标记已保存，重试沿用原上传请求。截图预览仍是本地交互，文档复用既有 Agent 与资料库协议；携带本地截图的文档请求提示移除截图后发送。页面重排、导航抽屉与纸面预览适配由 Web 客户端完成，不进入 Agent 上下文或模型任务；共享布局边界见 [Web 响应式布局](web.md#响应式布局)，具体交互见 [AI 求职助手](../features/ai-assistant.md)。

## 组件入口

Web 共享侧栏由 `V3Shell` / `V3Sidebar` 渲染，不提供新建对话按钮或对应显示控制属性；置顶分组根据客户端会话列表决定是否挂载。入口和空分组的显示规则见 [AI 求职助手](../features/ai-assistant.md)，会话持久化和运行 API 沿用既有协议。

首页 Offer 截止提醒直接读取求职记录的 `offer_reply_due_on`，客户端按日历日期计算，不经过 Agent、LLM 或本地示例生成器。

- `modules/agent/routes.py`：用户会话、当前模型摘要、消息 SSE、运行重连、取消和提案确认。
- `modules/agent/run_stream.py`：在 FastAPI 进程内独立消费并缓冲每个 run 的可见事件，使浏览器订阅断开时后台生成继续。
- `modules/agent/internal_routes.py`：只供 Pi 调用的受控上下文与简历工具。
- `apps/pi-service`：独立无头 Node 服务，执行 loop、转发模型调用并调用内部工具。
- `modules/llm/resolver.py`、`service.py`：场景线路解析、调用记录和稳定失败映射。
- `modules/llm/gateway.py`、`crypto.py`：LiteLLM 协议适配与版本化凭据解密。
- `modules/llm/pi_probe.py`：对话线路的固定 Pi Tool 探针。

Pi Service 由运行时按任务和步骤编排整个流程，模型只在步骤内做语义判断和内容生成。意图结果（回退时是对话模型的一次规划）确定任务清单后，运行时逐项启动任务、读取内容、按工作流声明的步骤调用模型，并在每一步只开放该步需要的工具；模型不能规划、开始或结束任务，也不读取 Skill 文件。工作流与任务终态规则在 `apps/pi-service/src/runtime/workflows.js`，步骤、工具和任务执行在 `orchestrator.js`，`resources/skills/*/SKILL.md` 只保存内容规则并由运行时注入步骤指令（测试校验其中不得出现工具名）。Pi Service 通过单一 `systemPromptOverride` 组合 Agent 业务策略和用户可见回复风格；身份、授权资料、结构化澄清与提案确认属于高优先级约束，表达规则只作用于最终自然语言，不改变工具参数、结构化事件或提案字段。回复风格按请求复杂度控制整条回复和单个列表项的句数，把用户指定的事项数量作为硬上限，并要求并列内容使用真实 Markdown 列表而不是序数词段落；分析、诊断和建议类请求不按单点问答压缩，先给总括再逐条分点，诊断 Skill 与最终回复指令同样要求保留分点。简历分析、修改、面试、规划和标题工作流共同叠加 `resume-evidence-method`（证据来源、默认信任用户经历、问题分级、具体性检查与改写示例规则；只有能逐字指出的内部矛盾才算硬伤，正常日期不作为发现）；`resume-diagnosis` 以目标方向、求职阶段和招聘方视角为前提，用 STAR 逐条拆解、XYZ 句式给改写示例，并对技术经历补充难点、取舍、个人分工与效果验证检查，在同一个工作流内按请求区分整体诊断、单段经历、岗位匹配、结构格式、内容问答和片段评价六种场景，不新增工作流或意图类别。工具阶段的可见自然语言被标记为临时活动；全部任务收口后运行时关闭全部工具并发起最终回复，只有该回复才保存为答案，没有正文时运行失败收口，临时活动不会被误存成答案。一次简单诊断是运行时读取简历、一步模型生成和一次最终回复，不含意图识别共 2 轮模型调用。

## 调用链

Pi 在执行任务前调用内部 `intent:recognize`，由 FastAPI 用独立 `assistant_intent` 场景执行结构化意图识别。管理员在模型与路由的场景绑定中配置并探测“助手意图识别”，与用户选择的对话模型独立；协议支持 `openai_chat` 结构化识别及 AIHubMix 的 `system_one` 原生决策。探测必须识别固定虚构请求中的两个只读目标，通用文本连通性不能代替识别探测。

识别输入只含当前请求、有界近期对话、澄清答案及本轮授权资料轻量描述，不额外读取资料正文。响应为 `version=2` 的 `plan|conversation|clarify|fallback`；有效计划复用现有任务 schema 和 `save_task_plan` 的授权校验，保存后 Pi 直接按计划执行，不再重新规划。信息不足沿用结构化澄清；未配置、无有效线路、10 秒总预算超时或模型输出无效时返回 `fallback` 并携带 FastAPI 中唯一一份路由规则（`PLANNING_RULES`），Pi 让对话模型据此规划一次（只开放提交计划、澄清和直接回复三个工具），之后与识别结果走同一条执行路径。授权拒绝、计划冲突和取消不进入回退。运行取消或 Pi 断开内部识别请求会取消上游调用。

原生决策由 `modules/agent/systemone_intent.py` 将有界识别输入转为 `state` 和固定 `questions`，通过受控 AIHubMix 地址的 `/v1/systemone` 发送，不使用 Chat 的 `messages` 接口。问题只问无法推导的内容：是否超过 8 项、最先阻塞执行的一项澄清原因（含 `none`）、显式简历冲突、8 个任务槽位及其依赖集合；存在编辑器背景简历时多问一个 `resume_switch`。处理方式和目标数量由槽位推出，简历授权由服务端按请求规则计算，因此模型不再回答处理方式、目标数量或简历选择，也不存在互相矛盾的答案；只有非简历资料（岗位、资料文件等）才按任务选择，只有一项时不提供等价的“全部”选项。Chat 与原生模式共享 `PLANNING_RULES`：先识别本轮全部业务目标，再按对应任务检查必要条件；问候、能力介绍和使用方法不成为业务目标，混合请求保留业务部分，历史仅解释当前指代。泛优化中“先看看问题”是一项诊断（`resume_diagnosis`），不额外生成修改提案。原生澄清以 choice 选择最先阻塞执行的一项原因；Pi 在澄清步骤只接受 `clarification_purposes` 之内的类别，否则返回 `AGENT_INTENT_CLARIFICATION_SCOPE_INVALID`，返回给模型的错误文本列出本步骤允许的类别。

任务槽位允许出现间隔，按顺序压缩为 `intent_1..n` 并重映射依赖。choice 置信度低于 0.5（任务槽位、澄清原因、依赖）或 noul 概率落在 (0.4, 0.6)（超限、身份冲突）返回 `INTENT_UNCERTAIN`，末尾空槽位的低置信度视为噪声；非简历资料选择置信度不足时只让该任务退化为可读本轮全部非简历资料，不整轮回退，`resume_switch` 存疑时按切换处理。存在澄清原因即为 `clarify`，没有任何任务槽位为 `conversation`，其余为 `plan`；缺字段、未知类别、非法引用和 schema 错误保留 `LLM_RESPONSE_INVALID`。阈值保持不变，失败继续进入回退规划，仍受原权限、任务校验和提案确认约束。超过 8 项和未支持目标要求澄清，不截断。转换器生成顺序标签，不要求模型生成自由文本；生成的 `IntentDecision` 仍经 `save_task_plan` 授权校验。原生协议只开放给意图场景，不能作为 Pi 对话或流式输出协议。管理端修改协议后停用绑定，再次启用时自动验证。

识别结果的版本、类别、调用 ID 和稳定回退原因保存在当前消息的有界 `agent_intent` 元数据；任务仍只有 `agent_tasks` 一个真值。重复请求复用已保存结果。实际调用以 `assistant_intent` 场景、`agent_intent` 来源关联用户与 run 写入 `llm_call_logs`，不记录提示词、原始响应或推理。配置此场景会增加识别调用的延迟与费用；不配置时不发起额外供应商请求。普通对话及回退路由中的纯问候可在读取路由后直接开启最终回复，无需创建业务任务；已有计划包含未完成任务时仍拒绝最终回复。

简历身份由运行时按确定规则决定：`save_task_plan` 把本轮显式选择和编辑器背景简历写入除资源盘点外每项任务的 `context_refs`（识别为 `resume_switch` 时不含背景简历），模型或意图识别提交的简历引用被重算，且不得超出本轮授权；任务能确定简历时不调用模型。只有没有可确定的简历且工作流需要简历时，运行时才进入身份解析步骤，仅开放 `resolve_resume_reference`（有记忆时加 `resolve_resource_reference`）和限定为 `resume_identity` 的澄清；面试、规划和标题等可选简历的只读任务在没有简历时，由模型在生成步骤内按用户点名决定是否解析，解析结果连同当前内容一并返回。身份解析一律经过 `resumes:resolve-reference`，它记录当前任务授权后才允许读取内容；整份简历读取不经过文字定位。

本轮显式 `@简历`（`presentation:mention`，缺省同义）优先于历史；编辑器自动附带的 `presentation:implicit` 简历是本轮背景候选，用户明确切换时可以解析新目标并清除旧选区。显式选择与文字目标冲突时澄清，不静默替换。Pi 按任务解析并冻结目标，范围工具沿用该目标；不同任务分别授权，整个会话不保存默认简历绑定。每份简历只读取当前内容，退休的历史快照不能成为可写目标。

FastAPI 从同会话当前用户消息之前最多 41 条近期记录投影 `conversationMemory`，与文字 `history` 和本轮 `contextMaterials` 分开发送。记忆最多包含 10 个不同资源、总计 6,000 字符，保存消息序号、可信资源 ID、当时名称和有界任务结果；只从用户消息的结构化选择、服务端解析记录或任务 `resolved_refs` 恢复身份，不从助手正文猜 ID，不复制简历正文。超出窗口或预算标记截断，刷新后从已有消息元数据重建；不同会话和用户相互隔离。

模型先判断本轮是否需要读取资料，再结合历史任务理解指代；没有指向时即使只有一个历史对象也不自动读取。明确承接或历史回指使用受控 `resolve_resume_reference` 的 `memory_ref/relation/referring_text` 分支，任务先以空引用规划并启动，服务端校验同会话来源、本轮表达、归属、存在性和显式选择冲突后才追加本任务 `resolved_refs`。解析来源与授权原子保存到当前消息的 `resume_resolutions`，同任务重复解析同 ID 幂等、不同 ID 拒绝。名称未匹配、记忆目标不可用、位置不明和工具故障分别处理；正文与 locator 仍由当前读取产生。模型语义判断依赖运行策略与真实模型评估，服务端引用校验不等于证明自然语言指代正确。

FastAPI 使用进程内后台任务独立消费 Pi 流，浏览器的初始 POST 和后续 `GET /runs/:runId/events` 都只是缓冲流订阅者；切页或刷新只关闭订阅，不取消 run。Web 返回会话时通过 `GET /sessions/:sessionId/active-run` 找到运行并重放事件，终态后再回读持久化消息。

Web API client 在收到 `run.completed`、`run.failed` 或 `run.cancelled` 时结束流读取，不把随后关闭连接的异常重新映射为运行失败。终态后的会话和提案回读是补充同步：独立助手（含恢复订阅）及编辑器侧栏在回读失败时保留流中已收到的内容和真实终态；终态前断流仍报告 `AGENT_STREAM_INCOMPLETE`。

1. FastAPI 创建独立的 Agent session/run/message；session 不保存默认简历。发送前通过唯一的 `contexts` 协议重新解析浏览器选择的简历、资料库文件等轻量引用；简历界面同样提交 `{type:"resume",id}`，并在这一边界转换为当前消息的快照与有界材料，再以服务 token 调用 Pi。独立助手自动附带当前打开的简历时在引用快照与 Pi 材料中保存 `presentation:"implicit"`，Pi 将其作为可切换背景候选；Web 不在输入框或历史用户消息中渲染 `@简历` 单元，所有权、版本校验、canonical 正文读取和 Pi 材料与显式引用完全一致；缺省或 `mention` 保持旧客户端的显式展示。Web 持久化并回读消息时仍以结构化 `contexts` 识别显式引用，在用户气泡正文的原位置渲染内联文件单元，不依赖或重复展示文件名标签；运行阶段只在当前消息附近呈现，不在消息区顶部复制状态标题。已有对话的 Web 输入框最多随草稿增长到 6 行，超出后仅在编辑区内滚动；新建对话继续使用独立的大输入框布局。这些输入框尺寸和位置只属于客户端呈现，不进入消息协议或持久化数据。成功或主动取消终态清空下一轮输入草稿与引用，失败终态保留；已经发送并进入消息历史的 query 不会在取消后自动复制回输入框。独立助手把请求、运行和提案失败投影到页面根层的统一顶部反馈浮层，不改变服务端错误码或终态。助手 Markdown 在共享渲染边界处理标题、软换行、分隔线、表格、列表、引用、链接和代码等常见语法，围栏代码提供复制操作，禁用原始 HTML，并把远程图片降级为文字占位。独立助手和简历编辑器侧栏的用户消息、AI 回复正文与周边 UI 统一使用随应用发布的思源黑体；用户消息气泡与无气泡 AI 正文的呈现差异不进入消息协议或持久化数据。
2. 登录后的 Web 通过 `/api/agent/models` 读取当前有效 `assistant_conversation` 线路按逻辑模型去重后的列表及默认模型 ID；`llm_models.user_selectable=false` 的模型在对话能力中整体排除，默认模型取剩余可选模型中优先级最高者。会话显式选择保存在 `agent_sessions.selected_llm_model_id`；空值跟随当前默认。
3. Pi 通过另一枚 token 调用 `/internal/agent`，读取当前消息已授权的简历、岗位、进程、面试或资料集上下文；`agent_sessions` 不再包含简历字段。运行时先定位整份简历（`scope_hint=resume`，不带引用文字，否则返回 `422 TARGET_REQUEST_INVALID`），再用 `context:read` 一次读取全部内容块及各块 locator，模型只看到内容和块标识：诊断收到全文，修改收到块列表。Pi 的有状态工具在调度层声明串行执行并共用运行级 FIFO。工具阶段的可见 `text_delta` 转换为 `assistant.activity.delta`；每个模型工具、运行时步骤（读取简历、读取资源目录等）和批量修改项另发送 `assistant.activity.status`，浏览器以 `callKey` 原位更新 `running/succeeded/failed`，失败事件只含稳定错误码；运行时步骤写入 `runtime_step` 审计。工具参数在进入执行函数前校验失败时，以同一个 `callKey` 写入 `AGENT_TOOL_ARGUMENT_INVALID` 失败审计，不记录原始参数或供应商错误。隐藏思考、工具参数和工具结果不进入用户正文。全部任务收口后运行时发送 `assistant.activity.clear` 并关闭全部工具，下一轮可见 `text_delta` 才转换为 `assistant.delta`。资源盘点由运行时调用 `resources:list`，只返回轻量目录，不含正文。模型创建修改时只引用已读取的 `block_id` 或逐字摘录的原文，运行时再注入服务端 locator 与 expected-text hash，不能让模型复制或改写这些授权字段。求职进程的阶段摘要以追加式当前阶段和生命周期为真值，旧扁平字段只作迁移兼容；公开选择的 `dataset` 仅限解析成功且转换对象键属于当前用户前缀的资料。`materials:search` 的资料部分在 FastAPI 内先对本轮任务授权且已在 LinkRag 建好索引的资料做多路融合召回，再对其余授权资料做子串匹配；Pi 仅在资料相关或现有信息不足时调用工具，默认查询资料库并固定返回上限 6 条。纯资料问答使用只读 `material_lookup` 工作流；LinkRag 凭证只在 FastAPI。
4. 内部能力和对话请求都先固定逻辑模型，再按该模型在 `llm_use_case_routes` 中的优先级依次尝试有效线路；可切换的上游失败才进入下一条。每次实际上游请求写入 `llm_call_logs`。
5. 运行时按任务清单逐项执行并记录完成、部分完成、受阻或失败；模型只在步骤内生成内容并通过该步骤的提交工具提交（`submit_task_result`、`submit_resume_edit_plan`、`submit_translation`），提交后本步骤立即结束，未提交时提醒一次，仍未提交则任务以 `AGENT_STEP_RESULT_MISSING` 失败并继续后续任务；无法确定简历身份则任务受阻。`resume_diagnosis` 是只读诊断：读取全文后一次生成并提交结论，全程没有提案工具，`needs_input` 只能追问 `content_location`，其他缺失事实写进结论作为补充问题；只读与修改步骤的任务指令带有按 `Asia/Shanghai` 计算的当天日期，只用于避免把已结束的正常经历误判为未来时间，日期本身不作为分析对象；`resume_edit` 读取全部内容块后由模型提交一份修改计划（`polish_local`、`rewrite_entry_star` 或 `generate_from_materials`），运行时逐项定位、校验并创建提案，单项失败只记录该项；`resume_translation` 提交翻译后的正文，样式由运行时从读取结果原样带入；面试、规划、标题和资料问答为只读任务。简历上下文通过统一的 persisted canonical 解析边界读取；结构化 `InlineIcon/title_icon` 只在 Agent Markdown 边界序列化为白名单 `:icon[Name]:`。普通简历改动保存为范围化 canonical 提案；整篇翻译保存为独立 `translate_resume` 提案，服务端复验结构、节点、日期、数字、链接、联系方式和样式不变。确认普通提案时更新当前快照；确认翻译提案时创建新 Resume 与初始版本，并复制源 Resume 私有图片。图片缺失、不支持、复制失败或超过限额时不应用提案，已复制对象在事务失败时补偿删除。

任务计划通过内部 `tasks:plan` 接口在当前用户消息元数据中保存，限制为 1–8 项，并校验工作流、产物类型、已授权资料引用、唯一 ID 和先后依赖。运行时逐项调用 `tasks/{taskId}:status`，按实际结果写入 `running/completed/partial/blocked/failed`（修改类任务没有提案不能完成，部分目标失败为部分完成，等待用户补充为受阻），模型不能声明终态；服务端只接受属于同一 run 的真实提案 ID。工作流以当前任务为边界，Skill 规则只提供方法，不决定用户资料授权。简历引用工具的参数 schema 将显式名称/ID 与历史引用分成互斥分支，历史分支要求完整的 memory_ref、relation、referring_text；memory_ref 仅列出当前窗口中的可用引用。短请求的 referring_text 列出本轮原话和已校验澄清答案，长请求允许逐字摘录并继续由运行时核对；没有记忆时不向模型暴露历史分支。运行意外结束时，FastAPI 把未收口任务标记为失败或受阻，并把该请求已创建但未计入其他任务的提案归到当时正在执行的任务。`agent_runs.status=succeeded` 仍只表示运行和回复正常结束；每项业务结果以任务状态为准。单项提案使用基于目标与操作的稳定请求键，服务端按 run 与请求键幂等返回，批量目标部分失败时保留已创建提案 ID。

## 同一运行内的请求来源

两个 Web 助手入口直接调用消息接口，不再读取、修改或调度未发送队列；现存本机队列保留但不会自动执行。Pi Service 的 `steering.js` 只管理当前运行已接收的插入及回执，最多一条尚未消费的输入；不提供服务端队列编辑、排序或后台调度。运行句柄和插入接收回执在 Pi 内存，业务真值仍在 MySQL。

Pi 复用 SDK 的 `steer()` 和 `prepareNextTurnWithContext` 包装钩子，在完整模型轮次及全部工具结束后调用 FastAPI `steering:activate`。FastAPI 按 User → Session → Run → Message 加锁，复验引用和版本，分配正式用户消息；Pi 切换可信来源序号、目标和工具状态，恢复规划工具，并在用户输入进入原生对话后调用 `steering:ack`。激活重试返回原授权快照和回执，不因后来的资料变化改判成未接受；真正读取正文时仍复验版本。资料正文不写入消息快照。

`message_scope.py` 从同一 run 最新用户消息解析活动请求。Pi 客户端在所有工具回调注入 `X-Agent-User-Sequence`，模型不能自行选择序号；旧请求迟到回调返回 `AGENT_REQUEST_SCOPE_STALE`。旧单用户消息 run 可以兼容推导，多消息 run 缺少来源时拒绝猜测。任务、显式目标和提案授权都跟随当前来源，旧任务结果及提案继续保留。

不改变数据库 schema：正式用户消息的既有 `metadata_json` 保存 `submission`（key/hash/mode）、`steering` 接收/生效状态和 `generated_proposal_ids`；任务仍在各自消息的 `agent_tasks`，被调整的未完成任务增加 `superseded_by_sequence_no`。助手消息元数据保存 `reply_to_sequence_no`。完整回复由 `messages:complete` 在发送完成事件前持久化，后续插入失败不删除此前完整回复；当前未完成片段仍不保存。终态先写回数据库，再对浏览器发送，避免下一条普通消息与上一轮收口竞争。

浏览器断开不会取消当前运行；Web 通过历史会话和活跃运行接口恢复当前运行，不恢复或调度本机队列。客户端重放事件按来源与消息序号去重。用户行为及本机保留边界见[助手功能](../features/ai-assistant.md#消息排队与插入)，接口状态见[HTTP 契约](../api/http-contracts.md#消息排队与插入回执)。

## 进程与信任边界

| 调用方 | 被调用方 | 身份材料 | 可执行范围 |
| --- | --- | --- | --- |
| Web | FastAPI `/api/agent/*` | 用户 Cookie | 当前用户会话、模型摘要、上下文、运行和提案 |
| FastAPI | Pi Service | `PI_SERVICE_TOKEN` | 创建/继续/取消 Agent 运行 |
| Pi Service | FastAPI `/internal/agent/*` | `LINKRESUME_INTERNAL_AGENT_TOKEN` | 受控上下文、模型和简历提案工具 |
| FastAPI LLM service | 模型供应商 | 运行时解密凭据 | 当前绑定能力的一次模型调用 |

两枚服务 token 方向不同且不能复用。Pi Service 默认只监听内部地址；浏览器、插件和小程序都不应感知 Pi URL。

能力配置卡片将识别协议单独展示，避免价格元数据的单行裁切。启用绑定时由后端运行现有场景探针，失败保留停用并显示稳定错误；没有手动探测按钮。验证通过后在新的数据库快照中重新锁定、核对配置指纹，避免使用旧会话中未刷新的验证状态。停用、排序以及有效已启用绑定的幂等请求不发起额外模型调用。

## 治理数据

- `llm_provider_connections`：接入商代码、独立凭据、受控设置、配置版本与目录同步状态。推理地址由接入商适配器确定，后台不能提交任意 URL；AIHubMix 的 model 目标支持 `openai_chat` 与 `openai_responses`，可选择官方默认或备用地址，切换会让旧探测失效。
- `llm_models`：供用户选择的稳定逻辑模型名称；`user_selectable` 决定它能否出现在对话页，隐藏不影响系统能力绑定。
- `llm_model_routes`：逻辑模型在某连接上的实际 `invoke_target`、目标类型、目录元数据、价格规则和启停状态。同一逻辑模型可配置多条线路。线路、逻辑模型一旦被 `agent_runs` 冻结或被 `agent_sessions` 选中，管理端就无法删除，只能停用；因此 Agent 历史里记录的模型和线路始终能查到。
- `llm_use_case_routes`：系统能力和对话列表共用的线路绑定，保存场景、协议、优先级及成功探针指纹。当前场景为职位文本提取、简历结构化、职位图片识别、模拟面试、识别稿修正、简历匹配度（`job_match`）、面试准备清单（`interview_prep`）、编辑器段落精修（`section_review`）、语音识别（`speech_to_text`）、语音合成（`text_to_speech`）和用户对话；场景代码由后端注册，不建字典表。语音支持百炼连接的 `aliyun_asr_realtime`、`aliyun_tts_realtime`，以及 AIHubMix 连接的 `openai_asr_file`、`openai_tts`；协议不能跨场景或跨接入商使用。除意图识别外，其他非对话场景支持接入商声明的 `openai_chat`、`openai_responses`。语音探针通过同一个服务商适配器发送固定测试录音、一秒静音或合成一句固定文本；调用日志在 `usage_json` 记录音频秒数或字符数，不记录音频与正文，也不把缺少计费依据的语音请求估成零费用。
- `llm_call_logs`：每次实际模型请求的线路、配置版本、用量、价格快照、费用和安全错误分类；失败后切换线路会产生多条记录，不保存提示词或正文。Pi 的模型请求由内部服务令牌回传；运行费用由这些记录汇总。
- FastAPI 写入调用日志时按 ORM 字段上限校验上游模型和请求编号；Pi 在计量回传前也按 `PiCallRecord` 的 256/128 字符上限处理这两个可选字段。超长编号记为 `null`，保留调用终态、用量和费用，避免 MySQL 或内部请求校验拒绝计量后使成功请求失败。不会截断编号后冒充完整上游标识。
- 计价由 `modules/llm/pricing.py` 统一计算，Pi 只回传用量。AIHubMix 目录优先保存 `pricing_lines`，完整保留计费项、单位、上下文阶梯和分时条件；有明细时不混用旧摘要。上下文阶梯作用于整次请求，分时区间按供应商时区取左闭右开。输入、缓存读、缓存写互斥；推理 Token 已在输出内，不重复收费。普通 Chat/Responses 网关保留缓存细分，Pi 用 `providerReported` 区分供应商真实用量和 SDK 初始零值；探针的多次模型请求分别计量。未知促销、语音单位、缺少缓存或请求时间均返回具体原因，不能视作免费。
- 新调用以 `request_started_at/request_finished_at` 显式写 UTC；时间窗统计只使用有明确请求时间的记录，另外报告 `unknownTimeCallCount`。历史时间转换必须在管理员预览中选择已核实的旧时区；旧创建时间保持原值。价格版本以完整规则指纹去重，读取时间不冒充生效时间；人工覆盖不会被目录同步覆盖，同步失败也不会清空已有规则。
- 历史补算与账单导入由 `cost_routes.py` 提供管理员预览和每批最多 100 条的执行，保留原投影与新费用明细；同幂等键重复提交复用操作，预览后调用变化标为冲突。仅补算缺失估算费用，指定当前规则需确认适用于选定历史区间。账单精确匹配连接及请求 ID，不按时间或模型模糊匹配，重复、负数和冲突不覆盖已有结算。`costs` 保留估算，`settledCosts` 只汇总结算，`accountedCosts` 每条优先结算否则估算，不将两者相加；补算后重新汇总 Agent run 的完整估算费用。
- `agent_sessions` 保存用户对话显式选中的逻辑模型 ID；`agent_runs` 冻结本轮解析出的逻辑模型、线路、连接配置版本、协议和价格规则。正在运行的请求若遇配置版本变化会失败，避免静默切换凭据。

只有连接、线路、绑定都启用，目录未确认目标下线，并且该场景探针指纹匹配且未过期时，线路才进入解析结果。内部能力和 Pi 都先确定一个逻辑模型，再按该模型在对应场景下的线路优先级尝试；可切换的上游失败会转向下一条有效线路，不跨模型。对话模型列表按逻辑模型去重，用户选定模型失效时返回错误。Pi 在单次模型请求失败且尚未产生内容或工具调用时切换，不重跑整轮 Agent，也不重复已完成的业务工具。当前 FastAPI 的 OpenAI-compatible 请求由薄的 `LiteLLMGateway` 处理，目录、价格和路由均不依赖 LiteLLM。Pi 根据线路声明的协议直接调用供应商。

FastAPI 与 Pi 对 AIHubMix 的两个受控地址使用逐模型验证的参数：

| 模型 | 绑定协议 | 关闭思考参数 |
| --- | --- | --- |
| `gpt-6-luna` | `openai_responses` | `reasoning:{effort:"none"}` |
| `deepseek-v4.1-flash` | `openai_chat` | `thinking:{type:"disabled"}` |
| `qwen3.8-flash` | `openai_chat` | `enable_thinking:false` |

探测、非流式和流式请求均经过同一参数策略。统一 `reasoning_effort:"none"` 在已验证渠道上未可靠关闭 GPT/DeepSeek 的思考，因此不使用该捷径；Pi 的 `thinkingLevel:"off"` 本身也不足以关闭上游思考。其他地址与模型不额外注入这些参数。已有 GPT-6 Luna 的 Chat 绑定必须改为 Responses 并重新探测，代码不静默替换管理员选择的协议。FastAPI Responses Adapter 把文本、图片、终态与 input/output 用量映射到既有调用结果，不保存供应商响应（`store:false`），流在失败、incomplete 或缺失终态时不报告成功。图片探针使用 64×64 RGB PNG，满足 Qwen 的最小尺寸限制。

`ProviderSpeechGateway` 按连接接入商分派。AIHubMix Whisper 将 16 kHz 单声道 PCM16 在内存封装为 WAV，停止录音后调用 `/audio/transcriptions`；词时间戳缺失时返回空列表。Qwen Audio 3.0 TTS Flash 与 `tts-1` 调用 `/audio/speech` 请求 MP3，默认音色分别为 `longanhuan_v3.6` 和 `alloy`。Qwen 的 JSON 音频 URL 只允许已验证的百炼北京结果存储域名，升级为 HTTPS、独立无凭据下载、拒绝重定向并限制响应 8 MiB；返回其他域名或格式时失败，不扩展任意 URL 访问。HTTP 合成/转写请求总时限 75 秒，不自动重试。

文件 ASR 探针使用随 Python 包发布的固定合成录音 `modules/speech/asr_probe.wav`，要求最终转写非空，并继续走同一适配器的时间戳校验。Whisper 对一秒静音曾返回约 30 秒的虚构词时间戳，因此不再把静音响应作为文件识别的可用性依据；百炼实时 ASR 仍使用一秒静音。录音内容为虚构测试句，不含真实用户信息。

旧 `llm_model_configs`、`llm_capability_bindings`、`llm_model_validations` 和旧版 `llm_call_logs` 在 `0088` 中删除并重建。该迁移丢弃旧 LLM 治理和日志数据；Agent 会话及运行记录保留。目标环境迁移前必须核对 revision、旧表行数、运行中任务并备份。

提案确认接口接受可选请求体 `{entry}`，只用于产品漏斗统计，不参与提案校验、重放或权限判断；非法取值在进入确认逻辑前由请求校验返回 422。

`0111–0115` 之后，治理表名为 `llm_provider_connection`、`llm_model`、`llm_model_route`、`llm_use_case_route`、`llm_call_log`，启用与可选标记为 `is_enabled`、`is_user_selectable`、`is_target_available`（NULL 表示未探测）。`llm_use_case_route` 以 `id` 为主键、`(use_case, route_id)` 唯一，代码通过 `get_use_case_route()` 按自然键读取。删除连接、模型或线路前，管理端检查绑定、调用日志和 Agent 运行的引用并返回 409；数据库不再用外键兜底。详见[阿里巴巴 MySQL 规约整改](../internals/backend.md#阿里巴巴-mysql-规约整改)。

## 扩展边界

`resume_tools.replace_editor_markdown` 在修改结构化字段的 `value` 时同步清除该字段的旧 `runs`，随后仍走 canonical 校验；字段样式模型见 [语义简历契约](../api/http-contracts.md#语义简历契约)。

Agent 文本投影为经历结构化字段和 row 单元格正文保留各自的 canonical 节点；locator 的 `field` 标识具体经历字段。`polish_local` 每张提案只允许一个局部 operation：普通块锚点只能修改自身，section 或 entry 标题锚点可以授权其范围内一个已读取的子块，不能跨 section/entry。多项修改必须在同一份修改计划中提交；Pi 复制并冻结计划后严格串行完成每一项的定位、校验和提案，最多展开 20 个目标，`rewrite_entry_star` 的全部修改合并为同一段经历的一张提案。父 section/entry 下需要清理的重复短文本可以通过 `match=all` 展开，不能脱离父范围全局匹配；单项失败写入失败状态后继续后续任务。计划结果在当前 run 内幂等缓存，重复提交返回首次结果而不再创建提案。`replace_target_text` 允许空字符串以清空选区或可选字段，确认时把空的可选经历字段收敛为 `null`；`delete_target` 只删除 section/entry 正文中的完整 paragraph/list item canonical 节点，不允许删除 section、entry、字段或表格单元节点，也不留下空列表项；`insert_after_target` 仍要求非空。多张范围化提案共享创建版本时，确认逻辑用当前快照和各自的目标哈希重放 operation，因其他不相交修改产生的锁版本变化不会使提案冲突，目标自身变化才返回 `TARGET_STALE`；旧快照和整篇翻译仍严格依赖原 `base_lock_version`。语义整份 locator 使用非 `resume` scope 时返回 `SCOPE_FORBIDDEN`。

任务规划阶段只向 Pi 提供已授权资料的轻量目录；每项任务的 `context_refs` 必须是本轮授权引用的子集。任务启动后由 FastAPI 复验归属与当前版本，向 Pi 交付该任务的有界正文和来源角色，任务元数据只保存不含正文、包含内容指纹的材料收据。已规划任务的材料搜索、诊断与提案按当前运行任务的引用检查；未选中的资源不能通过目录扩展正文权限。用户明确点名并通过受控解析得到的本人简历可记录为当前任务的新增引用。新增 Agent 工具必须限制资源类型、动作和用户归属，并保持提案确认边界。资源目录查询只允许 `resume/dataset/interview`，必须从 run 反查用户且只返回轻量元数据；名称分支只接受本轮用户原文或已校验澄清中明确出现的名称；历史分支只接受同会话有界记忆引用及本轮指代表达。目录和记忆结果本身不能授权读取正文。面试、职业规划和标题工作流只有只读能力；普通编辑和整篇翻译使用不同提案工具。简历工具只能操作 canonical 内容节点，不得直接持久化模板 region、slot、CSS 或分页投影；读取和保存必须复用简历应用服务的严格解析与校验入口。新增模型能力需同步能力目录、数据库约束、探针、管理端、调用来源和 HTTP 契约。

## 故障与降级

首页匹配岗位卡的后台分析使用统一 LLM 的 `job_match` 场景和进程内任务，不经过 Pi 运行时；模型未配置或失败时卡片显示不可用说明，不影响助手对话。编辑器段落精修同样直接使用统一 LLM 的 `section_review` 场景，不经过 Pi 运行时，也不创建会话、运行或提案。

- Pi readiness 失败时 FastAPI 仍可提供非 Agent 业务，但助手入口显示不可用且不能创建假成功运行。
- 会话标题和置顶状态由 FastAPI 在用户归属校验后直接持久化；这些 PATCH 操作不进入消息/模型调用链。Web 根据返回的 `pinned` 状态把置顶会话投影到独立 `Pinned` 分组；选择会话时只原位刷新详情，发起新用户消息时才把会话提升到所在分组首位。工作台内简历、模板、求职记录、面试排期和资料库的路由切换、简历选择与工作台嵌入、整块侧栏显隐，以及桌面端会话栏宽度拖动和 `Pinned` 与“最近对话”的独立展开或收起都只属于客户端呈现。它们复用既有资料、简历和求职接口，不改变 Agent API、PATCH 或 DELETE 契约；提案卡片确认按钮改用描边样式同样只是呈现调整。删除会话会锁住目标会话及其运行，运行中时返回 `AGENT_RUN_IN_PROGRESS`，否则按 proposal、tool call、message、run、session 顺序事务清理。
- 用户侧 `/api/agent/*` 路由使用 `get_current_agent_user`：Web Cookie 会话不变；desktop Bearer 只允许 `/api/agent/` 前缀下的路由，其他桌面路径仍返回 `403 DESKTOP_ROUTE_FORBIDDEN`。Mac 原生对话使用同一组接口和同一套运行、幂等与归属校验，不新增 Agent 专用桌面协议；后台管理与模型治理接口不在该白名单内。
- 独立助手确认当前嵌入简历的提案前先完成现有草稿保存；确认成功后 Web 重新读取返回的目标简历，并用非编辑事务替换 Tiptap 文档。刷新读取失败不回滚已经完成的服务端提案，而是保留应用状态并提示用户重新打开简历；非当前简历的提案不触发右侧工作台替换。
- `/api/agent/model` 没有可用对话默认模型时返回 `503 LLM_MODEL_NOT_CONFIGURED`；成功时只返回默认逻辑模型的 `id` 和 `name`，不触发凭据解密。
- 模型未绑定、凭据不可解密、探针失败、供应商超时和计量缺失分别保留稳定状态；调用日志只记录非敏感错误码。
- 单个浏览器 SSE 订阅断开不改变 run；后端进程重启导致运行中缓冲不存在时以 `AGENT_STREAM_INCOMPLETE` 收口。取消和失败保留此前已经创建的提案，不将其自动应用。
- 内部工具失败只影响当前调用；数据库事务由 FastAPI 控制，Pi 不能直接连接 MySQL、Redis 或对象存储。
- Pi 运行异常在进程日志中记录结构化 `agent_run_failed` 终点，只包含 run ID、稳定内部错误码、取消标记和时间，不记录对话或简历正文；浏览器仍只接收白名单公开错误码。
- 管理端通过停用连接、线路或场景绑定撤下新请求；已写入的调用日志和运行模型快照继续保留。

## 修改联动与验证

修改服务间协议时同步 FastAPI `pi_client/internal_routes`、`apps/pi-service`、Compose/Jenkins、运行时契约和 [HTTP 契约](../api/http-contracts.md)。修改能力治理时同步 catalog、schema、模型 CHECK、管理端和探针。主要验证入口为 Agent 路由/服务/context/Pi client 测试、LLM catalog/crypto/gateway/service/Pi probe 测试、`test_llm_admin.py`、Web `AssistantPage`/`AgentPanel`/`AdminLlmPanels` 测试，以及 `npm run check:contracts`。根级 `npm run check:pi` 会由 Node 递归发现并检查 Pi Service 的全部 `.js` 源文件，不依赖 Unix shell 展开通配符。

## 资料正文引用一致性

`modules/agent/resume_tools.py` 的资料检索优先读取 `user_dataset.content_object_name`，没有当前覆盖指针的历史资料回退到成功解析任务对象。来源 ID 使用 `dataset:<id>:content-<content_revision>`；序号为 0 的历史资料继续兼容原源文件摘要。引用校验使用同一规则，因此手动保存后旧来源 ID 失效，不能以未改变的源文件 SHA-256 冒充正文仍未变化。该读取与资料页面使用同一正文真值，详细写入和替换规则见[资料集功能](../features/datasets.md)。

`0089` 后，`context_service` 已移除旧简历版本的列表、解析与素材构造分支，不再导入历史 ORM。旧 `resume_version` 类型仅在入口保留拒绝逻辑，返回 `409 AGENT_CONTEXT_RETIRED`；当前简历上下文和提案继续使用 `resumes`。


## 账号能力与客户端边界

结构化上下文支持 user_profile，后端按当前用户和版本读取求职画像，只传 profile_markdown，不传登录身份和联系邮箱。Web 添加资料入口的可选类型见[助手功能](../features/ai-assistant.md)；入口展示不改变历史 user_profile 引用的解析及权限校验。Pi 上下文白名单接受这一只读字段，不能据此写画像或自动改简历。Agent 新运行、提案操作、模型日志及终态消息写回与账号注销协调；前端界面语言不改变模型正文或模拟面试作答语言。见[账号功能](../features/identity-account.md)。

## 文字面试复盘

求职中心的文字复盘使用既有 `mock_interview` 模型场景（管理员的模拟面试模型绑定），调用来源为 `interview_review`。输入只包含本人该场次的文字记录、阶段和岗位名称，不发送录音。结构化输出复用 LLMService 的额度、线路选择、调用日志和有限重试；原问题、原回答与非空评分证据必须能匹配原记录，记录不足的维度保留空分。只有三个维度都有分数时计算综合平均分。

生成前在本人锁和场次锁下保存请求 UUID、源记录 SHA-256、开始时间和状态，再释放事务调用模型；单次调用最长 120 秒，每个账号至多一场活动生成。相同 UUID 重试不创建新的生成，失败后需以新 UUID 显式重新生成。进程中断的活动状态在 3 分钟后可以重试。生成结束重新核实归属、状态、归档和源记录；变化时丢弃新结果，保留旧报告与文字。报告独立于用户手写总结，修改原文后报告被标为过期。没有长录音转写、音频问题时间戳或后台任务队列承诺。

### 所有可提及资源的跨轮读取

同会话的 `conversationMemory` 覆盖 user_profile、resume、dataset、job、application、interview 六类资源，引用键为 `m:<来源轮次>:<类型>:<ID>`，同数值 ID 按类型区分。记忆仍只有身份、来源与任务摘要，不携带附件正文、来源材料收据或工具结果；窗口、总字符数和资源数量上限保持不变。模型需要此前 @ 的对象时，先启动任务，再调用 `resolve_resource_reference(memory_ref, relation, referring_text)`；FastAPI 从同会话历史重建引用，验证本轮原话、资源当前归属及状态，读取最新有界正文并登记当前任务的引用和来源收据。

同类型的本轮显式 @ 与历史选择冲突时返回 `AGENT_RESOURCE_SELECTION_CONFLICT`；同一任务已解析同类型目标后切换 ID 返回 `AGENT_RESOURCE_TARGET_CONFLICT`。对象不存在、已删除、归属改变或文件未解析可用时返回 `AGENT_MEMORY_TARGET_UNAVAILABLE`。两轮之间变更的对象按当前版本读取；同一任务重复读取冻结的版本和正文 SHA256，期间版本或可读正文变化返回 `AGENT_CONTEXT_STALE`，即使文件源 SHA 不变也不能静默混用新正文。通用简历解析将既有简历授权与通用记录在同一事务提交，中断时一起回滚。解析记录保存无正文 snapshot，材料收据只存内容指纹、来源角色和 source_only，不能将其作为已核实个人业绩。简历通用历史读取继续复用原有显式选择、目标冻结与提案边界，旧简历专用内部接口保持兼容。

服务端意图识别同样接收有界身份记忆，历史指代以空 context_refs 规划，不把旧 ID 直接当成本轮授权。同 run 的插入激活后重建记忆、更新 Pi 历史引用参数与选区来源；读取仍受 X-Agent-User-Sequence 的当前消息校验。个人画像历史读取按本人最新版本解析，保持显式入口的版本校验、只读求职字段和联系信息排除。


本轮显式选择的简历（presentation=mention）就是目标身份：意图识别的 `resume_identity` 澄清只在用户明确点名另一份简历时成立，历史中出现过别的简历或文字没有写明是哪份都不算；Pi 在回退规划等未受意图约束的路径中也拒绝提交 `resume_identity` 问题（`AGENT_RESUME_ALREADY_SELECTED`），除非意图结果标明与显式选择冲突。

后续轮次没有再 `@` 简历、只是继续追问上一轮简历里的内容（如“第一段实习的职位”）时，意图识别把它规划为一项只读的 `resume_diagnosis` 任务，而不是普通对话；Pi 的身份步骤通过 `memory_ref` 与 `relation: continuation` 从短期记忆读取该简历，再按正文直接回答。同样，追问此前 `@` 过的岗位、资料、求职进程或面试记录时，所有只读生成步骤都开放 `resolve_resource_reference`（记忆非空时），按 `memory_ref` 重新校验归属后读取当前内容。

### Canonical 原生目标

任务启动后由 Pi 运行时从镜像内已注册 Markdown 注入工作流规则，模型不读取文件。简历读取使用 canonical 节点：整份读取返回全部可编辑节点及其稳定 ID，章节下的段落可以直接属于章节而没有 entry。修改计划按节点 ID 或带父范围的逐字摘录定位；`rewrite_entry_star` 的目标没有 entry 时，运行时把被修改节点冻结为一个连续 range（服务端记录授权收据）后再诊断和创建提案。读取超过上限时 `truncated=true`：诊断和修改只针对已读取部分并向模型说明，整份翻译因缺少完整数据直接失败为 `RESUME_TOO_LARGE_TO_TRANSLATE`。模型提交的修改在服务端仍复验授权、版本、节点归属和范围。

结构化字段的 `replace_target_text` 在 `canonical_targets.py` 中按纯文字偏移替换 `runs`，保留行内媒体及 `prefix_runs`；图片 alt 不参与字段的预期文字匹配。文字清空后仍包含图片的经历字段不会被删除。完整行内契约见[语义简历契约](../api/http-contracts.md#语义简历契约)。
