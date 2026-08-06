# HTTP 接口契约

本文记录当前调用方可观察的 HTTP 行为。全部 `/api` 路径由 FastAPI 提供，Swagger UI 位于 `/api/docs`，OpenAPI JSON 位于 `/api/openapi.json`。未匹配的 `/api` 路径返回 JSON 404，不会被 SPA fallback 转成 HTML。

## 健康检查与鉴权

`GET /api/health` 返回 `{status, service, version}`。鉴权接口包括：

| Method | Path                 | 成功结果                                              |
| ------ | -------------------- | ----------------------------------------------------- |
| `GET`  | `/api/auth/me`       | `{user}`；未登录或 Cookie 无效时为 `null`             |
| `POST` | `/api/auth/register` | `201 {user}`，签发短 access 与 7 天 refresh 双 Cookie |
| `POST` | `/api/auth/login`    | `{user}`，签发短 access 与 7 天 refresh 双 Cookie     |
| `POST` | `/api/auth/refresh`  | `{user}`，轮换 refresh 密钥并下发新双 Cookie          |
| `POST` | `/api/auth/logout`   | `{ok: true}`，删除 Redis 会话并清除双 Cookie          |

鉴权使用“短 JWT access + 不透明 refresh + Redis 会话”的双 Token 方案。Access Cookie 名为 `resume_access`，有效期 `ACCESS_TTL_MINUTES`（默认 15 分钟），`SameSite=Lax`、`Path=/`。Refresh Cookie 名为 `resume_refresh`，有效期 `SESSION_TTL_DAYS`（默认 7 天），`HttpOnly`、`SameSite=Lax`、`Path=/api/auth`。Web 调用受保护接口收到 `401` 时，会把并发请求合并到同一次 refresh，刷新成功后各自重试一次；启动检查 `/api/auth/me` 返回空用户时也会先尝试 refresh，再进入访客态。登录或刷新失败返回 `401 INVALID_CREDENTIALS`。`/api/auth/me`、登录、注册与 refresh 返回的 `user` 对象与用户中心一致，包含 `avatar_url`（无头像时为 `null`）。

每次受保护请求按“Access 自洽 → Session 存活 → 用户启用”三步校验：先校验 access JWT 签名与过期，再用 `EXISTS auth:session:{sid}` 确认 Redis 会话仍在，最后从 MySQL 读取用户并要求 `status=1`。私有接口不接受客户端 `user_id`；未登录返回 `401 UNAUTHORIZED`。会话只存 Redis（`auth:session:{sid}` 哈希与 `auth:user_sessions:{uid}` 集合），不写 MySQL；撤销即删除 key。`POST /api/auth/refresh` 校验 refresh Cookie 中的 `sid.secret`，匹配 Redis 中保存的 secret 哈希后轮换密钥、续期会话并下发新 Cookie；哈希不匹配会立即撤销该会话。密码经 Argon2id 哈希后存入 `password_hash`，不保存明文。

## 用户中心

