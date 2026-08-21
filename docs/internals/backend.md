# FastAPI 后端

## 当前职责与结构

`apps/backend` 承接健康检查、Web/小程序双通道 Redis 会话鉴权、微信自动建号、网页扫码确认、小程序只读简历、语义简历生命周期、历史版本、简历分享链接、异步文件导入、私有对象资源、结构化 JD 生命周期、用户中心、统一 LLM 调用和管理员模型治理 API、管理台用户管理、知识库资料异步解析，以及统一系统日志、业务审计和管理员日志查询。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 装配数据库、Redis、MinIO、统一 LLM、导入幂等和 MQ publisher；测试可注入 Fake |
| `src/linkcv/core/` | 配置、数据库、错误、安全、Redis 和 MinIO 基础设施 |
| `src/linkcv/domain/` | `ResumeDocumentV1`、`ResumeStyleV1`、联合快照、SectionIR、Draft 和确定性标准化 |
| `src/linkcv/domain/job_source.py` | JD 来源 URL 校验、规范化、站点识别和 SHA-256 身份计算 |
| `src/linkcv/application/resumes/` | 统一创建、乐观锁保存、版本创建/重命名/恢复、分享链接创建/覆盖/更新与事务规则 |
| `src/linkcv/application/job_descriptions/` | JD 创建、重复解决、搜索分页、乐观锁更新、归档和永久删除 |
| `src/linkcv/integrations/` | LinkParse PDF/DOCX Adapter、转换分发、微信小程序上游封装和统一 LLM 简历结构化 Adapter |
| `src/linkcv/services/resume_import_service.py` | Worker 使用的 Markdown 转换、结构化与规范化原语，不提交业务事务 |
| `src/linkcv/services/resume_import_idempotency.py` | Redis Lua 请求指纹到导入 ID 的短期绑定与冲突保护 |
| `src/linkcv/core/mq/` | RabbitMQ/Kafka publisher、统一导入消息和 confirm 异常边界 |
| `src/linkcv/workers/` | 独立消费、Redis 防重、解析和结果事务；公共依赖失败保留消息 |
| `src/linkcv/modules/identity/` | 用户模型、管理员密码登录、双通道会话、微信自动建号、扫码状态机、`/api/account` 用户中心与管理端用户管理 |
| `src/linkcv/modules/miniprogram/` | 只接受小程序 Bearer 的本人简历列表和详情只读路由 |
| `src/linkcv/modules/resumes/` | ORM、HTTP DTO、模板及管理、简历、版本、异步导入、分享和资源路由 |
| `src/linkcv/modules/datasets/` | `user_dataset` 资料元数据、异步解析受理与状态列表路由 |
| `src/linkcv/modules/job_descriptions/` | JD 单表 ORM、HTTP DTO 和受保护路由 |
| `src/linkcv/modules/llm/` | Chat 当前绑定、模型凭据加密、LiteLLM 适配、普通/流式/结构化单模型调用、计量与管理员 API |
| `src/linkcv/modules/observability/` | 请求追踪、结构化 JSONL、状态变更审计、受限 Web 事件上报和固定 Loki 查询适配 |
| `migrations/` | SQL-first Alembic revision；当前 head 为 `0025` |
| `tests/unit/` | 不访问外部资源的快速单元测试 |
| `tests/integration/` | 使用隔离 SQLite、Fake Redis、Fake MinIO 和外部服务替身的组合测试 |

## 数据与事务

MySQL 包含用户、简历、LLM 治理和 `job_descriptions` 等业务表。当前可编辑简历状态保存在 `resumes.data_json/style_json`，历史版本同时快照两份 JSON。HTTP 中的 ID 是十进制字符串，ORM 和数据库使用整数。

