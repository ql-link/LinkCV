# HTTP 接口契约

本文记录当前调用方可观察的 HTTP 行为。全部 `/api` 路径由 FastAPI 提供，Swagger UI 位于 `/api/docs`，OpenAPI JSON 位于 `/api/openapi.json`。未匹配的 `/api` 路径返回 JSON 404，不会被 SPA fallback 转成 HTML。

客户端可以发送最长 64 字符、仅包含字母数字、下划线和连字符的 `X-Request-ID`；不合法或缺失时服务端生成新值。所有正常及受控错误响应回传最终 `X-Request-ID`。命中状态变更审计映射的响应还带 `X-Audit-Recorded: true|false`，表示本地日志 sink 是否接受该次审计；它不表示事件已经同步到 Loki。

## 健康检查与鉴权

`GET /api/health` 返回 `{status, service, version}`。`GET /api/auth/capabilities` 公开返回 `{password_login_enabled}`，Web 据此选择普通邮箱密码入口。普通用户邮箱密码登录和注册仅在 `APP_ENV=local|development` 时开放；Production 的 `POST /api/auth/login` 与 `POST /api/auth/register` 都返回 `404 NOT_FOUND`。普通改密和微信绑定接口仍不公开；`POST /api/account/change-password` 和 `/api/account/wechat/bind-*` 在正常运行环境返回 `404 NOT_FOUND`。这些环境受限路由不进入 OpenAPI。`POST /api/auth/admin-login` 保持独立，只允许管理员成功。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/auth/me` | `{user}`；只识别 Web Cookie，无效 Cookie 或小程序 Bearer 均返回 `user: null` |
| `POST` | `/api/auth/register` | `201 {user}`；仅 local/development，JSON `{email, password}`，成功后签发 Web 双 Cookie |
| `POST` | `/api/auth/login` | `{user}`；仅 local/development，JSON `{email, password}`，成功后签发 Web 双 Cookie |
| `POST` | `/api/auth/admin-login` | `{user}`，管理员登录并签发 Web 双 Cookie |
| `POST` | `/api/auth/refresh` | `{user}`，轮换 Web refresh 并下发新双 Cookie |
| `POST` | `/api/auth/logout` | `{ok: true}`，撤销 Web session 并清除 Cookie |
| `POST` | `/api/auth/wechat/miniprogram/account-status` | `{registered}`；JSON `{code}`，只判断当前微信身份是否已有账号，不建号、不签发会话 |
| `POST` | `/api/auth/wechat/miniprogram/login` | `{user, access_token, refresh_token, expires_in}`；JSON `{code, privacy_accepted?}`，未知 openid 建号时该值必须为 `true` |
| `POST` | `/api/auth/wechat/miniprogram/refresh` | 同上；JSON `{refresh_token}`，成功后旧 refresh 立即失效 |
| `POST` | `/api/auth/wechat/miniprogram/logout` | `{ok: true}`；JSON `{refresh_token?}`，幂等撤销小程序 session |

会话统一保存为 Redis `auth:session:{sid}` hash 和 `auth:user_sessions:{uid}` 集合。Hash 包含 `uid`、refresh secret 哈希、`channel=web|miniprogram` 和创建时间；access JWT 同样携带 channel。Web 只接受 HttpOnly Cookie 中的 `channel=web` 凭据，小程序只接受 `Authorization: Bearer` 中的 `channel=miniprogram` 凭据；同时携带两种载体、JWT 与 Redis 的 uid/channel 不一致、session 被撤销或用户停用时均视为未登录。为兼容本功能上线前已签发的 Web 会话，缺少 channel 的旧 JWT/Redis session 仅按 Web 凭据接受，并在 refresh 轮换时补写 `channel=web`；它不会被小程序接口接受。Refresh 每次轮换 secret，重放旧 refresh 会撤销整个 session。

微信 code 只由后端提交微信平台换取 openid。`/api/auth/wechat/miniprogram/account-status` 使用当前 `wx.login` code 返回该 openid 是否已有关联账号，只返回布尔值，不创建用户、不更新登录时间、不签发会话；它与小程序登录共用来源 IP 默认每分钟 30 次的限流。openid 已存在时登录接口直接复用；不存在时，`/api/auth/wechat/confirm` 和 `/api/auth/wechat/miniprogram/login` 只有在收到 `privacy_accepted=true` 后才创建 `email/password_hash` 为空的普通账号，缺失或为 `false` 时返回 `400 PRIVACY_AGREEMENT_REQUIRED`，唯一约束负责并发建号收敛。该字段只表示本次注册请求已经通过客户端确认门禁，不是服务端持久化的同意审计记录。随仓库发布的小程序在调用建号接口或确认扫码前，还必须展示微信平台隐私保护指引、取得页面复选框确认和用户主动点击（未勾选时在协议区行内提示，不弹系统窗）；账号状态探测和登录请求只能出现在用户主动进入登录页之后，游客首页不发起任何认证请求；登录或确认成功后客户端先展示完成提示再进入简历页；简历页与请求重试路径只能以 `privacy_accepted=false` 尝试恢复已有账号，不能静默触发首次建号。停用账号不能登录或续期；管理员账号即使历史上已有 openid，也不能通过扫码或小程序登录，只能使用 `/api/auth/admin-login`。超出上述限流时返回 `429 WECHAT_RATE_LIMITED`。

### 网页扫码登录

| Method | Path | 成功结果 |
| --- | --- | --- |
| `POST` | `/api/auth/wechat/qrcode` | `{scene, poll_token, qr_base64}`；匿名，按 IP 限流；`poll_token` 只保留在创建二维码的网页 |
| `GET` | `/api/auth/wechat/status?scene=...&poll_token=...` | `{status, user?}`；`pending\|success\|cancelled\|expired`，success 且 poll token 匹配时设置 Web Cookie；不带 token 时只读状态 |
| `POST` | `/api/auth/wechat/confirm` | `{ok: true}`；小程序表单 `{scene, code, privacy_accepted?}`，未知 openid 建号时该值必须为 `true` |
| `POST` | `/api/auth/wechat/cancel` | `{ok: true, status: "cancelled"}`；小程序表单 `{scene}` |

scene 在 Redis 中按 `pending → processing → confirmed` 或 `pending → cancelled` 流转，默认 TTL 300 秒。确认使用原子 claim，只有一个请求执行微信换取；外部服务或无效 code 会由 claim 所有者恢复 `pending`，允许小程序取得新 code 后重试。processing 超过 30 秒视为遗留占用，可由新的确认请求原子接管；未超时的并发请求返回 `409 SCENE_IN_PROGRESS`。重复确认已确认场景幂等成功，终态保留到 TTL，不因重复请求删除。scene 供小程序确认并查询状态，独立 poll token 才允许 Web 领取会话，服务端只保存其哈希。Web 对已确认场景重复领取时会先发新 session、原子替换 scene 上的 `web_sid` 并撤销旧 sid，因此响应丢失可重试且同一 scene 最多保留一个有效 Web session；小程序无 poll token，不会误撤销网页会话。取消已确认场景返回冲突；未知或到期 scene 返回 `410 SCENE_EXPIRED`。

### 小程序只读简历

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/miniprogram/resumes` | `{resumes}`；本人简历摘要，按更新时间倒序；`preview` 与 `pdf_version_id/pdf_version_no` 来自最新手动版本，无手动版本时来自初始版本 |
| `GET` | `/api/miniprogram/resumes/:id` | `{resume}`；返回本人当前可读正式版本及 PDF 版本标识，不返回自动保存草稿；不存在或越权统一 `404 RESUME_NOT_FOUND` |
| `GET` | `/api/miniprogram/resumes/:id/pdf?version_id=...` | 当前可读正式版本的文字 PDF；`version_id` 必须仍等于最新可读版本，响应 `application/pdf`、`private, no-store` 并携带版本响应头 |
| `GET` | `/api/miniprogram/resumes/:id/preview.png?version_id=...` | 当前可读正式版本的智能一页 PNG；响应 `image/png`、`private, no-store` 并携带版本响应头，供小程序在当前页面内显示和本机缓存 |
| `GET` | `/api/miniprogram/account/profile` | `{nickname, avatar_url}`；本人资料，`avatar_url` 恒为 `/api/miniprogram/account/avatar` 或 `null` |
| `PATCH` | `/api/miniprogram/account/profile` | 同上；JSON `{nickname}`，去空白后非空且不超过 50 字，否则 `400 INVALID_NICKNAME` |
| `PUT` | `/api/miniprogram/account/avatar` | `{url}`；JSON `{dataUrl, fileName?}`，复用 `/api/account/avatar` 的解码、10MB 上限与 MinIO 归属键规则，替换后删除旧头像对象 |
| `GET` | `/api/miniprogram/account/avatar` | 本人头像二进制流（`image/*`、`private`）；无头像返回 `404 ASSET_NOT_FOUND`。普通 `/api/assets/*` 仍只接受 Web Cookie，小程序只能经此专用端点读取头像 |

