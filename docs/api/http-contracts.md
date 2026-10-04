# HTTP 接口契约

本文记录当前调用方可观察的 HTTP 行为。全部 `/api` 路径由 FastAPI 提供，Swagger UI 位于 `/api/docs`，OpenAPI JSON 位于 `/api/openapi.json`。未匹配的 `/api` 路径返回 JSON 404，不会被 SPA fallback 转成 HTML。

客户端可以发送最长 64 字符、仅包含字母数字、下划线和连字符的 `X-Request-ID`；不合法或缺失时服务端生成新值。所有正常及受控错误响应回传最终 `X-Request-ID`。命中状态变更审计映射的响应还带 `X-Audit-Recorded: true|false`，表示本地日志 sink 是否接受该次审计；它不表示事件已经同步到 Loki。

## 健康检查与鉴权

Web 客户端收到受保护请求的 `401` 后最多续期重试一次；对话发送重试保持原 `idempotency_key`，恢复订阅保持原 run ID，取消后不重发。跨标签页续期协调与浏览器兼容边界见[账号功能](../features/identity-account.md)。收到 Agent SSE 终态后即可结束订阅，后续连接关闭或会话回读失败不改变已经收到的运行终态。

`GET /api/health` 返回 `{status, service, version}`。`GET /api/auth/capabilities` 公开返回 `{password_login_enabled, wechat_login_enabled}`。Local/Development 只开放普通邮箱密码注册、登录及改密，微信相关认证与身份确认接口返回 `404 NOT_FOUND`；Production 只开放微信认证，普通注册、密码登录及改密返回 404。微信能力还要求配置上游凭据，未配置时能力为 false、接口为 `503 WECHAT_SERVICE_UNAVAILABLE`。未知环境两种能力都关闭。`POST /api/auth/admin-login` 保持独立，只允许管理员成功。普通微信绑定、解绑和换绑接口不公开。

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

会话统一保存为 Redis `auth:session:{sid}` hash 和 `auth:user_sessions:{uid}` 集合。Hash 包含 `uid`、refresh secret 哈希、`channel=web|miniprogram|desktop` 和创建时间；access JWT 同样携带 channel。Web 只接受 HttpOnly Cookie 中的 `channel=web` 凭据，小程序只接受 `Authorization: Bearer` 中的 `channel=miniprogram` 凭据；同时携带两种载体、JWT 与 Redis 的 uid/channel 不一致、session 被撤销、用户停用或申请注销时均视为未登录。为兼容本功能上线前已签发的 Web 会话，缺少 channel 的旧 JWT/Redis session 仅按 Web 凭据接受，并在 refresh 轮换时补写 `channel=web`；它不会被小程序接口接受。Refresh 每次轮换 secret，重放旧 refresh 会撤销整个 session。

微信 code 只由后端提交微信平台换取 openid。`/api/auth/wechat/miniprogram/account-status` 仍可使用当前 `wx.login` code 返回该 openid 是否已有关联账号，只返回布尔值，不创建用户、不更新登录时间、不签发会话；随仓库发布的小程序不再把它用于登录前置探测。该接口与小程序登录共用来源 IP 默认每分钟 30 次的限流。openid 已存在时登录接口直接复用；不存在时，`/api/auth/wechat/confirm` 和 `/api/auth/wechat/miniprogram/login` 只有在收到 `privacy_accepted=true` 后才创建 `email/password_hash` 为空的普通账号，缺失或为 `false` 时返回 `400 PRIVACY_AGREEMENT_REQUIRED`，唯一约束负责并发建号收敛。该字段只表示本次注册请求已经通过客户端确认门禁，不是服务端持久化的同意审计记录。随仓库发布的小程序冷启动在“简历”页展示一张内置“示例简历 · 内容为虚构信息”卡片，点击详情也只渲染包内虚构内容；游客首页与示例详情不发起账号探测、登录、隐私授权或个人数据请求，可切换“我的”游客态。登录入口位于“我的”页和求职游客引导；用户查看并勾选微信平台隐私保护指引并点击主操作后，客户端才调用建号或登录接口；未勾选时在协议区行内提示。普通登录成功后返回“我的”页；扫码确认先用一个 code 确认 Web scene，再用新的 code 建立独立小程序会话。登录后的简历页与请求重试路径只能以 `privacy_accepted=false` 尝试恢复已有账号，不能静默触发首次建号。停用账号不能登录或续期；启用管理员账号即使历史上已有 openid，也与普通账号一样可以通过网页扫码确认并由匹配 `poll_token` 的 status 签发 Web Cookie，也可以通过小程序 login 建立、refresh 轮换小程序 Bearer 会话并访问小程序业务接口；管理员仍可使用 `/api/auth/admin-login`。超出上述限流时返回 `429 WECHAT_RATE_LIMITED`。开发者工具和真机的 `develop` 运行时都默认使用 `https://linkresume.cn`；只有环境被明确识别为 `develop` 且设备本地执行 `wx.setStorageSync("linkresume_local_debug_enabled", true)` 时才读取每次 `npm run dev` 自动更新的 `local.js`，环境识别缺失或异常时不读取开发 storage/local.js；`linkresume_api_base_url` 显式 URL 覆盖优先于 `local.js`。关闭 opt-in 可执行 `wx.removeStorageSync("linkresume_local_debug_enabled")` 或写入 `false`；体验版和正式版忽略全部开发 storage/local.js，继续使用该 HTTPS 地址。

### 桌面 Bearer 会话

桌面微信能力沿用普通用户环境规则：仅配置可用的 Production 可获取二维码、查询和领取微信会话及续期；Local/Development/未知环境能力为 false，这些路径返回 404。退出接口仍可用于撤销已有凭据。领取、恢复结果和续期在账号行锁内重新检查停用及注销标记，不能与注销并发穿透。

桌面使用独立 `channel=desktop` Bearer，不能使用 Web Cookie、小程序 token 或无 channel 的旧凭据。桌面认证路由拒绝认证 Cookie；只有 `/me` 接受 Authorization，其余路由以 JSON 证明或 refresh secret 鉴权。响应均为 `Cache-Control: no-store`，不设置 Cookie。

| Method | Path | 输入与结果 |
| --- | --- | --- |
| `GET` | `/api/auth/desktop/capabilities` | `{wechat_login_enabled, session_protocol: 1}` |
| `POST` | `/api/auth/desktop/wechat/qrcode` | `{platform: macos\|windows, client_version, code_challenge, code_challenge_method: S256}` → `{scene, poll_token, qr_base64, expires_in, poll_interval_seconds}` |
| `POST` | `/api/auth/desktop/wechat/status` | `{scene, poll_token}` → `{status}`；pending/confirmed/consumed/cancelled/expired，不返回凭据 |
| `POST` | `/api/auth/desktop/wechat/exchange` | `{scene, poll_token, code_verifier, request_id}` → token envelope |
| `POST` | `/api/auth/desktop/refresh` | `{refresh_token, request_id}` → token envelope |
| `POST` | `/api/auth/desktop/logout` | `{refresh_token}` → `{ok: true}`；撤销前验证 secret，已不存在的 session 幂等成功 |
| `GET` | `/api/auth/desktop/me` | desktop Bearer → `{user}` |

Token envelope 为 `{user, access_token, refresh_token, expires_in, session_protocol: 1}`。每个逻辑 exchange/refresh 使用固定 UUID `request_id`；响应丢失时必须复用原证明和标识。结果以独立 Fernet 密钥 `AUTH_DESKTOP_RETRY_ENCRYPTION_KEY` 加密保留 120 秒，恢复必须同时匹配操作、渠道、请求、证明、当前 session 的 uid/refresh hash 和启用账号，不延长原 access 到期时间或 session TTL。过期领取返回 `410 LOGIN_RESULT_EXPIRED`；证明错误返回 `401 LOGIN_CHALLENGE_INVALID`；领取冲突返回 `409 LOGIN_EXCHANGE_CONFLICT`；刷新同标识不同证明返回 `409 AUTH_IDEMPOTENCY_CONFLICT`，旧 secret 在允许恢复条件外重放返回 `401 REFRESH_REPLAYED` 并撤销 session。非法请求返回脱敏的 `422 INVALID_DESKTOP_REQUEST`；鉴权服务不可用返回 `503 AUTH_SERVICE_UNAVAILABLE`，限流返回 `429 AUTH_RATE_LIMITED`。

桌面简历业务权限开放以下 GET：`/api/resume-templates`、`/api/resume-templates/{id}`、`/api/resumes`、`/api/resumes/{id}`、`/api/resumes/{id}/pdf`、`/api/resumes/{id}/assets/{asset_name}`、`/api/assets/{object_name:path}`。保留原资源归属、版本和 PDF 校验；不开放简历写入、账号、管理端或语音 WebSocket；文字模拟面试 SSE 与只读资料列表按本文的独立白名单开放。管理员桌面凭据也不能扩大渠道权限。`GET /api/auth/me` 仍只识别 Web Cookie，desktop Bearer 得到 `user: null`。

桌面岗位看板复用既有求职接口，通过独立的 `get_current_career_user` 白名单识别 desktop Bearer：允许读取岗位、本人岗位的带版本 Logo、求职进程、排期与周概览；创建岗位和求职进程；编辑或删除本人岗位/进程；添加阶段、终止、记录 Offer、接受/婉拒正式 Offer、归档/恢复、添加排期；编辑排期信息、改期、设置个人作答计划、标记完成和取消排期。其中 `PUT /api/interview-sessions/{id}` 只更新既有可编辑信息，携带 `base_lock_version`；时间变化仍使用 reschedule，个人计划仍使用 answer-plan。阶段详情另开放：场次 `DELETE`、`GET/POST /api/interview-sessions/{id}/assets`（录音列表与上传）、`GET /api/interview-assets/{id}/content`（播放）、`POST .../transcriptions/{dataset_id}:retry|:apply`、`POST .../written-questions:extract`、`POST .../review:generate` 以及 `PUT .../review-notes`、`DELETE .../review-notes/{note_id}`；它们与 Web 共用同一服务、归属校验和错误语义，准备清单生成和 `DELETE /api/interview-assets/{id}` 仍拒绝 desktop。岗位文字/PNG/JPEG 的智能提取通过既有 multipart `POST /api/job-descriptions/parse-draft`，继续使用原模型就绪与错误语义。独立求职复盘与匹配等其他岗位路径仍拒绝 desktop；场次 PUT 中既有的 questions_markdown、review_summary 和 improvement_markdown 可编辑，资料关联另由资料库白名单控制。数字 ID 路径、HTTP method、资源归属、乐观锁与幂等请求规则沿用原服务，管理员不能绕过渠道边界。Web Cookie 的原调用行为保留；游客和小程序 Bearer 不能使用这些桌面权限。

手机通过既有 confirm/cancel 处理固定为 desktop 的 scene，只确认账号、不签发桌面或 Web 凭据；小程序确认页按服务端 `login_target/platform` 显示目标，不在桌面确认后自动创建小程序会话。

### 网页扫码登录

| Method | Path | 成功结果 |
| --- | --- | --- |
| `POST` | `/api/auth/wechat/qrcode` | `{scene, poll_token, qr_base64}`；匿名，按 IP 限流；`poll_token` 只保留在创建二维码的网页 |
| `GET` | `/api/auth/wechat/status?scene=...&poll_token=...` | `{status, user?}`；`pending\|success\|cancelled\|expired`，success 且 poll token 匹配时设置 Web Cookie（启用管理员也适用）；不带 token 时只读状态 |
| `POST` | `/api/auth/wechat/confirm` | `{ok: true}`；小程序表单 `{scene, code, privacy_accepted?}`，未知 openid 建号时该值必须为 `true` |
| `POST` | `/api/auth/wechat/cancel` | `{ok: true, status: "cancelled"}`；小程序表单 `{scene}` |

scene 在 Redis 中按 `pending → processing → confirmed` 或 `pending → cancelled` 流转，默认 TTL 300 秒。确认使用原子 claim，只有一个请求执行微信换取；外部服务或无效 code 会由 claim 所有者恢复 `pending`，允许小程序取得新 code 后重试。processing 超过 30 秒视为遗留占用，可由新的确认请求原子接管；未超时的并发请求返回 `409 SCENE_IN_PROGRESS`。重复确认已确认场景幂等成功，终态保留到 TTL，不因重复请求删除。只要关联账号处于启用状态，普通账号和管理员都可以确认 scene，领取 Web Cookie，并继续完成小程序登录以取得 Bearer 会话；scene 供小程序确认并查询状态，独立 poll token 才允许 Web 领取会话，服务端只保存其哈希。Web 对已确认场景重复领取时会先发新 session、原子替换 scene 上的 `web_sid` 并撤销旧 sid，因此响应丢失可重试且同一 scene 最多保留一个有效 Web session；小程序无 poll token，不会误撤销网页会话。取消已确认场景返回冲突；未知或到期 scene 返回 `410 SCENE_EXPIRED`。