Alembic `0002` 建立 `users`、`resume_templates`、`resumes` 和 `resume_versions` 四张核心表。业务主键和外键统一使用 `BIGINT UNSIGNED`；数据库中的整数 ID 在 HTTP、TypeScript 和对象键中表示为规范十进制字符串。`0014` 幂等写入四个官方模板，包含空白简历模板；标识冲突且内容不一致时迁移中止，不覆盖现场数据。`0015` 在不改变 schema 的前提下补充现代双栏和紧凑技术型官方模板的受控编辑 Markdown：现代模板使用 `::: left/right` 左右结构，紧凑模板使用高密度技术条目。`0024` 新增“经典单页技术简历”官方模板，使用虚构的张三示例、高密度单页参数与独立主题键；downgrade 只在没有简历引用时删除该模板，存在来源引用时拒绝降级。`0025` 将该模板的示例内容重编为虚构的平台工程方向经历，技能、公司、业务场景和个人项目均与来源材料解耦；迁移只接受 `0024` 的原始内容摘要，downgrade 也只接受未被后续定制的 `0025` 内容。模板卡片、完整预览和普通创建后的编辑器读取同一份模板快照。

`0016` 新增 12 字段 `resume_imports` 过程表，保存用户、源文件对象、上传/解析状态和唯一结果简历关联；非空表拒绝 downgrade。`0017` 要求旧 `source_type=import` 简历已通过发布清理命令归零，再删除 `resumes` 中旧同步导入使用的 `source_filename/source_object_key/extracted_markdown`。存在无法恢复这些证据的新导入简历时，`0017` downgrade 同样拒绝执行。

普通创建必须提供名称和启用模板，在用户行锁内完成容量、名称规范键和模板快照校验，再以 `source_type=template` 原子创建当前简历和 initial 版本。正式简历与活动导入任务共享每用户 10 个名额。异步导入同样必须提供启用模板，其标题来自安全化源文件名并允许与已有简历同名；解析内容作为 data，所选模板提供 style。自动保存使用 `resume_id + user_id + base_lock_version` 条件更新并递增锁，不创建版本。手动正式版本在创建和重命名时保存 1–80 字符的名称；旧调用方缺省时按版本号生成“版本 N”。手动版本、重命名、删除版本与恢复都先锁定所属简历；重命名只更新名称，恢复直接替换当前简历且不创建新版本；每份简历最多保存 10 个版本。`0023` 为 `resume_versions.name` 回填历史名称，历史初始版本、恢复前备份和 restore 记录使用系统名称。

`0003` 将模板外键改为 `ON DELETE SET NULL`，同时允许历史模板来源在模板删除后保留 `source_type=template/template_id=NULL`。MySQL 8.4 禁止 `SET NULL` 外键列参与 CHECK，因此 `ck_resumes_source_fields` 只约束来源证据字段，`template_id/source_type` 组合由统一创建服务保证，外键继续保证非空引用有效。如果已经出现模板来源但 `template_id=NULL` 的记录，0003 downgrade 会拒绝恢复不成立的 RESTRICT/非空来源约束。`0004` 曾新增对象存储清理任务表；`0010` 在删除链路改为同步后移除该表，upgrade 会先锁表并在存在待处理任务时拒绝删表，downgrade 只恢复空表结构。部署流水线先迁移再替换应用，因此迁移到 `0010` 前须确认任务表为空；迁移和容器替换之间的旧应用删除请求可能短暂失败，回滚旧应用前须先 downgrade 到 `0009`。`0005` 在批量转换前核对旧节点和样式字段，只接受可完整表达的上一版结构；遇到未知字段、危险 Markdown 或无法保留的内嵌图片会中止。`0012` 删除 `resumes` 和 `resume_versions` 的旧版内容与样式备份列；降级只恢复空列结构，无法重建已删除的旧 JSON，恢复旧值必须使用迁移前的外部数据库备份。已进入共享环境的 revision 不原地修改。

`0006` 新增 `llm_model_configs` 和 `llm_call_logs`。模型配置保留启停、优先级、可选价格和版本化凭据密文；调用日志按唯一 `call_id` 保存用户、实际模型快照、最终状态、计量完整性、Token、价格快照和估算成本，不保存消息或模型正文。配置和调用日志不提供级联删除，历史关联使用 `RESTRICT`。两张表及其全部字段都在 SQL-first DDL 和 SQLAlchemy 模型中维护一致的中文注释；状态字段的英文值是持久化契约，不因注释语言改变。

