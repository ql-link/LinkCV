# FastAPI 后端

## 当前职责与结构

`apps/backend` 承接健康检查、短 JWT access + 不透明 refresh + Redis 会话鉴权、语义简历生命周期、历史版本、文件导入、私有对象资源、结构化 JD 生命周期、用户中心与账号安全、统一 LLM 调用和管理员模型治理 API，以及管理台用户管理（列表/搜索/详情/状态变更/概览统计）。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 装配数据库、Redis、MinIO、文档转换、统一 LLM 和导入幂等服务；测试可注入 Fake |
| `src/linkcv/core/` | 配置、数据库、错误、安全、Redis 和 MinIO 基础设施 |
| `src/linkcv/domain/` | `ResumeDocumentV1`、`ResumeStyleV1`、联合快照、SectionIR、Draft 和确定性标准化 |
| `src/linkcv/domain/job_source.py` | JD 来源 URL 校验、规范化、站点识别和 SHA-256 身份计算 |
| `src/linkcv/application/resumes/` | 统一创建、乐观锁保存、版本创建/恢复与事务规则 |
| `src/linkcv/application/job_descriptions/` | JD 创建、重复解决、搜索分页、乐观锁更新、归档和永久删除 |
| `src/linkcv/integrations/` | LinkParse PDF Adapter、Mammoth DOCX worker、转换分发和统一 LLM 简历结构化 Adapter |
| `src/linkcv/services/resume_import_service.py` | 文件校验、对象上传、Markdown 转换、结构化、统一创建、deadline 和失败补偿 |
| `src/linkcv/services/resume_import_idempotency.py` | Redis Lua 短窗口幂等租约、成功重放和冲突保护 |
| `src/linkcv/modules/identity/` | 用户模型、注册、登录、admin-login 鉴权、双 Token 会话、`/api/account` 用户中心、管理端用户管理 |
| `src/linkcv/modules/resumes/` | ORM、HTTP DTO、模板/简历/版本/导入/资源路由 |
| `src/linkcv/modules/job_descriptions/` | JD 单表 ORM、HTTP DTO 和受保护路由 |
| `src/linkcv/modules/llm/` | Chat 当前绑定、模型凭据加密、LiteLLM 适配、普通/流式/结构化单模型调用、计量与管理员 API |
| `migrations/` | SQL-first Alembic revision；当前 head 为 `0011` |
| `tests/unit/` | 不访问外部资源的快速单元测试 |
| `tests/integration/` | 使用隔离 SQLite、Fake Redis、Fake MinIO 和外部服务替身的组合测试 |

## 数据与事务

MySQL 包含用户、简历、LLM 治理和 `job_descriptions` 等业务表。当前可编辑简历状态保存在 `resumes.data_json/style_json`，历史版本同时快照两份 JSON。由 `0005` 转换过的旧记录还在同一行的 `legacy_data_json_backup/legacy_style_json_backup` 保存迁移前原值，普通新记录保持为 `NULL`，这些备份不通过 HTTP 暴露。HTTP 中的 ID 是十进制字符串，ORM 和数据库使用整数。

Alembic `0002` 建立 `users`、`resume_templates`、`resumes` 和 `resume_versions` 四张核心表。业务主键和外键统一使用 `BIGINT UNSIGNED`；数据库中的整数 ID 在 HTTP、JWT、TypeScript 和对象键中表示为十进制字符串。`users` 保存账号、昵称、头像对象键、`0/1` 状态和管理员标记，不保存会话；注册时生成以“用户”为前缀的默认昵称。所有创建来源都调用统一服务，在单事务中创建当前简历和 initial 版本。每个用户最多保留 10 份简历；创建前锁定对应 `users` 行并读取已有记录，使普通、模板和导入创建在 MySQL 并发请求下共享同一上限，删除后立即释放名额。导入还会在上传和模型调用前快速拒绝已经达到上限的请求，最终事务检查继续处理快速检查后的竞态。自动保存使用 `resume_id + user_id + base_lock_version` 条件更新并递增锁，不创建版本。手动版本、删除版本与恢复都先锁定所属简历；每份简历最多保存 10 个版本，空间不足时事务直接拒绝且不修改当前简历或历史快照。用户可以删除非最新的旧版本释放名额；恢复按当前内容是否已形成快照，原子地预留一个 `restore` 或两个 `before_restore + restore` 名额。

