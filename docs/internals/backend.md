# FastAPI 后端

## 功能与架构导航

本页维护 FastAPI/Worker 运行结构、事务、迁移、外部集成和后端通用约定。用户能力与业务规则分别见[账号](../features/identity-account.md)、[简历](../features/resume-workbench.md)、[求职中心](../features/career-center.md)、[AI 助手](../features/ai-assistant.md)和[资料集](../features/datasets.md)；独立运行子系统见[小程序适配](miniprogram.md)、[Agent/LLM](agent-runtime.md)、[可观测性](observability.md)和[插件制品](plugin-delivery.md)。具体 URL、schema 和稳定错误仍以 [HTTP 接口契约](../api/http-contracts.md) 为准。

## 当前职责与结构

`apps/backend` 承接健康检查、Web/小程序双通道 Redis 会话鉴权、微信自动建号、网页扫码确认、小程序只读简历、语义简历生命周期、历史版本、简历分享链接、智能助手会话与修改提案、异步文件导入、私有对象资源、无状态结构化 JD 资料、面试求职进程与排期复盘、用户中心、统一 LLM 调用和管理员模型治理 API、管理台用户管理、知识库资料异步解析，以及统一系统日志、业务审计和管理员日志查询。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 装配数据库、Redis、MinIO、统一 LLM、导入幂等和 MQ publisher；托管 SPA 静态产物并为哈希资源设置 gzip 与长期 immutable 缓存；测试可注入 Fake |
| `src/linkcv/core/` | 配置、数据库、错误、安全、Redis 和 MinIO 基础设施 |
| `src/linkcv/domain/` | 唯一运行时 `ResumeDocument`、`ResumePresentation`、`TemplateManifest`、联合快照、保留来源顺序与列表语义的 `SourceLayoutIR`、模型映射决策和确定性导入组合 |
| `src/linkcv/domain/job_source.py` | JD 来源 URL 校验、规范化、站点识别和 SHA-256 身份计算 |
| `src/linkcv/application/resumes/` | 统一创建、乐观锁保存、版本创建/重命名/恢复、分享链接创建/覆盖/更新与事务规则 |
| `src/linkcv/application/job_descriptions/` | JD 创建、AI 草稿提取、重复解决、搜索分页、乐观锁更新和直接永久删除 |
| `src/linkcv/application/interviews/` | 求职进程状态机、面试排期冲突、完成/推进/关闭和素材元数据事务 |
| `src/linkcv/integrations/` | LinkParse PDF/DOCX Adapter、转换分发、微信小程序上游封装、统一 LLM 简历结构化与未分类章节语义建议 Adapter |
| `src/linkcv/services/resume_import_service.py` | Worker 使用的 Markdown 转换、严格布局损失检查、决策式结构化与规范组合原语，不提交业务事务 |
| `src/linkcv/services/resume_import_idempotency.py` | Redis Lua 请求指纹到导入 ID 的短期绑定与冲突保护 |
| `src/linkcv/core/mq/` | RabbitMQ/Kafka publisher、统一导入消息和 confirm 异常边界 |
| `src/linkcv/workers/` | 独立消费、Redis 防重、解析和结果事务；公共依赖失败保留消息 |
| `src/linkcv/modules/identity/` | 用户模型、管理员密码登录、双通道会话、微信自动建号、扫码状态机、`/api/account` 用户中心、个人画像（`user_profiles`）与管理端用户管理 |
| `src/linkcv/modules/miniprogram/` | 本人正式版本只读元数据、PDF 与 PNG 预览；校验私有图片后调用一次性 Node 渲染器，并用 PDFium 栅格化页面，不保存成品。`account_routes.py` 提供小程序专用昵称与头像读写（头像二进制仅经 `/api/miniprogram/account/avatar` 分发） |
| `src/linkcv/modules/resumes/` | ORM、HTTP DTO、模板及管理、简历、版本、异步导入、分享和资源路由 |
| `src/linkcv/modules/datasets/` | `user_dataset` 资料元数据、异步解析受理与状态列表路由 |
| `src/linkcv/modules/job_descriptions/` | JD 单表 ORM、HTTP DTO 和受保护路由 |
| `src/linkcv/modules/interviews/` | 求职进程、单场面试和素材 ORM、HTTP DTO 与受保护路由 |
| `src/linkcv/modules/llm/` | 多能力模型绑定、验证证据、模型凭据加密、LiteLLM/Pi 适配、计量与管理员 API |
| `src/linkcv/modules/agent/` | 用户会话、所有权与版本校验的多来源上下文、SSE 代理、Pi 服务间鉴权、内部工具、运行/工具审计和简历修改提案 |
| `src/linkcv/modules/observability/` | 请求追踪、结构化 JSONL、状态变更审计、受限 Web 事件上报和固定 Loki 查询适配 |
| `migrations/` | SQL-first Alembic revision；当前 head 为 `0045` |
| `tests/unit/` | 不访问外部资源的快速单元测试 |
| `tests/integration/` | 使用隔离 SQLite、Fake Redis、Fake MinIO 和外部服务替身的组合测试 |

## 数据与事务

MySQL 包含用户、简历、LLM 治理和 `job_descriptions` 等业务表。当前可编辑简历状态保存在 `resumes.data_json/style_json`，历史版本同时快照两份 JSON。HTTP 中的 ID 是十进制字符串，ORM 和数据库使用整数。

`user_dataset.sha256` 在 MySQL 使用固定长度 `CHAR(64)` 保存源文件 SHA-256 十六进制摘要；SQLite 测试仍使用通用字符串替身。该字段只用于后端完整性元数据，不向浏览器返回。

Alembic `0002` 建立 `users`、`resume_templates`、`resumes` 和 `resume_versions` 四张核心表。业务主键和外键统一使用 `BIGINT UNSIGNED`；数据库中的整数 ID 在 HTTP、TypeScript 和对象键中表示为规范十进制字符串。`0014` 幂等写入四个官方模板，包含空白简历模板；标识冲突且内容不一致时迁移中止，不覆盖现场数据。`0015` 在不改变 schema 的前提下补充现代双栏和紧凑技术型官方模板的受控编辑 Markdown：现代模板使用 `::: left/right` 左右结构，紧凑模板使用高密度技术条目。`0024` 新增“经典单页技术简历”官方模板，使用虚构的张三示例、高密度单页参数与独立主题键；`0025` 将该模板的示例内容重编为虚构的平台工程方向经历。`0026` 新增“深蓝行政双栏”“校招 / 社招通用”“蓝色政务行政”和“橙弧创意设计”四套官方模板，默认内容与头像均为项目内置虚构示例；稳定 key 冲突且内容不一致时升级中止。`0027` 通过内容摘要保护刷新这四套官方模板的默认快照，统一使用随 Web 发布的猫咪头像并扩充虚构示例；已创建简历持有自己的快照，不会被回填。模板卡片、完整预览和普通创建后的编辑器读取同一份模板快照。