`0007` 新增用户私有 `job_descriptions` 单表。岗位、要求、工作地点、薪资、公司与招聘者快照、来源身份、备注、归档和乐观锁均保存在同行；福利和原始抓取内容不落库。`skills` 是字符串 JSON 数组。来源 URL 只在后端规范化，随后同时保存规范化值和二进制 SHA-256；BOSS 岗位链接还保存站点原生 ID。`(user_id, source_site, source_job_id)` 与 `(user_id, source_url_hash)` 两组唯一约束处理同用户重复。硬删除只接受归档记录，删除语句原子约束用户、记录 ID 和非空 `archived_at`，成功后真实释放来源唯一键；活动、已恢复或并发恢复的记录不会被删除。JD 搜索、归档和所有写操作始终带用户条件；外键使用 `ON DELETE RESTRICT`，不把删除用户隐式扩成级联删除岗位。

`POST /api/job-descriptions/import` 是浏览器插件的受保护入口，只接受 BOSS 岗位详情 URL 和有限的页面采集字段。`application/job_descriptions/import_service.py` 先清理不可见字符、空白和明确页尾噪声，再映射就业类型、工作形态、月薪/日薪/时薪及公司标签；它还会把 `5天/周`、`6个月` 等实习安排从误传的经验字段移入 `work_schedule`，并在入库前剔除福利标签。最后构造已有 `JobDescriptionCreateRequest` 并复用统一创建与重复解决事务。该过程不调用 LLM，不保存输入 DTO，也不绕过既有用户条件、来源唯一键或乐观锁。

`0008` 在模型配置上增加 `capability`、LiteLLM `adapter`、不含前缀的模型调用名和配置版本；新增按能力保存唯一当前候选的 `llm_capability_bindings`，并预置一行可为空的 `chat` 绑定。调用日志增加能力、来源、adapter 和调用名快照。旧的完整 `model_name`、`enabled`、`priority` 和手工价格列暂时保留用于应用回滚兼容，新 HTTP 契约和运行时不读取其旧产品语义。revision 在 DDL 前先删除 `llm_call_logs`，再删除 `llm_model_configs`；旧数据不迁移且 downgrade 不恢复，升级完成后的 `chat` 绑定为空。

`0009` 曾新增 `admin_operation_logs` 管理操作审计表，记录管理员对用户的 enable/disable 操作。字段包括 `id`（BIGINT UNSIGNED PK）、`actor_user_id`（操作人，FK → users.id）、`target_user_id`（目标用户，FK → users.id）、`action`（受 CHECK 约束的 VARCHAR，只允许 "disable"/"enable"）和 `created_at`。该表仅写入不读取，管理端无查询入口，`0011` 将其删除（down 只重建空表结构）；enable/disable 操作不再持久化审计记录。

`0013` 为 `resumes` 增加分享字段：`share_token`（VARCHAR(64)，全局唯一索引）、`share_visibility`（VARCHAR(16)，`private|public`）、`share_expires_at`（可空，UTC 过期时间）和 `share_created_at`。两个 CHECK 约束保证分享字段要么全部为空（未分享）、要么全部非空（已分享），且可见性只允许 `private/public`。分享不单独建表、不落内容快照，公开读取时实时取 `resume_versions` 中 `version_no` 最大的正式版本；down 迁移只删除新增列与约束，不触碰分享期间创建的版本数据。