`/api/account/*` 全部通过 `get_current_user` 取当前登录用户，不接受客户端传入 `user_id`。头像只暴露相对 URL（经 `/api/assets` 转发），不返回对象存储键。未登录返回 `401 UNAUTHORIZED`。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/account/profile` | `{user, resume_count, recent_resumes}` |
| `PATCH` | `/api/account/profile` | `{user}`；请求为 `{nickname}` |
| `PUT` | `/api/account/avatar` | `{url}`；请求为 `{fileName?, dataUrl}` |
| `DELETE` | `/api/account/avatar` | `{ok: true}` |
| `POST` | `/api/account/change-password` | `{ok, message}`；请求为 `{current_password, new_password, confirm_password}` |

`user` 为 `{id, email, nickname, is_admin, avatar_url}`，无头像时 `avatar_url` 为 `null`。`recent_resumes` 是最近编辑的 5 份简历，每项 `{id, title, updated_at}`，按 `updated_at DESC, id DESC` 排序。

昵称去空白后为空或超过 50 字符返回 `400 INVALID_NICKNAME`。头像通过 data URL 上传（≤10MB），新对象键使用 `users/{user_id}/assets/avatar/{毫秒时间戳}-{8位随机串}-{文件名}.{扩展名}`。非法图片返回 `400 INVALID_IMAGE`，超限返回 `413 IMAGE_TOO_LARGE`，对象写入失败返回 `502 ASSET_UPLOAD_FAILED`；先写新对象再更新数据库，提交失败补偿删除新对象，成功后清理旧头像对象。旧路径中的已有头像继续可读、可替换和删除，不做批量迁移。

修改密码先校验当前密码（错误返回 `400 INVALID_CURRENT_PASSWORD`），再要求新密码至少 8 位（否则 `400 WEAK_PASSWORD`）、两次输入一致（否则 `400 PASSWORD_MISMATCH`）且不能与当前密码相同（否则 `400 PASSWORD_UNCHANGED`）。成功后更新 Argon2id 哈希，立即撤销该用户全部 Redis 会话，并在同一响应中清除双 Cookie，所有设备都必须用新密码重新登录。

## 语义简历契约

简历 API、Python DTO 和 TypeScript 类型统一使用 `snake_case`。数据库 ID 在 HTTP 中使用十进制字符串。`data` 是 `ResumeDocumentV1`，`style` 是 `ResumeStyleV1`，两者的 `schema_version` 当前均为字符串 `"1.0"`。`style.smart_one_page` 控制连续单页或标准 A4 导出模式，并随版本快照保存。旧 `markdown/settings/splitRatio/previewScale/lockVersion` 不再是简历写契约。

Alembic `0005` 将历史 `schema_version=1` 的 Tiptap 当前态和版本快照转换为上述 `"1.0"` 契约；这些迁移期旧 JSON 从未进入 API 响应，`0012` 删除其同行备份列，因此 HTTP 请求、响应和现有 `"1.0"` 数据保持不变。发布顺序仍为先迁移数据库、再启动新应用。

| Method   | Path                        | 鉴权 | 成功结果                                                         |
| -------- | --------------------------- | ---- | ---------------------------------------------------------------- |
| `GET`    | `/api/resume-templates`     | 否   | `{templates}` 启用模板列表                                       |
| `GET`    | `/api/resume-templates/:id` | 否   | `{template}`                                                     |
| `GET`    | `/api/resumes`              | 是   | `{resumes}`，按更新时间倒序                                      |
| `POST`   | `/api/resumes`              | 是   | `201 {resume}`；请求为 `{title?, template_id?}`                  |
| `GET`    | `/api/resumes/:id`          | 是   | `{resume}`                                                       |
| `PUT`    | `/api/resumes/:id`          | 是   | `{resume}`；请求含 `base_lock_version` 及可选 `title/data/style` |
| `DELETE` | `/api/resumes/:id`          | 是   | `{deleted}`                                                      |

空白、模板和导入创建统一受每用户最多 10 份简历的限制；创建事务先锁定用户行再检查数量，并发请求不会突破上限。达到上限返回 `409 RESUME_LIMIT_REACHED`，删除任意一份后释放名额。空白和模板创建都在同一事务写入当前简历及 `version_no=1/reason=initial` 快照。更新同时保存完整 data/style 并递增 `lock_version`，不创建历史版本；过期基准返回 `409 RESUME_EDIT_CONFLICT`。非法内容和样式分别返回 `400 INVALID_RESUME_DOCUMENT`、`400 INVALID_RESUME_STYLE`。不存在或不属于当前用户的简历统一返回 `404 RESUME_NOT_FOUND`。

## 历史版本

| Method   | Path                                            | 鉴权 | 成功结果                                               |
| -------- | ----------------------------------------------- | ---- | ------------------------------------------------------ |
| `GET`    | `/api/resumes/:id/versions`                     | 是   | `{versions}`，版本号倒序                               |
| `POST`   | `/api/resumes/:id/versions`                     | 是   | `201 {version}`，创建 `manual` 快照                    |
| `GET`    | `/api/resumes/:id/versions/:version_no`         | 是   | `{version}` 完整快照                                   |
| `DELETE` | `/api/resumes/:id/versions/:version_no`         | 是   | `{deleted}`；删除指定旧版本                            |
| `POST`   | `/api/resumes/:id/versions/:version_no/restore` | 是   | `{resume}`；按需追加 `before_restore` 后追加 `restore` |

版本号单调递增且不复用；每份简历默认最多保存 10 个版本。创建或恢复所需的版本空间不足时返回 `409 RESUME_VERSION_LIMIT_REACHED`，不会自动删除任何历史版本；用户删除旧版本后才能继续。最新版本作为当前恢复基准不可删除，尝试删除返回 `409 LATEST_RESUME_VERSION_REQUIRED`。版本不存在返回 `404 RESUME_VERSION_NOT_FOUND`，并发兜底失败返回 `409 VERSION_CONFLICT`。

## 文件导入

`POST /api/resumes/import` 使用 `multipart/form-data`，字段为 `file` 和可选 `title`，并要求 `Idempotency-Key` Header 为小写、带连字符的 canonical UUID。支持 UTF-8 Markdown、DOCX 和文字/扫描/混合 PDF：Markdown 本地直接读取，DOCX 本地通过 Mammoth 和安全 HTML 转 Markdown，只有 PDF 会调用 LinkParse `POST /v1/parse` 并由远端自动选择文字提取或 OCR；随后统一经过 `SectionIR → ResumeExtractionDraft → ResumeDocumentV1`。成功返回：

```json
{
  "resume": { "id": "1", "source_type": "import", "data": {}, "style": {} },
  "import": {
    "source_file_name": "resume.pdf",
    "source_file_format": "pdf",
    "warnings": []
  }
}
```

原文件对象键、LinkParse request ID、外部 URL 和模型调用信息不在响应中。`warnings` 只允许 `pdf_ocr_applied`、`pdf_low_text_quality`、`docx_embedded_images_omitted`、`docx_textbox_order_may_change`、`document_heading_structure_missing`、`source_quote_not_found`、`unparsed_work_start_date`、`unparsed_work_end_date` 和 `unmapped_fragments_preserved`，按转换、章节、标准化顺序首次去重。

缺少或使用非 canonical Header 返回 `400 INVALID_IDEMPOTENCY_KEY`；同一用户、Key 与指纹仍在处理返回 `409 IMPORT_ALREADY_PROCESSING`，成功状态返回原 resume ID 和原导入元数据，不重复副作用；Key 用于不同文件或标题返回 `409 IDEMPOTENCY_KEY_REUSED`。Redis 不可用返回 `503 IMPORT_IDEMPOTENCY_UNAVAILABLE`。Header 按用户隔离，成功重放仍重新校验 MySQL 归属。

文件为空、超限、不支持或内容非法分别返回 `EMPTY_IMPORT_FILE`、`IMPORT_FILE_TOO_LARGE`、`UNSUPPORTED_IMPORT_FORMAT`、`IMPORT_CONTENT_INVALID`；超过结构化模型输入上限返回 `413 STRUCTURING_INPUT_TOO_LARGE`，触发频率或并发保护返回 `429 IMPORT_RATE_LIMITED`。账号已有 10 份简历时会在上传和模型处理前返回 `409 RESUME_LIMIT_REACHED`；快速检查后的并发创建仍由最终事务检查兜底。LinkParse 未配置/未授权、网络或引擎不可用返回 `503 DOCUMENT_CONVERSION_UNAVAILABLE`，转换失败返回 `502 DOCUMENT_CONVERSION_FAILED`，阶段或总时限耗尽返回 `504 DOCUMENT_CONVERSION_TIMEOUT` 或 `504 IMPORT_DEADLINE_EXCEEDED`。结构化模型不可用、调用失败或输出非法分别返回 `503 STRUCTURING_MODEL_UNAVAILABLE`、`502 STRUCTURING_MODEL_FAILED`、`422 RESUME_STRUCTURE_INVALID`。失败不创建半成品；已上传对象即时补偿，删除失败进入持久化清理队列。

## JD 数据模型与管理

JD 管理接口接受和返回最终结构化数据；单独的浏览器导入接口接受有限页面采集 DTO，并在同一请求中清洗为最终结构化数据。服务端不保存插件原始页面、抓取中间结果或模型过程数据。所有接口都要求当前登录用户，服务端从会话取得 `user_id`；不存在和不属于当前用户的记录统一返回 `404 JD_NOT_FOUND`。

| Method   | Path                                | 成功结果                                                                 |
| -------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `GET`    | `/api/job-descriptions`             | `{items, next_cursor}`，默认只列活动记录                                 |
| `POST`   | `/api/job-descriptions`             | 新建时 `201 {job_description}`；解决重复时 `200`                         |
| `POST`   | `/api/job-descriptions/import`      | 清洗 BOSS 页面采集字段；新建时 `201 {job_description}`，解决重复时 `200` |
| `GET`    | `/api/job-descriptions/:id`         | `{job_description}`                                                      |
| `PUT`    | `/api/job-descriptions/:id`         | `{job_description}`；请求含 `base_lock_version` 和至少一个可编辑字段     |
| `POST`   | `/api/job-descriptions/:id/archive` | `{job_description}`；请求含 `base_lock_version`                          |
| `POST`   | `/api/job-descriptions/:id/restore` | `{job_description}`；请求含 `base_lock_version`                          |
| `DELETE` | `/api/job-descriptions/:id`         | 仅归档记录返回 `{deleted: true}`，永久删除并释放来源唯一标识             |

列表查询支持 `scope=active|archived|all`、最长 200 字符的 `keyword`、不透明 `cursor` 和 `limit=1..100`。关键词忽略大小写，覆盖岗位名、公司名、城市、地址、正文和技能；分页按 `updated_at DESC, id DESC` 稳定排序。非法筛选或游标返回 `400 INVALID_JOB_QUERY`。

创建必填 `job_title`、`company_name`、`description` 和 `source_type=manual|external_import`。`external_import` 必须带 `http/https source_url`；服务端负责规范化 URL 并计算来源身份。当前 BOSS 直聘岗位链接提取 `/job_detail/{source_job_id}.html`，保存 `source_site=boss`、原生 `source_job_id`、规范化 `source_url` 及其 SHA-256；其他链接保存 `source_site=web` 和 URL 哈希。`source_type`、`source_site`、`source_job_id`、`source_url`、`source_url_hash`、`imported_at` 创建后均不可通过更新接口修改。

浏览器导入请求使用 `source_url` 和嵌套 `capture`。当前只接受 `zhipin.com` 的 `/job_detail/{source_job_id}.html`；`capture.job_title`、`capture.company_name`、`capture.description_text` 清洗后必须非空。可选采集字段包括 `skills`、就业类型原文、学历、经验、工作时间、城市、地址、薪资原文、公司字段/标签和招聘者字段。后端去除不可见字符、压缩空白、删除明确的详情标题与举报页尾，并确定性映射常见就业类型、远程/混合工作、`K·N薪` 和人民币时/日/月/年区间；无法可靠识别的字段保持为空，不做分析或模型推断。

导入请求字段非法、非 BOSS 详情 URL 或必填采集内容缺失时返回 `400 INVALID_JOB_IMPORT`。它与普通创建复用相同的 `JD_SOURCE_DUPLICATE`、`duplicate_resolution`、`JD_EDIT_CONFLICT` 和 `JD_WRITE_FAILED` 契约；插件不需要也不能提交 `user_id`、来源身份哈希或数据库字段。

同一用户的 `(source_site, source_job_id)` 或 `source_url_hash` 重复时返回 `409 JD_SOURCE_DUPLICATE`，响应 `duplicate` 包含现有摘要和可选动作。活动记录允许 `update|cancel`；归档记录允许 `restore|update|cancel`。`duplicate_resolution` 必须回传现有 `job_description_id` 和 `base_lock_version`：`restore` 只恢复原内容，`update` 用本次结构化内容更新原记录并在必要时恢复；两者都不创建第二条记录。普通更新、归档、恢复及重复解决使用 `lock_version`，并发过期返回 `409 JD_EDIT_CONFLICT`。

硬删除只允许 `archived_at` 非空的归档记录；活动记录（包括已恢复记录）返回 `409 JD_DELETE_REQUIRES_ARCHIVE` 且不产生删除副作用。删除语句同时约束记录 ID、当前用户和归档状态，因此记录在并发删除前恢复后不会被误删。不存在和不属于当前用户的记录仍返回 `404 JD_NOT_FOUND`。

技能以最多 100 个字符串的 JSON 数组保存，写入时去空和去重。数值薪资非空时必须同时给出三字母币种与计薪周期，最高值不得低于最低值。请求字段、长度或组合非法返回 `400 INVALID_JOB_DESCRIPTION`，来源非法返回 `400 INVALID_JOB_SOURCE`。福利、原始抓取数据和插件 API Key 不属于当前契约。

## 对象资源

原用户级 `/api/assets` 图片接口继续保留。新增简历级资源接口：

| Method   | Path                                  | 行为                                          |
| -------- | ------------------------------------- | --------------------------------------------- |
| `POST`   | `/api/resumes/:id/assets`             | 接收 `file_name/data_url`，写入简历私有前缀   |
| `GET`    | `/api/resumes/:id/assets/:asset_name` | 校验简历所有权后读取                          |
| `DELETE` | `/api/resumes/:id/assets/:asset_name` | 当前或历史快照仍引用时返回 `409 ASSET_IN_USE` |

删除简历会先同步删除导入原文件和简历资源前缀，全部成功后再删除数据库版本和简历；对象存储删除失败返回 `502 ASSET_DELETE_FAILED`，数据库记录保持不变。MinIO 与 MySQL 不构成原子事务，多个对象可能只删除一部分，对象已删除后的数据库提交失败也无法回滚对象。

## 大模型管理接口

以下接口只允许当前数据库用户的 `is_admin=true` 时访问。未登录返回 `401 UNAUTHORIZED`，普通用户返回 `403 FORBIDDEN`。本期不公开普通用户或第三方可调用的通用 chat、stream HTTP API；模型调用只作为 FastAPI 后端内部 Python 服务提供。

`users.is_admin` 不进入 access JWT 或 Redis 会话；管理员接口每次请求都从数据库读取该 `0/1` 标记，因此提权或降权对现有 Cookie 的下一次请求即时生效。公开注册始终创建普通用户。

管理员通过 `POST /api/auth/admin-login` 登录，后端额外校验 `is_admin=true` 后签发会话；普通用户调用返回 `403 FORBIDDEN`。管理端前端使用独立登录页 `/admin/login`（任何访问者可打开），通过 `api.me()` 恢复登录态后检查 `is_admin`；已登录管理员访问受保护页面（`/admin` 及其子页面）直接进入后台，未登录或无管理员身份的访问被重定向到登录页，登录成功后回到原目标，无法发起管理 API 调用。

| Method  | Path                                            | 成功结果                                                                       |
| ------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET`   | `/api/admin/llm/capabilities/chat`              | `{capability, activeModelId, activeModel, models}`，返回 Chat 当前项与候选列表 |
| `GET`   | `/api/admin/llm/catalog/chat`                   | `{capability, adapters}`，返回受支持 adapter 和 LiteLLM Chat 模型建议          |
| `POST`  | `/api/admin/llm/models`                         | `201 {model}`                                                                  |
| `PATCH` | `/api/admin/llm/models/:modelConfigId`          | `{model, validationCallId}`；编辑当前项时先测试拟议配置                        |
| `POST`  | `/api/admin/llm/models/:modelConfigId/test`     | `{ok: true, callId}`，测试指定配置                                             |
| `POST`  | `/api/admin/llm/models/:modelConfigId/activate` | `{activeModel, callId}`，测试成功后设为 Chat 当前模型                          |
| `GET`   | `/api/admin/llm/calls`                          | `{calls, summary, nextCursor}`                                                 |