`0003` 将模板外键改为 `ON DELETE SET NULL`，同时允许历史模板来源在模板删除后保留 `source_type=template/template_id=NULL`。MySQL 8.4 禁止 `SET NULL` 外键列参与 CHECK，因此 `ck_resumes_source_fields` 只约束来源证据字段，`template_id/source_type` 组合由统一创建服务保证，外键继续保证非空引用有效。如果已经出现模板来源但 `template_id=NULL` 的记录，0003 downgrade 会拒绝恢复不成立的 RESTRICT/非空来源约束。`0004` 曾新增对象存储清理任务表；`0010` 在删除链路改为同步后移除该表，upgrade 会先锁表并在存在待处理任务时拒绝删表，downgrade 只恢复空表结构。部署流水线先迁移再替换应用，因此迁移到 `0010` 前须确认任务表为空；迁移和容器替换之间的旧应用删除请求可能短暂失败，回滚旧应用前须先 downgrade 到 `0009`。`0005` 在批量转换前核对旧节点和样式字段，只接受可完整表达的上一版结构；遇到未知字段、危险 Markdown 或无法保留的内嵌图片会中止。降级先从同行备份恢复 `resumes` 和 `resume_versions`，再删除备份列。已进入共享环境的 revision 不原地修改。

`0006` 新增 `llm_model_configs` 和 `llm_call_logs`。模型配置保留启停、优先级、可选价格和版本化凭据密文；调用日志按唯一 `call_id` 保存用户、实际模型快照、最终状态、计量完整性、Token、价格快照和估算成本，不保存消息或模型正文。配置和调用日志不提供级联删除，历史关联使用 `RESTRICT`。两张表及其全部字段都在 SQL-first DDL 和 SQLAlchemy 模型中维护一致的中文注释；状态字段的英文值是持久化契约，不因注释语言改变。

`0007` 新增用户私有 `job_descriptions` 单表。岗位、要求、工作地点、薪资、公司与招聘者快照、来源身份、备注、归档和乐观锁均保存在同行；福利和原始抓取内容不落库。`skills` 是字符串 JSON 数组。来源 URL 只在后端规范化，随后同时保存规范化值和二进制 SHA-256；BOSS 岗位链接还保存站点原生 ID。`(user_id, source_site, source_job_id)` 与 `(user_id, source_url_hash)` 两组唯一约束处理同用户重复。硬删除只接受归档记录，删除语句原子约束用户、记录 ID 和非空 `archived_at`，成功后真实释放来源唯一键；活动、已恢复或并发恢复的记录不会被删除。JD 搜索、归档和所有写操作始终带用户条件；外键使用 `ON DELETE RESTRICT`，不把删除用户隐式扩成级联删除岗位。

`POST /api/job-descriptions/import` 是浏览器插件的受保护入口，只接受 BOSS 岗位详情 URL 和有限的页面采集字段。`application/job_descriptions/import_service.py` 先清理不可见字符、空白和明确页尾噪声，再映射就业类型、工作形态、月薪/日薪/时薪及公司标签；它还会把 `5天/周`、`6个月` 等实习安排从误传的经验字段移入 `work_schedule`，并在入库前剔除福利标签。最后构造已有 `JobDescriptionCreateRequest` 并复用统一创建与重复解决事务。该过程不调用 LLM，不保存输入 DTO，也不绕过既有用户条件、来源唯一键或乐观锁。

`0008` 在模型配置上增加 `capability`、LiteLLM `adapter`、不含前缀的模型调用名和配置版本；新增按能力保存唯一当前候选的 `llm_capability_bindings`，并预置一行可为空的 `chat` 绑定。调用日志增加能力、来源、adapter 和调用名快照。旧的完整 `model_name`、`enabled`、`priority` 和手工价格列暂时保留用于应用回滚兼容，新 HTTP 契约和运行时不读取其旧产品语义。revision 在 DDL 前先删除 `llm_call_logs`，再删除 `llm_model_configs`；旧数据不迁移且 downgrade 不恢复，升级完成后的 `chat` 绑定为空。