四个端点只接受小程序 Bearer，不接受 Web Cookie；小程序 Bearer 也不能调用普通 `/api/resumes*` 读写接口。预览选择最新 `reason=manual` 快照，没有手动版本时回退 `reason=initial`；客户端版本过期或无可读版本返回 `409 RESUME_VERSION_UNAVAILABLE`。服务端按请求启动一次性 Node 渲染进程，强制智能一页，从该版本真实引用且通过用户/简历对象键校验的 PNG/JPEG 私有图片构造输入；`preview.png` 再用 PDFium 把单页 PDF 栅格化为宽度不超过 1440 像素的 PNG。PDF 和 PNG 都只保留在请求内存，不写 MySQL、MinIO 或服务端文件缓存。输入、页面尺寸、像素数和输出大小都有上限；渲染脚本缺失、超时、异常退出、非法 PDF 或栅格化失败以稳定的 4xx/503 错误收口。

### 用户中心

`/api/account/*` 通过当前用户身份确定资源归属，不接受 `user_id`。当前公开接口为 profile、昵称和头像读写；Web 账号页不再显示密码或微信绑定入口。`user.email` 对微信用户为 `null`。最近简历仍按更新时间倒序返回最多 5 条。

## 语义简历契约

简历 API、Python DTO 和 TypeScript 类型统一使用 `snake_case`。数据库 ID 在 HTTP 中使用十进制字符串。运行期只接受字段完整的 `ResumeDocument data` 与 `ResumePresentation style`，不再携带或协商 `schema_version`；缺少 `semantic_sections` 或 `manifest` 的请求不会被静默补齐。`data.semantic_sections` 把用户可见标题、稳定语义类型、来源、置信度和真实内容引用分离保存，每份实际内容必须被恰好引用一次；编辑器章节使用独立 `blk_*` ID，标题改名不改变章节身份。已进入编辑器的章节正文以受控 `{format: "tiptap-json", content: JSONContent}` 保存，保留段落、列表、双列、信息行、图片、对齐和富文本 marks；历史 `{format: "markdown", content: string}` 只作为兼容输入继续可读，首次正文保存后转成规范 Tiptap JSON。页级 `sidebar/main` 属于 `style.manifest` 投影，禁止作为正文持久化；`profile`、`interests` 等侧栏内容仍是独立语义章节。`style.manifest` 只允许受控 renderer、区域、插槽、唯一自定义兜底区和头像策略。简历正文以用户内容为准：错别字、非标准邮箱或电话、无法识别或先后矛盾的日期、缺少单位或职位等内容质量问题不阻断保存、导入或版本恢复；可识别日期仍会规范化，无法识别的日期原样保留。字段类型、总量和长度上限、URL 协议、Markdown 主动内容、Tiptap 节点/marks/属性白名单及内部 ID 完整性仍严格校验。`style.smart_one_page` 控制连续单页或标准 A4 导出模式，并随版本快照保存。旧 `markdown/settings/splitRatio/previewScale/lockVersion` 不再是简历写契约。

Alembic `0036` 在写入前预检全部模板、当前简历和历史版本，把旧 `"1.0"` JSON 一次性转换为上述唯一契约；`0037`–`0040` 依次拆分官方编辑 Markdown、移除 typed 副本、规范区块 ID 并修正双栏插槽。`0041` 再对模板、当前简历和历史版本全量预检，把旧整篇编辑正文及跨章节残留的 `sidebar/main` 页级包装转换为无投影语义块，保留可见文字与私有用户头像，并为双栏 manifest 补齐 `profile/interests` 路由；写后重复完整校验。`0042` 恢复经典技术模板及既有快照的生产页边距并删除 `blank-cn`，历史简历依靠 `ON DELETE SET NULL` 只清空来源引用。发布顺序仍为停止旧写入、备份、执行迁移、验证后启动新应用；失败时依赖备份恢复，不执行 downgrade。

| Method   | Path                        | 鉴权 | 成功结果                                                         |
| -------- | --------------------------- | ---- | ---------------------------------------------------------------- |
| `GET`    | `/api/resume-templates`     | 是   | `{templates}` 启用且结构有效的模板列表                           |
| `GET`    | `/api/resume-templates/:id` | 是   | `{template}`                                                     |
| `GET`    | `/api/resumes`              | 是   | `{resumes}`，摘要含可选 `preview`，按更新时间倒序                |
| `POST`   | `/api/resumes`              | 是   | `201 {resume}`；请求必填 `{title, template_id}`                  |
| `GET`    | `/api/resumes/:id`          | 是   | `{resume}`                                                       |
| `POST`   | `/api/resumes/:id/semantic-classification` | 是 | 对当前自定义章节返回 `{content_hash, suggestions}`，不写入简历 |
| `PUT`    | `/api/resumes/:id`          | 是   | `{resume}`；请求含 `base_lock_version` 及可选 `title/data/style` |
| `POST`   | `/api/resumes/:id/apply-template` | 是 | `{resume}`；请求含 `{template_id, base_lock_version}` 及可选 `title/data`，原子保存最新内容并切换模板 |
| `GET`    | `/api/resumes/:id/pdf?lock_version=...` | 是 | 当前 Web 快照的 PDF；版本不一致返回 `409 RESUME_PDF_SNAPSHOT_STALE` |
| `DELETE` | `/api/resumes/:id`          | 是   | `{deleted}`                                                      |