Chat 是服务端预定义能力，管理员不填写能力标识。候选写入只接受 `adapter`、不含 adapter 前缀的 `model`、可选 `apiBase` 和只写 `apiKey`；服务端将 DeepSeek 示例组装成 `deepseek/deepseek-v4-flash`，将千问示例组装成 `dashscope/qwen-plus` 后传给 LiteLLM。目录响应使用稳定 adapter 代码，管理页面只展示供应商名称；目录建议来自锁定版本 LiteLLM 的 Chat 元数据，目录外调用名仍可提交并由真实连接测试兜底。旧 `enabled`、`priority` 和手工价格字段不再接受或返回。

候选读取只用 `keyConfigured` 表示是否已有凭据，绝不返回明文或数据库密文。PATCH 省略 `apiKey` 时保留原凭据，传 `null` 时清除，传非空字符串时替换。新增和编辑普通候选不会改变 Chat 当前项；启用操作先测试目标快照，成功后才切换，失败时原当前项不变。编辑当前候选也先测试拟议配置，测试或版本核对失败时不覆盖正在使用的版本。候选不提供硬删除或独立启停接口。

模型配置 `id`、调用记录 `userId` 和 `modelConfigId` 与其他 MySQL 业务 ID 一致，对外使用十进制字符串，内部数据库列仍为 `BIGINT UNSIGNED`。