`0016` 新增 12 字段 `resume_imports` 过程表，保存用户、源文件对象、上传/解析状态和唯一结果简历关联。`0017` 要求旧 `source_type=import` 简历已通过发布清理命令归零，再删除 `resumes` 中旧同步导入使用的 `source_filename/source_object_key/extracted_markdown`。

`0036` 在不新增物理列的前提下，把 `resume_templates`、`resumes` 和 `resume_versions` 的全部 `data_json/style_json` 一次性转换为唯一规范结构：内容增加稳定的 `semantic_sections`，呈现增加受控 `TemplateManifest`，并删除运行时 `schema_version`。revision 在任何更新前读取并验证全部目标记录、比较递归叶子内容是否守恒；写入后再次逐行读取并核对完整 JSON 与模板启用状态，任一记录不可转换或写后不一致都会抛错并回滚事务。维护窗口可先运行 `uv run --directory apps/backend python scripts/release/preflight_canonical_resume_snapshots.py` 做只读全量预检。官方深蓝行政模板使用 `columns` 清单，其他官方模板使用 `flow`；缺少可信布局信息的历史导入模板获得安全单栏清单并保持停用。该 revision 是 forward-only，回退依赖发布前备份，不运行 downgrade。

`0037` 只修正九个稳定 key 的官方模板快照，不修改用户简历或历史版本。它把 `0036` 保留在单个 `custom_section_editor` 中的整篇模板 Markdown 按二级标题拆为稳定 `custom_sections`，并让页首信息也通过自定义内容引用，避免读取时同时输出 typed `basics` 和整篇模板正文；原有 `::: left/right`、`:::: sidebar/main`、`:::: meta/trio` 与头像 Markdown 保持原顺序。revision 同时把官方模板字号、行距、主题色、智能一页和页边距恢复为 PDF 视觉基线使用的受审参数。升级前先全量读取并验证九个官方模板，写入后逐行重读完整 JSON，集合不完整、结构歧义或写后不一致都会回滚。

`0038` 是 `0037` 的前向完整性修正：官方模板一旦采用全 custom 的规范编辑章节，就清空工作、教育、项目等 typed 列表以及已进入编辑 Markdown 的联系方式，仅保留契约允许的姓名与头像元数据。迁移在第一笔更新前用完整 `ResumeSnapshot` 校验九个官方模板，并在写后重新执行同一全量预检，保证模板只有一份内容真值。用户简历和历史版本仍不在迁移范围内。

`0039` 继续前向修正官方模板的编辑区块标识：把不受 Web 编辑器识别的 `template_*` custom section ID 转换为确定性的 `blk_*` 不透明 ID，并同步更新 semantic section 引用。迁移在写前和写后校验九个完整模板快照，不改用户简历与历史版本；受旧模板影响的开发测试简历需要在迁移后从模板重新创建。

`0040` 前向修正官方双栏模板的插槽清单：从侧栏插槽移除完整 `basics` 章节，使姓名与职位继续进入主内容区，同时保留侧栏技能、语言和头像。迁移预检并同步 `resume_templates`、`resumes` 与 `resume_versions` 中使用官方双栏模板的规范快照，正文和其他呈现参数保持不变；失败依赖发布前备份恢复或后续 forward revision 修正。

`0041` 从正文中移除模板拥有的页级投影。迁移全量读取 `resume_templates`、`resumes` 和 `resume_versions`：旧 `custom_section_editor` 整篇 Markdown 以及跨规范章节残留的 `:::: sidebar/main` 被拆成无投影 `custom_sections`，侧栏标题映射为 `profile/skills/interests/languages` 等独立语义，私有用户头像转入 `basics.photo`，系统模板头像继续由 manifest 提供。转换在首笔写入前比较去除页栏标记与模板头像后的全部可见行，校验完整 `ResumeSnapshot`；写后再次全量转换并核对幂等结果。revision 不新增物理列，失败按 forward-only 规则从备份恢复或增加后续 revision。

`0042` 先验证 `blank-cn`、其历史简历引用以及所有 `classic-technical-cn` 模板/简历/版本快照，再把经典单页技术模板的 A4 页边距恢复为生产审查值 `9/11/9/11mm` 并删除空白模板行。`resumes.template_id` 的既有 `ON DELETE SET NULL` 只清除历史简历的来源引用；简历和版本自有的 `data_json/style_json` 不变。迁移写后逐项验证模板不存在、旧简历仍存在且来源已置空、经典技术快照内容不变。revision 为 forward-only，恢复删除的模板和原引用依赖升级前备份。

`0043` 是 Development 已有稳定基线，新增 `user_profiles` 用户个人画像表：与 `users` 一对一（唯一 `user_id`、`RESTRICT` 外键），独立于简历内容保存求职偏好、基础信息与技能荣誉。关键偏好用独立列并以 CHECK 约束拦截非法枚举（期望工作性质、工作方式、计薪周期、可到岗时间、学历层次）与联动非法（薪资成组、`available_from` 要求 `availability=custom`、`salary_max >= salary_min`）；多变列表（职位方向、排除条件、目标公司、语言、技能、证书、荣誉、校园经历、学校层级）用 JSON 数组列并校验 `json_type`。`lock_version` 乐观锁初始为 1。稳定 revision ID 已在共享环境应用，后续迁移不得复用或改写；revision 为 forward-only。

`0044` 只锁定并更新稳定 key 唯一的 `classic-technical-cn` 官方模板行，把后续创建或导入快照使用的字号、行距和主题色恢复为受审的 `9.5 / 1.25 / #202632`；A4 页边距、模板正文、manifest、模板 ID 与启用状态保持不变。既有 `resumes` 和不可变 `resume_versions` 不在写集内，继续保留各自完整快照。迁移在更新前要求目标严格匹配受保护的 `0042` 样式，写后重新解析并比较完整目标快照；任何现场漂移都会在写入前失败。revision 仍为 forward-only，恢复依赖升级前备份或新的向前修正。

`0045` 为资料上传增加数据库幂等和可靠调度字段：`user_dataset` 保存 `idempotency_key/request_fingerprint` 并以 `(user_id, idempotency_key)` 唯一约束收敛并发请求；`document_parse_tasks` 支持 `queued`，并保存解析尝试次数和最近分发时间。历史资料获得确定性兼容键与指纹；原有解析状态和对象引用保持不变，历史 `processing` 任务随后按陈旧租约规则恢复。revision 是 forward-only；部署必须先升级 schema，再同时替换 FastAPI、Worker 和 Web。