`0009` 曾新增 `admin_operation_logs` 管理操作审计表，记录管理员对用户的 enable/disable 操作。字段包括 `id`（BIGINT UNSIGNED PK）、`actor_user_id`（操作人，FK → users.id）、`target_user_id`（目标用户，FK → users.id）、`action`（受 CHECK 约束的 VARCHAR，只允许 "disable"/"enable"）和 `created_at`。该表仅写入不读取，管理端无查询入口，`0011` 将其删除（down 只重建空表结构）；enable/disable 操作不再持久化审计记录。

## 统一 LLM 调用

`LLMService.chat()`、`LLMService.stream_chat()` 和 `LLMService.structured_chat()` 是后端业务模块使用的内部异步接口，不注册 HTTP route。调用方只提供可信 `user_id`、稳定 `source`、messages，以及结构化调用所需的响应模型；不传候选 ID、adapter、模型名、地址或密钥。服务从固定的 `chat` binding 解析唯一当前模型，并在单次逻辑调用内只调用该模型一次。没有当前项时返回 `LLM_CHAT_NOT_CONFIGURED`；供应商失败时直接收口，不重试、不遍历其他候选、不自动切换 binding。结构化调用把 Pydantic 响应模型交给 LiteLLM；对已实测的 `openai/qwen3.7-plus` 与国际兼容端点精确组合额外关闭 thinking mode。

LiteLLM 只位于 `modules/llm/gateway.py` 和只读目录边界。白名单 adapter 与不含前缀的调用名组装成 LiteLLM 模型标识；阿里云百炼（千问）使用 `dashscope/<model>` 路由，和其他当前支持的简单 API Key 供应商共享模型名、可选 API Base 与加密 API Key 配置。所有 `acompletion` 显式传 `num_retries=0`，价格只读 `litellm.model_cost`，缺价格不阻断调用。供应商异常转换成稳定分类。同步 SQLAlchemy 操作使用独立短 Session 在线程池执行，外部调用和流式迭代期间不持有数据库事务。成功、失败和取消都会收口同一条逻辑调用记录；进程被强制终止造成的 `pending` 记录保留为崩溃排查信号。

模型凭据使用 `LLM_CREDENTIAL_ENCRYPTION_KEYS` 提供的 Fernet 密钥环加密，数据库只保存 `v1:<keyId>:<token>`。列表首项负责新写入，旧 key 用于兼容解密；读取旧密文时会惰性重包到首项。普通日志、HTTP 响应和调用记录均不包含明文凭据、messages、模型完整响应或供应商原始错误。

简历导入通过 `integrations/resume_structuring.py` 以 `source=resume_import` 调用 `LLMService.structured_chat()`，复用数据库中的 Chat 当前绑定、加密凭据、调用日志和计量，不再读取导入专用的 `LLM_BASE_URL`、`LLM_API_KEY` 或 `LLM_MODEL`。模型输入只包含 SectionIR 的标题、类别和 Markdown，不包含原文件、对象键、LinkParse 元数据、warnings 或用户 ID；模型返回内容仍须通过 `ResumeExtractionDraft` 严格校验。

`scripts/db/init_mysql.py` 只允许创建名为 `linkcv` 的 MySQL 数据库；`scripts/release/run_alembic.py` 在迁移前校验环境、host、port 和数据库并输出不含密码的摘要。FastAPI 配置支持根 `.env`、显式 `LINKCV_ENV_FILE`、同名 `.local` 和进程环境覆盖。Redis 在鉴权链路中作为唯一会话存储：`auth:session:{sid}` 保存会话哈希，`auth:user_sessions:{uid}` 索引该用户全部会话；会话不写 MySQL，撤销即删除 key。对象存储配置仅使用 `MINIO_*`。

## 导入与外部边界

Markdown 文件在进程内做 UTF-8 与确定性换行清理；DOCX 在可取消子进程中使用 Mammoth 转安全 HTML，经 nh3 allowlist 清洗后转 Markdown；只有 PDF 会以固定的 `engine=auto/output_formats=markdown/ocr=auto/dpi=200/include_bbox=false/include_images=false` 调用 LinkParse `POST /v1/parse`。LinkParse 响应在 JSON decode 前限制为 3 MiB，随后校验 request ID、schema、页数、Markdown 质量和空 assets；客户端不下载或保存外部 assets，也不自动重试同步解析请求。

