# Agent 与统一 LLM 运行时架构

Agent 消息操作由会话 ID 与幂等键生成稳定公共 ID。`agent_operations` 在上下文预检前落库，保存运行创建前失败摘要；`agent_stage_events` 按同一操作记录阶段转换。运行创建后状态仍以 `agent_runs` 为真值，工具终态仍以 `agent_tool_calls` 为真值，提案状态仍以 `resume_change_proposals` 为真值。`agent_runs.model_name` 保存本轮逻辑模型展示名快照，后续改名不改变它；无法可靠还原的旧运行保持空值。新表只提供安全排障时间线，不复制提示词、简历正文、上下文或工具参数；管理员通过 `/api/admin/agent-operations` 查询（`operationId`、`userId` 在 31 天时间窗内精确匹配），删除会话时同步清理。列表与 `modules/admin_insights` 的 Agent 健康统计共用 `agent/admin_routes.py` 的 `operation_rows()`，保证两处状态口径一致；统计的 P95 耗时取已完成运行的 `completed_at - started_at`。`/api/admin/llm/calls` 的 `callId`、`userId` 筛选分别落在 `uk_llm_call_logs_call_id` 与 `idx_llm_calls_user_created` 上。LLM 用量、厂商与模型健康统计只读 `llm_call_logs` 并经线路关联到模型与连接，验证是否有效复用 `resolver.probe_valid`，不另立规则。

普通提案确认的事务边界为当前 Resume 与提案状态，不调用历史版本追加服务。scoped 模式始终在最新 canonical 内容重放 operation 并保留当前 presentation；旧完整快照模式继续严格检查内部锁。翻译需要检查新简历额度，锁顺序为 User、Proposal、源 Resume，与创建简历的 User-before-Resume 顺序一致。普通提案提交失败显式 rollback，幂等确认直接返回当前结果而不重放。

## 运行时边界

独立助手和编辑器侧栏复用本地 `MessageActions` 展示消息已有的 `created_at`，并将该条 `content` 写入浏览器剪贴板；悬停显隐和复制反馈只发生在 Web，不新增 Agent 请求或持久化字段。

新 scoped 提案保存有界 preview 与操作，不再保存整篇 data/style；旧快照与翻译仍保留完整内容。新上下文目录不列出 resume_version，显式请求或澄清继承这种退休引用时返回 409 AGENT_CONTEXT_RETIRED，不能悄悄替换为当前简历；历史消息中的展示快照继续可读。

Agent 系统由 FastAPI `agent` 模块、独立 `apps/pi-service` 和 FastAPI `llm` 模块组成：`agent` 管理持久化会话、会话展示状态与提案，Pi 执行 agent loop，`llm` 管理模型选择、凭据、验证与计量。普通用户功能见 [AI 求职助手](../features/ai-assistant.md)，第三方 Pi 包边界见 [third_party/pi](third-party-pi.md)。