所有新简历都从当前启用的非空白模板创建；历史 `blank-cn` 已由 `0042` 退役并删除。普通创建先把名称去首尾空白、折叠连续空白，再按 Unicode `casefold` 比较同一用户已有名称；重复返回 `409 RESUME_TITLE_CONFLICT`，名称为空或超过 255 字符返回 `400 INVALID_RESUME_TITLE`，缺模板返回 `400 TEMPLATE_REQUIRED`，模板不存在、停用或结构无效返回 `422 TEMPLATE_INACTIVE`。历史无模板简历继续可读写，历史重名不回填也不阻止保持原名。

模板切换使用独立原子接口，不通过普通 `PUT` 猜测模板身份。旧调用方可只发送模板 ID 和锁版本；Web 同时发送当前 `title/data`，服务端验证简历归属、目标模板启用状态、完整快照和内容 ID 到目标插槽的唯一组合计划后，在同一条件更新中保存最新标题与正文、替换目标模板 `style`、写入 `template_id` 并递增 `lock_version`。目标模板只提供呈现，不能用自己的示例正文覆盖用户数据。过期基准返回 `409 RESUME_EDIT_CONFLICT`，标题冲突返回 `409 RESUME_TITLE_CONFLICT`，模板不存在、停用或结构无效返回 `422 TEMPLATE_INACTIVE`，内容无法完整且唯一地映射到目标模板时返回 `422 TEMPLATE_COMPOSITION_INVALID`；任一失败都不产生“内容已保存但模板未切换”或相反的半状态。

语义分类请求携带当前规范 `data` 的 `sha256:` 内容哈希和可选章节 ID 列表。分类器只接收自定义章节的标题、正文和相邻标题，必须综合上下文，不在模板切换时调用，也不改写正文或持久化建议；相同用户、简历、内容哈希和章节集合的成功结果在 Redis 缓存 1 小时，重复请求不重复调用模型；响应包含稳定章节 ID、建议类型、置信度和依据。内容已变化返回 `409 RESUME_SEMANTIC_CLASSIFICATION_STALE`，章节选择非法返回 `400 INVALID_RESUME_SEMANTIC_CLASSIFICATION`，模型不可用或返回越界 ID 返回 `503 RESUME_SEMANTIC_CLASSIFICATION_UNAVAILABLE`。未登录返回 `401 UNAUTHORIZED`，不存在或越权统一返回 `404 RESUME_NOT_FOUND`。

Web PDF 请求必须携带当前保存成功后的 `lock_version`。服务端再次校验 Cookie 用户、简历归属和版本，然后以当前 `data/style` 快照调用受控 Chromium；成功响应为 `application/pdf`、`private, no-store`，并携带 `Content-Disposition`、`X-LinkCV-Pdf-Lock-Version` 和 `X-Content-Type-Options: nosniff`。固定模式按 A4 分页，智能一页保持 210mm 宽并按内容增长，超过 2000mm 返回 `413 RESUME_PDF_PAGE_TOO_TALL`。私有图片只从已校验的用户/简历对象键读取，缺失、不支持或超限分别以稳定 `RESUME_PDF_*` 错误失败关闭；正文中的外部资源不会被渲染器联网获取。

每个用户最多保存 10 份正式简历；创建事务锁定用户行后检查，达到上限返回 `409 RESUME_LIMIT_REACHED`。创建在同一事务写入当前简历及 `version_no=1/reason=initial` 快照。更新同时保存完整 data/style 并递增 `lock_version`，不创建历史版本；过期基准返回 `409 RESUME_EDIT_CONFLICT`。非法内容和样式分别返回 `400 INVALID_RESUME_DOCUMENT`、`400 INVALID_RESUME_STYLE`。不存在或不属于当前用户的简历统一返回 `404 RESUME_NOT_FOUND`。

## 历史版本

| Method   | Path                                            | 鉴权 | 成功结果                                               |
| -------- | ----------------------------------------------- | ---- | ------------------------------------------------------ |
| `GET`    | `/api/resumes/:id/versions`                     | 是   | `{versions}`，正式版本号倒序；每项含 `name`            |
| `POST`   | `/api/resumes/:id/versions`                     | 是   | `201 {version}`，创建带名称的 `manual` 快照            |
| `GET`    | `/api/resumes/:id/versions/:version_no`         | 是   | `{version}` 完整快照，含 `name`                        |
| `PATCH`  | `/api/resumes/:id/versions/:version_no`         | 是   | `{version}`；只更新指定正式版本的 `name`               |
| `DELETE` | `/api/resumes/:id/versions/:version_no`         | 是   | `{deleted}`；删除指定旧版本                            |
| `POST`   | `/api/resumes/:id/versions/:version_no/restore` | 是   | `{resume}`；直接用目标正式版本替换当前简历，不创建新版本 |

版本号单调递增且不复用；每份简历默认最多保存 10 个正式版本。创建和重命名请求中的 `name` 会去除首尾空白并折叠连续空白，规范化后必须为 1–80 个字符；创建缺省名称兼容旧调用方并按版本号生成“版本 N”。非法名称返回 `400 INVALID_RESUME_VERSION_NAME`。`PATCH` 重命名只更新指定版本的名称，不改变 `data/style` 快照、不创建新版本，也不改变当前简历标题。恢复直接使用已存在的目标快照替换当前简历，不创建新的 `before_restore` 或 `restore` 版本，也不占用版本空间。创建版本空间不足时返回 `409 RESUME_VERSION_LIMIT_REACHED`，不会自动删除任何历史版本；用户删除旧版本后才能继续。最新版本作为当前恢复基准不可删除，尝试删除返回 `409 LATEST_RESUME_VERSION_REQUIRED`。版本不存在返回 `404 RESUME_VERSION_NOT_FOUND`，并发兜底失败返回 `409 VERSION_CONFLICT`。历史数据中的 `before_restore`、`restore` 原因仍可读取，但新恢复操作不会再生成这两类记录。旧版本名称由 `0023` 按原因回填，Web 版本抽屉只展示这些正式版本，不单独展示当前草稿。

## 简历智能助手