### 小程序只读简历

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/miniprogram/v2/resumes/:id/pdf?lock_version=...` | 当前已保存内容的文字 PDF，响应 X-LinkResume-Lock-Version 与 private, no-store |
| `GET` | `/api/miniprogram/v2/resumes/:id` | `{resume}` 当前正文及内部 lock_version；越权或不存在返回 404 |
| `GET` | `/api/miniprogram/v2/resumes/:id/pdf?lock_version=...` | 当前已保存内容的文字 PDF，响应 X-LinkResume-Lock-Version 与 private, no-store |
| `GET` | `/api/miniprogram/v2/resumes/:id/preview.png?lock_version=...` | 当前已保存内容的智能一页 PNG，响应 X-LinkResume-Lock-Version 与 private, no-store |
| `GET` | `/api/miniprogram/account/profile` | `{nickname, avatar_url}`；本人资料，`avatar_url` 恒为 `/api/miniprogram/account/avatar` 或 `null` |
| `PATCH` | `/api/miniprogram/account/profile` | 同上；JSON `{nickname}`，去空白后非空且不超过 50 字，否则 `400 INVALID_NICKNAME` |
| `PUT` | `/api/miniprogram/account/avatar` | `{url}`；JSON `{dataUrl, fileName?}`，复用 `/api/account/avatar` 的解码、10MB 上限与 MinIO 归属键规则，替换后删除旧头像对象 |
| `GET` | `/api/miniprogram/account/avatar` | 本人头像二进制流（`image/*`、`private`）；无头像返回 `404 ASSET_NOT_FOUND`。普通 `/api/assets/*` 接受 Web Cookie 或只读白名单内的 desktop Bearer，不接受小程序 Bearer；小程序只能经此专用端点读取头像 |

四个端点只接受小程序 Bearer，不接受 Web Cookie；小程序 Bearer 也不能调用普通 `/api/resumes*` 读写接口。预览读取当前已保存内容；必填 lock_version 不匹配返回 409 RESUME_EDIT_CONFLICT。旧四个简历协议端点返回 426 CLIENT_UPDATE_REQUIRED。服务端按请求启动一次性 Node 渲染进程，强制智能一页，从当前内容真实引用且通过用户/简历对象键校验的 PNG/JPEG 私有图片构造输入；`preview.png` 再用 PDFium 把单页 PDF 栅格化为宽度不超过 1440 像素的 PNG。PNG 栅格化进入进程级 PDFium 互斥区；预览槽位耗尽仍返回 `503 RESUME_PDF_BUSY`，不改变版本与归属校验。PDF 和 PNG 都只保留在请求内存，不写 MySQL、MinIO 或服务端文件缓存。输入、页面尺寸、像素数和输出大小都有上限；渲染脚本缺失、超时、异常退出、非法 PDF 或栅格化失败以稳定的 4xx/503 错误收口。

### 用户中心

`/api/account/*` 通过当前用户身份确定资源归属，不接受 `user_id`。除 profile、昵称、头像和求职画像外，还提供联系邮箱、偏好、当前会话、环境对应的敏感操作及注销回执接口，详见本文「账号补充接口」。Web 账号页按能力显示开发改密或正式微信注销确认，普通微信绑定入口已撤下。`user.email` 对微信用户为 `null`。最近简历仍按更新时间倒序返回最多 5 条。

`GET/PUT /api/account/user-profile` 维护跨简历共享的个人画像，聚合可比较的求职条件、教育背景与技能成果，独立保存于 `user_profiles` 表，不修改任何简历内容；这是唯一画像资源入口。未创建时 `GET` 返回 `lock_version=1` 的约定空画像且不写库；`PUT` 整体替换全部可编辑字段，缺省字段以 `null`/空数组覆盖旧值。`PUT` 必须携带 `base_lock_version`（首次创建固定为 1），服务端原子比较版本号，并发基准过期返回 `409 USER_PROFILE_VERSION_CONFLICT`，响应 `{profile}` 携带最新画像供调用方刷新后重试。可编辑字段包括 `candidate_cities`（最多 20 项）、`employment_types`（最多 2 项且只接受 `internship`/`full_time`）、薪资四字段、`candidate_status`、`graduation_year`、`years_experience`、教育字段和语言/技能/证书/荣誉/校园经历列表。城市及普通字符串列表会去除空串、去重并保留首次顺序；单项最长 100 字符，普通列表最多 100 项，`school_tier` 只接受 `project_985`/`project_211`/`double_first_class` 且最多 10 项。薪资必须成组填写：`salary_min`/`salary_max` 任一非空时要求 `salary_currency`（大写三字母 ISO 4217）与 `salary_period` 同时非空，最高值不得低于最低值。`candidate_status=fresh_graduate` 时 `graduation_year` 必须为 1900–9999 的四位年份且 `years_experience` 固定为 0；`experienced` 时毕业年份必须为空；未选择类型时毕业年份也必须为空。非法枚举、超长列表或违反联动约束返回 `400 INVALID_USER_PROFILE`。`GET /api/account/profile` 只返回账号资料、简历数量和最近简历，不内嵌 `profile`。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/account/user-profile` | 新画像完整对象；未创建返回 `lock_version=1` 空对象 |
| `PUT` | `/api/account/user-profile` | 保存后的新画像完整对象；请求含 `base_lock_version` 及可编辑字段，并发过期返回 `409 USER_PROFILE_VERSION_CONFLICT` 并携带最新画像 |

## 语义简历契约

`TextValue`（姓名、职业定位、章节标题、经历字段）与 `Contact` 可携带可选的 `runs`，结构复用正文的 `TextRun`，用于保存局部字号等文字样式；`runs` 非 `null` 时，其中的文字拼接必须严格等于字段 `value`，否则保存返回 `400 INVALID_RESUME_DOCUMENT`。`runs` 最多 1000 项；`prefix_runs` 最多 100 项、合计不超过 101 字符，用于联系方式和经历字段的显示标签，渲染时仅在其文字与当前生成标签完全相符时采用。字号仍由 `InlineStyle.font_size_pt` 约束为 6–48 pt。缺少或为 `null` 的两个可选字段继续按旧数据读取，并在序列化时省略，避免改变未设置样式的历史内容摘要；有样式的新快照必须由支持该扩展的前后端及 PDF 渲染器共同读写。

简历 API、Python DTO 和 TypeScript 类型统一使用 `snake_case`，数据库 ID 在 HTTP 中使用十进制字符串。维护窗口升级到 `0047` 后，运行期只接受 `schema_version=canonical-resume.v1` 的 `data` 和 `schema_version=resume-presentation.v1` 的 `style`；旧 `basics/semantic_sections/custom_sections` 与旧 `manifest` 只允许进入一次性迁移转换器，不能通过普通保存、模板切换、版本、Agent、分享或 PDF API 写回。`CanonicalResumeDocument` 使用稳定 `node_*`、identity、按语义排序的 sections、段落/列表/媒体以及章节内 `row`（`pair` 两格、`meta` 四格、`trio` 三格、`equal` 三或四格等分；等分行可选携带与格数等长的每栏宽度占比，缺省即等分且不写入该字段）和 `source_refs/source_dispositions` 保存唯一内容真值；row/cell 是模板无关的正文结构，禁止保存模板级 region、slot、sidebar/main、column、CSS、分页和编辑器 selection。`TemplateDefinition` 的严格 `avatar` 包含 `visibility`、`fallback_asset`、`size_px` 和已声明的 `region_id`；系统默认头像只在渲染投影中出现，不写回 canonical 正文。`ResumePresentation` 使用 `portable/template_scoped/template_snapshot` 保存展示设置与当前模板快照；`portable.smart_one_page` 控制连续单页或标准 A4 导出。模板切换只更换模板身份、presentation 与后端编译的 `LayoutPlan`，正文规范摘要必须保持不变。字段闭集、数量和长度、URL、node/source 唯一性与来源闭包均严格校验；LLM 只返回稀疏语义标注，未标注源块由确定性组合器保留，不生成“未分类内容”。旧 `markdown/settings/splitRatio/previewScale/lockVersion` 不是简历写契约。

Alembic `0036` 在写入前预检全部模板、当前简历和历史版本，把旧 `"1.0"` JSON 一次性转换为上述唯一契约；`0037`–`0040` 依次拆分官方编辑 Markdown、移除 typed 副本、规范区块 ID 并修正双栏插槽。`0041` 再对模板、当前简历和历史版本全量预检，把旧整篇编辑正文及跨章节残留的 `sidebar/main` 页级包装转换为无投影语义块，保留可见文字与私有用户头像，并为双栏 manifest 补齐 `profile/interests` 路由；写后重复完整校验。`0042` 恢复经典技术模板及既有快照的生产页边距并从目录删除 `blank-cn`，历史简历依靠 `ON DELETE SET NULL` 暂时只清空来源引用。`0043` 增加资料上传幂等和可靠调度字段，`0044`–`0046` 建立并收敛 `user_profiles`。`0047` 全量只读预检后执行 canonical 切流；若历史简历或版本仍引用 `blank-cn`，先创建不含用户内容、`is_active=0` 的 tombstone 身份，再把各行绑定到该身份，各自正文和冻结样式仍从自己的旧快照转换。未知退役身份、关系冲突或非法 JSON 在首次写入前阻断。`0048` 确定性重组 canonical row 并恢复 avatar 策略；`0049` 为活动导入任务回填受理时模板定义；`0050` 规范官方模板图标；`0051` 修复已标记迁移环境中的画像结构漂移；`0052` 为 Agent 会话增加持久化置顶状态及对应列表索引；`0053` 简化 Offer 状态并增加可选详情；`0054` 将 Offer 薪资收敛为单值字段；`0055` 允许手工创建的岗位不填写职位描述；`0056` 将岗位性质收敛为实习、校招和正式三类；`0057` 增加求职生命周期、阶段历史及排期关联；`0058` 增加开放作答窗口；`0059` 增加岗位 Logo URL 与独立全局公司资料表；`0060` 增加资料库文件夹分类；`0061` 增加资料当前正文指针、替换操作与对象清理记录。所有 revision 均为 forward-only，发布顺序仍为停止旧写入、备份、从真实 current 按顺序升级到 `0061`、验证后启动新应用；失败时依赖备份恢复，不执行 downgrade。

| Method   | Path                        | 鉴权 | 成功结果                                                         |
| -------- | --------------------------- | ---- | ---------------------------------------------------------------- |
| `GET`    | `/api/resume-templates`     | 是   | `{templates}` 启用且结构有效的模板列表，含 `style_categories`、`use_cases` 数组和 `use_count`（当前引用该模板的简历数，全站聚合）；按 `sort_order`、ID 升序 |
| `GET`    | `/api/resume-templates/:id` | 是   | `{template}`，含同样的分类数组和 `use_count` |
| `GET`    | `/api/resumes`              | 是   | `{resumes}`，摘要含可选 `preview`，按更新时间倒序                |
| `POST`   | `/api/resumes`              | 是   | `201 {resume}`；请求必填 `{title, template_id}`                  |
| `GET`    | `/api/resumes/:id`          | 是   | `{resume}`                                                       |
| `POST`   | `/api/resumes/:id/semantic-classification` | 是 | 对当前自定义章节返回 `{content_hash, suggestions}`，不写入简历 |
| `PUT`    | `/api/resumes/:id`          | 是   | `{resume}`；请求含 `base_lock_version` 及可选 `title/data/style` |
| `POST`   | `/api/resumes/:id/apply-template` | 是 | `{resume}`；请求含 `{template_id, base_lock_version}` 及可选 `title/data`，原子保存最新内容并切换模板 |
| `GET`    | `/api/resumes/:id/pdf?lock_version=...` | 是 | 当前 Web 快照的 PDF；版本不一致返回 `409 RESUME_PDF_SNAPSHOT_STALE` |
| `DELETE` | `/api/resumes/:id`          | 是   | `{deleted}`                                                      |

两个模板读取接口返回的 `layout_plan` 由后端从模板的 `data_json`、`style_json` 编译；内容相同的模板复用同一份进程内缓存，管理员改写模板后缓存随内容变化自动失效。缓存只影响请求耗时，不改变响应结构、字段含义、排序和错误语义。

所有新简历都从当前启用的非空白模板创建；历史 `blank-cn` 已由 `0042` 从产品目录退役，`0047` 仅在仍有历史引用时恢复为 `is_active=0` 的不可选身份。普通创建先把名称去首尾空白、折叠连续空白，再按 Unicode `casefold` 比较同一用户已有名称；重复返回 `409 RESUME_TITLE_CONFLICT`，名称为空或超过 255 字符返回 `400 INVALID_RESUME_TITLE`，缺模板返回 `400 TEMPLATE_REQUIRED`，模板不存在、停用或结构无效返回 `422 TEMPLATE_INACTIVE`。历史简历和版本在 `0047` 后模板外键非空，可继续读取、编辑或切换到启用模板，但不能用 tombstone 新建或切换；历史重名不回填也不阻止保持原名。

模板切换使用独立原子接口，不通过普通 `PUT` 猜测模板身份。旧调用方可只发送模板 ID 和锁版本；Web 同时发送当前 `title/data`，服务端验证简历归属、目标模板启用状态、完整快照和内容 ID 到目标插槽的唯一组合计划后，在同一条件更新中保存最新标题与正文、替换目标模板 `style`、写入 `template_id` 并递增 `lock_version`。目标模板只提供呈现，不能用自己的示例正文覆盖用户数据。过期基准返回 `409 RESUME_EDIT_CONFLICT`，标题冲突返回 `409 RESUME_TITLE_CONFLICT`，模板不存在、停用或结构无效返回 `422 TEMPLATE_INACTIVE`，内容无法完整且唯一地映射到目标模板时返回 `422 TEMPLATE_COMPOSITION_INVALID`；任一失败都不产生“内容已保存但模板未切换”或相反的半状态。

语义分类请求携带当前规范 `data` 的 `sha256:` 内容哈希和可选章节 ID 列表。分类器只接收自定义章节的标题、正文和相邻标题，必须综合上下文，不在模板切换时调用，也不改写正文或持久化建议；相同用户、简历、内容哈希和章节集合的成功结果在 Redis 缓存 1 小时，重复请求不重复调用模型；响应包含稳定章节 ID、建议类型、置信度和依据。内容已变化返回 `409 RESUME_SEMANTIC_CLASSIFICATION_STALE`，章节选择非法返回 `400 INVALID_RESUME_SEMANTIC_CLASSIFICATION`，模型不可用或返回越界 ID 返回 `503 RESUME_SEMANTIC_CLASSIFICATION_UNAVAILABLE`。未登录返回 `401 UNAUTHORIZED`，不存在或越权统一返回 `404 RESUME_NOT_FOUND`。

Web PDF 请求必须携带当前保存成功后的 `lock_version`。服务端再次校验 Web Cookie 或 desktop Bearer 用户、简历归属和版本，然后以当前 `data/style` 快照调用受控 Chromium；Linux 部署可用专用账号降权运行，Windows 本地环境没有 Unix 账号 API 时直接运行 Node，这一内部选择不改变 HTTP 响应契约。成功响应为 `application/pdf`、`private, no-store`，并携带 `Content-Disposition`、`X-LinkResume-Pdf-Lock-Version` 和 `X-Content-Type-Options: nosniff`。固定模式按 A4 分页，智能一页保持 210mm 宽并按内容增长，超过 2000mm 返回 `413 RESUME_PDF_PAGE_TOO_TALL`。简历级图片只接受 PNG/JPEG，上传与 PDF 读取共用 10 MiB 单图上限，一份当前快照引用的私有图片原始二进制总量上限为 10 MiB；更新简历、切换模板和复制当前简历均在持久化前校验该契约，超限返回 `413 RESUME_PDF_ASSET_TOO_LARGE` 或 `413 RESUME_PDF_ASSETS_TOO_LARGE`，因此不能保存成随后无法导出的当前快照。私有图片只从已校验的用户/简历对象键读取，缺失、不支持或超限分别以稳定 `RESUME_PDF_*` 错误失败关闭；正文中的外部资源不会被渲染器联网获取。

每个用户最多保存 10 份正式简历；创建事务锁定用户行后检查，达到上限返回 `409 RESUME_LIMIT_REACHED`。创建只写当前简历，不创建历史记录。更新同时保存完整 data/style 并递增 `lock_version`，不创建历史版本；过期基准返回 `409 RESUME_EDIT_CONFLICT`。非法内容和样式分别返回 `400 INVALID_RESUME_DOCUMENT`、`400 INVALID_RESUME_STYLE`。不存在或不属于当前用户的简历统一返回 `404 RESUME_NOT_FOUND`。

## 当前内容复制与存量取回

简历不提供历史管理。`0089` 删除历史表及全部 `/api/resumes/:id/versions` 路由（包括读取、复制、恢复等子路由），请求返回 404。图片删除只检查当前正文引用。

- POST /api/resumes/:id/copy 接受 {title,base_lock_version,client_request_id}，请求 ID 必须为 UUID；成功 201 {resume}，相同请求重试 200 返回同一副本。
- 同请求 ID 不同参数返回 409 RESUME_COPY_REQUEST_CONFLICT；过期锁返回 409 RESUME_EDIT_CONFLICT；标题冲突与简历数量上限分别为 RESUME_TITLE_CONFLICT、RESUME_LIMIT_REACHED；图片复制失败返回 502 RESUME_COPY_ASSET_FAILED，不保留半成品。
- 副本保留正文和模板快照（包括已下架模板），源简历专属图片复制到新命名空间，不继承分享链接和导入任务。仅写入当前简历表。

## 简历智能助手

除部署探针 `GET /api/agent/readiness` 外，智能助手接口全部要求登录，且会话、运行、模型摘要与提案都按当前用户重新校验归属；不存在或越权资源返回对应 `AGENT_*_NOT_FOUND`，不暴露其他用户数据。消息发送使用 POST SSE，不使用浏览器原生 `EventSource`。

消息请求另支持可选 `revision_proposal_id`，只接受当前用户、当前会话内的 pending 提案。服务端从该提案确定本轮目标简历并提供原提案上下文，不采信客户端传来的提案正文；澄清续答继承该关联。会话消息返回可空 `run_id`，供客户端按来源轮次归组。提案列表默认仅返回最近 20 项 pending 提案，增加 `include_history=true` 可返回最近 200 项全部状态，仍受用户及查询过滤条件约束。提案返回可空 `superseded_by`：替代提案成功创建时，在同一事务中把原提案置为 rejected 并在原消息元数据记录替代 ID；有此字段的界面显示“已被替代”，不能再确认。新消息、取消或创建失败本身不会放弃原提案。

Pi 在执行前通过服务间 `POST /internal/agent/runs/:runId/tasks:plan` 保存 1–8 项任务；每项包含唯一 `id`、`workflow`、`output`、`label`、只引用前序任务的 `depends_on` 和可选的本轮已授权 `context_refs`。任务通过 `POST /internal/agent/runs/:runId/tasks/:taskId:status` 依次更新为 `running` 和 `completed|partial|blocked|failed`。计划与结果写在该 run 的用户消息元数据中，会话回读时该消息可返回 `tasks`；提案类任务的 `proposal_ids` 必须确属同一 run。服务端拒绝未授权资料引用、重复改写计划、非法状态转换和未完成依赖。`run.status=succeeded` 只表示模型运行正常结束，不代替各任务的业务结果。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/agent/readiness` | `200 {ready: true, steering: true}`；steering 表示插入能力，只读校验完整 Agent 服务链，不返回模型或凭据 |
| `GET` | `/api/agent/model` | `200 {model: {id, name}}`；返回默认有效对话逻辑模型的非敏感摘要 |
| `GET` | `/api/agent/models` | `{models:[{id,name}],defaultModelId}`；只返回管理员标记为用户可选的有效对话模型，按逻辑模型去重 |
| `GET` | `/api/agent/contexts[?type=:type&q=:query&prefix=:bool&limit=:limit]` | `{contexts}`；返回当前用户可选的轻量资料引用，类型为 `resume`、`dataset`、`job`、`application` 或 `interview`；`prefix=true` 时按名称前缀匹配；`dataset` 只包含解析成功且转换对象有效的本人资料，不返回正文 |
| `GET` | `/api/agent/sessions` | `{sessions}`；返回当前用户最近更新的至多 50 个独立会话，不按简历绑定或过滤 |
| `POST` | `/api/agent/sessions` | `201 {session}`；请求为 `{title?,modelId?,resume_id?}`，其中 `resume_id` 只为旧 Web 缓存兼容而接收并忽略，不校验、不持久化也不返回绑定语义；会话不保存默认简历 |
| `GET` | `/api/agent/sessions/:sessionId` | `{session}`，包含最近 100 条消息 |
| `PATCH` | `/api/agent/sessions/:sessionId` | `200 {session}`；请求至少包含一个字段，可更新 `title`（trim 后 1–128 字符）、`pinned`（布尔值）或 `modelId`（有效逻辑模型 ID；null 表示跟随默认） |
| `DELETE` | `/api/agent/sessions/:sessionId` | `204`；无运行中任务时永久删除该会话及其 Agent 依赖数据 |
| `POST` | `/api/agent/sessions/:sessionId/messages` | SSE；请求为 `{content, idempotency_key, selection_context?, contexts?, reply_to_sequence_no?, clarification_answers?, replace_inherited_resume?}`；`contexts` 是唯一的本轮资料协议，最多 10 项且同类型只能选择一项，每项携带服务端返回的 `type`、`id` 和版本标记；当前简历使用 `{type:"resume",id}`，独立助手中自动附带的已打开简历额外使用 `presentation:"implicit"`，该兼容新增字段只控制用户消息是否展示引用单元，不改变授权或模型材料。服务端按当前用户解析为消息级快照和材料，不写入会话。选区包含稳定块 ID、编辑器范围、原文和 SHA-256，并随来源消息持久化；回答结构化澄清问题时携带对应助手消息序号，服务端同时继承并复验原上下文、展示来源与选区，当前 Web 发送 `{question_id,option_id,value?}` 数组 |
| `GET` | `/api/agent/sessions/:sessionId/active-run` | `{run: {run_id,status,started_at} \| null}`；只返回本人会话当前仍在运行的 run，用于刷新或返回助手页后恢复状态 |
| `GET` | `/api/agent/runs/:runId/events` | SSE；重新订阅本人 run 的缓冲事件，运行完成后仍以既有 `run.*` 终态结束 |
| `POST` | `/api/agent/runs/:runId/cancel` | `{run_id, status}`；重复取消幂等 |
| `GET` | `/api/agent/proposals?resume_id=:id&session_id=:sessionId` | `{proposals}`，只返回当前待确认提案；两个过滤条件至少提供一个，`session_id` 按本人会话过滤且不要求会话绑定该简历 |
| `POST` | `/api/agent/proposals/:proposalId/confirm` | 可选请求体 `{entry: "assistant" \| "editor"}` 只用于产品漏斗，缺省记为 `unknown`，其他取值返回 422；`{resume}`；普通范围化提案只更新源简历的当前内容；若仅有无关提案先行应用导致版本变化，服务端按目标哈希在当前快照安全重放，目标自身变化才返回 `TARGET_STALE`；旧快照与 `translate_resume` 仍要求原始版本，翻译提案返回新创建的独立简历 |
| `POST` | `/api/agent/proposals/:proposalId/reject` | `{proposal}`；放弃待确认提案 |

SSE 事件包括 `run.started`、`run.phase`、`assistant.activity.delta`、`assistant.activity.status`、`assistant.activity.clear`、`assistant.delta`、`clarification.requested`、`tool.started`、`tool.completed`、`proposal.created`、`run.completed`、`run.cancelled` 和 `run.failed`。Pi 在工具阶段把模型主动生成的可见 `text_delta` 和兼容的工具执行标签逐个发送为临时 `assistant.activity.delta`；结构化 `assistant.activity.status` 携带 `{runId,callKey,label,status,errorCode?}`，其中 `status` 为 `running|succeeded|failed`，浏览器必须按 `callKey` 原位更新而不是追加重复步骤，失败时只暴露稳定错误码。隐藏思考 delta、工具调用参数和工具结果不进入这些事件；原有 `tool.started/tool.completed` 继续只服务运行兼容与业务工具审计。全部业务工具完成后，模型必须调用不进入工具审计的内部切换工具；Pi 先发送一次 `assistant.activity.clear` 并关闭本轮工具，再把下一轮每个正式回复 `text_delta` 实时发送为 `assistant.delta`，不等待整条 assistant message 结束。临时活动只保存在运行事件缓冲中，不进入助手消息正文；结构化澄清也会先清空活动区，并只持久化服务端生成的澄清文本。`run.phase` 只允许服务端定义的稳定阶段和安全化文案，并可携带实际引用资料数量，不暴露工具参数或推理内容。`clarification.requested` 携带版本化的 `clarification`：1–3 个问题，每题 2–3 个 `{id,label,description?}` 选项；客户端额外提供自由输入的“其他”。该成功运行把助手消息以 `message_type=clarification` 持久化，普通文本消息为 `message_type=text`。回答只有在 `reply_to_sequence_no` 仍指向当前会话最后一条澄清消息时才创建新运行，否则返回 `409 AGENT_CLARIFICATION_STALE`，客户端应刷新当前会话。服务端从该澄清所属 run 的用户消息继承原始 `contexts` 和 `selection_context`，重新校验资源存在性、归属和版本，再与客户端本轮引用合并；未经显式替换的同类资源目标或选区不同返回 `409 AGENT_CLARIFICATION_CONTEXT_CONFLICT`；仅当澄清续答显式携带新的简历引用与 `replace_inherited_resume:true` 时允许更换简历，服务端重新验证归属与当前内容并丢弃原简历选区，其他资料仍沿用冲突保护；历史快照损坏返回 `409 AGENT_CLARIFICATION_CONTEXT_INVALID`。服务端按原问题复验 `clarification_answers` 的问题与选项并保存规范化答案；历史客户端可以只发送展示文本，但当前 Web 不依赖该兼容路径。澄清续答要改用另一份简历时，必须同时提交新简历引用与 `replace_inherited_resume=true`；服务端重新校验归属和当前内容，丢弃旧简历选区。该标记只用于澄清续答或插入中的简历替换，不能替换其他类型的资料。每个成功建立的 SSE 响应必须以后三种 `run.*` 终态之一结束；Pi 在 HTTP 200 后提前 EOF 时 FastAPI 补发 `run.failed/AGENT_UPSTREAM_FAILED`，浏览器也会把无终态 EOF 识别为 `AGENT_STREAM_INCOMPLETE`。完整回复在完成事件前分别持久化，运行终态收口 Token/估算成本；后来失败或取消保留此前完整回复，未完成片段不保存。同一用户只允许一个 running 运行；相同 `idempotency_key` 重放现有运行状态。取消与流式完成并发时采用第一个成功写入的终态，后到操作不得覆盖。
FastAPI 在进程内独立消费 Pi 流并缓冲可见事件，单个浏览器订阅断开不会取消模型运行；Web 返回助手页时先查询当前 run，再从头重放该 run 的缓冲事件，因此刷新、SPA 路由切换或切换其他会话不会丢失思考/输出状态。只有显式调用 cancel 才取消运行。事件缓冲是 FastAPI 进程内状态；若后端进程重启而数据库仍残留 running run，重连会以 `AGENT_STREAM_INCOMPLETE` 失败收口，不会重复调用模型。

`/api/agent/model` 返回默认有效对话模型的 `{model:{id,name}}`；`/api/agent/models` 返回去重后的可选列表和 `defaultModelId`，均不返回密钥、地址或价格。没有有效线路时前者返回 `503 LLM_MODEL_NOT_CONFIGURED`，后者返回空列表。`AgentSessionRecord.selected_model_id` 为可空字符串；null 表示跟随当前默认。POST/PATCH 的 `modelId` 由服务端按当前有效对话模型列表校验，其他用户的会话仍按 `404 AGENT_SESSION_NOT_FOUND` 处理。用户已选模型失效时新运行返回 `409 AGENT_MODEL_UNAVAILABLE`，不切换到其他逻辑模型。逻辑模型的 `user_selectable=false` 时，该模型在对话能力中视同无效：不进入列表、不作为默认模型、不能被新建或修改的会话选择，已选中它的会话新运行同样返回 `409 AGENT_MODEL_UNAVAILABLE`；已开始的运行继续使用冻结线路。所有对话模型都被隐藏时按未配置处理。该开关只作用于 `assistant_conversation`，系统能力仍可使用隐藏模型。

`AgentSessionRecord` 仍包含布尔 `pinned`，不包含默认 `resume_id`；会话列表先按 `pinned DESC`，再按 `updated_at DESC, id DESC`。PATCH 不创建消息或启动模型调用。DELETE 会锁定会话和运行；存在 `status=running` 的运行返回 `409 AGENT_RUN_IN_PROGRESS`，否则清理该会话及其 Agent 依赖数据。

独立助手页选择的资料不是可信正文：FastAPI 按当前用户重新查询每项资源、核对版本标记、拒绝不存在、越权或已过期的引用，初始传给 Pi 的 `contextMaterials` 只含受控目录字段，不含正文。任务清单的 `context_refs` 必须是本轮引用的子集；启动任务后，内部材料接口再次校验当前归属和版本，只返回该任务引用的有界正文，并在任务结果中保存不含正文、包含内容指纹的来源收据。材料已变化时该任务受阻，不让旧正文继续进入模型。用户消息只持久化轻量引用快照，后续读取不会把历史正文重新注入。独立助手每轮选择的简历不会绑定会话；用户明确指定名称、ID 或轻量目录中的某份简历时，Pi 调用受限解析工具，FastAPI 按当前用户归属解析本轮目标。名称同名时返回候选；用户已给出更新时间等版本条件后，Pi 可用对应候选 ID 精确解析，不要求重新通过 `@` 选择。目标 locator 随范围读取、诊断和提案请求传递，跨用户结果继续不可见。Agent 不能直接写简历：普通修改先解析稳定 locator、读取最小范围、生成结构化诊断并创建类型化 operation 提案；复合局部请求必须一次提交完整任务清单，由 Pi 冻结后串行执行每个目标的定位、读取、诊断和独立提案，不能用共享可变目标状态并行创建提案。同一批处理调用在当前 run 内幂等，单项失败不会自动重试或阻止后续任务；整篇翻译创建 `translate_resume` 提案。

确认普通范围化提案时，服务端始终在当前正文重新校验目标哈希并重放 operation，保留当前样式；不相交提案或手工编辑引起的内部锁变化不阻止应用。目标自身变化返回 `409 TARGET_STALE`，旧完整快照和翻译提案仍严格检查内部锁，变化返回 `409 RESUME_EDIT_CONFLICT`。普通确认原子提交当前正文和提案状态，不读取或写入历史版本，不再返回 `RESUME_VERSION_LIMIT_REACHED`；重复确认直接返回当前简历，不重放、不回退之后的编辑。响应仍为 `{resume}`。

确认翻译提案时源简历保持不变，创建新的 Resume，不创建历史记录，并以 `result_resume_id` 保证重复确认幂等。源 Resume 私有图片复制到新命名空间，账户级图片保持共享引用。翻译还可能返回 `RESUME_TITLE_CONFLICT`、`RESUME_LIMIT_REACHED`、`RESUME_TRANSLATION_INVALID` 或 `RESUME_TRANSLATION_ASSET_COPY_FAILED`。过期提案返回 `410 AGENT_PROPOSAL_EXPIRED`。服务或模型错误继续使用安全化公开 code，供应商原始错误和 API Key 不进入浏览器响应。

`/internal/agent/**` 仅供 Pi 服务使用，以独立 Bearer token 鉴权且不出现在 OpenAPI。`POST /runs/:runId/resources:list` 接受可选的 `{types,query,limit}`，其中类型只允许 `resume/dataset/interview`；它从 run 反查当前用户，按类型分别限制数量，并只返回 ID、名称、状态、版本和更新时间等轻量目录，不返回简历、资料或面试正文。`POST /runs/:runId/resumes:resolve-reference` 接受至少一个 `{title?,resume_id?}`，只解析属于当前用户的简历并返回整份简历 locator，不修改会话；名称不存在或同名不唯一返回 `not_found/ambiguous`，候选 ID 可用于用户已明确版本后的精确解析。除兼容的完整上下文和快照提案接口外，范围化编辑工具继续使用 `POST /runs/:runId/targets:resolve`、`context:read`、`materials:search`、`diagnoses` 和 `proposals:v2`；`materials:search` 的请求与响应不变；Pi 的 `search_resume_materials` 工具仅在需要资料事实时调用，默认查询 `dataset` 并固定 `limit=6`。启用 LinkRag 时其 `dataset` 部分按多路融合排序返回前 6 条，未建索引的资料和 LinkRag 失败时回退子串匹配；`targets:resolve` 可携带当前运行已由 `resolve-reference` 得到的 `resume_id`，仍由 FastAPI 复验当前用户归属。Pi 的模型工具只提交 `context:read` 已返回的 `block_id`、操作类型和新文本，Pi 运行时用同一读取结果补入完整 locator 与 expected-text hash 后再请求 `proposals:v2`，未知块在进入 FastAPI 前即拒绝。经历字段 locator 的 `field` 使用具体字段键；空字符串 `replace_target_text` 清空块内选区或可选字段，`delete_target` 删除 section/entry 正文中的完整 paragraph/list item canonical 节点且禁止携带新文本，`insert_after_target` 仍禁止空内容。整篇翻译使用 `POST /runs/:runId/proposals:translation`。目标出现零处或多处时不允许创建提案；用户已经明确父 section/entry 时，Pi 可先读取该范围，再按返回的不同 `block_id` 为重复短文本分别创建提案。诊断 fingerprint、资料版本、执行模式和 operation 范围由 FastAPI 复验。`GET /internal/agent/readiness` 验证默认有效对话线路、凭据解密和 Pi provider 映射，不发起供应商模型调用；工具事件的 `tool_name` 白名单包含批量局部修改工具 `execute_local_resume_edit_plan`，并以 `(run_id, call_key)` 幂等，同一工具调用进入 succeeded、failed 或 cancelled 后不可回退或改写为另一终态。工具参数在 Pi 执行函数前校验失败时以 `AGENT_TOOL_ARGUMENT_INVALID` 记为 failed，不上传原始参数。内部运行配置读取 `agent_runs` 冻结的首选线路，并下发同模型的有序备用线路及其价格快照；模型配置页面仍是 `/admin/llm/models`，不新增第二套 Pi 配置 UI。

### 消息排队与插入回执

队列编辑和排序在浏览器完成，没有服务端队列 CRUD。普通消息在首次接收时记录规范化请求指纹；相同 `idempotency_key` 不同正文或引用返回 `409 AGENT_SUBMISSION_CONFLICT`，同一请求仍重放原运行。会话消息增加可空 `submission_key`、`reply_to_sequence_no`；提案增加可空 `source_user_sequence_no`，均来自既有消息元数据，历史单请求 run 保持兼容。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/agent/sessions/:sessionId/submissions/:submissionKey` | 普通提交回执；未找到返回 `404 AGENT_SUBMISSION_NOT_FOUND`，不能据此换标识重复发送 |
| `POST` | `/api/agent/runs/:runId/steer` | `202` 插入回执，正文、引用、选区、幂等键及 `replace_inherited_resume` 沿用消息协议；可关联本人同会话 pending 提案，不能回答澄清 |
| `GET` | `/api/agent/runs/:runId/steer/:submissionKey` | 优先回读正式消息，再查询活动 Pi 句柄；回执包含 `run_id/submission_key/state/user_sequence_no?/run_status?/error?` |

插入状态为 `waiting`（Pi 已接收）、`accepted`（正式消息已激活）、`applied`（已进入 Pi 对话）、`not_applied`（确认未激活）或 `unknown`（无法核实）。`202` 不保证已经生效。另一条插入尚未消费返回 `409 AGENT_STEER_BUSY`，目标已结束返回 `409 AGENT_STEER_TARGET_FINISHED`，同标识内容变化返回 `409 AGENT_SUBMISSION_CONFLICT`。接收与安全边界激活都校验本人引用和版本；更换简历须明确替换意图并丢弃旧选区。回执重试保持原接收结果，不重新继承后来请求的资料。终态且没有正式激活记录可确认 `not_applied`，仍运行但 Pi 失联只能返回 `unknown`。客户端对未知结果保持冻结并暂停，对 `accepted` 不自动重复执行。

新增 SSE `user.message.accepted`、`user.message.applied`、`user.message.rejected` 和 `assistant.message.completed`，携带 `runId/submissionKey/userSequenceNo`；完成事件另含 `sequenceNo/content/clarification?`，在正式回复落库后发出。过程、正文、任务、澄清和提案事件追加 `userSequenceNo`。同一 run 可有多条用户请求和各自完整回复；后来失败保留此前结果，终态不再次拼接或保存不同请求的正文。重放时按来源与正式消息序号去重。

Pi 服务令牌保护的 POST/GET `/internal/agent/runs/:runId/steer[/:submissionKey]` 只协调进程内输入。FastAPI 服务间 POST `/internal/agent/runs/:runId/steering:activate`、`steering:ack` 与 `messages:complete` 分别激活、确认消费和持久化完整回复。工具回调的可信 `X-Agent-User-Sequence` 必须对应当前活动用户消息；不匹配或多消息 run 缺失来源返回 `409 AGENT_REQUEST_SCOPE_STALE`，仍从 run 反查用户与会话，不能把序号当身份。

## 简历分享链接

每份简历一个分享链接，分享状态直接落在 `resumes` 表的 `share_*` 字段，不单独建表。分享内容不另落快照：公开读取时实时取简历主记录中最近一次保存成功的 `data/style` 草稿；所有者自动保存成功后，已分享内容随之更新，不要求创建正式版本。管理接口全部要求登录且只能操作本人简历（`404 RESUME_NOT_FOUND`）；公开接口 `/api/share/{token}` 允许未登录访问。

| Method   | Path                  | 鉴权 | 成功结果                                                                 |
| -------- | --------------------- | ---- | ------------------------------------------------------------------------ |
| `GET`    | `/api/resumes/:id/share`    | 是   | `{share}`；未开启分享时 `share` 为 `null`                        |
| `POST`   | `/api/resumes/:id/share`    | 是   | `{share}`；请求可选 `{visibility, expires_at, allow_download}`，无链接时创建，已有链接时作废旧 token 并生成新 token（一键覆盖） |
| `PATCH`  | `/api/resumes/:id/share`    | 是   | `{share}`；请求可选 `{visibility, expires_at, allow_download}`，可续期、修改可见性或下载权限 |
| `DELETE` | `/api/resumes/:id/share`    | 是   | `{deleted: true}`；清空分享字段，旧地址访问统一失效，重复删除幂等          |
| `GET`    | `/api/share/{token}`        | 否   | `{data, style, layout_plan, assets, sharer, allow_download, expires_at, updated_at}`；`sharer` 为 `{nickname, avatar_url}`；`expires_at` 为分享有效期（`null` 表示长期有效），`updated_at` 为简历主记录最近更新时间（分享设置变更也会刷新） |
| `GET`    | `/api/share/{token}/pdf`    | 否   | 当前已保存草稿的 A4 分页 PDF；沿用分享 token 的访问规则并要求允许下载 |

`share` 为 `{share_token, share_visibility, share_expires_at, share_allow_download, share_created_at}`。`share_visibility` 只允许 `public|private`，`share_expires_at` 为带时区的 ISO 8601，`null` 表示长期有效；`share_allow_download` 为布尔值，旧记录和创建缺省值均为 `true`。`private` 时只有分享者本人登录可见，未登录或其他用户访问一律按失效处理。

公开读取在通过 token、过期时间和 `private` 所有者校验后，从分享记录反查用户与简历，实时读取简历主记录中最近一次保存成功的 `data/style` 草稿，并把该草稿引用的本人私有 PNG/JPEG 解析为 `assets` 映射中的 data URI；无需创建正式版本，自动保存成功后公开内容立即更新，尚未保存成功的浏览器本地编辑不会公开。浏览器不直接匿名访问私有资源路由。对象键不能由匿名请求指定，单图和快照图片原始总量继续分别受 10 MiB 上限约束。JSON 与 PDF 成功响应都使用 `Cache-Control: private, no-store`。公开 PDF 复用编辑器的受控 Node/Chromium 渲染器，固定按 A4 分页生成，只包含简历文档，不包含分享页头部或操作按钮，并返回 `Content-Disposition`、`X-LinkResume-Pdf-Lock-Version` 和 `X-Content-Type-Options: nosniff`。`allow_download=false` 时公开 JSON 仍可读取并用于隐藏入口，但 PDF 路由对未登录访问者、其他登录用户和分享者本人统一返回 `404 SHARE_LINK_UNAVAILABLE`。

`POST` 创建或覆盖请求可选 `{visibility, expires_at, allow_download}`，分别指定可见性（缺省 `public`）、有效期（缺省永久，即 `expires_at` 为 `null`）和 PDF 下载权限（缺省 `true`）。`PATCH` 用 `model_fields_set` 区分传入字段，可单独续期（延长或清除 `expires_at`）、切换可见性或更新下载权限；未开启分享时返回 `404 SHARE_LINK_UNAVAILABLE`。token 使用 `secrets.token_urlsafe(16)`（约 160 bit 熵）且全局唯一，冲突重试 3 次。为避免枚举探测，以下场景在管理侧与公开侧统一返回 `404 SHARE_LINK_UNAVAILABLE`：token 不存在、已删除、已过期、`private` 无权查看、分享记录对应的用户或简历不存在，以及直接请求已关闭下载的 PDF。过期后可再次 `PATCH expires_at` 恢复访问，不需重建链接。

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

RabbitMQ 是默认 Broker，V2 使用 `tolink.resume.resume_import.v2` exchange、`linkresume.resume_import.worker.v2` queue 和固定 `resume.import.v2` routing key；Kafka 兼容实现使用同名 V2 topic、独立 V2 consumer group，并以规范任务 ID 作为消息 key。Resume 与 Dataset 消息正文都强制 `pipeline_version="v2"`，旧版或未知消息不会进入业务 Processor。独立 Worker 从私有对象存储读取文件，Markdown 本地转换，DOCX/PDF 经 LinkParse，再走 `SourceLayoutIR → 模型映射决策 → 规范组合器`。`SourceLayoutIR` 保存源块全局顺序、跨度、列表类型、起始序号、项目序号和嵌套深度；模型只能为每个稳定源块选择语义/布局角色和受限分组，不能返回正文或决定丢弃。程序要求每个源块恰好使用一次，再按任务受理时冻结的模板定义生成 canonical 简历：联系信息保持同一信息行；单块左右经历头必须有显式 `entry_header` 决策与原文分隔符，普通正文不猜测；同语义嵌套 heading 保留在父章节；有序与嵌套列表使用合法 CommonMark，超过 50 个源引用时分片并延续实际序号；章节保持来源顺序，不生成“未分类内容”。转换存档写到 `users/{user_id}/resume-imports/{operation_id}/artifacts/converted.md`；只有任务仍为本人 `processing` 时才允许上传并写回对象引用。解析成功时以安全化文件名的 stem 作为标题；同一用户已有规范键同名标题时，在用户行锁内依次追加数字后缀 `1`、`2` 直到可用。解析内容作为 data，受理时冻结的模板 ID 与完整 `TemplateDefinition` 快照提供 style。Worker 持久化前只锁定模板行并核对关系 key 仍指向同一模板身份，不重读当前样式，也不要求模板继续启用，因此受理后的模板更新或停用不会改变任务结果。正式简历、`resumes.parse_task_id` 结果关联和任务成功状态在一个数据库事务内提交；响应仍以 `result_resume_id` 返回关联结果。

缺少或使用非 canonical Header 返回 `400 INVALID_IDEMPOTENCY_KEY`。同一用户、Key 和请求指纹在 15 分钟映射窗口内重放同一导入记录：活动状态返回 `202`，成功终态返回 `200`，失败终态返回 `409 IMPORT_PREVIOUSLY_FAILED`；同 Key 异指纹返回 `409 IDEMPOTENCY_KEY_REUSED`。记录绑定前的短窗口返回 `409 IMPORT_ACCEPTANCE_IN_PROGRESS`，Redis 不可用返回 `503 IMPORT_IDEMPOTENCY_UNAVAILABLE`。记录创建后的错误响应在顶层 `import` 字段附带同一任务摘要。

`GET /api/resume-overview` 返回 `{resumes, active_imports, failed_imports, next_failed_cursor}`；失败列表支持 `failed_limit=1..50` 和服务端生成的 `failed_cursor`。`GET /api/resume-imports/:id` 返回本人的单个 `{import}` 任务摘要，查询前沿用陈旧任务收口；不存在、非法 ID 或越权统一返回 `404 RESUME_IMPORT_NOT_FOUND`。Web 只对 `upload_status=succeeded` 且 `parse_status=processing` 的任务按 ID 每秒独立查询，多个任务分别轮询，终态后停止；成功终态再一次性刷新 overview，使正式简历替换活动任务。`DELETE /api/resume-imports/:id` 只允许本人删除上传或解析失败记录，并同时清理源文件、当前 `artifacts/converted.md` 和旧版 `converted.md` 候选；活动任务返回 `409 RESUME_IMPORT_IN_PROGRESS`，不存在、非法 ID 或越权同样返回 `404 RESUME_IMPORT_NOT_FOUND`，对象删除失败返回 `502 ASSET_DELETE_FAILED`。

文件或模板无效时返回对应 `4xx` 且不创建正式简历。文字型、扫描和混合 PDF 都以 LinkParse Markdown 作为可编辑文字基线，并额外请求可选的 V1 layout；可安全解析且有界的页码、归一化 bbox、顺序、文字、置信度、角色、同行和续行作为精简模型提示，layout 的严格关系、计数、warning allowlist 和 Markdown 一致性只决定是否采用重建 Markdown。显式请求 layout 遇到 `413 LAYOUT_RESOURCE_LIMIT` 时，客户端在同一 deadline 内仅补发一次不含 layout 的 Markdown 请求，第二次失败按既有错误映射返回。layout 缺失、降级、畸形或不一致时保留 Markdown；若基础物理块仍安全，提示可以继续传给模型，不产生 `RESUME_LAYOUT_UNSUPPORTED`。PDF 固定请求 `include_images=false`，因此文字与图片混排的 PDF 只导入文字，源图片不进入简历且不会仅因原文件存在图片对象返回 `RESUME_LAYOUT_UNSUPPORTED`；模板头像保持为空。含图片/表格/文本框的 DOCX，以及转换后仍含表格、图片、嵌入或主动 HTML 的内容仍返回 `422 RESUME_LAYOUT_UNSUPPORTED`；源块映射不完整、重复、越界或分组非法返回 `422 RESUME_STRUCTURE_INVALID`。MinIO 上传失败会补偿删除可能写入的对象，再返回 `502 RESUME_SOURCE_UPLOAD_FAILED` 并保留上传失败记录；MQ publisher 初始化或 confirm 失败返回 `503 RESUME_IMPORT_QUEUE_UNAVAILABLE`，记录保存为解析失败且不会覆盖 Worker 已成功写入的终态。非法 MQ envelope 直接进入 DLT 且不调用 Processor；Processor 内部异常使用有界重试，耗尽后必须把可识别的简历导入任务写为失败终态，不能永久停留在 `processing`。转换、结构化或模板复核失败由 Worker 保存解析失败终态，不创建半成品，也不自动重试业务失败。正式简历与活动导入共享每用户 10 个名额；成功导入只是把活动占位转换为正式简历。

## 简历模板管理

`/api/admin/resume-templates` 只允许管理员访问。`GET` 返回按 `sort_order`、ID 升序排列的全部模板（包括启用、停用和结构无效项），包含 `style_categories`、`use_cases`、`style_review_status` 和 `sort_order`；`POST /import` 接受最大 512 KiB 的严格 UTF-8 JSON 模板包，新模板默认停用、分类为空，排序值取当前最大值加 10（上限 1000000），相同 `key` 返回 `409 TEMPLATE_KEY_CONFLICT`，不覆盖已有模板；`PUT /:id/status` 幂等启停，结构无效模板不能启用；`PUT /:id/sort-order` 接收整数 `sort_order`（0–1000000），保存后普通用户的模板列表和编辑器模板侧栏按该值升序展示，相同值按 ID 升序，非法值返回 422、不存在返回 `404 TEMPLATE_NOT_FOUND`；`PUT /order` 接收 `{template_ids}`，按列表顺序一次重写全部模板的 `sort_order` 为 10、20、30…，返回按新顺序排列的 `{templates}`；列表必须恰好包含每个现有模板一次，缺少或多出模板返回 `409 TEMPLATE_ORDER_STALE`（页面数据已过期，需重新加载），重复或非法 ID 返回 `422 TEMPLATE_ORDER_INVALID`，失败时已有顺序保持不变；`PUT /:id/classification` 接收完整的风格数组、场景数组和风格状态（`pending/classified/unsure`），校验标签枚举、重复值及状态与风格数组的一致性后覆盖该模板分类，不存在返回 `404 TEMPLATE_NOT_FOUND`。模板包必须携带合法 `TemplateManifest`，包含受支持 renderer、区域、插槽、唯一自定义兜底区和头像策略；同时拒绝未知字段、脚本、任意 HTML/CSS、外链、文件 URL、本地路径和媒体引用。`DELETE /:id` 硬删除模板并返回 204：只要仍有简历（`resumes.template_id`）或导入任务（`document_parse_tasks.selected_template_id`）引用该模板，就返回 `409 TEMPLATE_IN_USE`，响应附带 `resume_count` 与 `parse_task_count`，模板保持不变，下线应改用停用；不存在或 ID 非法返回 `404 TEMPLATE_NOT_FOUND`。当前不提供模板覆盖或强制删除。

## 知识库资料

`POST /api/datasets` 使用 `multipart/form-data`，必填字段为 `file` 和 `folder_id`（当前用户拥有的现存文件夹），并要求 canonical UUID `Idempotency-Key`。缺少或空白文件夹返回 `400 DATASET_FOLDER_REQUIRED`；非法、不存在、已删除或越权文件夹统一返回 `404 FOLDER_NOT_FOUND`，不创建资料、解析任务或存储对象，不再降级到未分类。支持 docx/pdf/md/txt 四种文档格式与 webm/m4a/mp3/wav/ogg/mp4/mov 七种音视频格式（扩展名大小写不敏感），服务端还会检查 PDF 结构、DOCX ZIP 结构与解压边界、文本编码和 NUL 字节，不信任浏览器 MIME。文档单文件上限由 `DATASET_UPLOAD_MAX_BYTES` 控制（默认 10 MiB）；媒体单文件上限由 `INTERVIEW_ASSET_UPLOAD_MAX_BYTES` 控制（默认 500 MiB），且媒体资料独立受 `MEDIA_MAX_COUNT_PER_USER`（默认 50）与 `MEDIA_MAX_TOTAL_BYTES_PER_USER`（默认 5 GiB）约束，超限返回 `409 DATASET_MEDIA_COUNT_LIMIT_REACHED`/`DATASET_MEDIA_STORAGE_LIMIT_REACHED`。文档上传先建立 `uploading` 容量预留，再写入 MinIO；成功后把任务提交为 `upload_status=succeeded/parse_status=queued`。媒体上传在短锁内完成归属与申报容量检查、流式落盘后再以实际字节复核并直接落地终态任务，不进入解析队列。首次 RabbitMQ 发布失败不使请求失败，数据库中的 `queued` 是持久待分发标记，Worker 扫描器会重新发布。文档受理返回 `202`，媒体上传成功返回 `200`：

```json
{
  "id": "1",
  "folder_id": "1",
  "file_name": "notes.md",
  "file_format": "md",
  "file_size": 12,
  "upload_status": "succeeded",
  "parse_status": "queued",
  "failure_reason": null,
  "created_at": "…"
}
```

`GET /api/datasets` 只返回当前用户 `upload_status=succeeded` 的正式资料，支持可选 Query 参数 `folder_id`（传数值 ID 过滤具体文件夹，传 `uncategorized` 过滤未分类资料，不传则返回全部）；按上传时间倒序。响应为 `{datasets, limits}`，每项数据包含 `folder_id`、`asset_kind`（`document|audio|video`）、可空的 `interview_session_id`/`interview_source_type`/`duration_ms` 与派生 `interview_label`（场次关联的“公司·阶段”标签）。`limits` 包含文档单文件字节数、单批文件数、文档允许扩展名，以及媒体单文件字节数 `max_media_file_bytes`、媒体允许扩展名 `media_allowed_extensions`、媒体个数 `media_max_count` 与总量 `media_max_total_bytes`，供前端提前反馈。列表从关联任务返回 `queued/processing/succeeded/failed` 解析状态。失败分类为 `format_unsupported/content_invalid/size_exceeded/service_unavailable/timeout/quota_exceeded/internal_error`。`GET /api/datasets/:id/content` 只允许资料所有者读取解析成功且已保存转换对象的 Markdown，返回 `{id, file_name, file_format, markdown, content_format: "markdown", content_revision, content_updated_at}` 并带 ETag；资料不存在或越权统一返回 `404 DATASET_NOT_FOUND`，解析尚未成功或转换存档未保存返回 `409 DATASET_CONTENT_UNAVAILABLE`，对象读取、大小或 UTF-8 校验失败返回 `502 DATASET_CONTENT_READ_FAILED`。

`GET /api/datasets/:id/source` 流式返回资料的原始上传文件：音视频以 `inline` 分发支持播放，文档以附件下载；仅 `upload_status=succeeded` 的资料可读，否则返回 `409 DATASET_CONTENT_UNAVAILABLE`；资料不存在或越权返回 `404 DATASET_NOT_FOUND`，对象读取失败返回 `502`。

`GET /api/datasets/folders` 列出当前用户自建的全部文件夹及其所含资料数，响应为 `{folders: [{id, name, dataset_count, created_at, updated_at}], total_count, uncategorized_count}`。`POST /api/datasets/folders` 接受 `{name: string}` 创建新文件夹（1~64 字符，去首尾空格，禁止斜杠与控制字符，用户内唯一，每用户上限 50 个；超限 `429 FOLDER_LIMIT_EXCEEDED`，重名 `409 FOLDER_NAME_DUPLICATE`，非法名称 `400 INVALID_FOLDER_NAME`）。`PATCH /api/datasets/folders/:id` 接受 `{name: string}` 重命名文件夹。`DELETE /api/datasets/folders/:id` 删除空文件夹；非空文件夹必须传 `confirm_contents=true`，否则返回 `409 FOLDER_DELETE_CONFIRMATION_REQUIRED`。确认后永久清理其中的源文件、转换对象、资料与解析任务，再删除文件夹，返回 `{deleted: true, affected_dataset_count}`。任一资料上传或解析中返回 `409 DATASET_BUSY`，清理对象失败返回 `502 ASSET_DELETE_FAILED` 并保留数据库记录供重试。

`PATCH /api/datasets/:id/folder` 接受 `{folder_id: string}` 移动单份资料。`POST /api/datasets/move-batch` 接受 `{dataset_ids: string[], folder_id: string}` 批量移动资料，返回 `{moved_count: number}`。移动目标必填，缺失、null、空串返回 422；目标必须是当前用户拥有的现存文件夹。以上接口均要求登录（未登录返回 `401 UNAUTHORIZED`），响应不包含对象存储路径或 SHA-256。

资料源文件 SHA-256 仅作为后端完整性元数据，以固定 64 位十六进制字符串保存；它不进入公开请求或响应契约。服务端以用户、`Idempotency-Key` 和包含文件元数据及摘要的请求指纹收敛重放：同 Key 同指纹返回原记录，活动任务返回 `202`、成功任务返回 `200`；同 Key 异指纹返回 `409 IDEMPOTENCY_KEY_REUSED`，上一次上传已失败返回 `409 DATASET_UPLOAD_PREVIOUSLY_FAILED`，调用方随后应为明确的新尝试生成新 Key。

`PATCH /api/datasets/:id` 接受 JSON `{name: string}`，只更新资料显示名称并沿用原始扩展名；`document_parse_tasks.file_name`、源对象键和转换对象键不变。名称为空、过长、含控制字符或路径分隔符返回 `400 INVALID_DATASET_NAME`。`POST /api/datasets/:id/retry` 只允许 `parse_status=failed` 且源对象仍可读取的本人资料，成功把任务改为 `queued` 并返回 `202`；即时发布失败仍保留 `queued`，等待扫描器补发。任务进行中或其他终态返回 `409 DATASET_NOT_RETRYABLE`，源对象不可用返回 `502 DATASET_SOURCE_UNAVAILABLE`。`DELETE /api/datasets/:id` 只允许删除本人的终态资料，`uploading/queued/processing` 返回 `409 DATASET_BUSY`；删除前清理源文件和已保存的转换对象，任一对象清理失败返回 `502 ASSET_DELETE_FAILED` 并保留数据库记录，成功后在同一事务删除资料与解析任务。所有新增操作对不存在或越权资料统一返回 `404 DATASET_NOT_FOUND`。

文件名非法返回 `400 INVALID_DATASET_FILENAME`，空文件返回 `400 EMPTY_DATASET_FILE`，格式或内容非法统一返回 `400 UNSUPPORTED_DATASET_FILE`，超过大小上限返回 `413 DATASET_FILE_TOO_LARGE`。请求频率或进程内并发超限返回带 `Retry-After` 的 `429 DATASET_UPLOAD_RATE_LIMITED`；数量或总容量超限分别返回 `409 DATASET_COUNT_LIMIT_REACHED`、`409 DATASET_STORAGE_LIMIT_REACHED`。对象存储上传失败返回 `502 DATASET_STORAGE_UNAVAILABLE`，预留记录标记为上传失败且不会出现在正式列表；后续清理器删除对象与预留记录。元信息状态提交失败返回 `500 DATASET_RECORD_FAILED` 并尽力清理对象。独立上传必须使用新 Key；网络失败等结果不明确的重试保持原 Key，避免重复记录。

### 资料正文读取与替换

资料列表及 `GET /api/datasets/:id` 返回字符串 `content_revision`、可空 `content_updated_at`；详情另外返回 `folder_name`。ETag 为 `"dataset-<id>-<revision>"`。这些接口继续只对本人可见，不暴露存储对象键；不再返回独立的 `replacement` 状态。

资料正文只提供 GET 读取，不提供 PUT 保存接口。既有正文对象继续可读。

普通上传新增可选 `file_name` 表单字段，重命名必须保留扩展名。同一文件夹出现同名时返回 `409 DATASET_NAME_CONFLICT`，响应携带 `candidates:[{id,file_name,created_at,content_revision,replaceable}]` 与 `suggested_name`；不自动替换。同名规则也用于改名、移动和批量移动；批量任一冲突整批拒绝。

`PUT /api/datasets/:id/file` 接受 multipart `file`、`confirm_replace=true`，必传 UUID `Idempotency-Key` 和当前 `If-Match`。当前支持文档替换，与普通文档上传共用格式、大小、频率和容量校验；目标完整文件名必须相同。校验通过后同步删除旧源、旧正文和旧解析结果，将同一资料 ID 关联到新的普通解析任务；保留文件夹和面试关联，容量按替换后的文件计算，不同时计入旧文件。返回 202 的 `UserDatasetRecord`，成功重放已完成的解析结果时返回 200；同键同指纹重放，同键异指纹返回 409。幂等信息使用资料主表的当前请求字段，不保存历史替换操作。

新任务受理时递增正文序号并清空旧正文，解析成功后写入新正文。上传或解析失败不恢复旧文件，解析失败复用 `POST /api/datasets/:id/retry`，上传失败重新上传；不存在或越权返回 404，旧版本请求返回 412，上传或解析中的再次替换和删除返回 `409 DATASET_BUSY`。已删除旧的替换操作查询、重试替换和放弃替换接口。

删除资料、删除文件夹和替换文档都同步删除相关 MinIO 文件；明确的文件删除失败返回 `502 ASSET_DELETE_FAILED`，不会继续上传新文件。网络或进程异常可能造成部分完成，不提供跨 MySQL/MinIO 原子回滚或持久化清理补偿。

## JD 数据模型与管理

JD 管理接口接受和返回最终结构化数据；浏览器导入接口接受有限页面采集 DTO，并在同一请求中清洗为最终结构化数据；智能导入接口把文字或图片解析为待确认草稿，不创建 JD。服务端不保存插件原始页面、智能导入原文、图片或模型过程数据。所有接口都要求当前登录用户，服务端从会话取得 `user_id`；不存在和不属于当前用户的记录统一返回 `404 JD_NOT_FOUND`。

| Method   | Path                                | 成功结果                                                                 |
| -------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `GET`    | `/api/job-descriptions`             | `{items, next_cursor}`，列出当前用户保留的全部 JD                         |
| `POST`   | `/api/job-descriptions`             | 新建时 `201 {job_description, application}`；解决重复或复用待投递时 `200` |
| `POST`   | `/api/job-descriptions/parse-draft` | 从文字或图片提取 `{draft, warnings, inputType, callId}`，不写入 JD       |
| `POST`   | `/api/job-descriptions/import`      | 清洗 BOSS 页面采集字段；返回 `{job_description, application}`，新建时 `201`，解决重复或复用待投递时 `200` |
| `GET`    | `/api/job-descriptions/:id`         | `{job_description}`                                                      |
| `PUT`    | `/api/job-descriptions/:id`         | `{job_description}`；请求含 `base_lock_version` 和至少一个可编辑字段     |
| `DELETE` | `/api/job-descriptions/:id`         | `{deleted: true}`，永久删除岗位及其完整求职聚合并释放来源唯一标识         |
| `GET`    | `/api/job-descriptions/:id/match?resume_id=` | `{match}`；该岗位与指定简历的分析结果，从未分析为 `null` |
| `POST`   | `/api/job-descriptions/:id/match:analyze` | 请求 `{resume_id}`；同步分析并返回 `{match}`，命中未过期结果时不调用模型 |
| `GET`    | `/api/job-matches/recommendations`  | `{state, resume, items, pending_count, can_compute}`，只读不调用模型 |
| `POST`   | `/api/job-matches/recommendations:ensure` | 同上结构；有可算岗位时启动后台分析，幂等 |

**简历匹配度**：`match` 含 `status`（`pending`、`ready`、`failed`）、`stale`、`score`（0–100）、`headline`、`hits`、`gaps`、`highlights{covered,missing}`、`analyzed_at` 与 `error_code`。分数是岗位要求被简历覆盖的加权比例，不是录取概率。`stale` 表示岗位描述或简历内容在分析后变化；仅改简历标题或排版不会过期。错误：岗位或简历不存在或不属于当前用户 `404 JOB_NOT_FOUND`、`RESUME_NOT_FOUND`；无描述且无技能 `400 JOB_MATCH_NO_DESCRIPTION`；同一岗位与简历正在分析 `409 JOB_MATCH_IN_PROGRESS`；模型未配置 `503 LLM_MODEL_NOT_CONFIGURED`，模型失败 `502`。推荐接口的 `state` 取 `no_resume`、`no_jobs`、`computing`、`ready`、`idle`、`unavailable`，`items` 至多 3 条且按分数降序，`application_status` 为该岗位最新未归档求职记录的阶段文案。桌面 Bearer 不在白名单内，这些路径仍拒绝 desktop。

岗位 `employment_type` 只接受 `internship`（实习）、`campus`（校招）、`full_time`（正式）或 `null`（未分类）。文字/图片识别和插件导入使用同一分类语义：实习优先于校招，校招优先于全职；无法判断不猜测。旧的 `part_time/contract/temporary` 不再接受。个人画像的 `employment_types` 是独立契约，不随岗位分类变更。

列表查询支持最长 200 字符的 `keyword`、不透明 `cursor` 和 `limit=1..100`。关键词忽略大小写，覆盖岗位名、公司名、城市、地址、正文和技能；分页按 `updated_at DESC, id DESC` 稳定排序。非法筛选或游标返回 `400 INVALID_JOB_QUERY`。JD 不维护活动、归档、投递或面试状态。

Web 的 `api.getJobMatch`、`analyzeJobMatch`、`getJobMatchRecommendations` 和 `ensureJobMatchRecommendations` 对应岗位匹配接口：详情页只在用户点击时调用分析，首页卡在显示时读取、必要时触发后台计算并轮询。

智能导入使用 `multipart/form-data`，必须且只能提交一个非空 `text` 或一个 `image`。文字去除首尾空白后最长 60,000 字符，使用 `job_text_extraction` 场景；图片只接受实际内容可解码的 PNG、JPEG 或 WebP，最大 10 MiB、最多 4,000 万像素，使用独立的 `job_image_extraction` 场景。响应中的 `draft` 与普通创建字段同构但全部可空，明确的币种别名规范化为三字母代码。文字仅对能与输入对应、币种及周期明确且已有值不冲突的薪资片段补全缺失数值；图片不做数值补全。`warnings` 提示未识别的核心字段、薪资来源/结构问题及模型识别出的岗位目标歧义，不阻止返回草稿，也不能代替最终创建校验；调用方必须先让用户核对或补充，再另行调用创建接口。规范化不增加模型调用。输入缺失或同时提供两种输入返回 `400 JD_IMPORT_INPUT_REQUIRED|JD_IMPORT_INPUT_AMBIGUOUS`，大小、格式或内容非法返回对应的 `JD_IMPORT_TEXT_TOO_LARGE`、`JD_IMPORT_IMAGE_TOO_LARGE`、`JD_IMPORT_IMAGE_UNSUPPORTED` 或 `JD_IMPORT_IMAGE_INVALID`。能力未绑定返回 `503 JD_IMPORT_MODEL_NOT_CONFIGURED`，超时返回 `504 JD_IMPORT_PARSE_TIMEOUT`，其他模型或结构化结果失败返回 `502 JD_IMPORT_PARSE_FAILED`；模型调用已建立记录时错误详情包含脱敏的 `callId` 和 `inputType`。

创建必填 `job_title`、`company_name` 和 `source_type=manual|external_import`；手工创建的 `description` 可省略或留空，服务端统一保存为空字符串。普通更新同样允许把 `description` 清空为空字符串，但不接受 `null`；`job_title` 和 `company_name` 更新后仍必须非空。可选 `logo_url` 最长 2048 字符且必须是无内嵌凭据的 HTTPS 绝对 URL，此字段只保存外链；托管图片通过独立 Logo 上传接口写入。`external_import` 仍必须带非空 `description` 和 `http/https source_url`；服务端负责规范化 URL 并计算来源身份。当前 BOSS 直聘岗位链接提取 `/job_detail/{source_job_id}.html`，保存 `source_site=boss`、原生 `source_job_id`、规范化 `source_url` 及其 SHA-256；其他链接保存 `source_site=web` 和 URL 哈希。`source_type`、`source_site`、`source_job_id`、`source_url`、`source_url_hash`、`imported_at` 创建后均不可通过更新接口修改。

浏览器导入请求使用 `source_url` 和嵌套 `capture`。当前只接受 `zhipin.com` 的 `/job_detail/{source_job_id}.html`；`capture.job_title`、`capture.company_name`、`capture.description_text` 清洗后必须非空。可选采集字段包括 `logo_url`、`skills`、就业类型原文、学历、经验、工作时间、城市、地址、薪资原文、公司字段/标签和招聘者字段。后端去除不可见字符、压缩空白、删除明确的详情标题与举报页尾，并确定性映射常见就业类型、远程/混合工作、`K·N薪` 和人民币时/日/月/年区间；无法可靠识别的字段保持为空，不做分析或模型推断。

导入请求字段非法、非 BOSS 详情 URL 或必填采集内容缺失时返回 `400 INVALID_JOB_IMPORT`。重复来源直接返回既有 JD 及其唯一求职记录，包括已经结束的记录，不创建再次投递；显式 `duplicate_resolution` 仍复用普通创建的 `JD_EDIT_CONFLICT` 和 `JD_WRITE_FAILED` 语义。插件不需要也不能提交 `user_id`、来源身份哈希或数据库字段。

岗位创建和浏览器导入会在同一数据库事务中为该 JD 创建唯一的待投递求职记录；同一 JD 已有任何求职记录时直接返回该记录，不重复创建，也不覆盖其投递时间、阶段或历史。浏览器插件保留成功响应中的 `application.id`，用于打开 `/career/applications/{id}`；兼容旧服务缺少或返回空 `application` 时回退到岗位详情，不影响导入请求格式。通过求职进程接口为已有记录的 JD 再次创建返回 `409 APPLICATION_ALREADY_EXISTS` 并携带原 `application_id`。显式 `duplicate_resolution` 仍用于用户确认用新采集内容更新已有 JD。普通更新及重复解决使用 `lock_version`，并发过期返回 `409 JD_EDIT_CONFLICT`。

硬删除同时约束记录 ID 和当前用户，不要求中间状态或 `lock_version`。服务先锁定岗位及其求职进程，解除关联资料与场次的绑定（文件保留在资料库），删除排期、阶段和求职进程，再删除 JD；活动和已结束进程都在清理范围内。成功后所有关联数据均无法恢复，相同来源可再次写入。数据库删除失败返回 `502 JD_DELETE_FAILED`，数据库记录保留供重试。不存在和不属于当前用户的记录返回 `404 JD_NOT_FOUND`。

技能以最多 100 个字符串的 JSON 数组保存，写入时去空和去重。数值薪资非空时必须同时给出三字母币种与计薪周期，最高值不得低于最低值。请求字段、长度或组合非法返回 `400 INVALID_JOB_DESCRIPTION`，来源非法返回 `400 INVALID_JOB_SOURCE`。福利、原始抓取数据和插件 API Key 不属于当前契约。

### 公司 Logo 托管

`POST /api/job-descriptions/{job_id}/logo` 接受 multipart `file`、可选 `mode=fill_missing|replace`（默认补图），换图必须携带 `expected_revision`（当前图片 SHA-256，无托管图时为 `none`）。登录并核实岗位归属后，按用户限制每分钟 30 次；原图最多 2 MiB，允许 PNG/JPEG/WebP/GIF，最多 1600 万像素。服务端统一生成最长边不超过 256 像素、不放大的 WebP，去除元数据，对最终字节计算 SHA-256。默认补图不替换已有托管图。成功返回 `{logo_url, revision}`；读取/解码/存储失败不会回滚之前成功的岗位导入。

错误包括 `401` 未登录、`404 JD_NOT_FOUND` 不存在或越权、`413 COMPANY_LOGO_TOO_LARGE`、`422 COMPANY_LOGO_INVALID`、`409 COMPANY_LOGO_CONFLICT`、`429 COMPANY_LOGO_RATE_LIMITED`、`503 COMPANY_LOGO_SAVE_FAILED|COMPANY_LOGO_BUSY|COMPANY_LOGO_UNAVAILABLE`。存储成功后仅更新岗位图片指纹和所属求职快照的图标键，并递增受影响记录的锁版本。

`GET /api/job-descriptions/{job_id}/logo?v={sha256}` 先检查登录、岗位归属和当前图片指纹，返回 `image/webp`、`Cache-Control: private, no-cache`、ETag 和 `nosniff`；命中 ETag 返回 304。越权、岗位不存在或指纹过期返回 404；未登录为 401；对象缺失为 `404 COMPANY_LOGO_NOT_FOUND`，存储故障为 `503 COMPANY_LOGO_READ_FAILED`。不会返回 MinIO 对象地址，也没有跨用户指纹查询接口。

岗位响应增加 `resolved_logo_url` 和 `logo_revision`；原 `logo_url` 继续表达可编辑 HTTPS 外链。求职响应的 `company_logo_url` 允许 HTTPS 外链或本记录关联岗位的受控本站 Logo 路径。普通全量表单提交未变化的外链不清空托管图；明确改变外链才解除托管引用并同步图标。

## 求职中心

求职中心以 `job_descriptions` 保存岗位资料，以 `job_applications` 表达一家公司和岗位的一次完整求职尝试，以 `job_application_stages` 保存追加式阶段历史，以 `interview_sessions` 表达其中一场可排期、可完成、可复盘的面试。所有接口都要求当前登录用户，后端只从会话取得所有者；不存在和越权资源统一返回 `404 INTERVIEW_NOT_FOUND`。JD 创建或导入会原子创建或复用待投递记录；求职记录保存公司、岗位和完整 JD 快照（包括创建时的可选 `logo_url`），响应以可选 `company_logo_url` 暴露该快照值，后续修改原 JD 不会改写历史快照的正文和其他业务信息；补充托管图片或明确修改原 Logo 外链时，仅同步图标键并递增求职记录锁版本。Web 与小程序两侧共用同一个快照投影：只输出 `https://` 开头的绝对 URL，或该求职记录自己岗位的托管 Logo 地址（`/api/job-descriptions/{id}/logo?v=...`），其余取值一律投影为 `null`。

待投递由 `applied_at=null` 且 `lifecycle_status=active` 表示，不生成虚构业务阶段。`POST /api/job-applications/:id/stages` 接受 `client_request_id`、稳定 `stage_type`、可选 `stage_label/interview_round_no/applied_at/resume_id` 和 `base_lock_version`，可直接进入 `screening/assessment/written_test/ai_interview/interview/hr/oc/offer`。普通面试必须提供非空显示名称，轮次可空；其他类型不能携带轮次，`hr`、`oc` 默认名称为“HR 面”“OC”。首次阶段写入同时保存投递时间，未提供时使用服务端操作时间；旧当前阶段改为已完成，新阶段成为唯一当前阶段。相同请求 UUID 和相同阶段内容幂等返回，内容不同或版本过期返回 `409 INTERVIEW_EDIT_CONFLICT`。

`PUT /api/job-applications/:id` 可提交 `employment_type`（上述三类或 `null`）及 `base_lock_version`，在同一次版本校验中更新当前记录的 `job_snapshot.employment_type`，保留其他快照属性和阶段。它不改原岗位或其他求职进程。非法分类返回 `400 INVALID_INTERVIEW_REQUEST`，非本人记录返回 `404 INTERVIEW_NOT_FOUND`，过期版本返回 `409 INTERVIEW_EDIT_CONFLICT`。

求职绑定只提交 resume_id，不要求简历内容锁：省略保持关联，显式 null 解除，非空关联本人当前简历。无效或他人简历返回 404 RESUME_NOT_FOUND，非空旧 resume_version_id 返回 410 RESUME_VERSION_RETIRED。绑定和求职写入同事务提交，不复制正文或图片。响应 resume_id 为当前关联，兼容字段 resume_title_snapshot 动态返回当前标题，无关联时为空；不返回 resume_snapshot。源简历编辑影响后续查看，删除源简历清空关联但保留求职记录。

`POST /api/job-applications/:id/terminate` 接受请求 UUID、终止原因、可选投递时间和版本，一次完成待投递或进行中记录的终止；当前阶段如存在会被关闭并保留。响应中的 `phase=pending|applied`、`lifecycle_status=active|terminated`、`current_stage` 和有序 `stages` 是新消费方真值。归档只影响列表范围，不改变投递、当前阶段或终止事实。`DELETE /api/job-applications/:id` 对已终止且仍关联 JD 的记录执行完整岗位聚合删除；活动记录不能通过该接口删除，历史遗留的无 JD 记录仍沿用原有归档/终止清理条件。删除只解除资料库文件与场次的关联，不再清理素材对象；数据库删除失败返回 `502 INTERVIEW_APPLICATION_DELETE_FAILED` 并保留数据库记录，用户可重试删除。旧扁平字段以及 `/advance`、`/offer`、`/close` 保留一个兼容期。

原生 V4 使用 Offer 阶段且 `offer_status=none` 表示 OC 口头意向，`POST /offer` 才将其标记为 `received`，即使未填写数值薪资也可确认正式 Offer。`POST /close` 携带 `status=closed` 和 `offer_status=accepted|declined` 完成最终决策；OC 不能直接接受或婉拒，已归档记录不能作决策。`terminate` 的 `offer_declined` 原因同样要求已收到正式 Offer。双方均沿用归属检查和 `base_lock_version`。原生将 `status=closed` 的接受记录归入已结束，不因恢复归档而重新开启流程。

`POST /offer` 另可携带 `received_on/reply_due_on/start_on` 三个独立日期字段；仅接受 MySQL DATE 支持的 `YYYY-MM-DD`（年份 1000–9999）或 `null`，不接受时间戳或时分。省略字段保留原值，显式 `null` 清空，与 Offer 状态在同一乐观锁事务中更新。求职详情与列表返回可空 `offer_received_on/offer_reply_due_on/offer_start_on`。旧原生备注内的日期标签仍保留，不解析回填；旧客户端省略新字段不会清除 Web 保存的结构化日期。复用 `400 INVALID_INTERVIEW_REQUEST`、`404 INTERVIEW_NOT_FOUND` 和 `409 INTERVIEW_EDIT_CONFLICT`。

**投递渠道、HR 面与 OC（0109）**：`POST /stages` 与 `PUT /job-applications/:id` 可选携带 `applied_channel`（最多 100 字符，首尾空白去除）；记录投递时随首次阶段一并保存。`hr` 阶段可排期，排期时场次 `stage_type` 必须为 `hr`。`oc` 阶段可选携带 `oc_communicated_at`（须带时区）、`oc_contact`、`oc_salary_text`、`oc_start_text`（各最多 100 字符）与 `oc_note`（最多 500 字符），非 `oc` 阶段携带这些字段返回 `400`。`oc` 阶段投影为 `current_stage_type=offer`；当前阶段为 `oc` 时 `POST /offer` 返回 `409 INTERVIEW_INVALID_TRANSITION`，正式 Offer 需先追加 `offer` 阶段。`POST /offer` 另可携带 `probation`（最多 100 字符）和 `material_dataset_ids`（最多 10 个、不可重复的本人资料库文件 ID，提供时整体替换，空数组清空，省略保留）；任一文件不属于当前用户时返回 `404 INTERVIEW_NOT_FOUND` 且不改写。求职响应新增可空 `applied_channel`、`oc_*`、`offer_probation` 与 `offer_materials`（`dataset_id`、`file_name` 列表），小程序求职响应同样返回这些字段。

`POST /stages` 与 `POST /offer` 可选携带 `notes`（最多 16,000 字符），在同一版本校验与事务中保存补充说明；省略保持原备注，显式 `null` 清空。原生 V4 的投递渠道、口头薪酬、收到日期、回复截止、薪酬说明、预计入职、试用期与 Offer 材料名称按可读标签保存于备注，保留其他行；材料名称不是附件上传或关联。旧 Web 请求无需新增字段。阶段请求继续复用 UUID，重放不会重复追加阶段或覆盖后续备注。

| Method | Path | 行为 |
| --- | --- | --- |
| `GET` | `/api/interview-overview` | 返回本周指标、当前阶段流程和周排期；支持 `week_start` 与 IANA `timezone` |
| `GET/POST` | `/api/job-applications` | 列出或创建求职进程 |
| `GET/PUT/DELETE` | `/api/job-applications/:id` | 读取、乐观锁更新；已终止且关联 JD 时永久删除整个岗位聚合，无 JD 历史记录沿用旧清理条件 |
| `POST` | `/api/job-applications/:id/stages` | 追加并切换当前阶段；首次写入同时隐式完成投递 |
| `POST` | `/api/job-applications/:id/terminate` | 终止待投递或进行中的求职记录 |
| `POST` | `/api/job-applications/:id/advance` | 将已完成且等待结果的当前阶段确认通过并推进 |
| `POST` | `/api/job-applications/:id/offer` | 统一记录已收到 Offer，并选填 Base、结构化薪资与福利 |
| `POST` | `/api/job-applications/:id/close` | 记录未通过、主动结束、接受或婉拒 Offer |
| `POST` | `/api/job-applications/:id/archive\|restore` | 乐观锁归档或恢复进程 |
| `GET` | `/api/interview-sessions` | 按时间、状态、`application_id`、归档范围和游标列出当前用户的面试记录 |
| `POST` | `/api/job-applications/:id/interview-sessions` | 在指定求职进程的当前阶段创建排期 |
| `GET/PUT/DELETE` | `/api/interview-sessions/:id` | 读取、乐观锁更新或删除无素材的单场记录 |
| `POST` | `/api/interview-sessions/:id/prep-items:generate` | 让 AI 为本场生成准备清单，成功返回更新后的场次；每场只能成功一次 |
| `POST` | `/api/interview-sessions/:id/reschedule` | 调整排期，开始时间接受有效 24 小时制 `HH:mm`（小时 `00–23`、分钟 `00–59`） |
| `PUT` | `/api/interview-sessions/:id/answer-plan` | 设置或清除开放笔试、测评或 AI 面试的一组个人作答计划时间 |
| `POST` | `/api/interview-sessions/:id/complete\|cancel` | 明确完成或取消一场面试；完成接口保留兼容，正常流程按结束时间自动完成 |
| `GET/POST` | `/api/interview-sessions/:id/assets` | 列出或上传素材；上传与资料库共用同一入库链路，成功后自动关联该场次 |
| `POST` | `/api/interview-sessions/:id/assets/attach` | 把本人资料库中未关联的资料（`{dataset_id}`）关联到本场次 |
| `DELETE` | `/api/interview-sessions/:id/assets/:dataset_id` | 解除资料与场次的关联，文件保留在资料库 |
| `GET` | `/api/interview-assets/:id/content` | 所有权校验后流式读取仍关联场次的素材；已解除关联返回 `404` |
| `DELETE` | `/api/interview-assets/:id` | 解除素材与场次的关联，不删除文件 |

排期请求可携带 `application_stage_id` 和 `schedule_kind=fixed_slot|open_window`，服务端要求它是该求职记录当前且可排期的测评、笔试、AI 面试或普通面试阶段；筛选和 Offer 不能排期，其中测评、笔试和 AI 面试支持开放窗口，普通面试只支持固定场次。创建与改期请求在 `start_at` 之外必须且只能提交 `end_at` 或正整数 `duration_minutes` 之一；提交持续分钟时由服务端计算并保存 `end_at`，旧的显式结束时间写法继续兼容。开放窗口的个人作答计划同样可用 `answer_plan_start_at + duration_minutes` 让服务端推算结束时间，也兼容 `answer_plan_start_at/answer_plan_end_at` 成对设置；清除时两端同时为空。计划必须完整落在官方窗口内，否则返回 `INTERVIEW_ANSWER_PLAN_INVALID_TIME`、`INTERVIEW_ANSWER_PLAN_OUTSIDE_WINDOW` 或 `INTERVIEW_ANSWER_PLAN_NOT_SUPPORTED`。不支持开放窗口的阶段返回 `INTERVIEW_SCHEDULE_KIND_NOT_SUPPORTED`。开始时间必须是带时区的有效分钟时间，服务端转成 UTC 保存。同一用户的多个排期允许时间重叠。调整排期只要求场次仍为 `scheduled` 且所属求职进程未归档，不受求职进程是否已经结束影响。过期 `base_lock_version` 返回 `409 INTERVIEW_EDIT_CONFLICT`，不合法状态跳转返回 `409 INTERVIEW_INVALID_TRANSITION`。

**按时间完成**：`end_at` 已过的 `scheduled` 场次在所有场次响应中投影为 `status=completed`、`completed_at=end_at`；当前阶段的全部已排期场次都已结束时，求职进程的 `stage_state` 与场次摘要的 `application_stage_state` 投影为 `awaiting_result`。`GET /api/interview-sessions?status=scheduled|completed` 与总览的已完成数量按同一投影筛选。读取不写库；添加阶段或终止流程时在同一事务内把已结束场次落库为 `completed`，该结算不递增 `lock_version`。改期和取消仍按库内 `scheduled` 判断，因此已过时间的场次可以改到未来时间，从而恢复为已安排。

Offer 状态只使用 `none/received/accepted/declined`，其中 Web 只写 `received`；迁移 `0053` 将历史 `oc_received` 与 `written_offer_received` 合并为 `received`。`POST /api/job-applications/:id/offer` 只要求 `base_lock_version`，并接受全部可空的 `base_location`、`salary`、`salary_currency`、`salary_period`、`benefits_description`；空请求仍会记录为已收到 Offer。填写数值薪资时必须同时提供大写三字母币种与 `hour/day/month/year` 计薪周期。求职进程响应以 `offer_` 前缀返回这五个详情字段。迁移 `0054` 将原薪资下限重命名为单值 `offer_salary` 并删除薪资上限；旧记录缺少下限但存在上限时保留原上限值。总览指标使用 `offers_received`，统计 `received/accepted/declined`，不再返回 `written_offers`。

`GET /api/job-applications` 按 `updated_at DESC, id DESC` 分页，`GET /api/interview-sessions` 按 `start_at ASC, id ASC` 分页；两者的 `next_cursor` 都是不透明且与当前筛选条件绑定的游标。调用方必须把游标与原筛选一起回传；游标损坏、跨筛选复用或超长都返回 `400 INVALID_INTERVIEW_QUERY`。创建面试的 `(application_id, client_request_id)` 唯一：相同请求重放返回原场次，相同标识绑定到不同时间或内容时返回 `409 INTERVIEW_EDIT_CONFLICT`。

面试模块的求职进程、岗位、简历版本、单场面试和素材 ID 与项目其他 BIGINT 资源一致，在 JSON、查询参数和路径中都使用无前导零的十进制字符串；前端不得把这些 ID 转成 JavaScript `number`。

**面试准备清单**：清单保存在场次行的 `prep_items`（JSON，最多 12 条，元素 `{id,title,category,reason,done}`，`category` 取 `intro|project|technical|system_design|behavior|company|other`），`prep_generated_at` 非空表示本场已用掉唯一一次 AI 生成。场次响应附带只读的 `prep_total`、`prep_done`。用户通过 `PUT /api/interview-sessions/:id` 的 `prep_items` 整体替换清单（需 `base_lock_version`，服务端为缺失或重复的 `id` 重新分配），清空清单不会恢复生成次数。`prep-items:generate` 只对 `scheduled` 且未归档的本人场次可用，否则 `409 INTERVIEW_INVALID_TRANSITION`；已生成过返回 `409 INTERVIEW_PREP_ALREADY_GENERATED`；`interview_prep` 场景未配置返回 `503 LLM_MODEL_NOT_CONFIGURED`，模型失败或两次结构无效返回 `502`（含 `LLM_RESPONSE_INVALID`），失败和空结果都不占用次数。

素材上传是 `multipart/form-data`，必须携带 canonical UUID `Idempotency-Key`；`source_type=recorded|uploaded` 仅记录来源路径。上传复用资料库入库链路：文件落入 `users/{user_id}/datasets/` 前缀，`user_dataset.interview_session_id` 记录场次关联，场次侧不再持有独立素材记录。服务端按扩展名与规范化 MIME 双重校验，流式计算大小和 SHA-256；单文件上限由 `INTERVIEW_ASSET_UPLOAD_MAX_BYTES=524288000` 控制，媒体个数与总量由 `MEDIA_MAX_COUNT_PER_USER`/`MEDIA_MAX_TOTAL_BYTES_PER_USER` 控制。格式、大小、配额和对象存储失败复用资料库的 `DATASET_*` 错误码。文档类素材上传后进入解析队列，音视频落地为终态、不参与解析。`POST /interview-sessions/:id/assets/attach` 要求资料属本人、`upload_status=succeeded` 且未关联其他场次；重复关联本场次幂等返回，已关联其他场次返回 `409 DATASET_ALREADY_LINKED`，资料不存在或越权返回 `404 DATASET_NOT_FOUND`。统一入库和关联服务保证 `interview_session_id` 与 `interview_source_type` 同时设置或同时为空；该内部一致性校验不增加新的请求或响应字段。解除关联只清空这两列，物理删除只能在资料库进行；删除场次或求职进程同样只解除关联。音视频内容使用 `inline` 分发以支持播放，文档使用附件下载；响应不暴露对象键。

## AI 模拟面试

模拟面试以 `mock_interviews` 保存一场面试的来源快照、配置、计划与报告，以 `mock_interview_questions` 保存每次提问和作答。所有接口要求登录，只从会话取得所有者；不存在和越权资源统一返回 `404 MOCK_INTERVIEW_NOT_FOUND`。面试 ID 为 UUID 字符串，题目、简历、岗位、求职记录和资料 ID 为无前导零的十进制字符串。业务规则见 [AI 模拟面试](../features/mock-interview.md)。

| Method | Path | 行为 |
| --- | --- | --- |
| `GET` | `/api/mock-interviews` | 按 `created_at DESC, id DESC` 分页；支持 `job_application_id`、`resume_id`、`status`、`cursor` 和 `limit`（默认 20、最大 100），返回 `{items, next_cursor}` |
| `POST` | `/api/mock-interviews` | 发起并在后台准备，返回 `201 {mock_interview}`，状态为 `preparing` |
| `GET` | `/api/mock-interviews/:id` | 详情；读取时应用任务租约与空闲超时 |
| `POST` | `/api/mock-interviews/:id/answers` | 提交当前题回答并以 SSE 返回面试官下一回合 |
| `POST` | `/api/mock-interviews/:id/skip` | 跳过当前题并以 SSE 返回面试官下一回合 |
| `POST` | `/api/mock-interviews/:id/reply:retry` | 面试官回复丢失时重新生成，以 SSE 返回 |
| `POST` | `/api/mock-interviews/:id/finish` | 提前结束；有作答时进入 `evaluating`，否则为 `abandoned` |
| `POST` | `/api/mock-interviews/:id/abandon` | 放弃 `preparing`、`preparation_failed` 或 `in_progress` 的场次 |
| `POST` | `/api/mock-interviews/:id/retry` | 准备失败或评估失败后重试 |
| `POST` | `/api/mock-interviews/:id/repeat` | 按原来源与配置发起新场次，返回 `201`；可选请求体 `{answer_mode:"text"|"voice"}` 覆盖新场作答方式，省略时沿用原场 |
| `DELETE` | `/api/mock-interviews/:id` | 删除非进行中场次及其提问和录音，返回 `{deleted: true}` |
| `GET` | `/api/mock-interviews/speech-capability` | 返回 `{stt, tts}`，表示语音识别与语音合成场景是否有有效线路 |
| `POST` | `/api/mock-interviews/:id/speech/playback` | 本人语音场次的设备试音 `{}` 或当前未答题目 `{question_id}`；返回 `audio/mpeg`、`Cache-Control: no-store`，不接受任意文本 |
| `WS` | `/api/mock-interviews/:id/speech?question_id=&purpose=voice_input\|voice_answer` | 音频录入与识别；中间结果取决于服务商，见下文 |
| `POST` | `/api/mock-interviews/:id/transcripts:correct` | 已完成的语音面试整场 AI 修正识别稿，每场一次 |
| `PUT` | `/api/mock-interviews/:id/questions/:qid/transcript` | 对照录音手动修改一条语音回答的最终稿 `{text}` |
| `POST` | `/api/mock-interviews/:id/questions/:qid/re-evaluate` | 识别稿变化后重新评估一道主问题，最多 3 次 |
| `GET` | `/api/mock-interviews/:id/questions/:qid/recording` | 本人读取一条回答的录音（`audio/wav`，16 kHz 单声道） |
| `DELETE` | `/api/mock-interviews/:id/recordings` | 删除本场全部录音，保留文字 |

发起请求必须提供 `job_application_id` 或 `resume_id`；求职记录来源不能再带 `job_description_id` 或 `job_description_text`，后两者也不能同时提交，违反时返回 `422`。可选字段为 `target_role`（≤200）、`interview_type=technical|project_deep_dive|hr|comprehensive`、`difficulty=junior|intermediate|senior`（默认 `intermediate`）、`question_count` 3–10（默认 5）、`follow_up_enabled`（默认 `true`）、`language=zh|en`（默认 `zh`）、`answer_mode=text|voice`（默认 `text`）最多 10 个 `material_ids`，以及 `materials_in_questions`（默认 `false`）。`materials_in_questions=false` 时所选资料只用于报告事实核验，背景分析与出题不读取资料；为 `true` 时出题也参考所选资料；未选资料时按 `false` 保存。详情和列表返回同名字段，再练一次沿用原值。`answer_mode=voice` 要求 `speech_to_text` 与 `text_to_speech` 都有有效线路，否则返回 `503 MOCK_INTERVIEW_SPEECH_UNAVAILABLE` 且不创建记录；再练一次默认沿用原场作答方式，显式覆盖为语音时也检查 STT/TTS 线路。

作答和跳过请求体为 `{question_id, answer}` 与 `{question_id}`，必须携带 8–64 位 `[A-Za-z0-9_.:-]` 的 `Idempotency-Key`；回答去除首尾空白后为 1–8000 字符。同一题目以相同幂等键重放不产生新回答，也不再次消费语音会话；面试官已回复时只返回 `answer.accepted`，尚未回复时可继续生成回合。`created_at`、`started_at`、`finished_at`、`answered_at` 与 `transcript_corrected_at` 均为带 `Z` 的 UTC 时间；可空时间未设置时为 `null`。SSE 事件依次为 `answer.accepted {question_id, skipped, lock_version}`、零到多个 `interviewer.delta {content}`，最后是 `interviewer.turn {status, action, question, closing_message, lock_version}` 或 `interviewer.failed {error}`。`action=finish` 时 `question` 为空、`closing_message` 为结束语，场次进入 `evaluating`。每个回合流都以 `interviewer.turn` 或 `interviewer.failed` 之一结束；非模型错误的失败码为 `MOCK_INTERVIEW_TURN_FAILED`。回合失败时回答已保存，详情的 `needs_reply=true`，调用方用 `reply:retry` 重新生成；无需重新生成时该接口返回 `409 MOCK_INTERVIEW_STATE_INVALID`。

**语音识别通道**：WebSocket 使用登录 Cookie 鉴权，并要求 `Origin` 与 `Host` 同源，否则以关闭码 `4403` 拒绝；场次不属于本人、不在 `in_progress`、`question_id` 不是当前题或 `purpose` 与作答方式不符（文字面试只能 `voice_input`，语音面试只能 `voice_answer`）时以 `4409` 关闭。客户端发送 16 kHz 单声道 PCM16 二进制帧，发送 `{"type":"stop"}` 结束；单次最长 5 分钟、10 MB，达到上限自动结束。服务端推送 `{"type":"partial","text"}`，结束时推送 `{"type":"final","session_id","text","duration_ms","words":[{text,start_ms,end_ms}],"partial"}` 后关闭；服务商失败且没有识别出文字时推送 `{"type":"error","code":"MOCK_INTERVIEW_SPEECH_FAILED"}`，已识别出文字时仍返回 `final` 且 `partial=true`。识别结果与待提交录音共享 Redis 的 10 分钟 TTL，支持跨进程提交；`session_id` 10 分钟内有效、只能用于本人本场当前题的一次提交。

**语音作答**：作答请求可带 `speech_session_id`（32 位小写十六进制），此时 `answer` 可省略。语音面试只接受 `speech_session_id`（或跳过），回答以服务端识别稿为准并保存录音，提交纯文字返回 `422 MOCK_INTERVIEW_SPEECH_SESSION_INVALID`；文字面试带 `speech_session_id` 时仍以 `answer` 为准，只记录来源 `voice_input` 与时长，不保存录音。识别会话过期、已使用或不属于该题返回 `409 MOCK_INTERVIEW_SPEECH_SESSION_INVALID`，识别稿为空返回 `422 MOCK_INTERVIEW_SPEECH_EMPTY`。录音存储失败返回 `502 MOCK_INTERVIEW_RECORDING_STORE_FAILED` 并恢复识别会话，可用原幂等键重试。语音面试的回合 SSE 在 `interviewer.delta` 之间按句追加 `interviewer.audio {seq, text, format:"mp3", data}`（base64），合成失败时改发 `interviewer.audio_failed {seq, text}`，面试不中断；所有音频事件都在 `interviewer.turn` 之前发出。

AIHubMix 文件识别在客户端停止录音后返回整段结果，录音期间没有实时 `partial`；百炼实时识别仍可返回中间结果。上游缺少词时间戳时 `words=[]`，报告只统计有时间戳的回答，全部缺少时 `voice_metrics=null`。识别稿 AI 修正的保守接受规则见 [模拟面试](../features/mock-interview.md#识别稿修正与重新评估)，手动修改继续按原始字符变化计算 15% 上限。

**识别稿修正与重新评估**：`transcripts:correct` 只对 `completed` 的语音面试可用，否则 `409 MOCK_INTERVIEW_STATE_INVALID`；已执行过返回 `409 MOCK_INTERVIEW_TRANSCRIPT_ALREADY_CORRECTED`；`transcript_correction` 未配置返回 `503 LLM_MODEL_NOT_CONFIGURED` 且不消耗本场次数。响应为 `{items:[{question_id, state, changes}], mock_interview}`，`state` 为 `corrected|correction_rejected|original`。手动修改相对原始识别稿的字符变化超过 15% 返回 `422 MOCK_INTERVIEW_TRANSCRIPT_CORRECTION_REJECTED`，录音已删除返回 `404 MOCK_INTERVIEW_RECORDING_NOT_FOUND`。重新评估要求该题（含追问）识别稿已被修正或修改，否则 `409 MOCK_INTERVIEW_STATE_INVALID`；超过 3 次返回 `409 MOCK_INTERVIEW_RE_EVALUATE_LIMIT`；响应为 `{question_id, evaluation, re_evaluate_count, remaining, total_score, previous_total_score, mock_interview}`。

详情返回来源与配置摘要、`materials`、`current_question_id`、`answered_main_questions`、`needs_reply`、有序 `questions` 和 `report`；`report` 只在 `completed` 时返回，包含 `rubric_version`、`answer_mode`、`voice_metrics`（语音面试的 `chars_per_minute`、`long_pauses`、`filler_ratio`、`answer_duration_ms`、`reference` 与 `tip`，文字面试为 `null`）、`re_evaluations`（如有）、`total_score`、`question_average`、`dimension_score`、`dimensions`、逐题 `questions`、`fact_check`、`resume_risks`、`improvements`、`low_confidence` 与 `closing_message`。`fact_check.status` 为 `not_requested|completed|failed`。详情另含 `answer_mode`、`transcript_corrected_at`、`recordings_deleted`；每条提问另含 `answer_source`、`audio_duration_ms`、`has_recording`、`raw_transcript`、`transcript_state`、`correction`、`re_evaluate_count` 与 `evaluation_history`。

Web 消费方：作答与跳过每次发送新的 `Idempotency-Key`；回合 SSE 没有 `interviewer.turn` 或 `interviewer.failed` 就结束视为连接中断，页面据详情的 `needs_reply` 提供 `reply:retry`；真实接口下 `preparing`、`evaluating` 靠轮询详情感知完成；录音读取 404 显示为不可用。详见 [AI 模拟面试](../features/mock-interview.md#web-前端)。

| 错误码 | 场景 |
| --- | --- |
| `409 MOCK_INTERVIEW_IN_PROGRESS` | 已有进行中的场次时发起、再练或重试，包括并发发起造成的死锁或锁等待超时 |
| `409 MOCK_INTERVIEW_QUESTION_MISMATCH` | 提交的题目不是当前待答题 |
| `409 MOCK_INTERVIEW_STATE_INVALID` | 当前状态不允许该操作，包括删除进行中场次 |
| `422 MOCK_INTERVIEW_RESUME_REQUIRED` | 求职记录未关联简历且未另选，或来源简历已被删除后再练 |
| `422 MOCK_INTERVIEW_RESUME_INVALID` | 简历快照无法解析 |
| `422 MOCK_INTERVIEW_MATERIAL_INVALID` | 资料不属于本人、未解析成功、为音视频或超过 10 份 |
| `404 MOCK_INTERVIEW_SOURCE_NOT_FOUND` | 简历、岗位或求职记录不存在或不属于本人 |
| `400 MOCK_INTERVIEW_CURSOR_INVALID` | 列表游标无法解析 |
| `503 LLM_MODEL_NOT_CONFIGURED` | `mock_interview` 场景没有有效线路；此时不创建记录 |

后台失败写入场次的 `error_code`，包括上游 LLM 错误码、`LLM_RESPONSE_INVALID`、`MOCK_INTERVIEW_PLAN_INCOMPLETE` 和 `MOCK_INTERVIEW_TASK_INTERRUPTED`。发起、再练、提前结束和删除分别审计为 `mock_interview.create`、`mock_interview.create`、`mock_interview.finish` 与 `mock_interview.delete`；AI 修正、手动修改、重新评估和删除录音分别审计为 `mock_interview.transcript_correct`、`mock_interview.transcript_edit`、`mock_interview.re_evaluate` 与 `mock_interview.recordings_delete`，目标类型均为 `mock_interview`。

## 对象资源

原用户级 `/api/assets` 图片接口继续保留。新增简历级资源接口：

| Method   | Path                                  | 行为                                          |
| -------- | ------------------------------------- | --------------------------------------------- |
| `POST`   | `/api/resumes/:id/assets`             | 接收 PNG/JPEG `file_name/data_url`，单图最大 10 MiB，写入简历私有前缀 |
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

PDF 导出审计上报接口只接受当前用户拥有的简历 ID；不存在或不属于当前用户都返回 `404 RESUME_NOT_FOUND`，非法动作或字段返回 `400 INVALID_AUDIT_EVENT`，sink 拒绝写入返回 `503 AUDIT_EVENT_UNAVAILABLE`。该接口为既有调用方保留；新的 `GET /api/resumes/:id/pdf` 由服务端路由自动记录同一个 `resume.pdf_export` 动作。其他审计动作不能通过该接口伪造。自动审计还覆盖鉴权/会话、账号资料和密码、简历/资源、JD、管理员用户状态、模型连接/逻辑模型/线路/能力绑定、插件发布包、应用内公告和模拟面试等动作；成功和受控失败都记录可信 actor、target、result、错误码和 request ID，不记录请求 body。审计进入共享 Loki，不新增 MySQL 审计表；现有 `/api/admin/llm/calls` 继续是 LLM 计量和调用状态的事实源。
简历导入的后端内部日志使用 `operation_id`/`task_id` 串联阶段和重试，失败时只记录稳定错误码、失败阶段和不含字段值的验证元数据；这些内部字段不扩展本节的 HTTP 请求或响应结构。

管理员日志查询接口复用 `is_admin=true` 权限；未登录返回 `401 UNAUTHORIZED`，普通用户返回 `403 FORBIDDEN`：

Agent 排障查询也只允许管理员访问：`GET /api/admin/agent-operations` 接受 `from`、`to`（带时区且最多 31 天）、`status`、`errorCode`、`operationId`、`userId`（二者均为时间窗内的精确匹配）、`cursor`、`limit`，返回 `{items, next_cursor}`。每项含操作 ID、内部 `user_id`、创建时间、状态、错误码、失败阶段、运行时请求的 `model_name` 快照和 `legacy` 标志。`GET /api/admin/agent-operations/:operationId` 返回同一模型快照、状态、`timeline_status`、按事件 ID 分页的 `events`、工具摘要和提案摘要；尚未选中模型或无法可靠还原的旧记录返回 `model_name: null`。阶段事件不含消息或简历正文。旧运行可查询但标记 `legacy`，不补造阶段事件；会话删除后相关轨迹一并删除。

| Method | Path | 查询参数 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/logs/system` | `from`、`to`、`level`、`source`、`dependency`、`requestId`、`taskId`、`operationId`、`errorCode`、`keyword`、`cursor`、`limit` | `{items, nextCursor, partial, droppedMalformed}` |
| `GET` | `/api/admin/logs/audit` | `from`、`to`、`action`、`actorUserId`、`targetType`、`targetId`、`result`、`requestId`、`cursor`、`limit` | 同上 |
| `GET` | `/api/admin/logs/summary` | `from`、`to` | `{system: {total, warnings, errors}, audit: {total, succeeded, failed}}` |

时间使用带时区 ISO 8601，默认最近 24 小时，最大跨度七天；`limit` 默认 50、最大 200。系统依赖筛选只允许 `mysql|redis|minio|linkparse|llm`，审计 action 只允许服务端已注册动作。游标不透明；非法筛选分别返回 `400 INVALID_SYSTEM_LOG_QUERY`、`INVALID_AUDIT_LOG_QUERY` 或 `INVALID_LOG_SUMMARY_QUERY`。查询固定使用 `service=linkresume`、当前环境和日志类型，不接受任意 selector。历史脏行会被丢弃并通过 `partial/droppedMalformed` 告知调用方；重复 `event_id` 在返回前去重。Loki 未配置、超时、网络或响应异常统一返回 `503 LOG_QUERY_UNAVAILABLE`，不能伪装为空结果。

## 大模型管理接口

以下接口只允许当前数据库用户的 `is_admin=true` 时访问。未登录返回 `401 UNAUTHORIZED`，普通用户返回 `403 FORBIDDEN`。本期不公开普通用户或第三方可调用的通用 chat、stream HTTP API；模型调用只作为 FastAPI 后端内部 Python 服务提供。

`users.is_admin` 不进入 access JWT 或 Redis 会话；管理员接口每次请求都从数据库读取该 `0/1` 标记，因此提权或降权对现有 Cookie 的下一次请求即时生效。公开注册始终创建普通用户。

管理员通过 `POST /api/auth/admin-login` 登录，后端额外校验 `is_admin=true` 后签发会话；普通用户调用返回 `403 FORBIDDEN`。管理端前端使用独立登录页 `/admin/login`（任何访问者可打开），通过 `api.me()` 恢复登录态后检查 `is_admin`；已登录管理员访问受保护页面（`/admin` 及其子页面）直接进入后台，未登录或无管理员身份的访问被重定向到登录页，登录成功后回到原目标，无法发起管理 API 调用。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/admin/llm/catalog` | `{useCases,providers}`；代码注册的场景和接入商能力 |
| `GET/POST/PATCH/DELETE` | `/api/admin/llm/connections[/:id]` | 连接列表、创建或按 `baseVersion` 编辑连接；密钥只写，响应仅含 `keyConfigured`；删除成功 `204` |
| `POST` | `/api/admin/llm/connections/:id/sync` | 从支持目录的接入商同步模型和线路；新线路默认停用 |
| `GET/POST/PATCH/DELETE` | `/api/admin/llm/models[/:id]` | 逻辑模型列表、创建或编辑显示名称与 `userSelectable`（对话页是否可选，创建时默认 `true`）；删除成功 `204` |
| `GET/POST/PATCH/DELETE` | `/api/admin/llm/routes[/:id]` | 线路列表、创建或修改线路启停、标识类型与价格规则；删除成功 `204` |
| `GET` | `/api/admin/llm/use-cases` | `{bindings}`；包含探测时间和当前是否生效 |
| `PUT/PATCH/DELETE` | `/api/admin/llm/use-cases/:useCase/routes/:routeId` | 创建或调整场景绑定、停用或删除绑定 |
| `POST` | `/api/admin/llm/use-cases/:useCase/routes/:routeId/probe` | 真实模型探针；成功返回 `{callId,validated:true}` |
| `GET` | `/api/admin/llm/calls` | `{calls,nextCursor,summary}`；按内部 ID 倒序分页，可选 `cursor`、`limit`、`useCase`、`status`、`errorCode`、`callId`、`userId`（精确匹配）、`from`、`to`（带时区，最多 31 天）；`summary` 按同一筛选计算 `callCount/succeeded/failed/inputTokens/outputTokens/costs/unmeteredCallCount` |

连接的 `providerCode` 在创建后固定，`settings` 只接受该接入商已登记的字段，不能提交任意推理 URL。AIHubMix 的 `settings.endpoint` 可选 `primary` 或 `alternate`，缺省为 `primary`；后者使用官方备用 `api.inferera.com`，目录与推理地址同步切换。修改连接设置会递增推理配置版本、清除旧目录同步状态并要求关联绑定重新探测。`apiKey` 加密保存，列表不返回密文。模型的 `id` 是用户看到的稳定逻辑模型 ID；线路 `invokeTarget` 才是供应商调用 ID。场景绑定的 `priority` 越小，该逻辑模型下的线路越先尝试；连接失败、超时、限流或线路不可用时按优先级尝试同模型的下一条有效线路，不跨模型。流式输出产生内容后不再切换；请求被拒绝和取消不切换。有效绑定同时要求连接、线路和绑定启用、目标可用，以及与当前配置匹配且未过期的成功探针。`assistant_conversation` 的有效绑定去重后就是用户可选列表。内部能力使用固定场景代码 `job_text_extraction`、`resume_structuring`、`job_image_extraction`、`mock_interview`，对话使用 `assistant_conversation`。图片场景探针实际发送测试图片，助手场景通过 Pi 执行 Tool 探针。

语音场景还包括 `speech_to_text` 与 `text_to_speech`，识别稿修正为 `transcript_correction`。目录的 AIHubMix `protocols` 兼容新增 `openai_responses`、`openai_asr_file`（仅识别）与 `openai_tts`（仅合成），百炼保留实时语音协议。目录继续优先列出 Chat，兼容管理台新增绑定时的原有默认值；Responses 和语音绑定通过管理 API 显式设置 `protocolCode`。非语音内部能力也接受接入商支持的 Responses，文本、图片与流式请求响应保持原有 DTO。接入商与场景交叉使用不支持的协议返回 `422 LLM_ROUTE_INVALID`；新绑定及修改协议后的绑定同样需要先探测，再启用线路与绑定，逐模型参数和协议边界见 [Agent/LLM 运行时](../internals/agent-runtime.md#治理数据)。

`llm_call_logs` 每条记录对应一次实际请求，切换前失败的线路和切换后成功的线路分别记录，保存场景、来源、用户、运行、真实线路、调用协议、用量、价格规则快照、估算费用与币种及安全错误分类；不保存提示词、图片、完整响应或明文凭据。目录价格带分档、缓存或优惠规则时，缺少充分用量明细的估算费用留空，`meteringStatus=partial`。Pi 的费用由后端根据线路价格规则计算，不信任 Pi 回传的金额。`0091` 删除并重建旧 LLM 四张表，保留 Agent 会话与运行；迁移前需检查目标 revision、旧数据与备份。

结构化调用是后端内部能力，服务端在系统指令中提供 JSON Schema，并本地验证输出；非法结构以 `LLM_RESPONSE_INVALID` 收口。

调用日志中的上游模型、请求编号超过存储字段上限时，对应可选值为 `null`，调用结果、用量和本系统 `callId` 仍保留。文件 ASR 探针要求固定测试录音的最终转写非空；为空返回 `422 LLM_RESPONSE_INVALID`，不会写入成功验证。

删除是物理删除，只用于清理从未使用过的配置，历史数据一律不删。线路只要仍被场景绑定、`llm_call_logs` 或 `agent_runs` 引用，删除返回 `409 LLM_ROUTE_IN_USE`，此时应改为停用。删除逻辑模型会同时删除它的全部线路：模型被 `agent_sessions`/`agent_runs` 引用，或其中任一线路被引用时，返回 `409 LLM_MODEL_IN_USE`。删除连接会同时删除它的全部线路，但保留逻辑模型，因为同一模型可能还有其他连接的线路；任一线路被引用时返回 `409 LLM_CONNECTION_IN_USE`。以上删除都整体成功或整体失败，不会只删掉一部分线路。

## 管理台用户管理

以下接口同样只允许 `is_admin=true` 访问。当前使用 `POST /api/auth/admin-login` 登录判定管理身份，管理台前端在 `/admin` 入口获得管理会话后调用管理端 API。

| Method  | Path                                    | 成功结果                                                                                                                       |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET`   | `/api/auth/admin/users`                 | `{items, total, page, size}`，支持 `q`（ID/邮箱/昵称模糊）、`status`（启用/禁用）、`role`（admin/user）筛选和 `page/size` 分页 |
| `GET`   | `/api/auth/admin/users/{userId}`        | 用户详情对象，含 `resume_count`（简历数）、`llm_call_count`（累计 LLM 调用数）和 `llm_costs`（按币种的累计估算费用与无费用调用数） |
| `PATCH` | `/api/auth/admin/users/{userId}/status` | `{ok: true, user, revoked_sessions}`；body 为 `{action: "disable" 或 "enable"}`                                                       |
| `GET`   | `/api/auth/admin/stats`                 | `{total_users, active_users_7d, total_resumes, llm_calls_today, estimated_cost_month}` 全系统概览统计；今日调用数与本月 USD 估算费用来自 `llm_call_logs` |

管理员禁用自己的账号返回 `422 CANNOT_SELF_DISABLE`；尝试禁用系统中最后一个管理员返回 `422 CANNOT_DISABLE_LAST_ADMIN`。禁用成功后服务端立即调用 `revoke_user_sessions` 删除该用户全部 Redis 会话，该用户的所有现有 Cookie 立即失效，重新登录时因用户 `status=0` 被拒绝。

## 管理台统计

以下只读接口只允许 `is_admin=true` 访问，未登录返回 `401 UNAUTHORIZED`，普通用户返回 `403 FORBIDDEN`。统计直接读取已有记录，不写入任何数据，不保存告警状态。时间窗参数 `from`、`to` 必须带时区，最大跨度 31 天；非法时返回 `400 INVALID_ADMIN_INSIGHTS_QUERY`。费用统一为 `{costs: [{currency, amount}], unmeteredCallCount}`，按币种分别汇总、不折算汇率。成功率只以已结束（成功、失败、取消）的调用为分母，分母为 0 时为 `null`；环比在上一等长窗口为 0 时为 `null`。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/admin/insights/overview` | `{metrics: {activeUsers7d, newUsers7d, callsToday, cost7d}, deltas, trend (14 天), alerts}` |
| `GET` | `/api/admin/insights/users` | `{total, newUsers7d, activeUsers7d, disabled, admins, registeredToday, daily (14 天)}` |
| `GET` | `/api/admin/insights/templates?limit` | `{total, active, inactive, pendingReview, usedToday, usage, top}`；`limit` 1–20，默认 5 |
| `GET` | `/api/admin/insights/job-imports` | `{imported7d, imported30d, users7d, sources, daily (30 天)}`；只统计 `external_import` 岗位 |
| `GET` | `/api/admin/insights/llm-usage?groupBy&from&to` | `{from, to, summary, previous, groups}`；`groupBy` 为 `model`、`useCase` 或 `connection`，默认最近 24 小时 |
| `GET` | `/api/admin/insights/llm-health` | `{connections, models}`；24 小时请求数、成功率与验证有效的绑定数 |
| `GET` | `/api/admin/insights/agent?from&to` | `{operations, failed, failureRate, running, p95Ms, topFailureStage, topErrorCode, daily (7 天)}`；状态口径与 Agent 排障列表一致 |
| `GET` | `/api/admin/insights/funnel?from&to` | `{window, steps, registrationsByMethod, aiCustomizationByEntry, resumeBySource, daily}`；以窗口内注册的用户为一组（默认最近 30 天，最长 31 天），`steps` 依次为 `registered`、`resume`（仅模板创建或文件导入）、`ai_customization`、`mock_interview`、`pdf_export` 的去重人数；分布统计每人首个对应事件，缺失维度计为 `unknown` |
| `GET` | `/api/admin/insights/log-heatmap` | `{buckets}`；最近 7 天按 3 小时分桶的 ERROR（含 CRITICAL）与 WARNING 数，共 56 桶；Loki 不可用返回 `503 LOG_QUERY_UNAVAILABLE` |

`alerts` 每项为 `{type, severity, title, description, target}`，按请求时的数据现场判定：对话能力存在已启用但验证失效的绑定（`critical`）；最近 1 小时 Agent 失败不少于 3 次且失败率不低于 10%（`warning`）；最近 1 小时已结束的 LLM 调用不少于 20 次且成功率低于 98%（`warning`）；存在分类状态为待讨论的启用模板（`info`）。

## 应用内公告

公告面向全体登录用户，只支持纯文本与换行；客户端必须按纯文本展示正文，不渲染 HTML。公告状态为 `draft → published → unpublished`，已下线为终态；只有草稿可以编辑、删除和发布。已发布公告在“生效开始（为空时取发布时间）≤ 当前时间 < 生效结束（为空不过期）”时对用户可见，与用户注册时间无关。已读状态按用户只保存一个“已读到的时间点”：公告的展示时间（生效开始与发布时间中较晚者）晚于该时间点即为未读；从未打开过公告的用户，所有生效公告都算未读。系统不记录单条已读，也不统计已读人数。

管理端接口要求 `is_admin=true`：

| Method | Path | 请求 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/announcements` | `status?`、`cursor?`、`limit?`（1–100，默认 20） | `{items, nextCursor}`，按创建顺序倒序 |
| `POST` | `/api/admin/announcements` | `{level?, title, body, startsAt?, endsAt?}` | `201 {announcement}`，状态为草稿 |
| `GET` | `/api/admin/announcements/stats` | 无 | `{draft, published, unpublished, active, scheduled}`；`scheduled` 为已发布但尚未到开始时间的数量，`published - active - scheduled` 即已过期 |
| `GET` | `/api/admin/announcements/{id}` | 无 | `{announcement}` |
| `PATCH` | `/api/admin/announcements/{id}` | 上述字段任意子集 | `{announcement}` |
| `DELETE` | `/api/admin/announcements/{id}` | 无 | `204` |
| `POST` | `/api/admin/announcements/{id}/publish` | 无 | `{announcement}` |
| `POST` | `/api/admin/announcements/{id}/unpublish` | 无 | `{announcement}`；已下线时幂等返回 |

管理端公告对象含 `id, level, title, body, status, visibility, startsAt, endsAt, publishedAt, unpublishedAt, createdBy, publishedBy, unpublishedBy, createdAt, updatedAt`。`level` 为 `normal` 或 `important`；`visibility` 为 `draft`、`scheduled`、`active`、`expired` 或 `unpublished`。标题 1–120 字、正文 1–5000 字，空白或超长返回 `422`；结束不晚于开始，或发布时结束时间已过，返回 `422 ANNOUNCEMENT_WINDOW_INVALID`；对非草稿编辑、删除、发布，或对草稿下线，返回 `409 ANNOUNCEMENT_STATE_CONFLICT`；不存在返回 `404 ANNOUNCEMENT_NOT_FOUND`。创建、编辑、删除、发布、下线分别登记 `admin.announcement_create|update|delete|publish|unpublish` 审计动作。

用户侧接口要求登录：

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/announcements` | `{items: [{id, level, title, body, startsAt, endsAt, publishedAt, read}], unreadCount}`；重要在前，同级按展示时间倒序 |
| `GET` | `/api/announcements/unread-count` | `{unreadCount}` |
| `POST` | `/api/announcements/read-all` | `{unreadCount: 0}`；把已读时间点更新为当前时间，只会前移，重复调用无副作用 |

用户侧只返回当前生效的公告，响应不包含管理员 ID。

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

Development 与 Production 使用独立 MinIO。各自 Bucket 内的当前指针固定为 `system/plugin-releases/current.json`，版本对象固定为 `system/plugin-releases/v<version>/linkresume-job-capture-v<version>.zip`；对象键不重复携带环境名。服务端新写的指针使用 `schema_version=3` 并显式包含 `status=published|unpublished`；读取兼容既有不含 `status` 的 v2 指针，并按已发布处理。

## 微信小程序求职接口

以下接口均要求有效小程序 Bearer，会话与 Web Cookie 隔离；普通用户和启用管理员均只能操作本人资源。前缀为 `/api/miniprogram/career`。

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/applications` | 游标分页，复用 scope/keyword/status/stage_type/limit；返回 items/next_cursor，包含 current_stage、stages、current_session_status（用于区分场次已完成与等待结果）和 company_logo_url |
| GET | `/applications/:id` | 本次求职的岗位快照、阶段历史、Offer 和锁版本 |
| POST | `/applications/:id/stages` | 复用 AddApplicationStageRequest；client_request_id 幂等追加阶段，首次追加同时记录投递事实与可选当前简历附件 |
| POST | `/applications/:id/terminate` | 复用 TerminateApplicationRequest；保留历史 |
| POST | `/applications/:id/offer` | 复用 OfferApplicationRequest，保存已收到 Offer 的待遇 |
| GET | `/sessions` | 游标分页，支持 application_id、带时区的 start_at/end_at、status、upcoming、scope、limit，时间窗口按重叠查询；每项附带 company_name、job_title、company_logo_url 和 calendar_color 公司标识快照 |
| POST | `/applications/:id/sessions` | 复用 InterviewSessionCreateRequest；关联当前阶段，幂等创建安排 |
| GET | `/sessions/:id` | 返回 session/application，含准备和文字记录 |
| PUT | `/sessions/:id` | 复用 InterviewSessionUpdateRequest，更新方式、链接、地点、准备或文字记录 |
| POST | `/sessions/:id/reschedule` | 复用 RescheduleInterviewRequest；更新开始结束时间与时区 |
| POST | `/sessions/:id/complete` | 复用 CompleteInterviewRequest，只完成本场 |
| POST | `/sessions/:id/cancel` | 复用 CancelInterviewRequest，取消安排，保留记录 |
| PUT | `/applications/:id/resume` | 仅接受 resume_id（必填可空）和 base_lock_version；关联、更换或解除本人简历，不推进阶段；复用求职乐观锁与归属校验 |
| GET | `/applications/:id/resume-preview.png` | 按本人求职记录关联的当前简历渲染；返回 PNG、private/no-store 和 X-LinkResume-Lock-Version；无关联或源已删除返回 409 APPLICATION_RESUME_UNAVAILABLE |

修改复用 base_lock_version；过期锁返回 `409 INTERVIEW_EDIT_CONFLICT`，非法阶段动作返回 `409 INTERVIEW_INVALID_TRANSITION`，排期允许时间重叠；兼容字段 `allow_conflict` 不再影响是否可保存。非法 ID、不存在或越权统一 `404 INTERVIEW_NOT_FOUND`。日期查询缺时区或范围倒置返回 `400 INVALID_INTERVIEW_QUERY`。阶段与安排分别提交，阶段成功后排期失败不会回滚阶段。原 overview、advance、close 兼容端点保留，新页面使用 stages/terminate。Web API、数据库 schema 和代理配置未改变。

### 桌面文字模拟面试权限

模拟面试 REST 和资料列表在有 Authorization 时只接受 desktop Bearer，会话校验拒绝认证 Cookie 与 Bearer 混用及 Web/小程序 token。允许 `GET/POST /api/mock-interviews`、`GET/DELETE /api/mock-interviews/{UUID}`、`POST /api/mock-interviews/{UUID}/{answers|skip|reply:retry|finish|abandon|retry|repeat}` 和 `GET /api/datasets`。所有个人资源仍执行原有归属校验；模拟面试配置只消费已完成的本人资料列表；独立资料库权限见下文。桌面创建与再练仅限文字模式，语音能力、WebSocket、识别稿修正、重评和录音仍不在桌面权限内。Web Cookie 调用保持原行为。

桌面 answers/skip transport 将本地 `__idempotency_key` 字段转为 HTTP `Idempotency-Key`，从 JSON 正文移除；重试沿用原值。SSE 的 `interviewer.failed` 转为失败提示，但不能据此推断回答未保存，客户端随后读取详情确认。原生缓冲 SSE，响应最多 4 MiB，拒绝重定向且不接收或发送 Cookie。


### 桌面资料库权限

`get_current_dataset_user` 在 Authorization 存在时只接受 desktop Bearer，拒绝认证 Cookie 混用及 Web/小程序 token；无 Authorization 的 Web Cookie 行为保持不变。白名单为 `GET/POST /api/datasets`、`GET/POST /api/datasets/folders`、`PATCH/DELETE /api/datasets/folders/:id`、`GET/PATCH/DELETE /api/datasets/:id`、`GET /api/datasets/:id/{content|source}`、`POST /api/datasets/:id/retry`、`PATCH /api/datasets/:id/folder`、`POST /api/datasets/move-batch`、`PUT /api/datasets/:id/file`、`POST /api/interview-sessions/:id/assets/attach` 和 `DELETE /api/interview-sessions/:id/assets/:dataset_id`。ID 为无前导零的正十进制数，其他路径/方法拒绝该渠道。路由复用原有资源归属、文件真实性、容量、幂等、正文版本与永久删除规则，不开放任意对象存储 URL 或 legacy 素材上传入口。原文件流继续 private/no-store，客户端不得把 Bearer 注入网页或媒体外链。


## 账号补充接口

以下接口除回执查询与小程序身份确认外都要求当前 Web Cookie。不能由客户端指定另一个用户。

| Method | Path | 契约 |
| --- | --- | --- |
| GET | `/api/account/profile` | 既有资料和简历摘要，新增 `user.contact_email`、`user.registered_at`、`current_session.device_label` 和 `capabilities`（auth_mode、can_change_password、can_delete_account、deletion_confirmation_method） |
| PUT | `/api/account/contact-email` | JSON `{email: string|null}`；去空白后空串视为 null，仅校验格式和 254 字符上限，不验证所有权；返回 `{contact_email}` |
| GET | `/api/account/preferences` | `{locale, interview_reminder_enabled, notifications_available:false}`；无记录默认 zh-CN/false |
| PATCH | `/api/account/preferences` | 非空严格 JSON，仅接受 `locale:zh-CN|en-US` 与布尔 `interview_reminder_enabled` 的局部字段；非法类型、未知键或空请求拒绝 |
| POST | `/api/account/change-password` | 仅 Local/Development；`{current_password,new_password,confirm_password}`，成功 `{ok:true}`，撤销账号全部会话并清 Cookie |
| POST | `/api/account/wechat/verification-request` | 仅 Production 且注销开启；`{action:"delete_account"}`，返回 `{scene,poll_token,qrcode_data,expires_at}` |
| POST | `/api/account/wechat/verification-confirm` | 小程序 JSON `{scene,code}`，以新微信 code 确认原账号与原网页会话；不建号、不发会话 |
| POST | `/api/account/wechat/verification-status` | Web JSON `{scene,poll_token}`，仅原 session 可查询；verified 时返回本次 `action_token` |
| POST | `/api/account/wechat/verification-cancel` | 同上；取消后旧凭证不可用 |
| POST | `/api/account/deletion` | `confirmation` 必须为 `注销账号`；开发 `{method:"password",current_password,confirmation}`，正式 `{method:"wechat",action_token,confirmation}`；严格拒绝额外字段。受理 `202 {job_id,receipt_token,status:"pending"}` |
| POST | `/api/account/deletion-status` | 匿名 JSON `{job_id,receipt_token}`；只返回 `status`、`phase`、可选 `error_code`。错误回执或过期均 404 |

微信确认五分钟有效，绑定 user/session/action；状态为 pending、verified、cancelled、consumed、expired，刷新取码取消旧请求。验证失败、跨账号或会话、取消、到期、消费后不允许注销。回执和 poll token 放请求体，不放 URL。

主要账号错误包括 `INVALID_CONTACT_EMAIL`、`INVALID_ACCOUNT_PREFERENCES`、`INVALID_CURRENT_PASSWORD`、`WEAK_PASSWORD`、`PASSWORD_MISMATCH`、`PASSWORD_UNCHANGED`、`INVALID_ACCOUNT_CONFIRMATION_METHOD`、`INVALID_ACCOUNT_DELETION_CONFIRMATION`、`ACCOUNT_DELETION_FORBIDDEN`、`ACCOUNT_SHARED_RESOURCE_OWNER`、`ACCOUNT_BUSY`、`WECHAT_IDENTITY_REQUIRED` 和 `WECHAT_IDENTITY_MISMATCH`。清理状态为 pending/processing/retry_wait/needs_attention/completed；阶段为 database/objects/rag/complete。详细语义见[账号功能](../features/identity-account.md)。

Agent 结构化上下文增加 `type:"user_profile"`；ID 必须属于当前账号，`version` 必须准确匹配画像的当前 `lock_version`。材料目录只返回元数据，显式选择后才以只读 `profile_markdown` 进入 Pi，认证和联系字段不进入正文。

## 文字 AI 面试复盘

`POST /api/interview-sessions/:id/review:generate` 接受 canonical UUID `request_id` 和 `base_lock_version`，校验通过后返回 `202` 与既有场次详情结构（`review_status=generating`），报告在后台生成，客户端轮询场次详情读取终态。仅本人未归档的已完成场次可生成；必须有不超过 50,000 字符的 `questions_markdown`。401 为失效账号，越权或不存在返回 404；状态不适用、乐观锁过期、源记录变化的重复请求和账号已有活动生成返回 409。无文字或超长返回 400。模型未配置返回 503，模型或证据验证失败返回 502，原文字和已有报告不被清除。

场次详情和列表增加可空的 `review_report`、`review_status`、`review_request_id`、`review_error`、`review_started_at`，以及 `review_stale`。报告包含 `schema_version: 1`、`source_hash`、`generated_at`、`summary`、可空 `overall_score`、三项 `{score, reason, evidence}` 和问题数组 `{question, answer, evidence, strength, improvement, suggested_answer}`。`score` 范围 0–10，证据不足留空；综合分要求三项分数齐全。问题、原回答和非空评分证据须摘录源记录；建议回答与原回答分开保存。旧手写 `review_summary` 等字段仍可编辑，生成不覆盖它们。

响应中的 `review_request_id` 标识当前生成。网络结果不明确时，只有读到同 UUID 的终态才结束该次重试，读到旧报告或读取失败仍复用原 UUID。相同 UUID 和源文字重复请求复用原生成状态，不再次调用模型；失败后的显式重新生成使用新 UUID。源记录在生成期间改变，返回详情中的 `review_status=failed`、`review_error=INTERVIEW_REVIEW_SOURCE_CHANGED`，原记录和旧报告保留。旧报告源哈希与当前文字不同即 `review_stale=true`。活动生成超过 5 分钟没有心跳即视为中断，同 UUID 重试返回 `502 INTERVIEW_REVIEW_INTERRUPTED`。

**复盘报告 v2（0110）**：新生成的报告为 `schema_version: 2`，包含 `rubric_version`、`headline`、`summary`、`verdict{level: likely_pass|promising|at_risk|likely_fail, confidence: high|medium|low, confidence_reason, signals[{polarity, quote, meaning}], adjusted_by_signals, fatal_questions}`、可空 `total_score`（0–100）与 `grade`（excellent/good/pass/improve）、`question_average`、`dimension_score`、`first_axis`（professional_depth 或 motivation_fit）、`category_counts`、`dimensions[{key, assessed, score(1–5), weight, evidence, comment}]`、`questions[{index, key, question, answer, category, answer_status, follow_ups, expected_depth, achieved_depth, score, signals[{signal, verdict, quote}], factual_errors, resume_conflict, strength, improvement, suggested_answer, evidence_snippets[{dataset_id, title, text}]}]`、`improvements[{title, detail, priority, dimension, question_indexes}]` 与 `basis{transcript_source, transcript_chars, resume_title, has_job, material_snippets, material_mode, downgraded_quotes, dropped_questions}`。识别不出可评估题目时失败为 `INTERVIEW_REVIEW_NO_QUESTIONS`。v1 报告保持原结构。

**逐题复盘笔记（0110）**：场次详情增加 `review_question_notes[{id, question_key, question_text, verdict: good|improve|null, note, lock_version, updated_at}]`。`PUT /api/interview-sessions/:id/review-notes` 接受 `question_text`（1–1000）、`verdict`、`note`（≤2000）和 `lock_version`（新建时省略，更新时必须等于当前值，否则 409）；返回 `{note}`，标记与笔记都为空时删除并返回 204。`DELETE /api/interview-sessions/:id/review-notes/:noteId` 返回 204。笔记按题目原文指纹挂接，客户端用报告题目的 `key` 匹配，未匹配的笔记照常返回。

**录音转写（0110）**：场次详情增加 `transcript_source`（manual/transcription/null）与 `transcriptions[{dataset_id, status, error_code, pending_replace, result_duration_ms, updated_at}]`。上传或关联音视频到非笔试场次时自动建任务；`PUT /api/interview-sessions/:id` 修改 `questions_markdown` 时来源置为 manual。`POST /api/interview-sessions/:id/transcriptions/:datasetId:retry` 对失败或已取消的任务重新排队（录音未关联本场返回 400，其他状态 409 `INTERVIEW_TRANSCRIPTION_INVALID_STATE`，功能关闭 503）；`POST …/transcriptions/:datasetId:apply` 接受 `base_lock_version`，用待替换结果覆盖文字稿（无待替换结果 409，版本过期 409）。失败码包括 `INTERVIEW_TRANSCRIPTION_NOT_CONFIGURED`、`…_STORAGE_UNAVAILABLE`、`…_FORMAT_UNSUPPORTED`、`…_DOWNLOAD_FAILED`、`…_AUDIO_TOO_LONG`、`…_EMPTY`、`…_TIMEOUT`、`…_FAILED`。

**笔试题导入（只预览，不保存）**：`POST /api/interview-sessions/:id/written-questions:extract` 为 multipart：`source=text` + `text`（≤20,000 字）、`source=dataset` + `dataset_id`（本人已解析完成的文档）、或 `source=images` + 1–5 个 `files`（png/jpg/webp，每张 ≤5MB，识别后不保存）。仅笔试或测评场次可用（否则 400 `INTERVIEW_NOT_WRITTEN_TEST`）。返回 `{questions[{no, text}], markdown}`；识别不到题目 422，模型未配置 503。确认后由客户端通过 `PUT /api/interview-sessions/:id` 保存 `questions_markdown`。