`0006` 在数据库中使用中文表注释和字段注释，这些注释只用于说明持久化语义，不改变本节约定的 JSON 字段名、错误码或状态字面值。`0008` 增加候选的 `capability/adapter/model_call_name/config_version`、Chat 唯一当前绑定，以及调用日志的能力、来源和模型快照。升级会先按外键依赖顺序永久清空旧调用日志和模型配置，不转换旧优先级、价格或调用数据；完成后 Chat 当前绑定为空，需要管理员重新配置并设为当前模型。

调用记录可用 `source`、`status`、精确 `callId`、`userId`、`modelConfigId`、`from`、`to`、`cursor` 和 `limit` 查询，默认每页 50、最大 200，按创建时间和内部 ID 倒序稳定分页。`source` 是由内部调用方提供的稳定小写代码，格式为 `^[a-z][a-z0-9_]{0,31}$`；本期实际接入并保证产生的来源只有管理动作使用的 `connection_test`。时间范围使用带时区的 ISO 8601，区间为左闭右开；非法值、反向区间或无效游标返回 `400 INVALID_LLM_CALL_QUERY`。每条记录只包含调用标识、能力、来源、用户、实际 adapter/模型快照、状态、耗时、Token、LiteLLM 价格快照、估算成本和非敏感错误分类，不保存或返回消息、模型完整响应和凭据。汇总针对当前筛选条件聚合全部命中记录，只累加已知值，并用 `incompleteMeteringCount` 表明不完整计量。