除部署探针 `GET /api/agent/readiness` 外，智能助手接口全部要求登录，且会话、运行与提案都按当前用户重新校验归属；不存在或越权资源返回对应 `AGENT_*_NOT_FOUND`，不暴露其他用户数据。消息发送使用 POST SSE，不使用浏览器原生 `EventSource`。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/agent/readiness` | `200 {ready: true}`；只读校验完整 Agent 服务链，不返回模型或凭据 |
| `GET` | `/api/agent/sessions[?resume_id=:id]` | `{sessions}`，`resume_id` 可选；传入时按本人简历过滤，省略时返回当前用户跨简历最近更新的至多 50 个会话 |
| `POST` | `/api/agent/sessions` | `201 {session}`；请求为 `{resume_id, title?}` |
| `GET` | `/api/agent/sessions/:sessionId` | `{session}`，包含最近 100 条消息 |
| `POST` | `/api/agent/sessions/:sessionId/messages` | SSE；请求为 `{content, idempotency_key, selection_context?, reply_to_sequence_no?}`，选区包含稳定块 ID、编辑器范围、原文和 SHA-256；回答结构化澄清问题时必须携带对应助手消息序号 |
| `POST` | `/api/agent/runs/:runId/cancel` | `{run_id, status}`；重复取消幂等 |
| `GET` | `/api/agent/proposals?resume_id=:id&session_id=:sessionId` | `{proposals}`，只返回当前待确认提案；`session_id` 可选，传入时同时校验会话归属和简历绑定并按会话过滤 |
| `POST` | `/api/agent/proposals/:proposalId/confirm` | `{resume}`；确认后应用完整快照并创建 `agent` 版本 |
| `POST` | `/api/agent/proposals/:proposalId/reject` | `{proposal}`；放弃待确认提案 |

SSE 事件包括 `run.started`、`assistant.delta`、`clarification.requested`、`tool.started`、`tool.completed`、`proposal.created`、`run.completed`、`run.cancelled` 和 `run.failed`。`clarification.requested` 携带版本化的 `clarification`：1–3 个问题，每题 2–3 个 `{id,label,description?}` 选项；客户端额外提供自由输入的“其他”。该成功运行把助手消息以 `message_type=clarification` 持久化，普通文本消息为 `message_type=text`。回答只有在 `reply_to_sequence_no` 仍指向当前会话最后一条澄清消息时才创建新运行，否则返回 `409 AGENT_CLARIFICATION_STALE`，客户端应刷新当前会话。每个成功建立的 SSE 响应必须以后三种 `run.*` 终态之一结束；Pi 在 HTTP 200 后提前 EOF 时 FastAPI 补发 `run.failed/AGENT_UPSTREAM_FAILED`，浏览器也会把无终态 EOF 识别为 `AGENT_STREAM_INCOMPLETE`。只有 `run.completed` 才把完整助手文本或结构化澄清消息和可用的 Token/估算成本写入数据库；失败、取消或缺失终态不会把已经流出的部分文本保存成历史消息。同一用户只允许一个 running 运行；相同 `idempotency_key` 重放现有运行状态。取消与流式完成并发时采用第一个成功写入的终态，后到操作不得覆盖。Agent 只能读取当前会话绑定的简历，并且不能直接写简历：修改先解析稳定 locator，再读取最小范围、生成结构化诊断并创建类型化 operation 提案；服务端在快照副本上应用 operation 后仍保存完整候选 data/style。旧的完整快照内部提案接口保留一个兼容期，存量 pending 提案仍可确认。确认时同时校验 `base_lock_version`、locator 和目标内容哈希；整份简历发生并发变化返回 `409 RESUME_EDIT_CONFLICT`，目标块失效返回 `409 TARGET_STALE` 并把提案标记为 conflicted。过期提案返回 `410 AGENT_PROPOSAL_EXPIRED`，正式版本已达上限时返回 `409 RESUME_VERSION_LIMIT_REACHED` 且不应用提案。服务或模型不可用返回安全化的 `AGENT_UNAVAILABLE`、`AGENT_MODEL_UNAVAILABLE`、`AGENT_MODEL_UNSUPPORTED`、`AGENT_MODEL_TIMEOUT` 或 `AGENT_MODEL_REQUEST_FAILED`，供应商原始错误和 API Key 不进入浏览器响应。

`/internal/agent/**` 仅供 Pi 服务使用，以独立 Bearer token 鉴权且不出现在 OpenAPI。除兼容的完整上下文和快照提案接口外，范围化工具依次使用 `POST /runs/:runId/targets:resolve`、`context:read`、`materials:search`、`diagnoses` 和 `proposals:v2`。目标出现零处或多处时不允许创建提案；诊断 fingerprint、资料版本、执行模式和 operation 范围由 FastAPI 复验。`GET /internal/agent/readiness` 验证当前 `pi_agent` binding、凭据解密和 Pi provider 映射，不发起供应商模型调用；工具事件以 `(run_id, call_key)` 幂等，同一工具调用进入 succeeded、failed 或 cancelled 后不可回退或改写为另一终态。内部运行配置复用统一模型管理中的 `pi_agent` binding；模型配置页面仍是 `/admin/llm/models`，不新增第二套 Pi 配置 UI。

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

RabbitMQ 是默认 Broker，使用固定 `resume.import` routing key；Kafka 兼容实现使用规范 `import_id` 作为消息 key。独立 Worker 从私有对象存储读取文件，Markdown 本地转换，DOCX/PDF 经 LinkParse，再走 `SectionIR → ResumeExtractionDraft → ResumeDocument`。转换成功后会尽力在源文件目录存档 `converted.md`，存档失败不改变解析状态。解析成功时以安全化文件名的 stem 作为标题，允许与已有简历同名；解析内容作为 data，所选模板只提供 style。正式简历、initial 版本、`resumes.parse_task_id` 结果关联和任务成功状态在一个数据库事务内提交；响应仍以 `result_resume_id` 返回关联结果。

缺少或使用非 canonical Header 返回 `400 INVALID_IDEMPOTENCY_KEY`。同一用户、Key 和请求指纹在 15 分钟映射窗口内重放同一导入记录：活动状态返回 `202`，成功终态返回 `200`，失败终态返回 `409 IMPORT_PREVIOUSLY_FAILED`；同 Key 异指纹返回 `409 IDEMPOTENCY_KEY_REUSED`。记录绑定前的短窗口返回 `409 IMPORT_ACCEPTANCE_IN_PROGRESS`，Redis 不可用返回 `503 IMPORT_IDEMPOTENCY_UNAVAILABLE`。记录创建后的错误响应在顶层 `import` 字段附带同一任务摘要。

`GET /api/resume-overview` 返回 `{resumes, active_imports, failed_imports, next_failed_cursor}`；失败列表支持 `failed_limit=1..50` 和服务端生成的 `failed_cursor`。`GET /api/resume-imports/:id` 返回本人的单个 `{import}` 任务摘要，查询前沿用陈旧任务收口；不存在、非法 ID 或越权统一返回 `404 RESUME_IMPORT_NOT_FOUND`。Web 只对 `upload_status=succeeded` 且 `parse_status=processing` 的任务按 ID 每秒独立查询，多个任务分别轮询，终态后停止；成功终态再一次性刷新 overview，使正式简历替换活动任务。`DELETE /api/resume-imports/:id` 只允许本人删除上传或解析失败记录，并同时清理源文件和可能存在的转换存档；活动任务返回 `409 RESUME_IMPORT_IN_PROGRESS`，不存在、非法 ID 或越权同样返回 `404 RESUME_IMPORT_NOT_FOUND`，对象删除失败返回 `502 ASSET_DELETE_FAILED`。

文件或模板无效时返回对应 `4xx` 且不创建正式简历。MinIO 上传失败会补偿删除可能写入的对象，再返回 `502 RESUME_SOURCE_UPLOAD_FAILED` 并保留上传失败记录；MQ confirm 失败返回 `503 RESUME_IMPORT_QUEUE_UNAVAILABLE`，记录保存为“上传成功、解析失败”。转换、结构化或模板复核失败由 Worker 保存解析失败终态，不创建半成品，也不自动重试业务失败。正式简历与活动导入共享每用户 10 个名额；成功导入只是把活动占位转换为正式简历。

## 简历模板管理

`/api/admin/resume-templates` 只允许管理员访问。`GET` 返回启用、停用和结构无效的全部模板；`POST /import` 接受最大 512 KiB 的严格 UTF-8 JSON 模板包，新模板默认停用且相同 `key` 返回 `409 TEMPLATE_KEY_CONFLICT`，不覆盖已有模板；`PUT /:id/status` 幂等启停，结构无效模板不能启用。模板包必须携带合法 `TemplateManifest`，包含受支持 renderer、区域、插槽、唯一自定义兜底区和头像策略；同时拒绝未知字段、脚本、任意 HTML/CSS、外链、文件 URL、本地路径和媒体引用。当前不提供模板覆盖或硬删除。

## 知识库资料

`POST /api/datasets` 使用 `multipart/form-data`，字段为 `file`，支持 docx/pdf/md/txt 四种格式（按扩展名判定、大小写不敏感），单文件上限 `DATASET_UPLOAD_MAX_BYTES`（默认 10MB）。上传成功后文件保存到对象存储，元信息与解析任务在同一事务写入，再向共用文档解析队列发布消息并返回：

```json
{
  "id": "1",
  "file_name": "notes.md",
  "file_format": "md",
  "file_size": 12,
  "upload_status": "uploading",
  "parse_status": null,
  "failure_reason": null,
  "created_at": "…"
}
```

`GET /api/datasets` 返回当前登录用户自己的资料记录，按上传时间倒序（`{datasets: [...]}`），并从关联任务返回 `upload_status`、`parse_status`、`failure_reason`。失败分类为 `format_unsupported/content_invalid/size_exceeded/service_unavailable/timeout/quota_exceeded/internal_error`。`GET /api/datasets/:id/content` 只允许资料所有者读取解析成功后保存的 Markdown，返回 `{id, file_name, file_format, markdown}`；资料不存在或越权统一返回 `404 DATASET_NOT_FOUND`，解析尚未成功或转换存档未保存返回 `409 DATASET_CONTENT_UNAVAILABLE`，对象读取、大小或 UTF-8 校验失败返回 `502 DATASET_CONTENT_READ_FAILED`。三个接口都要求登录（未登录返回 `401 UNAUTHORIZED`），响应不包含对象存储路径或 SHA-256。

资料源文件 SHA-256 仅作为后端完整性元数据，以固定 64 位十六进制字符串保存；它不进入公开请求或响应契约。

文件名非法返回 `400 INVALID_DATASET_FILENAME`，空文件返回 `400 EMPTY_DATASET_FILE`，不支持格式返回 `400 UNSUPPORTED_DATASET_FORMAT`，超过大小上限返回 `413 DATASET_TOO_LARGE`。对象存储上传失败返回 `502 DATASET_UPLOAD_FAILED` 且不落库；对象已上传但元信息写入失败返回 `500 DATASET_RECORD_FAILED`，已上传对象会被尽力清理；消息发布失败返回 `502 DATASET_QUEUE_UNAVAILABLE`，任务记录收口为上传失败。同一文件允许重复上传并生成新记录（不做去重或幂等）。

## JD 数据模型与管理

JD 管理接口接受和返回最终结构化数据；浏览器导入接口接受有限页面采集 DTO，并在同一请求中清洗为最终结构化数据；智能导入接口把文字或图片解析为待确认草稿，不创建 JD。服务端不保存插件原始页面、智能导入原文、图片或模型过程数据。所有接口都要求当前登录用户，服务端从会话取得 `user_id`；不存在和不属于当前用户的记录统一返回 `404 JD_NOT_FOUND`。

| Method   | Path                                | 成功结果                                                                 |
| -------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `GET`    | `/api/job-descriptions`             | `{items, next_cursor}`，列出当前用户保留的全部 JD                         |
| `POST`   | `/api/job-descriptions`             | 新建时 `201 {job_description}`；解决重复时 `200`                         |
| `POST`   | `/api/job-descriptions/parse-draft` | 从文字或图片提取 `{draft, warnings, inputType, callId}`，不写入 JD       |
| `POST`   | `/api/job-descriptions/import`      | 清洗 BOSS 页面采集字段；新建时 `201 {job_description}`，解决重复时 `200` |
| `GET`    | `/api/job-descriptions/:id`         | `{job_description}`                                                      |
| `PUT`    | `/api/job-descriptions/:id`         | `{job_description}`；请求含 `base_lock_version` 和至少一个可编辑字段     |
| `DELETE` | `/api/job-descriptions/:id`         | `{deleted: true}`，直接永久删除并释放来源唯一标识                        |

列表查询支持最长 200 字符的 `keyword`、不透明 `cursor` 和 `limit=1..100`。关键词忽略大小写，覆盖岗位名、公司名、城市、地址、正文和技能；分页按 `updated_at DESC, id DESC` 稳定排序。非法筛选或游标返回 `400 INVALID_JOB_QUERY`。JD 不维护活动、归档、投递或面试状态。

智能导入使用 `multipart/form-data`，必须且只能提交一个非空 `text` 或一个 `image`。文字去除首尾空白后最长 60,000 字符，使用当前 `chat` 能力；图片只接受实际内容可解码的 PNG、JPEG 或 WebP，最大 10 MiB、最多 4,000 万像素，使用独立的 `job_image_structuring` 能力。响应中的 `draft` 与普通创建字段同构但全部可空，`warnings` 提示未识别的核心字段；调用方必须先让用户核对或补充，再另行调用创建接口。输入缺失或同时提供两种输入返回 `400 JD_IMPORT_INPUT_REQUIRED|JD_IMPORT_INPUT_AMBIGUOUS`，大小、格式或内容非法返回对应的 `JD_IMPORT_TEXT_TOO_LARGE`、`JD_IMPORT_IMAGE_TOO_LARGE`、`JD_IMPORT_IMAGE_UNSUPPORTED` 或 `JD_IMPORT_IMAGE_INVALID`。能力未绑定返回 `503 JD_IMPORT_MODEL_NOT_CONFIGURED`，超时返回 `504 JD_IMPORT_PARSE_TIMEOUT`，其他模型或结构化结果失败返回 `502 JD_IMPORT_PARSE_FAILED`；模型调用已建立记录时错误详情包含脱敏的 `callId` 和 `inputType`。

创建必填 `job_title`、`company_name`、`description` 和 `source_type=manual|external_import`。`external_import` 必须带 `http/https source_url`；服务端负责规范化 URL 并计算来源身份。当前 BOSS 直聘岗位链接提取 `/job_detail/{source_job_id}.html`，保存 `source_site=boss`、原生 `source_job_id`、规范化 `source_url` 及其 SHA-256；其他链接保存 `source_site=web` 和 URL 哈希。`source_type`、`source_site`、`source_job_id`、`source_url`、`source_url_hash`、`imported_at` 创建后均不可通过更新接口修改。

浏览器导入请求使用 `source_url` 和嵌套 `capture`。当前只接受 `zhipin.com` 的 `/job_detail/{source_job_id}.html`；`capture.job_title`、`capture.company_name`、`capture.description_text` 清洗后必须非空。可选采集字段包括 `skills`、就业类型原文、学历、经验、工作时间、城市、地址、薪资原文、公司字段/标签和招聘者字段。后端去除不可见字符、压缩空白、删除明确的详情标题与举报页尾，并确定性映射常见就业类型、远程/混合工作、`K·N薪` 和人民币时/日/月/年区间；无法可靠识别的字段保持为空，不做分析或模型推断。

导入请求字段非法、非 BOSS 详情 URL 或必填采集内容缺失时返回 `400 INVALID_JOB_IMPORT`。它与普通创建复用相同的 `JD_SOURCE_DUPLICATE`、`duplicate_resolution`、`JD_EDIT_CONFLICT` 和 `JD_WRITE_FAILED` 契约；插件不需要也不能提交 `user_id`、来源身份哈希或数据库字段。

同一用户的 `(source_site, source_job_id)` 或 `source_url_hash` 重复时返回 `409 JD_SOURCE_DUPLICATE`，响应 `duplicate` 包含现有摘要和 `update|cancel` 动作。`duplicate_resolution` 必须回传现有 `job_description_id`、`base_lock_version` 和 `action=update`；更新使用本次结构化内容覆盖原记录但保留个人备注和来源身份，不创建第二条记录。普通更新及重复解决使用 `lock_version`，并发过期返回 `409 JD_EDIT_CONFLICT`。

硬删除语句同时约束记录 ID 和当前用户，不要求中间状态或 `lock_version`。成功后 JD 无法恢复，相同来源可再次写入；已有求职进程通过 `ON DELETE SET NULL` 解除来源引用并继续保存建立时的岗位快照。不存在和不属于当前用户的记录返回 `404 JD_NOT_FOUND`。

技能以最多 100 个字符串的 JSON 数组保存，写入时去空和去重。数值薪资非空时必须同时给出三字母币种与计薪周期，最高值不得低于最低值。请求字段、长度或组合非法返回 `400 INVALID_JOB_DESCRIPTION`，来源非法返回 `400 INVALID_JOB_SOURCE`。福利、原始抓取数据和插件 API Key 不属于当前契约。

## 求职中心

求职中心以 `job_descriptions` 保存岗位资料，以 `job_applications` 表达一家公司和岗位的一次完整求职尝试，以 `interview_sessions` 表达其中一场可排期、可完成、可复盘的面试。所有接口都要求当前登录用户，后端只从会话取得所有者；不存在和越权资源统一返回 `404 INTERVIEW_NOT_FOUND`。创建求职进程必须引用本人 JD，并保存公司、岗位和完整 JD 快照；后续修改原 JD 不会改写历史求职进程。公司颜色第一次创建时从 Mac 日历语义色中随机选择，之后同一求职进程的所有面试共用该颜色，也可通过进程更新接口修改。

求职进程的初始状态必须可达：`screening` 从 `awaiting_result` 开始，`interview/hr` 从 `awaiting_schedule` 开始，`offer` 从 `negotiating` 开始；其他阶段与等待状态组合返回 `400 INVALID_INTERVIEW_REQUEST`。筛选结果可在没有面试场次时直接推进；面试或 HR 阶段推进只消费当前阶段、当前轮次且仍待确认的已完成场次，不会把旧轮次或其他阶段误标为通过。归档进程从默认求职进程列表、总览和排期中隐藏，只有显式 `scope=all|archived` 或 `include_archived=true` 才返回历史；归档进程不能创建、调整、完成或取消排期，恢复后才能继续排期生命周期。

| Method | Path | 行为 |
| --- | --- | --- |
| `GET` | `/api/interview-overview` | 返回本周指标、当前阶段流程和周排期；支持 `week_start` 与 IANA `timezone` |
| `GET/POST` | `/api/job-applications` | 列出或创建求职进程 |
| `GET/PUT/DELETE` | `/api/job-applications/:id` | 读取、乐观锁更新，或永久删除已归档且无面试记录的进程 |
| `POST` | `/api/job-applications/:id/advance` | 将已完成且等待结果的当前阶段确认通过并推进 |
| `POST` | `/api/job-applications/:id/offer` | 记录 OC 或书面 Offer |
| `POST` | `/api/job-applications/:id/close` | 记录未通过、主动结束、接受或婉拒 Offer |
| `POST` | `/api/job-applications/:id/archive\|restore` | 乐观锁归档或恢复进程 |
| `GET` | `/api/interview-sessions` | 按时间、状态、`application_id`、归档范围和游标列出当前用户的面试记录 |
| `POST` | `/api/job-applications/:id/interview-sessions` | 在指定求职进程的当前阶段创建排期 |
| `GET/PUT/DELETE` | `/api/interview-sessions/:id` | 读取、乐观锁更新或删除无素材的单场记录 |
| `POST` | `/api/interview-sessions/:id/reschedule` | 调整排期，开始时间只接受整点或半点 |
| `POST` | `/api/interview-sessions/:id/complete\|cancel` | 明确完成或取消一场面试 |
| `GET/POST` | `/api/interview-sessions/:id/assets` | 列出或上传录音、视频和文档素材 |
| `GET` | `/api/interview-assets/:id/content` | 所有权校验后流式读取素材 |
| `DELETE` | `/api/interview-assets/:id` | 所有权校验后删除素材记录和对象存储文件 |

排期使用带时区的 `start_at/end_at`，服务端转成 UTC 保存；不画半点辅助线不影响 30 分钟吸附契约。与本人其他未取消面试重叠时返回 `409 INTERVIEW_TIME_CONFLICT` 和冲突摘要，只有请求再次携带 `allow_conflict=true` 才保存。完成面试会保存自由文本题目、复盘和改进点，并把求职进程置为 `awaiting_result`；它不会自动推断通过或把卡片移动到下一阶段。`advance` 负责把最近一场待确认结果标为通过并移动进程，`close` 负责标记未通过或其他终态。过期 `base_lock_version` 返回 `409 INTERVIEW_EDIT_CONFLICT`，不合法状态跳转返回 `409 INTERVIEW_INVALID_TRANSITION`。

`GET /api/job-applications` 按 `updated_at DESC, id DESC` 分页，`GET /api/interview-sessions` 按 `start_at ASC, id ASC` 分页；两者的 `next_cursor` 都是不透明且与当前筛选条件绑定的游标。调用方必须把游标与原筛选一起回传；游标损坏、跨筛选复用或超长都返回 `400 INVALID_INTERVIEW_QUERY`。创建面试的 `(application_id, client_request_id)` 唯一：相同请求重放返回原场次，相同标识绑定到不同时间或内容时返回 `409 INTERVIEW_EDIT_CONFLICT`。

面试模块的求职进程、岗位、简历版本、单场面试和素材 ID 与项目其他 BIGINT 资源一致，在 JSON、查询参数和路径中都使用无前导零的十进制字符串；前端不得把这些 ID 转成 JavaScript `number`。

素材上传是 `multipart/form-data`，`source_type=recorded|uploaded` 仅记录来源路径，两者写入同一 MinIO 私有前缀。服务端按扩展名与规范化 MIME 双重校验，流式计算大小和 SHA-256，默认上限由 `INTERVIEW_ASSET_UPLOAD_MAX_BYTES=524288000` 控制；空文件、不支持格式、超限和对象存储失败分别返回 `EMPTY_INTERVIEW_ASSET`、`UNSUPPORTED_INTERVIEW_ASSET`、`INTERVIEW_ASSET_TOO_LARGE` 和 `INTERVIEW_ASSET_UPLOAD_FAILED`。音视频内容使用 `inline` 分发以支持播放，文档使用附件下载；响应不暴露对象键。

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

PDF 导出审计上报接口只接受当前用户拥有的简历 ID；不存在或不属于当前用户都返回 `404 RESUME_NOT_FOUND`，非法动作或字段返回 `400 INVALID_AUDIT_EVENT`，sink 拒绝写入返回 `503 AUDIT_EVENT_UNAVAILABLE`。该接口为既有调用方保留；新的 `GET /api/resumes/:id/pdf` 由服务端路由自动记录同一个 `resume.pdf_export` 动作。其他审计动作不能通过该接口伪造。自动审计还覆盖鉴权/会话、账号资料和密码、简历/版本/资源、JD、管理员用户状态和模型配置等动作；成功和受控失败都记录可信 actor、target、result、错误码和 request ID，不记录请求 body。审计进入共享 Loki，不新增 MySQL 审计表；现有 `/api/admin/llm/calls` 继续是 LLM 计量和调用状态的事实源。
简历导入的后端内部日志使用 `operation_id`/`task_id` 串联阶段和重试，失败时只记录稳定错误码、失败阶段和不含字段值的验证元数据；这些内部字段不扩展本节的 HTTP 请求或响应结构。

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
| `GET`   | `/api/admin/llm/capabilities`                   | `{capabilities}`，返回 Chat、`resume_structuring`、`pi_agent`、`job_image_structuring` 能力矩阵与共享候选列表 |
| `GET`   | `/api/admin/llm/catalog`                        | `{capabilities, adapters}`，返回能力与模型目录                                 |
| `GET`   | `/api/admin/llm/catalog/chat`                   | `{capability, adapters}`，返回受支持 adapter 和 LiteLLM Chat 模型建议          |
| `POST`  | `/api/admin/llm/models`                         | `201 {model}`                                                                  |
| `PATCH` | `/api/admin/llm/models/:modelConfigId`          | `{model, validationCallId}`；编辑当前项时先测试拟议配置                        |
| `POST`  | `/api/admin/llm/models/:modelConfigId/test`     | `{ok: true, callId}`，测试指定配置                                             |
| `POST`  | `/api/admin/llm/models/:modelConfigId/tests`    | `{capability, baseConfigVersion?}`；按能力执行验证并返回验证证据                |
| `POST`  | `/api/admin/llm/models/:modelConfigId/activate` | `{activeModel, callId}`，测试成功后设为 Chat 当前模型                          |
| `PUT`   | `/api/admin/llm/capabilities/:capability/binding` | `{modelConfigId, baseConfigVersion?, baseBindingVersion?}`；验证成功后更新能力绑定并返回验证调用 ID |
| `DELETE` | `/api/admin/llm/models/:modelConfigId`         | 删除未绑定候选；被任一能力绑定时返回 `409 LLM_MODEL_IN_USE`                    |
| `GET`   | `/api/admin/llm/calls`                          | `{calls, summary, nextCursor}`                                                 |

模型候选是能力中立的共享连接配置，管理员不填写能力标识。候选写入只接受 `adapter`、不含 adapter 前缀的 `model`、可选 `apiBase` 和只写 `apiKey`；Chat、简历结构化与 JD 图片解析会把 adapter 和模型名组装成 LiteLLM 标识。目录响应使用稳定 adapter 代码，管理页面只展示供应商名称；目录建议来自锁定版本 LiteLLM 的 Chat 元数据，目录外调用名仍可提交并由真实连接测试兜底。旧 `enabled`、`priority` 和手工价格字段不再接受或返回。`job_image_structuring` 绑定前使用内置红色测试图片执行真实视觉探针，必须返回约定的结构化颜色结果；`pi_agent` 绑定会把选定配置快照交给 Pi Service，由 Pi 的模型 profile 决定协议和兼容参数并直接执行固定 Tool 探针。探针失败时原 binding 保持不变。

候选读取只用 `keyConfigured` 表示是否已有凭据，绝不返回明文或数据库密文。PATCH 省略 `apiKey` 时保留原凭据，传 `null` 时清除，传非空字符串时替换。新增和编辑未绑定候选不会改变任何能力当前项；被任一能力绑定的候选不可原地编辑或删除，管理员需创建替代候选后再验证并切换。启用操作先测试目标快照，成功后才切换，失败时原当前项不变。未绑定候选可以硬删除；删除会移除配置、加密凭据和验证证据，并把历史调用日志的 `modelConfigId` 置空，日志中的 adapter、模型、配置版本、状态和计量快照保持不变。不提供独立启停接口。

模型配置 `id`、调用记录 `userId` 和 `modelConfigId` 与其他 MySQL 业务 ID 一致，对外使用十进制字符串，内部数据库列仍为 `BIGINT UNSIGNED`。

`0006` 在数据库中使用中文表注释和字段注释，这些注释只用于说明持久化语义，不改变本节约定的 JSON 字段名、错误码或状态字面值。`0008` 增加候选的 LiteLLM adapter/model 调用名、Chat 唯一当前绑定，以及调用日志的能力、来源和模型快照。`0028` 扩展绑定版本、验证证据、简历结构化/Pi Agent 预置绑定和调用配置版本；`0029` 删除候选上的遗留 `capability` 列，候选正式成为能力中立配置；`0035` 扩展能力约束并预置空的 `job_image_structuring` binding，不改变 JD 表。升级仍不转换旧优先级、价格或调用数据；存量绑定验证证据可为空，需要管理员用对应探针测试成功后才会产生验证证据。

调用记录可用 `source`、`status`、精确 `callId`、`userId`、`modelConfigId`、`from`、`to`、`cursor` 和 `limit` 查询，默认每页 50、最大 200，按创建时间和内部 ID 倒序稳定分页。`source` 是由内部调用方提供的稳定小写代码，格式为 `^[a-z][a-z0-9_]{0,31}$`；当前接入来源包括管理动作的 `connection_test`、简历导入的 `resume_import`，以及 JD 智能导入的 `job_text_import` 和 `job_image_import`。时间范围使用带时区的 ISO 8601，区间为左闭右开；非法值、反向区间或无效游标返回 `400 INVALID_LLM_CALL_QUERY`。每条记录只包含调用标识、能力、来源、用户、实际 adapter/模型与配置版本快照、状态、耗时、Token、LiteLLM 价格快照、估算成本和非敏感错误分类，不保存或返回消息、图片、模型完整响应和凭据。汇总针对当前筛选条件聚合全部命中记录，只累加已知值，并用 `incompleteMeteringCount` 表明不完整计量。

管理错误包括 `INVALID_LLM_MODEL_CONFIG`、`INVALID_LLM_CALL_QUERY`、`LLM_MODEL_NOT_FOUND`、`LLM_MODEL_IN_USE`、`LLM_MODEL_CONFIG_CHANGED`、`LLM_BINDING_CHANGED`、`LLM_CHAT_NOT_CONFIGURED`、`LLM_MODEL_NOT_CONFIGURED`、`LLM_PI_AGENT_UNAVAILABLE`、`LLM_PI_AGENT_TIMEOUT`、`LLM_PI_AGENT_PROBE_FAILED`、`LLM_CREDENTIALS_UNAVAILABLE`、`LLM_UNAVAILABLE` 和 `LLM_REQUEST_REJECTED`。连接测试、绑定和当前项验证失败在已经创建调用记录时带可查询的 `callId`；供应商原始错误不会透传。

结构化模型调用仍是后端内部能力，不新增 HTTP 路由或管理接口字段。服务端不会向供应商发送 `response_format` JSON Schema 参数，而是在单次调用的系统指令中提供目标 Schema；返回文本由 LinkCV 本地提取 JSON 并执行 Pydantic 严格校验。非法结构以内部 `LLM_RESPONSE_INVALID` 收口，不触发第二次供应商调用，也不把模型正文写入调用记录或管理接口响应。

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
| `GET` | `/api/plugin-releases/{version}/download` | 当前版本匹配时返回名为 `linkresume-job-capture-v<version>.zip` 的 `200 application/zip` 附件流，带 `Content-Length`、SHA-256 `ETag`、`private, no-store` 和 `nosniff` |
| `GET` | `/api/admin/plugin-releases/current` | `200 {status, release}`；管理员状态为 `absent/published/unpublished`，已下架时仍返回保留版本信息 |
| `POST` | `/api/admin/plugin-releases` | multipart 字段 `file` 接收一个 ZIP，校验并发布成功返回 `201 {release, cleanup_pending}`；新版生效后自动删除其他版本 ZIP |
| `DELETE` | `/api/admin/plugin-releases/current` | 下架当前插件并返回 `200 {unpublished: true, release}`；把 current 指针状态改为 `unpublished`，保留当前唯一版本信息和 ZIP |
| `POST` | `/api/admin/plugin-releases/current/publish` | 重新上架已下架插件并返回 `200 {release}`；复用保留的 ZIP，不需要重新上传 |
| `DELETE` | `/api/admin/plugin-releases/current/package` | 永久删除当前 ZIP 和 current 指针并返回 `200 {deleted: true}`；操作不可恢复 |

current 或下载读取存储失败、指针/对象大小或摘要非法时返回 `503`，不会返回旧缓存或 MinIO URL。下载版本不是当前版本时返回 `409 PLUGIN_RELEASE_VERSION_CHANGED`，非法或未发布版本返回 `404 PLUGIN_RELEASE_NOT_FOUND`。

上传只接受最大 20 MiB 的 ZIP。压缩包结构、根目录 Manifest、Manifest V3 或三段数字版本不合法时返回 `422 PLUGIN_RELEASE_*`；上传不校验安装说明、站点权限、IP 或端口。超过上限返回 `413 PLUGIN_RELEASE_TOO_LARGE`；版本降级、同版本不同内容或当前对象冲突返回 `409`；新对象或指针写入失败返回 `503`，当前指针和旧版保持原值。指针成功切换后，服务端删除 `system/plugin-releases/` 下除 current 引用对象外的其他 ZIP；清理失败不回滚已经生效的新版本，响应为 `cleanup_pending=true`，管理端提示待重试，后续上传会重新清理。前端不得从文件名推断版本或环境，也不得自行拼接存储路径。

下架必须二次确认。没有 current 指针或指针已经是 `unpublished` 时返回 `404 PLUGIN_RELEASE_NOT_FOUND`；状态指针写入失败返回 `503 PLUGIN_RELEASE_UNPUBLISH_FAILED`，当前发布状态保持不变。成功下架后 current 查询返回 unpublished，当前唯一版本下载关闭；`current.json` 和该版本 ZIP 继续保留。保留的版本仍作为后续发布下限，同版本同摘要安装包可以重新上架；上架和下架都不创建第二个版本。

重新上架只接受 `unpublished` 指针：没有 current 指针返回 `404`，已经上架返回 `409 PLUGIN_RELEASE_ALREADY_PUBLISHED`，保留 ZIP 缺失或校验不一致返回 `503`。永久删除也必须二次确认；若插件仍已上架，服务端先把指针改为 `unpublished` 以关闭下载，再依次删除 ZIP 和 `current.json`。任一步骤失败返回 `503 PLUGIN_RELEASE_DELETE_FAILED`，保留 unpublished 状态供管理员安全重试；没有 current 指针返回 `404`。

Development 与 Production 使用独立 MinIO。各自 Bucket 内的当前指针固定为 `system/plugin-releases/current.json`，版本对象固定为 `system/plugin-releases/v<version>/linkcv-job-capture-v<version>.zip`；对象键不重复携带环境名。服务端新写的指针使用 `schema_version=3` 并显式包含 `status=published|unpublished`；读取兼容既有不含 `status` 的 v2 指针，并按已发布处理。
