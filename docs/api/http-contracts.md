# HTTP 接口契约

本文记录当前调用方可观察的 HTTP 行为。全部 `/api` 路径由 FastAPI 提供，Swagger UI 位于 `/api/docs`，OpenAPI JSON 位于 `/api/openapi.json`。未匹配的 `/api` 路径返回 JSON 404，不会被 SPA fallback 转成 HTML。

客户端可以发送最长 64 字符、仅包含字母数字、下划线和连字符的 `X-Request-ID`；不合法或缺失时服务端生成新值。所有正常及受控错误响应回传最终 `X-Request-ID`。命中状态变更审计映射的响应还带 `X-Audit-Recorded: true|false`，表示本地日志 sink 是否接受该次审计；它不表示事件已经同步到 Loki。

## 健康检查与鉴权

`GET /api/health` 返回 `{status, service, version}`。`GET /api/auth/capabilities` 公开返回 `{password_login_enabled}`，Web 据此选择登录入口。普通用户邮箱密码登录仅在 `APP_ENV=development` 时开放；Production 的 `POST /api/auth/login` 返回 `404 NOT_FOUND`。普通邮箱注册、改密和微信绑定接口仍不公开；`POST /api/auth/register`、`POST /api/account/change-password` 和 `/api/account/wechat/bind-*` 在正常运行环境返回 `404 NOT_FOUND`，且不进入 OpenAPI。`POST /api/auth/admin-login` 保持独立，只允许管理员成功。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/auth/me` | `{user}`；Web Cookie 或小程序 Bearer 无效时为 `null` |
| `POST` | `/api/auth/admin-login` | `{user}`，管理员登录并签发 Web 双 Cookie |
| `POST` | `/api/auth/refresh` | `{user}`，轮换 Web refresh 并下发新双 Cookie |
| `POST` | `/api/auth/logout` | `{ok: true}`，撤销 Web session 并清除 Cookie |
| `POST` | `/api/auth/wechat/miniprogram/login` | `{user, access_token, refresh_token, expires_in}`；JSON `{code}` |
| `POST` | `/api/auth/wechat/miniprogram/refresh` | 同上；JSON `{refresh_token}`，成功后旧 refresh 立即失效 |
| `POST` | `/api/auth/wechat/miniprogram/logout` | `{ok: true}`；JSON `{refresh_token?}`，幂等撤销小程序 session |

会话统一保存为 Redis `auth:session:{sid}` hash 和 `auth:user_sessions:{uid}` 集合。Hash 包含 `uid`、refresh secret 哈希、`channel=web|miniprogram` 和创建时间；access JWT 同样携带 channel。Web 只接受 HttpOnly Cookie 中的 `channel=web` 凭据，小程序只接受 `Authorization: Bearer` 中的 `channel=miniprogram` 凭据；同时携带两种载体、JWT 与 Redis 的 uid/channel 不一致、session 被撤销或用户停用时均视为未登录。Refresh 每次轮换 secret，重放旧 refresh 会撤销整个 session。

微信 code 只由后端提交微信平台换取 openid。openid 不存在时自动创建 `email/password_hash` 为空的普通账号，存在时复用；唯一约束负责并发建号收敛。停用账号不能登录或续期；管理员账号即使历史上已有 openid，也不能通过扫码或小程序登录，只能使用 `/api/auth/admin-login`。小程序自动登录按来源 IP 限制为默认每分钟 30 次，超限返回 `429 WECHAT_RATE_LIMITED`。

### 网页扫码登录

| Method | Path | 成功结果 |
| --- | --- | --- |
| `POST` | `/api/auth/wechat/qrcode` | `{scene, poll_token, qr_base64}`；匿名，按 IP 限流；`poll_token` 只保留在创建二维码的网页 |
| `GET` | `/api/auth/wechat/status?scene=...&poll_token=...` | `{status, user?}`；`pending\|success\|cancelled\|expired`，success 且 poll token 匹配时设置 Web Cookie；不带 token 时只读状态 |
| `POST` | `/api/auth/wechat/confirm` | `{ok: true}`；小程序表单 `{scene, code}` |
| `POST` | `/api/auth/wechat/cancel` | `{ok: true, status: "cancelled"}`；小程序表单 `{scene}` |

scene 在 Redis 中按 `pending → processing → confirmed` 或 `pending → cancelled` 流转，默认 TTL 300 秒。确认使用原子 claim，只有一个请求执行微信换取；外部服务或无效 code 会由 claim 所有者恢复 `pending`，允许小程序取得新 code 后重试。processing 超过 30 秒视为遗留占用，可由新的确认请求原子接管；未超时的并发请求返回 `409 SCENE_IN_PROGRESS`。重复确认已确认场景幂等成功，终态保留到 TTL，不因重复请求删除。scene 供小程序确认并查询状态，独立 poll token 才允许 Web 领取会话，服务端只保存其哈希。Web 对已确认场景重复领取时会先发新 session、原子替换 scene 上的 `web_sid` 并撤销旧 sid，因此响应丢失可重试且同一 scene 最多保留一个有效 Web session；小程序无 poll token，不会误撤销网页会话。取消已确认场景返回冲突；未知或到期 scene 返回 `410 SCENE_EXPIRED`。

### 用户中心

`/api/account/*` 通过当前用户身份确定资源归属，不接受 `user_id`。当前公开接口为 profile、昵称和头像读写；Web 账号页不再显示密码或微信绑定入口。`user.email` 对微信用户为 `null`。最近简历仍按更新时间倒序返回最多 5 条。

## 语义简历契约

简历 API、Python DTO 和 TypeScript 类型统一使用 `snake_case`。数据库 ID 在 HTTP 中使用十进制字符串。`data` 是 `ResumeDocumentV1`，`style` 是 `ResumeStyleV1`，两者的 `schema_version` 当前均为字符串 `"1.0"`。`style.smart_one_page` 控制连续单页或标准 A4 导出模式，并随版本快照保存。旧 `markdown/settings/splitRatio/previewScale/lockVersion` 不再是简历写契约。

Alembic `0005` 将历史 `schema_version=1` 的 Tiptap 当前态和版本快照转换为上述 `"1.0"` 契约；这些迁移期旧 JSON 从未进入 API 响应，`0012` 删除其同行备份列，因此 HTTP 请求、响应和现有 `"1.0"` 数据保持不变。发布顺序仍为先迁移数据库、再启动新应用。

| Method   | Path                        | 鉴权 | 成功结果                                                         |
| -------- | --------------------------- | ---- | ---------------------------------------------------------------- |
| `GET`    | `/api/resume-templates`     | 是   | `{templates}` 启用且结构有效的模板列表                           |
| `GET`    | `/api/resume-templates/:id` | 是   | `{template}`                                                     |
| `GET`    | `/api/resumes`              | 是   | `{resumes}`，摘要含可选 `preview`，按更新时间倒序                |
| `POST`   | `/api/resumes`              | 是   | `201 {resume}`；请求必填 `{title, template_id}`                  |
| `GET`    | `/api/resumes/:id`          | 是   | `{resume}`                                                       |
| `PUT`    | `/api/resumes/:id`          | 是   | `{resume}`；请求含 `base_lock_version` 及可选 `title/data/style` |
| `DELETE` | `/api/resumes/:id`          | 是   | `{deleted}`                                                      |

所有新简历都从模板创建，官方模板中包含空白简历模板。普通创建先把名称去首尾空白、折叠连续空白，再按 Unicode `casefold` 比较同一用户已有名称；重复返回 `409 RESUME_TITLE_CONFLICT`，名称为空或超过 255 字符返回 `400 INVALID_RESUME_TITLE`，缺模板返回 `400 TEMPLATE_REQUIRED`，模板不存在、停用或结构无效返回 `422 TEMPLATE_INACTIVE`。历史无模板简历继续可读写，历史重名不回填也不阻止保持原名。

每个用户最多保存 10 份正式简历；创建事务锁定用户行后检查，达到上限返回 `409 RESUME_LIMIT_REACHED`。创建在同一事务写入当前简历及 `version_no=1/reason=initial` 快照。更新同时保存完整 data/style 并递增 `lock_version`，不创建历史版本；过期基准返回 `409 RESUME_EDIT_CONFLICT`。非法内容和样式分别返回 `400 INVALID_RESUME_DOCUMENT`、`400 INVALID_RESUME_STYLE`。不存在或不属于当前用户的简历统一返回 `404 RESUME_NOT_FOUND`。

## 历史版本

| Method   | Path                                            | 鉴权 | 成功结果                                               |
| -------- | ----------------------------------------------- | ---- | ------------------------------------------------------ |
| `GET`    | `/api/resumes/:id/versions`                     | 是   | `{versions}`，版本号倒序                               |
| `POST`   | `/api/resumes/:id/versions`                     | 是   | `201 {version}`，创建 `manual` 快照                    |
| `GET`    | `/api/resumes/:id/versions/:version_no`         | 是   | `{version}` 完整快照                                   |
| `DELETE` | `/api/resumes/:id/versions/:version_no`         | 是   | `{deleted}`；删除指定旧版本                            |
| `POST`   | `/api/resumes/:id/versions/:version_no/restore` | 是   | `{resume}`；按需追加 `before_restore` 后追加 `restore` |

版本号单调递增且不复用；每份简历默认最多保存 10 个版本。创建或恢复所需的版本空间不足时返回 `409 RESUME_VERSION_LIMIT_REACHED`，不会自动删除任何历史版本；用户删除旧版本后才能继续。最新版本作为当前恢复基准不可删除，尝试删除返回 `409 LATEST_RESUME_VERSION_REQUIRED`。版本不存在返回 `404 RESUME_VERSION_NOT_FOUND`，并发兜底失败返回 `409 VERSION_CONFLICT`。

## 简历分享链接

每份简历一个分享链接，分享状态直接落在 `resumes` 表的 `share_*` 字段，不单独建表。分享内容不落快照：公开读取时实时取 `resume_versions` 中 `version_no` 最大的正式版本，所有者继续编辑的是快照草稿，不会影响已分享内容之外的版本语义。管理接口全部要求登录且只能操作本人简历（`404 RESUME_NOT_FOUND`）；公开接口 `/api/share/{token}` 允许未登录访问。

| Method   | Path                  | 鉴权 | 成功结果                                                                 |
| -------- | --------------------- | ---- | ------------------------------------------------------------------------ |
| `GET`    | `/api/resumes/:id/share`    | 是   | `{share}`；未开启分享时 `share` 为 `null`                        |
| `POST`   | `/api/resumes/:id/share`    | 是   | `{share}`；请求可选 `{visibility, expires_at}`，无链接时创建，已有链接时作废旧 token 并生成新 token（一键覆盖） |
| `PATCH`  | `/api/resumes/:id/share`    | 是   | `{share}`；请求可选 `{visibility, expires_at}`，可续期或改为仅自己可见     |
| `DELETE` | `/api/resumes/:id/share`    | 是   | `{deleted: true}`；清空分享字段，旧地址访问统一失效，重复删除幂等          |
| `GET`    | `/api/share/{token}`        | 否   | `{data, style, sharer}`；`sharer` 为 `{nickname, avatar_url}`             |

`share` 为 `{share_token, share_visibility, share_expires_at, share_created_at}`。`share_visibility` 只允许 `public|private`，`share_expires_at` 为带时区的 ISO 8601，`null` 表示长期有效；`private` 时只有分享者本人登录可见，未登录或其他用户访问一律按失效处理。

`POST` 创建或覆盖请求可选 `{visibility, expires_at}` 分别指定可见性（缺省 `public`）与有效期（缺省永久，即 `expires_at` 为 `null`）。`PATCH` 用 `model_fields_set` 区分传入字段，可单独续期（延长或清除 `expires_at`）或切换可见性；未开启分享时返回 `404 SHARE_LINK_UNAVAILABLE`。token 使用 `secrets.token_urlsafe(16)`（约 160 bit 熵）且全局唯一，冲突重试 3 次。为避免枚举探测，以下场景在管理侧与公开侧统一返回 `404 SHARE_LINK_UNAVAILABLE`：token 不存在、已删除、已过期、`private` 无权查看、简历或最新版本不存在。过期后可再次 `PATCH expires_at` 恢复访问，不需重建链接。

## 文件导入

`POST /api/resumes/import` 使用 `multipart/form-data`，必填规范十进制字符串 `template_id` 与 `file`，不接收目标名称，并要求 `Idempotency-Key` Header 为小写、带连字符的 canonical UUID。接口只完成校验、源文件上传、任务持久化和消息确认；首次受理成功返回 `202`，不等待转换或结构化：

```json
{
  "import": {
    "id": "42",
    "source_filename": "resume.pdf",
    "source_file_format": "pdf",
    "upload_status": "succeeded",
    "upload_duration_ms": 83,
    "parse_status": "processing",
    "parse_duration_ms": null,
    "result_resume_id": null,
    "created_at": "2026-08-08T12:00:00Z",
    "updated_at": "2026-08-08T12:00:00Z"
  }
}
```

RabbitMQ 是默认 Broker，使用固定 `resume.import` routing key；Kafka 兼容实现使用规范 `import_id` 作为消息 key。独立 Worker 从私有对象存储读取文件，Markdown 本地转换、DOCX 经 Mammoth、PDF 经 LinkParse，再走 `SectionIR → ResumeExtractionDraft → ResumeDocumentV1`。解析成功时以安全化文件名的 stem 作为标题，允许与已有简历同名；解析内容作为 data，所选模板只提供 style。正式简历、initial 版本、结果关联和任务成功状态在一个数据库事务内提交。

缺少或使用非 canonical Header 返回 `400 INVALID_IDEMPOTENCY_KEY`。同一用户、Key 和请求指纹在 15 分钟映射窗口内重放同一导入记录：活动状态返回 `202`，成功终态返回 `200`，失败终态返回 `409 IMPORT_PREVIOUSLY_FAILED`；同 Key 异指纹返回 `409 IDEMPOTENCY_KEY_REUSED`。记录绑定前的短窗口返回 `409 IMPORT_ACCEPTANCE_IN_PROGRESS`，Redis 不可用返回 `503 IMPORT_IDEMPOTENCY_UNAVAILABLE`。记录创建后的错误响应在顶层 `import` 字段附带同一任务摘要。

`GET /api/resume-overview` 返回 `{resumes, active_imports, failed_imports, next_failed_cursor}`；失败列表支持 `failed_limit=1..50` 和服务端生成的 `failed_cursor`。Web 仅在存在活动任务时每 2 秒刷新，成功任务在同一 overview 快照中由正式简历替换。`DELETE /api/resume-imports/:id` 只允许本人删除上传或解析失败记录；活动任务返回 `409 RESUME_IMPORT_IN_PROGRESS`，不存在、非法 ID 或越权统一返回 `404 RESUME_IMPORT_NOT_FOUND`，对象删除失败返回 `502 ASSET_DELETE_FAILED`。

文件或模板无效时返回对应 `4xx` 且不创建正式简历。MinIO 上传失败会补偿删除可能写入的对象，再返回 `502 RESUME_SOURCE_UPLOAD_FAILED` 并保留上传失败记录；MQ confirm 失败返回 `503 RESUME_IMPORT_QUEUE_UNAVAILABLE`，记录保存为“上传成功、解析失败”。转换、结构化或模板复核失败由 Worker 保存解析失败终态，不创建半成品，也不自动重试业务失败。正式简历与活动导入共享每用户 10 个名额；成功导入只是把活动占位转换为正式简历。

## 简历模板管理

`/api/admin/resume-templates` 只允许管理员访问。`GET` 返回启用、停用和结构无效的全部模板；`POST /import` 接受最大 512 KiB 的严格 UTF-8 JSON 模板包，新模板默认停用且相同 `key` 返回 `409 TEMPLATE_KEY_CONFLICT`，不覆盖已有模板；`PUT /:id/status` 幂等启停，结构无效模板不能启用。模板包拒绝未知字段、脚本、外链、文件 URL、本地路径和媒体引用。当前不提供模板覆盖或硬删除。

## 知识库资料

`POST /api/datasets` 使用 `multipart/form-data`，字段为 `file`，支持 docx/pdf/md/txt 四种格式（按扩展名判定、大小写不敏感），单文件上限 `DATASET_UPLOAD_MAX_BYTES`（默认 10MB）。上传成功后文件保存到对象存储（对象键由服务端生成并强制以 `users/{当前用户id}/datasets/` 为前缀，客户端不可指定），元信息写入 `user_dataset` 表并返回：

```json
{
  "id": "1",
  "file_name": "notes.md",
  "file_format": "md",
  "file_size": 12,
  "created_at": "…"
}
```

`GET /api/datasets` 返回当前登录用户自己的资料记录，按上传时间倒序（`{datasets: [...]}`）。两个接口都要求登录（未登录返回 `401 UNAUTHORIZED`），用户只能看到自己的记录。响应不包含对象存储路径、内容摘要（sha256）等内部字段。

文件名非法返回 `400 INVALID_DATASET_FILENAME`，空文件返回 `400 EMPTY_DATASET_FILE`，不支持格式返回 `400 UNSUPPORTED_DATASET_FORMAT`，超过大小上限返回 `413 DATASET_TOO_LARGE`。对象存储上传失败返回 `502 DATASET_UPLOAD_FAILED` 且不落库；对象已上传但元信息写入失败返回 `500 DATASET_RECORD_FAILED`，已上传对象会被尽力清理。同一文件允许重复上传并生成新记录（不做去重或幂等）。

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

删除简历会先同步删除该简历保存的导入源文件和简历资源前缀，全部成功后再删除数据库版本和简历；对象存储删除失败返回 `502 ASSET_DELETE_FAILED`，数据库记录保持不变。MinIO 与 MySQL 不构成原子事务，多个对象可能只删除一部分，对象已删除后的数据库提交失败也无法回滚对象。

## 系统日志与业务审计

以下上报接口只允许已登录用户访问。浏览器不直接连接 Loki，不提交 label 或 LogQL：

| Method | Path | 请求 | 成功结果 |
| --- | --- | --- | --- |
| `POST` | `/api/observability/client-events` | `{event_type, error_name, message, stack?, request_id?}` | `202 {accepted: true, eventId}` |
| `POST` | `/api/audit/events` | `{action: "resume.pdf_export", target_type: "resume", target_id, result, error_code?}` | `202 {accepted: true, eventId}` |

`event_type` 只允许 `unhandled_error`、`unhandled_rejection`、`render_error` 和 `api_5xx`。服务端从当前会话绑定 actor，忽略客户端提供身份；消息和栈经统一长度限制与脱敏后写入系统日志。请求非法返回 `400 INVALID_CLIENT_LOG_EVENT`，本地 sink 拒绝写入返回 `503 LOG_EVENT_UNAVAILABLE`。

PDF 导出审计只接受当前用户拥有的简历 ID；不存在或不属于当前用户都返回 `404 RESUME_NOT_FOUND`，非法动作或字段返回 `400 INVALID_AUDIT_EVENT`，sink 拒绝写入返回 `503 AUDIT_EVENT_UNAVAILABLE`。其他审计动作不能通过该接口伪造，而是由服务端路由映射自动生成。自动审计覆盖鉴权/会话、账号资料和密码、简历/版本/资源、JD、管理员用户状态和模型配置等状态变更；普通 GET 不写审计。成功和受控失败都记录 action、可信 actor、target、result、错误码和 request ID，不记录请求 body。审计进入共享 Loki，不新增 MySQL 审计表；现有 `/api/admin/llm/calls` 继续是 LLM 计量和调用状态的事实源。

管理员日志查询接口复用 `is_admin=true` 权限；未登录返回 `401 UNAUTHORIZED`，普通用户返回 `403 FORBIDDEN`：

| Method | Path | 查询参数 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/logs/system` | `from`、`to`、`level`、`source`、`dependency`、`requestId`、`taskId`、`operationId`、`errorCode`、`keyword`、`cursor`、`limit` | `{items, nextCursor, partial, droppedMalformed}` |
| `GET` | `/api/admin/logs/audit` | `from`、`to`、`action`、`actorUserId`、`targetType`、`targetId`、`result`、`requestId`、`cursor`、`limit` | 同上 |
| `GET` | `/api/admin/logs/summary` | `from`、`to` | `{system: {total, warnings, errors}, audit: {total, succeeded, failed}}` |

时间使用带时区 ISO 8601，默认最近 24 小时，最大跨度七天；`limit` 默认 50、最大 200。系统依赖筛选只允许 `mysql|redis|minio|linkparse|llm`，审计 action 只允许服务端已注册动作。游标不透明；非法筛选分别返回 `400 INVALID_SYSTEM_LOG_QUERY`、`INVALID_AUDIT_LOG_QUERY` 或 `INVALID_LOG_SUMMARY_QUERY`。查询固定使用 `service=linkcv`、当前环境和日志类型，不接受任意 selector。历史脏行会被丢弃并通过 `partial/droppedMalformed` 告知调用方；重复 `event_id` 在返回前去重。Loki 未配置、超时、网络或响应异常统一返回 `503 LOG_QUERY_UNAVAILABLE`，不能伪装为空结果。

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

## 浏览器插件发布与下载

插件发布复用现有私有 MinIO，不返回对象存储地址。以下读取和下载接口要求普通登录会话，所有 `/api/admin/plugin-releases` 接口要求 `is_admin=true`：

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/plugin-releases/current` | `200 {status, release}`；未发布为 `{status: "unpublished", release: null}`，可用 release 含 `version`、`released_at`、`browser`、`manifest_version`、`size`、`sha256`、`download_url` |
| `GET` | `/api/plugin-releases/{version}/download` | 当前版本匹配时返回名为 `linkcv-job-capture-v<version>.zip` 的 `200 application/zip` 附件流，带 `Content-Length`、SHA-256 `ETag`、`private, no-store` 和 `nosniff` |
| `GET` | `/api/admin/plugin-releases/current` | `200 {status, release}`；管理员状态为 `absent/published/unpublished`，已下架时仍返回保留版本信息 |
| `POST` | `/api/admin/plugin-releases` | multipart 字段 `file` 接收一个 ZIP，校验并发布成功返回 `201 {release, cleanup_pending}`；新版生效后自动删除其他版本 ZIP |
| `DELETE` | `/api/admin/plugin-releases/current` | 下架当前插件并返回 `200 {unpublished: true, release}`；把 current 指针状态改为 `unpublished`，保留当前唯一版本信息和 ZIP |
| `POST` | `/api/admin/plugin-releases/current/publish` | 重新上架已下架插件并返回 `200 {release}`；复用保留的 ZIP，不需要重新上传 |
| `DELETE` | `/api/admin/plugin-releases/current/package` | 永久删除当前 ZIP 和 current 指针并返回 `200 {deleted: true}`；操作不可恢复 |

current 或下载读取存储失败、指针/对象大小或摘要非法时返回 `503`，不会返回旧缓存或 MinIO URL。下载版本不是当前版本时返回 `409 PLUGIN_RELEASE_VERSION_CHANGED`，非法或未发布版本返回 `404 PLUGIN_RELEASE_NOT_FOUND`。

上传只接受最大 20 MiB 的 ZIP。压缩包、Manifest、离线说明或环境权限不合法返回 `422 PLUGIN_RELEASE_*`；超过上限返回 `413 PLUGIN_RELEASE_TOO_LARGE`；版本降级、同版本不同内容或当前对象冲突返回 `409`；新对象或指针写入失败返回 `503`，当前指针和旧版保持原值。指针成功切换后，服务端删除 `system/plugin-releases/` 下除 current 引用对象外的其他 ZIP；清理失败不回滚已经生效的新版本，响应为 `cleanup_pending=true`，管理端提示待重试，后续上传会重新清理。前端不得从文件名推断版本或环境，也不得自行拼接存储路径。

下架必须二次确认。没有 current 指针或指针已经是 `unpublished` 时返回 `404 PLUGIN_RELEASE_NOT_FOUND`；状态指针写入失败返回 `503 PLUGIN_RELEASE_UNPUBLISH_FAILED`，当前发布状态保持不变。成功下架后 current 查询返回 unpublished，当前唯一版本下载关闭；`current.json` 和该版本 ZIP 继续保留。保留的版本仍作为后续发布下限，同版本同摘要安装包可以重新上架；上架和下架都不创建第二个版本。

重新上架只接受 `unpublished` 指针：没有 current 指针返回 `404`，已经上架返回 `409 PLUGIN_RELEASE_ALREADY_PUBLISHED`，保留 ZIP 缺失或校验不一致返回 `503`。永久删除也必须二次确认；若插件仍已上架，服务端先把指针改为 `unpublished` 以关闭下载，再依次删除 ZIP 和 `current.json`。任一步骤失败返回 `503 PLUGIN_RELEASE_DELETE_FAILED`，保留 unpublished 状态供管理员安全重试；没有 current 指针返回 `404`。

Development 与 Production 使用独立 MinIO。各自 Bucket 内的当前指针固定为 `system/plugin-releases/current.json`，版本对象固定为 `system/plugin-releases/v<version>/linkcv-job-capture-v<version>.zip`；对象键不重复携带环境名。服务端新写的指针使用 `schema_version=3` 并显式包含 `status=published|unpublished`；读取兼容既有不含 `status` 的 v2 指针，并按已发布处理。