管理错误包括 `INVALID_LLM_MODEL_CONFIG`、`INVALID_LLM_CALL_QUERY`、`LLM_MODEL_NOT_FOUND`、`LLM_MODEL_CONFIG_CHANGED`、`LLM_CHAT_NOT_CONFIGURED`、`LLM_CREDENTIALS_UNAVAILABLE`、`LLM_UNAVAILABLE` 和 `LLM_REQUEST_REJECTED`。连接测试、启用和当前项验证失败响应带可查询的 `callId`；供应商原始错误不会透传。

## 管理台用户管理

以下接口同样只允许 `is_admin=true` 访问。当前使用 `POST /api/auth/admin-login` 登录判定管理身份，管理台前端在 `/admin` 入口获得管理会话后调用管理端 API。

| Method  | Path                                    | 成功结果                                                                                                                       |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET`   | `/api/auth/admin/users`                 | `{items, total, page, size}`，支持 `q`（ID/邮箱/昵称模糊）、`status`（启用/禁用）、`role`（admin/user）筛选和 `page/size` 分页 |
| `GET`   | `/api/auth/admin/users/{userId}`        | 用户详情对象，含 `resume_count`（简历数）和 `llm_call_count`（LLM 调用量，当前为占位值 0）                                     |
| `PATCH` | `/api/auth/admin/users/{userId}/status` | `{ok: true, user, revoked_sessions}`；body 为 `{action: "disable" 或 "enable"}`                                                       |
| `GET`   | `/api/auth/admin/stats`                 | `{total_users, active_users_7d, total_resumes, llm_calls_today, estimated_cost_month}` 全系统概览统计；后两项当前为占位值      |

管理员禁用自己的账号返回 `422 CANNOT_SELF_DISABLE`；尝试禁用系统中最后一个管理员返回 `422 CANNOT_DISABLE_LAST_ADMIN`。禁用成功后服务端立即调用 `revoke_user_sessions` 删除该用户全部 Redis 会话，该用户的所有现有 Cookie 立即失效，重新登录时因用户 `status=0` 被拒绝。