普通创建必须提供名称和启用模板，在用户行锁内完成容量、名称规范键和模板快照校验，再以 `source_type=template` 原子创建当前简历和 initial 版本。正式简历与活动导入任务共享每用户 10 个名额。异步导入同样必须提供启用模板，其标题来自安全化源文件名并允许与已有简历同名；Web 默认选择 `classic-technical-cn`，不可用时只回退到其他非空白启用模板，解析内容作为 data，所选模板提供 style。自动保存使用 `resume_id + user_id + base_lock_version` 条件更新并递增锁，不创建版本。模板切换使用同一乐观锁边界的独立原子服务：当前 `data_json` 保持不变，目标启用模板提供 `style_json` 与 `template_id`，成功后只递增一次锁；目标无效或版本冲突不会写入部分结果。手动正式版本在创建和重命名时保存 1–80 字符的名称；旧调用方缺省时按版本号生成“版本 N”。手动版本、重命名、删除版本与恢复都先锁定所属简历；重命名只更新名称，恢复直接替换当前简历且不创建新版本；每份简历最多保存 10 个版本。`0023` 为 `resume_versions.name` 回填历史名称，历史初始版本、恢复前备份和 restore 记录使用系统名称。

`0003` 将模板外键改为 `ON DELETE SET NULL`，同时允许历史模板来源在模板删除后保留 `source_type=template/template_id=NULL`。MySQL 8.4 禁止 `SET NULL` 外键列参与 CHECK，因此 `ck_resumes_source_fields` 只约束来源证据字段，`template_id/source_type` 组合由统一创建服务保证，外键继续保证非空引用有效。`0004` 曾新增对象存储清理任务表；`0010` 在删除链路改为同步后移除该表，upgrade 会先锁表并在存在待处理任务时拒绝删表。部署流水线先迁移再替换应用，因此迁移到 `0010` 前须确认任务表为空；迁移和容器替换之间的旧应用删除请求可能短暂失败。`0005` 在批量转换前核对旧节点和样式字段，只接受可完整表达的上一版结构；遇到未知字段、危险 Markdown 或无法保留的内嵌图片会中止。`0012` 删除 `resumes` 和 `resume_versions` 的旧版内容与样式备份列；恢复旧 JSON 必须使用迁移前的外部数据库备份。已进入共享环境的 revision 不原地修改，修正通过新的向前 revision 完成。

`0006` 新增 `llm_model_configs` 和 `llm_call_logs`。模型配置保留启停、优先级、可选价格和版本化凭据密文；调用日志按唯一 `call_id` 保存用户、实际模型快照、最终状态、计量完整性、Token、价格快照和估算成本，不保存消息或模型正文。配置和调用日志不提供级联删除，历史关联使用 `RESTRICT`。两张表及其全部字段都在 SQL-first DDL 和 SQLAlchemy 模型中维护一致的中文注释；状态字段的英文值是持久化契约，不因注释语言改变。

`0007` 新增用户私有 `job_descriptions` 单表。岗位、要求、工作地点、薪资、公司与招聘者快照、来源身份、备注和乐观锁保存在同行；福利和原始抓取内容不落库。`skills` 是字符串 JSON 数组。来源 URL 只在后端规范化，随后同时保存规范化值和二进制 SHA-256；BOSS 岗位链接还保存站点原生 ID。`(user_id, source_site, source_job_id)` 与 `(user_id, source_url_hash)` 两组唯一约束处理同用户重复。`0034` 永久删除当时所有已归档 JD，随后删除 `archived_at` 和归档联合索引；JD 从此不保存生命周期状态。列表、搜索、编辑和直接删除始终带用户条件，删除成功后真实释放来源唯一键。用户外键继续使用 `ON DELETE RESTRICT`；`0033` 建立的求职进程外键使用 `ON DELETE SET NULL`，因此删除 JD 只解除来源引用，完整岗位快照和后续面试历史继续保留。

`POST /api/job-descriptions/import` 是浏览器插件的受保护入口，只接受 BOSS 岗位详情 URL 和有限的页面采集字段。`application/job_descriptions/import_service.py` 先清理不可见字符、空白和明确页尾噪声，再映射就业类型、工作形态、月薪/日薪/时薪及公司标签；它还会把 `5天/周`、`6个月` 等实习安排从误传的经验字段移入 `work_schedule`，并在入库前剔除福利标签。最后构造已有 `JobDescriptionCreateRequest` 并复用统一创建与重复解决事务。该过程不调用 LLM，不保存输入 DTO，也不绕过既有用户条件、来源唯一键或乐观锁。

`POST /api/job-descriptions/parse-draft` 是 Web 新建流程的受保护智能导入入口，只接受一份文字或一张受限图片。`ai_import_service.py` 把文字交给 `chat` binding，把图片以多模态消息交给独立 `job_image_structuring` binding，并通过同一个可空 `JobDescriptionDraft` Schema 严格解析。接口只返回待确认草稿、核心字段缺失提示和调用 ID，不创建或更新 `job_descriptions`；原始输入、消息和模型正文不落库。`0035` 只扩展 LLM binding/validation 的能力约束并预置空视觉 binding，不修改 JD schema。

`0008` 在模型配置上增加 `capability`、LiteLLM `adapter`、不含前缀的模型调用名和配置版本；新增按能力保存唯一当前候选的 `llm_capability_bindings`，并预置一行可为空的 `chat` 绑定。调用日志增加能力、来源、adapter 和调用名快照。旧的完整 `model_name`、`enabled`、`priority` 和手工价格列暂时保留用于应用回退兼容，新 HTTP 契约和运行时不读取其旧产品语义。revision 在 DDL 前先删除 `llm_call_logs`，再删除 `llm_model_configs`；旧数据不迁移，恢复依赖迁移前备份，升级完成后的 `chat` 绑定为空。

`0009` 曾新增 `admin_operation_logs` 管理操作审计表，记录管理员对用户的 enable/disable 操作。字段包括 `id`（BIGINT UNSIGNED PK）、`actor_user_id`（操作人，FK → users.id）、`target_user_id`（目标用户，FK → users.id）、`action`（受 CHECK 约束的 VARCHAR，只允许 "disable"/"enable"）和 `created_at`。该表仅写入不读取，管理端无查询入口，`0011` 将其删除；enable/disable 操作不再持久化审计记录。