`0018` 新增 `user_dataset` 用户知识库数据集表。`0022` 为每行增加无数据库外键的唯一 `parse_task_id`，解析状态只以 `document_parse_tasks` 为真值源；同一事务创建资料和 `source_type=dataset` 的任务。`POST /api/datasets` 校验并上传源文件、提交两行记录后向既有文档解析队列发布 `DATASET_PARSE_TASK`；发布失败将任务收口为上传失败并返回 `502 DATASET_QUEUE_UNAVAILABLE`。Worker 对 DOCX/PDF 调用 LinkParse，对 Markdown/TXT 本地执行 UTF-8 与换行规范化，结果尽力存入 `users/{uid}/datasets/converted/{task_id}.md`。`GET /api/datasets` 联表按当前用户过滤并返回上传、解析状态和失败分类，不暴露对象键或 SHA-256；`GET /api/datasets/:id/content` 在再次校验资料与任务归属、解析成功状态后读取转换存档并返回 Markdown。转换存档缺失或对象读取失败不会退回源文件。本期不做分片、RAG、常规删除、源文件下载和去重。

### 微信账号、双端会话与扫码登录

`0019` 为 `users` 增加全局唯一的 `wechat_openid` 和可空 `wechat_bound_at`，`0020` 将 `email/password_hash` 放宽为可空。微信身份登录时，code2session 得到的 openid 不存在则创建无邮箱密码账号，存在则复用；数据库唯一约束收敛并发建号。普通邮箱注册和改密路由在正常应用中返回 404；普通密码登录仅在 `APP_ENV=local|development` 开放，Production 返回 404。`GET /api/auth/capabilities` 向 Web 暴露这一布尔能力，不返回具体环境名。`create_schema=True` 的隔离集成测试继续保留隐藏造数入口。管理员仍只通过 `/api/auth/admin-login` 使用密码登录；即使历史管理员记录已有 `wechat_openid`，扫码确认和小程序登录也会拒绝该账号。

`session_service.py` 统一发放、轮换和撤销 Redis session。`auth:session:{sid}` 保存 `uid/rhash/channel/created_at`，access JWT 也保存 `channel=web|miniprogram`。Web 只从 Cookie 接受 web channel，小程序只从 Bearer 接受 miniprogram channel；Redis uid/channel 必须与 JWT 完全一致。小程序的 login/refresh/logout 返回 JSON token，refresh 每次轮换，旧 secret 重放会删除 session；管理员停用用户时原有用户会话集合仍可撤销两个 channel。

`0021` 将 `resume_imports` 一次性迁移为通用 `document_parse_tasks`：任务表保存 `source_type=resume_import`、源文件和上传/解析状态，不再持有最终简历指针；`resumes.parse_task_id` 以无外键的可空唯一列记录来源任务，由 Worker 在创建简历和完成任务的同一事务中维护。迁移沿用原任务主键并回填来源指针，随后删除旧表；降级会镜像重建 `resume_imports`，存在非简历类型任务时拒绝执行。转换后的 Markdown 尽力存入 `converted_object_name`，历史迁移记录保持为空，生命周期检查不依赖该字段。

`0022` 扩展 `document_parse_tasks.source_type` 与文件格式约束以支持资料解析，并新增两个消费方共用的可空 `failure_reason`。迁移会删除上线前的全部 `user_dataset` 行；对象存储源文件必须在迁移前、确认数据库与对象存储备份后，通过 `scripts/release/cleanup_legacy_user_datasets.py --execute` 清理。该数据删除不可由 downgrade 恢复。`0023` 为 `resume_versions` 增加非空 `name`，先按版本原因和编号回填存量快照，再允许新建正式版本时保存用户名称；downgrade 删除该列并丢失名称，执行前必须确认数据库备份。

绑定由 Web 已登录用户发起，走 `/api/account/wechat/bind-request|bind-confirm|bind-status`（ticket 票据）。绑定票据是临时凭证，只存 Redis（`wechat:bind_ticket:<ticket>` 存用户、`wechat:bind_status:<ticket>` 存 `pending/bound`、`wechat:bind_user_ticket:<uid>` 指向当前票据），TTL 默认 300 秒，同用户重新发起时覆盖旧票据。`bind-confirm` 提交小程序 `wx.login()` 的临时 code，服务端换 openid 后关联到发起用户；openid 已被其他用户绑定时返回 `409 WECHAT_ALREADY_BOUND`，原绑定关系不被覆盖。