Markdown 只保存为 `extracted_markdown` 来源证据；超过结构化输入上限的内容不会发送给模型，合规输入的 AST 被压缩为 H1–H3 `SectionIR` 后才发送给结构化模型，模型只能返回 `ResumeExtractionDraft`，最终稳定 ID、日期和来源行号由程序生成。导入入口继续实施进程内频率与并发限制，并额外要求 canonical UUID `Idempotency-Key`。Redis key 按用户和 Header 哈希隔离，原子保存请求指纹、processing 租约、成功结果或短期失败；相同成功请求从 MySQL 按归属重放，不重复上传、转换或调用模型。Redis 不可用时 fail-closed。总业务 deadline 为 180 秒，PDF 阶段最多 90 秒、结构化阶段最多 60 秒。

Development 未配置 LinkParse Key 时应用仍可启动，Markdown/DOCX 保持可用，PDF 返回 `DOCUMENT_CONVERSION_UNAVAILABLE`；Production 缺 Key 会安全拒绝启动。默认测试全部使用确定性 Fake 和 `httpx.MockTransport`，不访问真实网络或读取密钥。日志只记录 operation/resume/user 标识、大小、耗时、解析分类和错误类型，不记录正文、Prompt、Cookie、密钥或完整供应商响应。

## 对象存储

- 用户级兼容图片：`users/{user_id}/assets/...`。
- 账号头像：`users/{user_id}/assets/avatar/...`，对象键记录在 `users.avatar_object_key`；旧路径中的已有头像保持兼容。
- 导入原文件：`users/{user_id}/resume-imports/{operation_id}/...`。
- 简历资源：`users/{user_id}/resumes/{resume_id}/assets/...`。

简历级读取先校验所属简历。资源删除会递归检查当前和历史 `data_json` 引用；仍在使用时拒绝删除。删除简历时先同步删除导入原文件和简历资源前缀，全部成功后才删除数据库中的简历与版本；MinIO 删除失败返回 `502 ASSET_DELETE_FAILED` 并保留数据库记录。数据库与 MinIO 仍不是同一事务：多个对象可能只删除一部分，且对象删除成功后的数据库提交失败无法恢复对象。导入失败同样同步尝试删除已上传原文件；清理失败只记录告警，当前没有后台重试或持久化补偿。

## 用户中心

`/api/account/*` 的五个端点都通过 `get_current_user` 获取当前用户，不接受客户端 `user_id`。`GET /api/account/profile` 返回资料并附带简历数量与最近 5 份简历；`PATCH /api/account/profile` 只允许修改昵称（去空白后 1–50 字符）。头像上传复用 `decode_image_data_url`、`build_avatar_object_name` 和 `asset_url`：新对象写入 `users/{user_id}/assets/avatar/...`，再更新 `users.avatar_object_key`，提交失败补偿删除新对象，成功后才清理旧对象；响应只含相对 URL，旧路径中的已有头像不迁移。`POST /api/account/change-password` 校验当前密码（新密码不得与当前密码相同，否则 `400 PASSWORD_UNCHANGED`）并更新 Argon2id 哈希后，调用 `revoke_user_sessions` 撤销该用户全部 Redis 会话，再通过 `clear_auth_cookies` 清除双 Cookie，强制所有设备用新密码重新登录。登录与 `/api/auth/me` 等鉴权响应的 `user` 对象同样包含 `avatar_url`（经 `/api/assets` 转发，无头像时为 `null`）。

## 测试约定

- `npm run test:backend:unit`：领域、Adapter 和仓库脚本测试。
- `npm run test:backend:integration`：SQLite、Fake Redis、Fake MinIO、Fake 转换/LLM 的 HTTP 组合测试。
- `LINKCV_TEST_MYSQL_URL`：仅允许指向本机一次性 `linkcv` 数据库，用于 `0002`–`0011` 往返、旧快照转换和物理约束验证。
- 真实 LinkParse、模型、MinIO 和浏览器流程不进入默认 CI，需单独授权联调。