`0013` 为 `resumes` 增加分享字段：`share_token`（VARCHAR(64)，全局唯一索引）、`share_visibility`（VARCHAR(16)，`private|public`）、`share_expires_at`（可空，UTC 过期时间）和 `share_created_at`。两个 CHECK 约束保证分享字段要么全部为空（未分享）、要么全部非空（已分享），且可见性只允许 `private/public`。分享不单独建表、不落内容快照，公开读取时实时取 `resume_versions` 中 `version_no` 最大的正式版本。

`0018` 新增 `user_dataset` 用户知识库数据集表。`0022` 为每行增加无数据库外键的唯一 `parse_task_id`，解析状态只以 `document_parse_tasks` 为真值源；同一事务创建资料和 `source_type=dataset` 的任务。`POST /api/datasets` 校验并上传源文件、提交两行记录后向既有文档解析队列发布 `DATASET_PARSE_TASK`；发布失败将任务收口为上传失败并返回 `502 DATASET_QUEUE_UNAVAILABLE`。Worker 对 DOCX/PDF 调用 LinkParse，对 Markdown/TXT 本地执行 UTF-8 与换行规范化，结果尽力存入 `users/{uid}/datasets/converted/{task_id}.md`。`GET /api/datasets` 联表按当前用户过滤并返回上传、解析状态和失败分类，不暴露对象键或 SHA-256；`GET /api/datasets/:id/content` 在再次校验资料与任务归属、解析成功状态后读取转换存档并返回 Markdown。转换存档缺失或对象读取失败不会退回源文件。本期不做分片、RAG、常规删除、源文件下载和去重。

### 微信账号、双端会话与扫码登录

`0019` 为 `users` 增加全局唯一的 `wechat_openid` 和可空 `wechat_bound_at`，`0020` 将 `email/password_hash` 放宽为可空。微信身份登录时，code2session 得到的 openid 存在则复用；不存在时，扫码确认和小程序登录请求只有携带 `privacy_accepted=true` 才创建无邮箱密码账号，否则返回 `400 PRIVACY_AGREEMENT_REQUIRED`。`account-status` 仍提供只读账号存在性查询，不写用户、不更新时间、不签发 session，但随仓库发布的小程序不再在统一登录前调用它；客户端只在用户确认隐私指引并主动点击后调用登录接口，由后端自动复用或创建账号。`privacy_accepted` 是本次建号门禁，不写入数据库作为同意审计记录；数据库唯一约束仍负责收敛并发建号。普通邮箱注册和密码登录仅在 `APP_ENV=local|development` 开放，Production 均返回 404；普通改密路由仍不公开。`GET /api/auth/capabilities` 向 Web 暴露邮箱密码能力布尔值，不返回具体环境名。`create_schema=True` 的隔离集成测试继续保留隐藏造数入口。启用管理员与普通账号一样可通过网页扫码确认并由匹配 `poll_token` 的 status 获取 Web Cookie，也可通过小程序 login 建立并 refresh 轮换小程序 Bearer 会话，访问小程序业务接口；停用账号的 Web、Bearer 和 refresh 会话仍被拒绝。密码登录仍可使用 `/api/auth/admin-login`。

`session_service.py` 统一发放、轮换和撤销 Redis session。`auth:session:{sid}` 保存 `uid/rhash/channel/created_at`，access JWT 也保存 `channel=web|miniprogram`。Web 只从 Cookie 接受 web channel，小程序只从 Bearer 接受 miniprogram channel；Redis uid/channel 必须与 JWT 完全一致。小程序的 login/refresh/logout 返回 JSON token，refresh 每次轮换，旧 secret 重放会删除 session；管理员停用用户时原有用户会话集合仍可撤销两个 channel。

`modules/resumes/pdf_service.py` 是 Web 与小程序共用的 PDF 边界：从快照提取 LinkCV 私有图片引用，按用户/简历对象键读取 PNG/JPEG 并转为内存 data URL，再以有界 stdin/stdout 协议启动一次性 Node/Chromium 进程。渲染器不监听端口、不读取任意对象键、不联网抓取正文资源，也不把快照或输出写入持久临时文件；并发、输入、单图、图片总量、输出、超时和智能页高都有上限。Web `GET /api/resumes/{id}/pdf` 校验当前 Cookie 用户和 `lock_version`，直接渲染 `resumes` 当前快照。

小程序简历接口仍从 `resume_versions` 选择最新 `reason=manual` 快照，没有手动版本时选择 `reason=initial`，因此不会暴露自动保存草稿。PDF/PNG 请求再次核对小程序会话、本人归属和当前版本标识，并在请求副本中强制 `smart_one_page=true`，保持现有单长页预览契约而不修改持久版本。PNG 路由继续用 `pypdfium2`/PDFium 把唯一页面渲染为最大宽度 1440 像素的 RGB 图片；页面尺寸、总像素和输出字节都有上限，并发栅格化槽位固定。异常以稳定 4xx/503 错误收口。

`0021` 将 `resume_imports` 一次性迁移为通用 `document_parse_tasks`：任务表保存 `source_type=resume_import`、源文件和上传/解析状态，不再持有最终简历指针；`resumes.parse_task_id` 以无外键的可空唯一列记录来源任务，由 Worker 在创建简历和完成任务的同一事务中维护。迁移沿用原任务主键并回填来源指针，随后删除旧表；需要恢复旧表与数据时使用迁移前备份。转换后的 Markdown 尽力存入 `converted_object_name`，历史迁移记录保持为空，生命周期检查不依赖该字段。

`0022` 扩展 `document_parse_tasks.source_type` 与文件格式约束以支持资料解析，并新增两个消费方共用的可空 `failure_reason`。迁移会删除上线前的全部 `user_dataset` 行；对象存储源文件必须在迁移前、确认数据库与对象存储备份后，通过 `scripts/release/cleanup_legacy_user_datasets.py --execute` 清理。该数据删除只能从备份恢复。`0023` 为 `resume_versions` 增加非空 `name`，先按版本原因和编号回填存量快照，再允许新建正式版本时保存用户名称；执行前必须确认数据库备份。