扫码登录挂在 `/api/auth/wechat` 下，scene 状态机存 Redis（key `wechat:login:<scene>`，TTL 默认 300 秒）：

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/wechat/qrcode` | 无需登录。生成 `login:{随机}` scene 和独立 Web `poll_token`，调用微信小程序码上游，返回 `{scene, poll_token, qr_base64}`；按 IP 限流（默认 10 次/分钟） |
| `GET` | `/api/auth/wechat/status` | 返回 `pending/success/cancelled/expired`；只有携带匹配 `poll_token` 的 success 查询才发放 Web Cookie，未携带时只读状态 |
| `POST` | `/api/auth/wechat/confirm` | 表单 `scene/code`；Redis Lua 原子进入 processing，按需建号后进入 confirmed；重复 confirmed 幂等成功 |
| `POST` | `/api/auth/wechat/cancel` | 表单 `scene`；仅 pending 可原子进入 cancelled，重复取消幂等 |
| `POST` | `/api/auth/wechat/miniprogram/login\|refresh\|logout` | 小程序自动登录、轮换 JSON token 和幂等撤销 |

scene 使用结构化 hash 保存 state、Web poll token 哈希、claim 所有者、claim 时间、uid 和最近发放的 web sid。小程序只持有二维码中的 scene，可读取状态但不能领取或替换 Web session；poll token 只返回给创建二维码的网页。processing 的微信调用失败时，只有 claim 所有者能恢复 pending；进程中断遗留的 processing 超过 30 秒后可由新确认原子接管，未超时的并发确认返回 `SCENE_IN_PROGRESS`。confirmed/cancelled 不被重复请求删除。携带正确 poll token 的重复 success 轮询先生成新 Web session，再原子交换 `web_sid` 并撤销旧 sid，以支持响应丢失重试。`integrations/wechat_client.py` 只封装 token、小程序码和 code2session；凭据、code、openid 和完整上游响应不写日志。微信凭据未配置时相关登录接口返回 `503 WECHAT_SERVICE_UNAVAILABLE`。

## 统一 LLM 调用

`LLMService.chat()`、`LLMService.stream_chat()` 和 `LLMService.structured_chat()` 是后端业务模块使用的内部异步接口，不注册 HTTP route。调用方只提供可信 `user_id`、稳定 `source`、messages，以及结构化调用所需的响应模型；不传候选 ID、adapter、模型名、地址或密钥。服务从固定的 `chat` binding 解析唯一当前模型，并在单次逻辑调用内只调用该模型一次。没有当前项时返回 `LLM_CHAT_NOT_CONFIGURED`；供应商失败时直接收口，不重试、不遍历其他候选、不自动切换 binding。结构化调用把 Pydantic JSON Schema 作为系统指令加入 messages，不向供应商传递 `response_format`；模型文本由 LinkCV 本地提取 JSON 对象并执行 Pydantic 严格校验，非法结果以 `LLM_RESPONSE_INVALID` 收口且不追加模型调用。

LiteLLM 只位于 `modules/llm/gateway.py` 和只读目录边界。白名单 adapter 与不含前缀的调用名组装成 LiteLLM 模型标识；阿里云百炼（千问）使用 `dashscope/<model>` 路由，和其他当前支持的简单 API Key 供应商共享模型名、可选 API Base 与加密 API Key 配置。所有 `acompletion` 显式传 `num_retries=0`，价格只读 `litellm.model_cost`，缺价格不阻断调用。供应商异常转换成稳定分类。同步 SQLAlchemy 操作使用独立短 Session 在线程池执行，外部调用和流式迭代期间不持有数据库事务。成功、失败和取消都会收口同一条逻辑调用记录；进程被强制终止造成的 `pending` 记录保留为崩溃排查信号。

模型凭据使用 `LLM_CREDENTIAL_ENCRYPTION_KEYS` 提供的 Fernet 密钥环加密，数据库只保存 `v1:<keyId>:<token>`。列表首项负责新写入，旧 key 用于兼容解密；读取旧密文时会惰性重包到首项。普通日志、HTTP 响应和调用记录均不包含明文凭据、messages、模型完整响应或供应商原始错误。

简历导入 Worker 通过 `integrations/resume_structuring.py` 以 `source=resume_import` 调用 `LLMService.structured_chat()`，复用数据库中的 Chat 当前绑定、加密凭据、调用日志和计量。模型输入只包含 SectionIR 的标题、类别和 Markdown，不包含原文件、对象键、LinkParse 元数据、warnings 或用户 ID；模型返回内容仍须通过 `ResumeExtractionDraft` 严格校验。

`scripts/db/init_mysql.py` 只允许创建名为 `linkcv` 的 MySQL 数据库；`scripts/release/run_alembic.py` 在迁移前校验环境、host、port 和数据库并输出不含密码的摘要。FastAPI 配置支持根 `.env`、显式 `LINKCV_ENV_FILE`、同名 `.local` 和进程环境覆盖。Redis 在鉴权链路中作为唯一会话存储：`auth:session:{sid}` 保存会话哈希，`auth:user_sessions:{uid}` 索引该用户全部会话；会话不写 MySQL，撤销即删除 key。Web Cookie 和小程序 Bearer 分别要求 `web` 与 `miniprogram` channel；上线前缺少 channel 的旧会话仅兼容为 Web，并在续期时补写 channel。对象存储配置仅使用 `MINIO_*`。

## 导入与外部边界

Markdown 文件在进程内做 UTF-8 与确定性换行清理；PDF 和 DOCX 以固定的 `engine=auto/output_formats=markdown/ocr=auto/dpi=200/include_bbox=false/include_images=false` 调用 LinkParse `POST /v1/parse`，由服务端识别文件类型。LinkParse 响应在 JSON decode 前限制为 3 MiB，随后校验 request ID、schema、页数、Markdown 质量、预期文件类型和空 assets；客户端不下载或保存外部 assets，也不自动重试同步解析请求。DOCX 响应只有 `meta.word.omitted_image_count > 0` 会形成用户告警，其余 Word 元数据只写入脱敏调用日志。

超过结构化输入上限的内容不会发送给模型，合规输入的 AST 被压缩为 H1–H3 `SectionIR` 后才发送给结构化模型，最终稳定 ID、日期和来源行号由程序生成。HTTP 导入入口先校验所选模板与文件，再使用 canonical UUID `Idempotency-Key`；Redis key 按用户和 Header 哈希隔离，先以 30 秒租约占有请求，再绑定持久化导入 ID 并保留 15 分钟。`document_parse_tasks` 中 `source_type=resume_import` 的记录是上传和解析状态真值；API 只上传、更新为解析中并等待 MQ confirm，Worker 才执行转换和结果事务。单任务状态接口按当前用户和 `source_type` 查询，非法 ID、不存在和越权统一隐藏为 `RESUME_IMPORT_NOT_FOUND`，并在读取前沿用现有陈旧任务收口。转换成功后 Worker 尽力把 Markdown 存到源文件同目录的 `converted.md`，存档失败只记录告警，不改变解析结果。上传失败补偿对象；业务解析失败保留源文件、可能存在的转换存档与失败记录供用户删除，不自动重试。

Development 未配置 LinkParse Key 时应用仍可启动，Markdown 保持可用，PDF/DOCX 返回 `DOCUMENT_CONVERSION_UNAVAILABLE`；Production 缺 Key 会安全拒绝启动。默认测试全部使用确定性 Fake 和 `httpx.MockTransport`，不访问真实网络或读取密钥。PDF/DOCX 解析日志只记录 LinkCV 调用 LinkParse 的开始、结果、耗时、解析器/页数/OCR 摘要、DOCX Word 元数据和稳定错误码；不读取 LinkParse 内部日志，也不记录正文、Prompt、Cookie、密钥或完整供应商响应。Markdown 本地转换只记录格式、结果和耗时。

## 可观测性与业务审计

`ObservabilityMiddleware` 为每次 HTTP 尝试接受格式合法的 `X-Request-ID` 或生成新值，并在响应中回传；它写入一条包含路由模板、状态码、耗时、可信用户和稳定错误码的 access 事件。未处理异常额外保留异常类型和脱敏后的栈。MinIO、Redis、MySQL、LinkParse 和 LLM 调用使用 `dependency` 分类，简历导入使用 `operation_id` 关联上传、转换、结构化和 HTTP 结果。Uvicorn 自带 access log 已关闭，避免同一请求重复记录。

状态变更和安全动作通过 `modules/observability/audit.py` 的固定映射写入审计事件，包括鉴权/会话、账号资料与密码、简历/版本/资源、JD、管理员用户状态和模型配置。普通读取不写审计。actor 只从已验证会话或登录结果绑定，target 从路由参数、归属校验后的实体或创建结果绑定；成功与受控失败都记录，响应以 `X-Audit-Recorded` 表示本地 sink 是否接受。PDF 导出发生在浏览器，使用单独的受保护接口校验简历归属后写入。审计不新增 MySQL 表，也不替代既有 `llm_call_logs`。

所有事件由后端白名单生成 `event_version=1` JSON Lines，同时写 stderr 和可选 `LOG_DIRECTORY/linkcv.jsonl`。日志正文会截断并遮盖 URL query、Bearer/JWT、邮箱和常见 secret 赋值；日志文件按 UTC 日期轮转并清理七天以前的缓冲文件。容器将目录挂入命名卷，由 LinkCV 自己的 Promtail 异步推送到共享 Loki。业务请求不直接调用 Loki；管理查询使用固定 `{service="linkcv", environment, log_type}` selector 和允许字段，最多查询七天、单页最多 200 条，并按 `event_id` 去重。Loki 不可用只使管理查询返回 `LOG_QUERY_UNAVAILABLE`，不阻断其他业务。

## 对象存储

- 用户级兼容图片：`users/{user_id}/assets/...`。
- 账号头像：`users/{user_id}/assets/avatar/...`，对象键记录在 `users.avatar_object_key`；旧路径中的已有头像保持兼容。
- 导入原文件：`users/{user_id}/resume-imports/{operation_id}/...`。
- 导入转换存档：`users/{user_id}/resume-imports/{operation_id}/converted.md`。
- 简历资源：`users/{user_id}/resumes/{resume_id}/assets/...`。

简历级读取先校验所属简历。资源删除会递归检查当前和历史 `data_json` 引用；仍在使用时拒绝删除。删除导入生成的正式简历时通过 `resumes.parse_task_id` 读取对应 `document_parse_tasks`，删除源文件、转换存档和任务记录，再删除简历资源、版本和简历；任务记录异常缺失时只记录告警，不阻断简历删除。MinIO 删除失败返回 `502 ASSET_DELETE_FAILED` 并保留数据库记录。数据库与 MinIO 仍不是同一事务：多个对象可能只删除一部分，且对象删除成功后的数据库提交失败无法恢复对象。

## 用户中心

公开的 `/api/account/*` 通过 `get_current_user` 获取当前用户，不接受客户端 `user_id`。`GET /api/account/profile` 返回资料并附带简历数量与最近 5 份简历；`PATCH /api/account/profile` 只允许修改昵称（去空白后 1–50 字符）。头像上传复用 `decode_image_data_url`、`build_avatar_object_name` 和 `asset_url`：新对象写入 `users/{user_id}/assets/avatar/...`，再更新 `users.avatar_object_key`，提交失败补偿删除新对象，成功后才清理旧对象；响应只含相对 URL。普通改密和微信绑定不是运行时公开契约；用户停用或管理员操作仍通过 `revoke_user_sessions` 撤销该用户的 Web 与小程序 session。

## 简历分享

`application/resumes/share_service.py` 承担分享业务，`modules/resumes/share_routes.py` 暴露管理端 4 个端点（`/api/resumes/{resume_id}/share` 的 GET/POST/PATCH/DELETE）和公开只读端点（`/api/share/{token}`，依赖 `get_optional_user` 以支持 `private` 可见性判断）。token 使用 `secrets.token_urlsafe(16)`，全局唯一且冲突重试 3 次；`POST` 可选携带 `visibility`（缺省 `public`）与 `expires_at`（缺省永久）指定创建/覆盖时的权限和有效期，已有链接时作废旧 token 生成新 token，`DELETE` 清空分享字段，重复删除幂等。公开解析按「token 存在 → 未过期（SQLite naive datetime 按 UTC 解释后比较）→ 非 `private` 或访问者是分享者本人 → 简历与最新版本存在」的顺序校验，任一不满足统一抛 `SHARE_LINK_UNAVAILABLE`，路由转成 `404`，防止枚举探测。分享内容实时读取 `resume_versions` 最新正式版本并脱敏返回 `data/style/sharer`，不保存快照，因此所有者后续保存新版本会立即反映到分享页。

## 测试约定

- `npm run test:backend:unit`：领域、Adapter 和仓库脚本测试。
- `npm run test:backend:integration`：SQLite、Fake Redis、Fake MinIO、Fake 转换/LLM 的 HTTP 组合测试。
- `LINKCV_TEST_MYSQL_URL`：仅允许指向本机一次性 `linkcv` 数据库，用于 `0002`–`0025` 往返、模板初始化和物理约束验证。
- 真实 LinkParse、模型、MinIO 和浏览器流程不进入默认 CI，需单独授权联调。
# 插件发布与私有下载

`modules/plugin_releases/` 负责 Chrome 岗位采集插件的当前版本发布。管理员上传预构建 ZIP 后，后端限制上传与解压大小，拒绝路径穿越、重复项、加密项和符号链接，并校验根目录安装说明、Manifest V3、三段数字版本以及当前 `PLUGIN_RELEASE_ORIGIN` 对应的精确站点权限。

插件不使用数据库表。Development 与 Production 使用彼此独立的 MinIO，因此各自 Bucket 内统一以 `system/plugin-releases/current.json` 保存当前指针，以 `system/plugin-releases/v<version>/linkcv-job-capture-v<version>.zip` 保存当前版本 ZIP，不在对象键中重复环境名。新写指针使用 schema v3，并显式包含 `published` 或 `unpublished` 状态；读取兼容既有不含状态的 v2 指针，并按已发布处理。发布顺序固定为先写 ZIP 并核对 size/SHA-256 元数据，再覆盖当前指针，最后枚举插件保留前缀并删除除 current 引用对象外的其他 ZIP。指针失败时上一状态和旧 ZIP 继续有效；清理失败时新版保持有效并返回 `cleanup_pending=true`，同版本重试或后续上传会再次清理。同版本同摘要可以幂等重试或从下架状态重新上架，同版本不同内容或低于指针保留版本的发布返回冲突。当前 Docker 入口是单 Uvicorn 进程，进程锁只保证当前部署内发布串行；扩为多副本前必须改成跨实例协调。

普通登录用户通过 FastAPI 读取当前元数据和流式下载，MinIO Bucket policy、Endpoint 和对象键都不暴露给浏览器。下载前重新核对当前版本、对象大小和 SHA-256 元数据，页面停留期间版本已变化时要求刷新，不回退到已删除的历史对象。管理员通过独立 current 接口区分无插件、已上架和已下架三种状态。下架将 `current.json.status` 改为 `unpublished`，成功后用户下载关闭，但当前版本信息和该版本 ZIP 均保留；重新上架校验保留 ZIP 后切回 `published`，无需再次上传。永久删除与发布共用进程锁，并在插件仍已上架时先写入 unpublished 指针关闭下载，再删除 ZIP 和指针；部分失败保留 unpublished 状态，允许重复删除完成收尾。