Web 的共享侧栏、首页任务卡与右侧预览属于客户端呈现；预览中的简历继续复用保存和提案确认队列，模型选择与消息发送仍调用既有 Agent API。明确的文档请求通过既有 Agent 消息运行，生成完成的 Markdown 回复在客户端映射为文档卡片，正文来自模型回复且可从历史消息恢复；`GeneratedDocumentSaveDialog` 复用现有文件夹与 `POST /api/datasets` 接口上传 `.md` 文件，只在上传成功后标记已保存，重试沿用原上传请求。截图预览仍是本地交互，文档复用既有 Agent 与资料库协议；携带本地截图的文档请求提示移除截图后发送。页面重排、导航抽屉与纸面预览适配由 Web 客户端完成，不进入 Agent 上下文或模型任务；共享布局边界见 [Web 响应式布局](web.md#响应式布局)，具体交互见 [AI 求职助手](../features/ai-assistant.md)。

## 组件入口

首页 Offer 截止提醒直接读取求职记录的 `offer_reply_due_on`，客户端按日历日期计算，不经过 Agent、LLM 或本地示例生成器。

- `modules/agent/routes.py`：用户会话、当前模型摘要、消息 SSE、运行重连、取消和提案确认。
- `modules/agent/run_stream.py`：在 FastAPI 进程内独立消费并缓冲每个 run 的可见事件，使浏览器订阅断开时后台生成继续。
- `modules/agent/internal_routes.py`：只供 Pi 调用的受控上下文与简历工具。
- `apps/pi-service`：独立无头 Node 服务，执行 loop、转发模型调用并调用内部工具。
- `modules/llm/resolver.py`、`service.py`：场景线路解析、调用记录和稳定失败映射。
- `modules/llm/gateway.py`、`crypto.py`：LiteLLM 协议适配与版本化凭据解密。
- `modules/llm/pi_probe.py`：对话线路的固定 Pi Tool 探针。

Pi Service 通过单一 `systemPromptOverride` 组合 Agent 业务策略和用户可见回复风格。身份、授权资料、工具顺序、结构化澄清与提案确认属于高优先级运行约束；表达规则只作用于最终自然语言，不改变工具参数、结构化事件或提案字段。回复风格按请求复杂度控制整条回复和单个列表项的句数，把用户指定的事项数量作为硬上限，并要求并列内容使用真实 Markdown 列表而不是序数词段落。工具阶段的可见自然语言被标记为临时活动；全部业务工具完成后，Agent 必须调用内部 `begin_final_response` 切换工具，该控制工具不写入业务工具审计，执行时清空临时活动并通过 Pi 的 active-tools API 关闭后续工具。之后的新 assistant turn 才是最终回复；若未切换就结束或切换后没有正文，运行失败收口，临时活动不会被误存成答案。

## 调用链

Pi 在业务工具前调用内部 `intent:recognize`，由 FastAPI 用独立 `assistant_intent` 场景执行结构化意图识别。管理员在模型与路由的场景绑定中配置并探测“助手意图识别”，与用户选择的对话模型独立；协议限定为 `openai_chat`。探测必须识别固定虚构请求中的两个只读目标，通用文本连通性不能代替识别探测。

识别输入只含当前请求、有界近期对话、澄清答案及本轮授权资料轻量描述，不额外读取资料正文。有效计划复用现有任务 schema 和 `save_task_plan` 的授权校验，保存后 Pi 直接加载并执行，不再重新规划。信息不足沿用结构化澄清；未配置、无有效线路、10 秒总预算超时或模型输出无效时沿用现有路由。授权拒绝、计划冲突和取消不进入回退。运行取消或 Pi 断开内部识别请求会取消上游调用。

识别结果的版本、类别、调用 ID 和稳定回退原因保存在当前消息的有界 `agent_intent` 元数据；任务仍只有 `agent_tasks` 一个真值。重复请求复用已保存结果。实际调用以 `assistant_intent` 场景、`agent_intent` 来源关联用户与 run 写入 `llm_call_logs`，不记录提示词、原始响应或推理。配置此场景会增加识别调用的延迟与费用；不配置时不发起额外供应商请求。普通对话及回退路由中的纯问候可在读取路由后直接开启最终回复，无需创建业务任务；已有计划包含未完成任务时仍拒绝最终回复。

简历定位工具的 description 区分身份解析与内容定位：本轮已有结构化 `resume` 上下文时直接使用 `resolve_resume_target`；没有该上下文时先按用户明确点名调用 `resolve_resume_reference`，唯一解析成功后也可继续调用 `resolve_resume_target`，不能因为缺少初始结构化上下文而重复解析身份。这些描述指导模型选择，不替代现有归属、工作流和目标校验。编辑 Skill 根据原文存在性及单字段、单块或同一经历的影响范围选择，复合局部目标仍由批处理工具执行，不按用户使用的近义动词切换执行模式。

本轮目标按显式 `@简历`、编辑器隐式简历、无结构化上下文时的用户点名依次确定。Web 在显式选择其他简历时不携带旧编辑器选区；Pi 将本轮 `resume` ID 固定为运行目标，名称解析工具也按该 ID 读取，不再搜索同名记录。已有目标的运行默认隐藏资源目录工具，只有明确的 `resource-catalog` 盘点工作流才开放目录；业务工具仍有同样的执行校验。澄清问题按内部 `purpose` 分类，已确定简历时排除 `resume_identity`，保留范围、岗位、事实和内容位置问题，purpose 不进入持久化澄清协议。不同 resume ID 是独立简历，每份简历只使用当前内容；已退休的历史快照引用不能成为可写目标。上述选择只属于当前运行，不恢复会话级简历绑定。

FastAPI 使用进程内后台任务独立消费 Pi 流，浏览器的初始 POST 和后续 `GET /runs/:runId/events` 都只是缓冲流订阅者；切页或刷新只关闭订阅，不取消 run。Web 返回会话时通过 `GET /sessions/:sessionId/active-run` 找到运行并重放事件，终态后再回读持久化消息。

Web API client 在收到 `run.completed`、`run.failed` 或 `run.cancelled` 时结束流读取，不把随后关闭连接的异常重新映射为运行失败。终态后的会话和提案回读是补充同步：独立助手（含恢复订阅）及编辑器侧栏在回读失败时保留流中已收到的内容和真实终态；终态前断流仍报告 `AGENT_STREAM_INCOMPLETE`。

1. FastAPI 创建独立的 Agent session/run/message；session 不保存默认简历。发送前通过唯一的 `contexts` 协议重新解析浏览器选择的简历、资料库文件等轻量引用；简历界面同样提交 `{type:"resume",id}`，并在这一边界转换为当前消息的快照与有界材料，再以服务 token 调用 Pi。独立助手自动附带当前打开的简历时在引用快照中保存 `presentation:"implicit"`，该字段只决定 Web 不在输入框或历史用户消息中渲染 `@简历` 单元，所有权、版本校验、canonical 正文读取和 Pi 材料与显式引用完全一致；缺省或 `mention` 保持旧客户端的显式展示。Web 持久化并回读消息时仍以结构化 `contexts` 识别显式引用，在用户气泡正文的原位置渲染内联文件单元，不依赖或重复展示文件名标签；运行阶段只在当前消息附近呈现，不在消息区顶部复制状态标题。已有对话的 Web 输入框最多随草稿增长到 6 行，超出后仅在编辑区内滚动；新建对话继续使用独立的大输入框布局。这些输入框尺寸和位置只属于客户端呈现，不进入消息协议或持久化数据。成功或主动取消终态清空下一轮输入草稿与引用，失败终态保留；已经发送并进入消息历史的 query 不会在取消后自动复制回输入框。独立助手把请求、运行和提案失败投影到页面根层的统一顶部反馈浮层，不改变服务端错误码或终态。助手 Markdown 在共享渲染边界处理标题、软换行、分隔线、表格、列表、引用、链接和代码等常见语法，围栏代码提供复制操作，禁用原始 HTML，并把远程图片降级为文字占位。独立助手和简历编辑器侧栏的用户消息、AI 回复正文与周边 UI 统一使用随应用发布的思源黑体；用户消息气泡与无气泡 AI 正文的呈现差异不进入消息协议或持久化数据。
2. 登录后的 Web 通过 `/api/agent/models` 读取当前有效 `assistant_conversation` 线路按逻辑模型去重后的列表及默认模型 ID；`llm_models.user_selectable=false` 的模型在对话能力中整体排除，默认模型取剩余可选模型中优先级最高者。会话显式选择保存在 `agent_sessions.selected_llm_model_id`；空值跟随当前默认。
3. Pi 通过另一枚 token 调用 `/internal/agent`，读取当前消息已授权的简历、岗位、进程、面试或资料集上下文。`resolve_resume_target` 优先沿用本轮已经解析的 locator，其次使用本轮唯一的 `resume` context；`agent_sessions` 不再包含简历字段。Pi 的有状态业务工具在 Pi 调度层声明串行执行，并继续共用运行级 FIFO，避免参数预检和目标 locator、范围上下文、诊断结果发生并行竞态。工具阶段的可见 `text_delta` 继续转换为 `assistant.activity.delta`；每次工具和批量任务另发送 `assistant.activity.status`，浏览器以 `callKey` 原位更新 `running/succeeded/failed`，失败事件只含稳定错误码。工具参数在进入执行函数前校验失败时，也以同一个 `callKey` 写入 `AGENT_TOOL_ARGUMENT_INVALID` 失败审计，不记录原始参数或供应商错误。隐藏思考、工具参数和工具结果不进入用户正文。`begin_final_response` 执行时发送 `assistant.activity.clear` 并关闭工具，下一轮可见 `text_delta` 才逐个转换为 `assistant.delta`。`list_user_resources` 可从当前 run 反查用户，并列出其简历、已解析资料和面试记录的轻量目录；目录不包含正文。用户明确指定简历名称、ID 或目录中的某份简历后，`resolve_resume_reference` 按当前用户归属解析本轮目标；局部编辑时 `resolve_resume_target` 显式携带已解析的 resume ID，在同一份简历内继续定位字段。范围读取结果中的 locator 由 Pi 运行时保留；模型创建修改操作时只引用已读取的 `block_id`，运行时再注入服务端 locator 与 expected-text hash，不能让模型复制或改写这些授权字段。求职进程的阶段摘要以追加式当前阶段和生命周期为真值，旧扁平字段只作迁移兼容；公开选择的 `dataset` 仅限解析成功且转换对象键属于当前用户前缀的资料。`materials:search` 的资料部分在 FastAPI 内先对本轮任务授权且已在 LinkRag 建好索引的资料做多路融合召回，再对其余授权资料做子串匹配；Pi 仅在资料相关或现有信息不足时调用工具，默认查询资料库并固定返回上限 6 条。纯资料问答使用只读 `material_lookup` 工作流；LinkRag 凭证只在 FastAPI。
4. 内部能力和对话请求都先固定逻辑模型，再按该模型在 `llm_use_case_routes` 中的优先级依次尝试有效线路；可切换的上游失败才进入下一条。每次实际上游请求写入 `llm_call_logs`。
5. Pi 每轮先加载 `career-assistant-router`，保存有界任务清单，再按任务选择工作流并记录完成、部分完成、受阻或失败。简历上下文通过统一的 persisted canonical 解析边界读取；结构化 `InlineIcon/title_icon` 只在 Agent Markdown 边界序列化为白名单 `:icon[Name]:`。普通简历改动保存为范围化 canonical 提案；整篇翻译保存为独立 `translate_resume` 提案，服务端复验结构、节点、日期、数字、链接、联系方式和样式不变。确认普通提案时更新当前快照；确认翻译提案时创建新 Resume 与初始版本，并复制源 Resume 私有图片。图片缺失、不支持、复制失败或超过限额时不应用提案，已复制对象在事务失败时补偿删除。

任务计划通过内部 `tasks:plan` 接口在当前用户消息元数据中保存，限制为 1–8 项，并校验工作流、产物类型、已授权资料引用、唯一 ID 和先后依赖。Pi 逐项调用 `tasks/{taskId}:status` 更新 `running/completed/partial/blocked/failed`；服务端只接受属于同一 run 的真实提案 ID。工作流切换以当前任务为边界，读取 Skill 只提供方法，不决定用户资料授权。运行意外结束时，FastAPI 把未收口任务标记为失败或受阻，并把该请求已创建但未计入其他任务的提案归到当时正在执行的任务。`agent_runs.status=succeeded` 仍只表示运行和回复正常结束；每项业务结果以任务状态为准。单项提案使用基于目标与操作的稳定请求键，服务端按 run 与请求键幂等返回，批量目标部分失败时保留已创建提案 ID。

## 同一运行内的请求来源

浏览器管理未发送队列，普通排队仍逐条调用现有消息接口。Web 使用支持 HTTP 的 IndexedDB 读写事务修改队列和认领普通发送，保存成功后才清理草稿；网络和流订阅不占用数据库事务。普通发送的本机占用在消息被接受后继续保留，收到结束事件、取消成功响应或查询原回执确认运行结束后释放，不按超时抢占。跨标签页变化通过 BroadcastChannel 或读取轮询同步，同站点旧 localStorage 队列在事务提交后迁移并暂停。随机编号使用 getRandomValues，SHA-256 由纯 JavaScript 实现，不要求 HTTPS 专用 API。Pi Service 的 `steering.js` 只管理当前运行已接收的插入及回执，最多一条尚未消费的输入；不提供服务端队列编辑、排序或后台调度。运行句柄和插入接收回执在 Pi 内存，业务真值仍在 MySQL。

Pi 复用 SDK 的 `steer()` 和 `prepareNextTurnWithContext` 包装钩子，在完整模型轮次及全部工具结束后调用 FastAPI `steering:activate`。FastAPI 按 User → Session → Run → Message 加锁，复验引用和版本，分配正式用户消息；Pi 切换可信来源序号、目标和工具状态，恢复规划工具，并在用户输入进入原生对话后调用 `steering:ack`。激活重试返回原授权快照和回执，不因后来的资料变化改判成未接受；真正读取正文时仍复验版本。资料正文不写入消息快照。

`message_scope.py` 从同一 run 最新用户消息解析活动请求。Pi 客户端在所有工具回调注入 `X-Agent-User-Sequence`，模型不能自行选择序号；旧请求迟到回调返回 `AGENT_REQUEST_SCOPE_STALE`。旧单用户消息 run 可以兼容推导，多消息 run 缺少来源时拒绝猜测。任务、显式目标和提案授权都跟随当前来源，旧任务结果及提案继续保留。

不改变数据库 schema：正式用户消息的既有 `metadata_json` 保存 `submission`（key/hash/mode）、`steering` 接收/生效状态和 `generated_proposal_ids`；任务仍在各自消息的 `agent_tasks`，被调整的未完成任务增加 `superseded_by_sequence_no`。助手消息元数据保存 `reply_to_sequence_no`。完整回复由 `messages:complete` 在发送完成事件前持久化，后续插入失败不删除此前完整回复；当前未完成片段仍不保存。终态先写回数据库，再对浏览器发送，避免下一条普通消息与上一轮收口竞争。

浏览器断开不会取消当前运行，但本机队列暂停；恢复查询优先读取正式消息回执，其次查询 Pi 句柄，未知结果保持冻结。客户端重放事件按来源与消息序号去重。用户行为及本机保留边界见[助手功能](../features/ai-assistant.md#消息排队与插入)，接口状态见[HTTP 契约](../api/http-contracts.md#消息排队与插入回执)。

## 进程与信任边界

| 调用方 | 被调用方 | 身份材料 | 可执行范围 |
| --- | --- | --- | --- |
| Web | FastAPI `/api/agent/*` | 用户 Cookie | 当前用户会话、模型摘要、上下文、运行和提案 |
| FastAPI | Pi Service | `PI_SERVICE_TOKEN` | 创建/继续/取消 Agent 运行 |
| Pi Service | FastAPI `/internal/agent/*` | `LINKRESUME_INTERNAL_AGENT_TOKEN` | 受控上下文、模型和简历提案工具 |
| FastAPI LLM service | 模型供应商 | 运行时解密凭据 | 当前绑定能力的一次模型调用 |

两枚服务 token 方向不同且不能复用。Pi Service 默认只监听内部地址；浏览器、插件和小程序都不应感知 Pi URL。

## 治理数据

- `llm_provider_connections`：接入商代码、独立凭据、受控设置、配置版本与目录同步状态。推理地址由接入商适配器确定，后台不能提交任意 URL；AIHubMix 可选择官方默认或备用地址，切换会让旧探测失效。
- `llm_models`：供用户选择的稳定逻辑模型名称；`user_selectable` 决定它能否出现在对话页，隐藏不影响系统能力绑定。
- `llm_model_routes`：逻辑模型在某连接上的实际 `invoke_target`、目标类型、目录元数据、价格规则和启停状态。同一逻辑模型可配置多条线路。线路、逻辑模型一旦被 `agent_runs` 冻结或被 `agent_sessions` 选中，管理端就无法删除，只能停用；因此 Agent 历史里记录的模型和线路始终能查到。
- `llm_use_case_routes`：系统能力和对话列表共用的线路绑定，保存场景、协议、优先级及成功探针指纹。当前场景为职位文本提取、简历结构化、职位图片识别、模拟面试、识别稿修正、简历匹配度（`job_match`）、面试准备清单（`interview_prep`）、语音识别（`speech_to_text`）、语音合成（`text_to_speech`）和用户对话；场景代码由后端注册，不建字典表。语音支持百炼连接的 `aliyun_asr_realtime`、`aliyun_tts_realtime`，以及 AIHubMix 连接的 `openai_asr_file`、`openai_tts`；协议不能跨场景或跨接入商使用。其他非对话场景支持接入商声明的 `openai_chat`、`openai_responses`。语音探针通过同一个服务商适配器发送固定测试录音、一秒静音或合成一句固定文本；调用日志在 `usage_json` 记录音频秒数或字符数，不记录音频与正文，也不把缺少计费依据的语音请求估成零费用。
- `llm_call_logs`：每次实际模型请求的线路、配置版本、用量、价格快照、费用和安全错误分类；失败后切换线路会产生多条记录，不保存提示词或正文。Pi 的模型请求由内部服务令牌回传；运行费用由这些记录汇总。
- FastAPI 写入调用日志时按 ORM 字段上限校验上游模型和请求编号；Pi 在计量回传前也按 `PiCallRecord` 的 256/128 字符上限处理这两个可选字段。超长编号记为 `null`，保留调用终态、用量和费用，避免 MySQL 或内部请求校验拒绝计量后使成功请求失败。不会截断编号后冒充完整上游标识。
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

## 扩展边界

`resume_tools.replace_editor_markdown` 在修改结构化字段的 `value` 时同步清除该字段的旧 `runs`，随后仍走 canonical 校验；字段样式模型见 [语义简历契约](../api/http-contracts.md#语义简历契约)。

Agent 文本投影为经历结构化字段和 row 单元格正文保留各自的 canonical 节点；locator 的 `field` 标识具体经历字段。`polish_local` 每张提案只允许一个局部 operation：普通块锚点只能修改自身，section 或 entry 标题锚点可以授权其范围内一个已读取的子块，不能跨 section/entry。复合意图必须先提交完整任务清单；Pi 复制并冻结清单后严格串行完成每个目标的定位、读取、诊断和提案，最多展开 20 个目标。父 section/entry 下需要清理的重复短文本可以通过 `match=all` 展开，不能脱离父范围全局匹配；单项失败写入失败状态后继续后续任务。批处理结果在当前 run 内幂等缓存，模型重复调用不能再次创建同一批提案；同一 run 已走单目标局部提案后也不能再混用批处理。`replace_target_text` 允许空字符串以清空选区或可选字段，确认时把空的可选经历字段收敛为 `null`；`delete_target` 只删除 section/entry 正文中的完整 paragraph/list item canonical 节点，不允许删除 section、entry、字段或表格单元节点，也不留下空列表项；`insert_after_target` 仍要求非空。多张范围化提案共享创建版本时，确认逻辑用当前快照和各自的目标哈希重放 operation，因其他不相交修改产生的锁版本变化不会使提案冲突，目标自身变化才返回 `TARGET_STALE`；旧快照和整篇翻译仍严格依赖原 `base_lock_version`。语义整份 locator 使用非 `resume` scope 时返回 `SCOPE_FORBIDDEN`。

任务规划阶段只向 Pi 提供已授权资料的轻量目录；每项任务的 `context_refs` 必须是本轮授权引用的子集。任务启动后由 FastAPI 复验归属与当前版本，向 Pi 交付该任务的有界正文和来源角色，任务元数据只保存不含正文、包含内容指纹的材料收据。已规划任务的材料搜索、诊断与提案按当前运行任务的引用检查；未选中的资源不能通过目录扩展正文权限。用户明确点名并通过受控解析得到的本人简历可记录为当前任务的新增引用。新增 Agent 工具必须限制资源类型、动作和用户归属，并保持提案确认边界。资源目录查询只允许 `resume/dataset/interview`，必须从 run 反查用户且只返回轻量元数据；按名称解析简历仍只能接受本轮用户原文中明确出现的完整名称，目录结果本身不能授权读取正文。面试、职业规划和标题工作流只有只读能力；普通编辑和整篇翻译使用不同提案工具。简历工具只能操作 canonical 内容节点，不得直接持久化模板 region、slot、CSS 或分页投影；读取和保存必须复用简历应用服务的严格解析与校验入口。新增模型能力需同步能力目录、数据库约束、探针、管理端、调用来源和 HTTP 契约。

## 故障与降级

首页匹配岗位卡的后台分析使用统一 LLM 的 `job_match` 场景和进程内任务，不经过 Pi 运行时；模型未配置或失败时卡片显示不可用说明，不影响助手对话。

- Pi readiness 失败时 FastAPI 仍可提供非 Agent 业务，但助手入口显示不可用且不能创建假成功运行。
- 会话标题和置顶状态由 FastAPI 在用户归属校验后直接持久化；这些 PATCH 操作不进入消息/模型调用链。Web 根据返回的 `pinned` 状态把置顶会话投影到独立 `Pinned` 分组；选择会话时只原位刷新详情，发起新用户消息时才把会话提升到所在分组首位。工作台内简历、模板、求职记录、面试排期和资料库的路由切换、简历选择与工作台嵌入、整块侧栏显隐，以及桌面端会话栏宽度拖动和 `Pinned` 与“最近对话”的独立展开或收起都只属于客户端呈现。它们复用既有资料、简历和求职接口，不改变 Agent API、PATCH 或 DELETE 契约；提案卡片确认按钮改用描边样式同样只是呈现调整。删除会话会锁住目标会话及其运行，运行中时返回 `AGENT_RUN_IN_PROGRESS`，否则按 proposal、tool call、message、run、session 顺序事务清理。
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

结构化上下文增加 user_profile，后端按当前用户和版本读取求职画像，只传 profile_markdown，不传登录身份和联系邮箱。Pi 上下文白名单接受这一只读字段，不能据此写画像或自动改简历。Agent 新运行、提案操作、模型日志及终态消息写回与账号注销协调；前端界面语言不改变模型正文或模拟面试作答语言。见[账号功能](../features/identity-account.md)。

## 文字面试复盘

求职中心的文字复盘使用既有 `mock_interview` 模型场景（管理员的模拟面试模型绑定），调用来源为 `interview_review`。输入只包含本人该场次的文字记录、阶段和岗位名称，不发送录音。结构化输出复用 LLMService 的额度、线路选择、调用日志和有限重试；原问题、原回答与非空评分证据必须能匹配原记录，记录不足的维度保留空分。只有三个维度都有分数时计算综合平均分。

生成前在本人锁和场次锁下保存请求 UUID、源记录 SHA-256、开始时间和状态，再释放事务调用模型；单次调用最长 120 秒，每个账号至多一场活动生成。相同 UUID 重试不创建新的生成，失败后需以新 UUID 显式重新生成。进程中断的活动状态在 3 分钟后可以重试。生成结束重新核实归属、状态、归档和源记录；变化时丢弃新结果，保留旧报告与文字。报告独立于用户手写总结，修改原文后报告被标为过期。没有长录音转写、音频问题时间戳或后台任务队列承诺。