`0028`–`0029` 扩展并收敛多能力模型配置；`0030` 新增 `agent_sessions`、`agent_runs`、`agent_messages`、`agent_tool_calls` 和 `resume_change_proposals`；`0031` 为提案增加兼容模式、稳定 locator、目标哈希、结构化诊断、类型化 operation、修改依据和资料引用；`0032` 为消息增加 `message_type` 和可空 `metadata_json`，存储版本化的结构化澄清问题，存量消息回填并保持为 `text`。五张 Agent 表不建立数据库外键，关联 ID、所有权、引用完整性和删除清理由 FastAPI 在事务中显式维护；查询仍使用对应关联列索引。`0031` 对旧记录使用 `legacy_snapshot` 且新增 JSON 字段可空，因此旧 pending 提案仍可确认。MySQL 保存产品会话和审计真值；Pi 容器不持有业务数据库连接。范围化提案由 FastAPI 在当前快照副本上应用经过模式和作用域校验的 operation 后保存完整候选简历与样式；确认事务使用行锁、乐观锁和目标哈希更新 `resumes`，并创建 `resume_versions.reason=agent` 的不可变版本。数据库迁移统一 forward-only，恢复旧数据库状态依赖备份，问题修正通过新的向前 revision 完成。

`0033` 新增 `job_applications`、`interview_sessions` 和 `interview_assets`。一次求职进程保存建立时的 JD/简历快照、公司统一日历颜色和当前阶段；排期与复盘共用同一条 `interview_sessions` 记录，通过 `scheduled/completed/cancelled` 区分生命周期。创建 DTO 只接受可达的阶段与等待状态组合；筛选可以无场次推进，面试和 HR 推进只消费当前阶段的待确认完成场次。完成一场面试只把进程置为等待结果，必须再由用户明确确认通过并推进到下一轮、HR 面或 Offer，或确认未通过后关闭。排期开始时间使用 IANA 时区校验并限制为整点或半点，时间重叠默认返回冲突，用户显式确认后才允许保存；归档进程不能再执行排期生命周期，也不会进入总览统计。求职进程和场次列表使用与筛选摘要绑定的时间加 ID 游标稳定分页，全部 BIGINT 资源 ID 在 HTTP 与 TypeScript 中保持规范十进制字符串。三类写操作均校验当前用户归属；进程和单场记录使用 `lock_version` 拒绝过期修改，场次创建的请求标识重放还会核对原业务内容。进程、排期和素材的创建、更新、状态动作与删除沿用统一审计链，创建型接口显式绑定新记录 ID，普通读取不写审计。

绑定由 Web 已登录用户发起，走 `/api/account/wechat/bind-request|bind-confirm|bind-status`（ticket 票据）。绑定票据是临时凭证，只存 Redis（`wechat:bind_ticket:<ticket>` 存用户、`wechat:bind_status:<ticket>` 存 `pending/bound`、`wechat:bind_user_ticket:<uid>` 指向当前票据），TTL 默认 300 秒，同用户重新发起时覆盖旧票据。`bind-confirm` 提交小程序 `wx.login()` 的临时 code，服务端换 openid 后关联到发起用户；openid 已被其他用户绑定时返回 `409 WECHAT_ALREADY_BOUND`，原绑定关系不被覆盖。

扫码登录挂在 `/api/auth/wechat` 下，scene 状态机存 Redis（key `wechat:login:<scene>`，TTL 默认 300 秒）：

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/wechat/qrcode` | 无需登录。生成 `login:{随机}` scene 和独立 Web `poll_token`，调用微信小程序码上游，返回 `{scene, poll_token, qr_base64}`；按 IP 限流（默认 10 次/分钟） |
| `GET` | `/api/auth/wechat/status` | 返回 `pending/success/cancelled/expired`；只有携带匹配 `poll_token` 的 success 查询才发放 Web Cookie，未携带时只读状态 |
| `POST` | `/api/auth/wechat/confirm` | 表单 `scene/code/privacy_accepted?`；Redis Lua 原子进入 processing，未知 openid 仅在确认标记为真时建号，否则恢复 pending；重复 confirmed 幂等成功 |
| `POST` | `/api/auth/wechat/cancel` | 表单 `scene`；仅 pending 可原子进入 cancelled，重复取消幂等 |
| `POST` | `/api/auth/wechat/miniprogram/account-status` | 用当前微信临时 code 只读判断账号是否存在；不建号、不发 session，与登录共用限流 |
| `POST` | `/api/auth/wechat/miniprogram/login\|refresh\|logout` | 小程序登录或注册、轮换 JSON token 和幂等撤销；未知 openid 登录请求要求 `privacy_accepted=true` |

scene 使用结构化 hash 保存 state、Web poll token 哈希、claim 所有者、claim 时间、uid 和最近发放的 web sid。小程序只持有二维码中的 scene，可读取状态但不能领取或替换 Web session；poll token 只返回给创建二维码的网页。processing 的微信调用失败时，只有 claim 所有者能恢复 pending；进程中断遗留的 processing 超过 30 秒后可由新确认原子接管，未超时的并发确认返回 `SCENE_IN_PROGRESS`。confirmed/cancelled 不被重复请求删除。携带正确 poll token 的重复 success 轮询先生成新 Web session，再原子交换 `web_sid` 并撤销旧 sid，以支持响应丢失重试。`integrations/wechat_client.py` 只封装 token、小程序码和 code2session；凭据、code、openid 和完整上游响应不写日志。微信凭据未配置时相关登录接口返回 `503 WECHAT_SERVICE_UNAVAILABLE`。

## 统一 LLM 调用

智能助手的浏览器请求先由 FastAPI 创建运行并写入 MySQL，再代理到独立 `apps/pi-service`。`context_service.py` 为独立助手页列出简历、历史版本、岗位、求职进程和面试的轻量引用；发送时在同一事务链中按当前用户重新查询、锁定并核对版本标记，只把字段白名单内且有长度上限的资料交给 Pi，消息元数据只保存展示用引用快照。未绑定会话第一次成功发送含简历归属的上下文时绑定该简历，已绑定会话拒绝切换到另一份简历。Pi 通过服务间 HTTP 读取当前 `pi_agent` binding 的解密运行配置，并把所选模型 ID 与配置版本快照到 `agent_runs`；它不使用 LiteLLM，也不提供独立模型治理。FastAPI 每轮从当前 `agent_session` 的消息恢复有限上下文；成功运行把完整助手文本或结构化澄清消息、Token 和可用的估算成本写回数据库，失败、取消或缺失终态时只保存运行终态，不把已经流出的半条文本写成历史助手消息。澄清回答以助手消息序号做并发校验，只有它仍是当前会话最后一条结构化澄清消息时才允许创建下一轮。取消与流式收口以条件更新和运行行锁保证终态只写一次。工具审计先锁运行行再按 call key 幂等写入，终态不可回退。Pi 对 FastAPI 只允许调用目标解析、范围上下文、当前用户资料召回、结构化诊断和范围化提案工具；受限 `read` 仅加载 Pi 镜像内四个已注册 Skill Markdown，不访问业务存储或其他服务端文件。内部路由从可信 `runId` 反查用户与简历，不接受调用方传入用户身份。完整边界见 [Pi 集成文档](third-party-pi.md)。

`LLMService.chat()`、`LLMService.stream_chat()` 和 `LLMService.structured_chat()` 是后端业务模块使用的内部异步接口，不注册 HTTP route。调用方只提供可信 `user_id`、稳定 `source`、messages，以及结构化调用所需的响应模型；不传候选 ID、adapter、模型名、地址或密钥。服务按调用方传入的能力解析唯一当前 binding；当前能力未绑定时，Chat 返回 `LLM_CHAT_NOT_CONFIGURED`，其他能力返回 `LLM_MODEL_NOT_CONFIGURED`。单次逻辑调用只调用当前模型一次，供应商失败直接收口，不重试、不遍历其他候选、不自动切换 binding。结构化调用把 Pydantic JSON Schema 作为系统指令加入 messages，不向供应商传递 `response_format`；模型文本由 LinkCV 本地提取 JSON 对象并执行 Pydantic 严格校验，非法结果以 `LLM_RESPONSE_INVALID` 收口且不追加模型调用。

LiteLLM 只位于 `modules/llm/gateway.py` 和只读目录边界。白名单 adapter 与不含前缀的调用名组装成 LiteLLM 模型标识；阿里云百炼（千问）使用 `dashscope/<model>` 路由，和其他当前支持的简单 API Key 供应商共享模型名、可选 API Base 与加密 API Key 配置。消息内容既可为文字，也可为 LiteLLM 兼容的受控文字/图片 part。所有 `acompletion` 显式传 `num_retries=0`，价格只读 `litellm.model_cost`，缺价格不阻断调用；供应商超时单独映射为 `LLM_TIMEOUT`，其余异常转换成稳定分类。同步 SQLAlchemy 操作使用独立短 Session 在线程池执行，外部调用和流式迭代期间不持有数据库事务。成功、失败和取消都会收口同一条逻辑调用记录；进程被强制终止造成的 `pending` 记录保留为崩溃排查信号。

模型凭据使用 `LLM_CREDENTIAL_ENCRYPTION_KEYS` 提供的 Fernet 密钥环加密，数据库只保存 `v1:<keyId>:<token>`。列表首项负责新写入，旧 key 用于兼容解密；读取旧密文时会惰性重包到首项。普通日志、HTTP 响应和调用记录均不包含明文凭据、messages、模型完整响应或供应商原始错误。

简历导入 Worker 通过 `integrations/resume_structuring.py` 以 `source=resume_import` 调用 `LLMService.structured_chat()`，使用数据库中的 `resume_structuring` 当前绑定、加密凭据、调用日志和计量。程序先把转换结果解析为保留全局顺序、来源跨度、列表类型、起始序号、项目序号与嵌套深度的 `SourceLayoutIR`；模型只接收稳定源块及必要布局元数据，只能返回每个源块的语义/布局角色和受限分组，不能返回、改写或丢弃可见文字。原文件、对象键、LinkParse 元数据、warnings 和用户 ID 不进入模型输入。结构化调用使用 DeepSeek 时显式发送 `thinking.type=disabled`，其他供应商和普通 Chat 不附加该专属参数；模型结果仍须通过 `ResumeExtractionDraft` 严格校验，再由程序核对源块恰好一次闭包。

模型候选在 `0029` 后不再携带能力列；`llm_capability_bindings` 为 `chat`、`resume_structuring`、`pi_agent`、`job_image_structuring` 各保存一行当前候选、绑定版本和最近验证证据。`llm_model_validations` 按候选配置版本、能力、探针版本和调用 ID 保存验证结果；`llm_call_logs.model_config_version` 保存实际调用时的候选版本快照。管理员使用 `/api/admin/llm/capabilities` 查看能力矩阵，并通过 `/api/admin/llm/capabilities/{capability}/binding` 以真实探针成功后切换绑定；JD 图片解析探针向候选发送内置红色 PNG，只有返回约定的结构化颜色结果才更新绑定。

`scripts/db/init_mysql.py` 只允许创建名为 `linkcv` 的 MySQL 数据库；`scripts/release/run_alembic.py` 在迁移前校验环境、host、port 和数据库并输出不含密码的摘要，再只读核对 Alembic 当前版本与已知 revision 的表、字段标记。发现版本落后但后续对象已存在，或版本已应用但标记对象缺失时，runner 会在任何 DDL 前停止，要求先人工核实并对齐 schema 与 `alembic_version`。FastAPI 配置支持根 `.env`、显式 `LINKCV_ENV_FILE`、同名 `.local` 和进程环境覆盖。Redis 在鉴权链路中作为唯一会话存储：`auth:session:{sid}` 保存会话哈希，`auth:user_sessions:{uid}` 索引该用户全部会话；会话不写 MySQL，撤销即删除 key。Web Cookie 和小程序 Bearer 分别要求 `web` 与 `miniprogram` channel；上线前缺少 channel 的旧会话仅兼容为 Web，并在续期时补写 channel。对象存储配置仅使用 `MINIO_*`。

## 导入与外部边界

Markdown 文件在进程内做 UTF-8 与确定性换行清理；DOCX 以固定的 `output_formats=markdown/include_bbox=false/include_images=false` 调用 LinkParse `POST /v1/parse`，PDF 在此基础上额外发送 `include_layout=true`。LinkParse 识别文件类型并决定 OpenDataLoader、OCR 选页和渲染 DPI；layout 模式内部即使公开 `include_bbox=false` 也必须保留 OCR 坐标，并在 `meta.pdf.layout` 返回版本化物理行、归一化 bbox、来源顺序、语义角色、同行、续行和质量计数，`outputs.markdown` 只能由这些 blocks 确定性生成。LinkParse 响应在 JSON decode 前限制为 3 MiB，随后校验 request ID、外层兼容 envelope、严格 layout schema、页数、完整闭包、来源单调顺序、关系引用、质量计数、warning allowlist、Markdown 一致性、预期文件类型和空 assets；客户端不下载或保存外部 assets，也不自动重试同步解析请求。通过 layout 门禁的扫描、混合和 OCR PDF 可以继续导入；缺失、降级、畸形或不一致的 layout，以及含嵌入图片的文本 PDF，统一以 `RESUME_LAYOUT_UNSUPPORTED` 失败。含图片、表格或文本框的 DOCX 仍失败；转换 Markdown 中仍存在图片、表格、嵌入或主动 HTML 时同样失败。LinkParse 的 Word omitted-image/table 信号参与该严格检查，其余 Word 元数据只写入脱敏调用日志。

超过结构化输入上限的内容不会发送给模型。合规输入经 `SourceLayoutIR → 模型映射决策 → 规范组合器` 处理：组合器只复制已校验源块文字，并按任务开始时锁定的模板 key/renderer 选择受控联系信息行、左右条目和 CommonMark 列表配方；同块经历头只有显式 `entry_header` 决策及原文确定性分隔符同时存在时才生成左右行，普通 `body` 中的 `｜`/`|` 原样保留。与父章节语义相同的嵌套 heading 作为父章节可见标题保留，只有根标题或语义切换才建立新章节。有序列表的起始值、项目编号和嵌套深度由程序输出，超过单 item 50 个源引用时在安全边界确定性分片并延续实际序号。所有源块必须保持来源顺序且恰好进入一个规范 custom 章节，不存在“未分类内容”运行时兜底。模型引用未知/重复/缺失源块、非法分组或模板布局无法完整承载时分别以 `RESUME_STRUCTURE_INVALID` 或 `RESUME_LAYOUT_UNSUPPORTED` 失败，不创建半成品。日期、联系方式、错别字和空缺字段作为可见源文字原样保留；字段类型、数量和长度上限、危险链接、Markdown 主动内容及内部 ID 完整性仍严格校验。

HTTP 导入入口先校验所选模板与文件，再使用 canonical UUID `Idempotency-Key`；Redis key 按用户和 Header 哈希隔离，先以 30 秒租约占有请求，再绑定持久化导入 ID 并保留 15 分钟。`document_parse_tasks` 中 `source_type=resume_import` 的记录是上传和解析状态真值；API 只上传、更新为解析中并等待 MQ confirm，Worker 才执行转换和结果事务。单任务状态接口按当前用户和 `source_type` 查询，非法 ID、不存在和越权统一隐藏为 `RESUME_IMPORT_NOT_FOUND`，并在读取前沿用现有陈旧任务收口。Worker 只有在仍持有本人 `processing` 任务行锁时才上传转换存档并写回引用；删除或终态并发胜出时不会产生新的转换对象。上传失败补偿对象；业务解析失败保留源文件、可能存在的转换存档与失败记录供用户删除，不自动重试。

Development 未配置 LinkParse Key 时应用仍可启动，Markdown 保持可用，PDF/DOCX 返回 `DOCUMENT_CONVERSION_UNAVAILABLE`；Production 缺 Key 会安全拒绝启动。默认测试全部使用确定性 Fake 和 `httpx.MockTransport`，不访问真实网络或读取密钥。PDF/DOCX 解析日志只记录 LinkCV 调用 LinkParse 的开始、结果、耗时、解析器/页数/OCR 摘要、DOCX Word 元数据和稳定错误码；不读取 LinkParse 内部日志，也不记录正文、Prompt、Cookie、密钥或完整供应商响应。Markdown 本地转换只记录格式、结果和耗时。

## 可观测性与业务审计

`ObservabilityMiddleware` 为每次 HTTP 尝试接受格式合法的 `X-Request-ID` 或生成新值，并在响应中回传；它写入一条包含路由模板、状态码、耗时、可信用户和稳定错误码的 access 事件。未处理异常额外保留异常类型和脱敏后的栈。MinIO、Redis、MySQL、LinkParse 和 LLM 调用使用 `dependency` 分类，简历导入使用 `operation_id` 关联上传、转换、结构化和 HTTP 结果。导入 Worker 另以 `task_load → source_read → document_conversion → resume_structuring → resume_composition → resume_persistence` 记录阶段结果与耗时；失败事件只增加稳定错误码、失败阶段、异常类型，以及不含字段值的 Pydantic 验证模型、路径和错误类型，不写文件名、简历正文或模型响应。Uvicorn 自带 access log 已关闭，避免同一请求重复记录。

文档解析 MQ 使用强制身份的 V2 envelope：Resume 与 Dataset 消息都要求 `pipeline_version="v2"`、`mq_name="tolink.cv.resume_import.v2"` 且拒绝未知字段。RabbitMQ 使用 `tolink.cv.resume_import.v2` exchange、`linkcv.resume_import.worker.v2` queue、`resume.import.v2` routing key，并添加同版本 header；Kafka 使用同名 V2 topic 和 `linkcv.resume_import.worker.v2` group。重试和 DLT 保留原正文与诊断 headers，Worker 日志只记录受控的 message ID、版本、来源、任务 ID、尝试次数、vendor 和 route，不记录消息正文。

状态变更和安全动作通过 `modules/observability/audit.py` 的固定映射写入审计事件，包括鉴权/会话、账号资料与密码、简历/版本/资源、PDF 导出、JD、管理员用户状态和模型配置。actor 只从已验证会话或登录结果绑定，target 从路由参数、归属校验后的实体或创建结果绑定；成功与受控失败都记录，响应以 `X-Audit-Recorded` 表示本地 sink 是否接受。浏览器单独上报 `resume.pdf_export` 的旧接口继续兼容；新的 Web PDF 路由自动记录该动作。审计不新增 MySQL 表，也不替代既有 `llm_call_logs`。

所有事件由后端白名单生成 `event_version=1` JSON Lines，同时写 stderr 和可选 `LOG_DIRECTORY/linkcv.jsonl`。日志正文会截断并遮盖 URL query、Bearer/JWT、邮箱和常见 secret 赋值；日志文件按 UTC 日期轮转并清理七天以前的缓冲文件。容器将目录挂入命名卷，由 LinkCV 自己的 Promtail 异步推送到共享 Loki。业务请求不直接调用 Loki；管理查询使用固定 `{service="linkcv", environment, log_type}` selector 和允许字段，最多查询七天、单页最多 200 条，并按 `event_id` 去重。Loki 不可用只使管理查询返回 `LOG_QUERY_UNAVAILABLE`，不阻断其他业务。

## 对象存储

- 用户级兼容图片：`users/{user_id}/assets/...`。
- 账号头像：`users/{user_id}/assets/avatar/...`，对象键记录在 `users.avatar_object_key`；旧路径中的已有头像保持兼容。
- 导入原文件：`users/{user_id}/resume-imports/{operation_id}/source/{safe_name}`。
- 导入转换存档：`users/{user_id}/resume-imports/{operation_id}/artifacts/converted.md`；删除时同时兼容旧的 `.../{operation_id}/converted.md`。
- 知识库原文件：`users/{user_id}/datasets/...`。
- 知识库转换存档：`users/{user_id}/datasets/converted/{parse_task_id}-{attempt}.md`；读取和删除兼容旧的 `{parse_task_id}.md`。
- 简历资源：`users/{user_id}/resumes/{resume_id}/assets/...`。
- 面试素材：`users/{user_id}/interviews/{application_id}/{session_id}/...`。

简历级读取先校验所属简历。资源删除会递归检查当前和历史 `data_json` 引用；仍在使用时拒绝删除。删除导入生成的正式简历时通过 `resumes.parse_task_id` 读取对应 `document_parse_tasks`，删除源文件、转换存档和任务记录，再删除简历资源、版本和简历；任务记录异常缺失时只记录告警，不阻断简历删除。面试录音、视频和文档使用流式上传，服务端在传输中计算 SHA-256 并执行 `INTERVIEW_ASSET_UPLOAD_MAX_BYTES` 上限，不把完整文件读入内存；浏览器录制和事后上传最终进入同一私有前缀。MinIO 与 MySQL 不是同一事务，元数据提交失败会尽力补偿删除新对象，对象删除成功后的数据库提交失败仍无法恢复对象。

## 用户中心

公开的 `/api/account/*` 通过 `get_current_user` 获取当前用户，不接受客户端 `user_id`。`GET /api/account/profile` 返回资料并附带简历数量与最近 5 份简历；`PATCH /api/account/profile` 只允许修改昵称（去空白后 1–50 字符）。头像上传复用 `decode_image_data_url`、`build_avatar_object_name` 和 `asset_url`：新对象写入 `users/{user_id}/assets/avatar/...`，再更新 `users.avatar_object_key`，提交失败补偿删除新对象，成功后才清理旧对象；响应只含相对 URL。普通改密和微信绑定不是运行时公开契约；用户停用或管理员操作仍通过 `revoke_user_sessions` 撤销该用户的 Web 与小程序 session。

`UserProfile` 模型承载每个用户至多一份的个人画像（`user_profiles` 表，迁移 `0043`），`GET/PUT /api/account/user-profile` 负责读写。`GET` 未创建时返回 `lock_version=1` 的约定空对象且不写库；`PUT` 整体替换全部可编辑字段（缺省以 `null`/空数组覆盖），首次创建要求 `base_lock_version=1`。更新使用 `user_id + lock_version` 条件写并递增版本，影响 0 行即并发冲突，`USER_PROFILE_VERSION_CONFLICT` 附最新画像供前端刷新重试；创建时 `IntegrityError` 冲突同样转成该错误。薪资币种统一转大写三字母，数组字段去除空串与重复并保留提交顺序；schema 侧 `UserProfileData` 追加 `lock_version` 与 UTC 时间戳，`GET /api/account/profile` 的 `profile` 字段未创建时为 `null`。

## 简历分享

`application/resumes/share_service.py` 承担分享业务，`modules/resumes/share_routes.py` 暴露管理端 4 个端点（`/api/resumes/{resume_id}/share` 的 GET/POST/PATCH/DELETE）和公开只读端点（`/api/share/{token}`，依赖 `get_optional_user` 以支持 `private` 可见性判断）。token 使用 `secrets.token_urlsafe(16)`，全局唯一且冲突重试 3 次；`POST` 可选携带 `visibility`（缺省 `public`）与 `expires_at`（缺省永久）指定创建/覆盖时的权限和有效期，已有链接时作废旧 token 生成新 token，`DELETE` 清空分享字段，重复删除幂等。公开解析按「token 存在 → 未过期（SQLite naive datetime 按 UTC 解释后比较）→ 非 `private` 或访问者是分享者本人 → 简历与最新版本存在」的顺序校验，任一不满足统一抛 `SHARE_LINK_UNAVAILABLE`，路由转成 `404`，防止枚举探测。分享内容实时读取 `resume_versions` 最新正式版本并脱敏返回 `data/style/sharer`，不保存快照，因此所有者后续保存新版本会立即反映到分享页。

## 测试约定

- `npm run test:backend:unit`：领域、Adapter 和仓库脚本测试。
- `npm run test:backend:integration`：SQLite、Fake Redis、Fake MinIO、Fake 转换/LLM 的 HTTP 组合测试。
- `LINKCV_TEST_MYSQL_URL`：仅允许指向本机一次性 `linkcv` 数据库，用于从根 revision 向前升级到 `0045`、模板初始化和物理约束验证。
- 真实 LinkParse、模型、MinIO 和浏览器流程不进入默认 CI，需单独授权联调。
# 插件发布与私有下载

`modules/plugin_releases/` 负责 Chrome 岗位采集插件的当前版本发布。管理员上传预构建 ZIP 后，后端限制上传与解压大小，拒绝路径穿越、重复项、加密项和符号链接，并校验根目录 Manifest、Manifest V3 与三段数字版本。上传不检查安装说明、站点权限、IP 或端口，发布者负责选择正确的环境构建产物。

插件不使用数据库表。Development 与 Production 使用彼此独立的 MinIO，因此各自 Bucket 内统一以 `system/plugin-releases/current.json` 保存当前指针，以 `system/plugin-releases/v<version>/linkcv-job-capture-v<version>.zip` 保存当前版本 ZIP，不在对象键中重复环境名。新写指针使用 schema v3，并显式包含 `published` 或 `unpublished` 状态；读取兼容既有不含状态的 v2 指针，并按已发布处理。发布顺序固定为先写 ZIP 并核对 size/SHA-256 元数据，再覆盖当前指针，最后枚举插件保留前缀并删除除 current 引用对象外的其他 ZIP。指针失败时上一状态和旧 ZIP 继续有效；清理失败时新版保持有效并返回 `cleanup_pending=true`，同版本重试或后续上传会再次清理。同版本同摘要可以幂等重试或从下架状态重新上架，同版本不同内容或低于指针保留版本的发布返回冲突。当前 Docker 入口是单 Uvicorn 进程，进程锁只保证当前部署内发布串行；扩为多副本前必须改成跨实例协调。

普通登录用户通过 FastAPI 读取当前元数据和流式下载，MinIO Bucket policy、Endpoint 和对象键都不暴露给浏览器。下载前重新核对当前版本、对象大小和 SHA-256 元数据，页面停留期间版本已变化时要求刷新，不回退到已删除的历史对象。管理员通过独立 current 接口区分无插件、已上架和已下架三种状态。下架将 `current.json.status` 改为 `unpublished`，成功后用户下载关闭，但当前版本信息和该版本 ZIP 均保留；重新上架校验保留 ZIP 后切回 `published`，无需再次上传。永久删除与发布共用进程锁，并在插件仍已上架时先写入 unpublished 指针关闭下载，再删除 ZIP 和指针；部分失败保留 unpublished 状态，允许重复删除完成收尾。
