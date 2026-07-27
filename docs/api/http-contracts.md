# HTTP 接口契约

本文记录当前调用方可观察的 HTTP 行为。全部 `/api` 路径由 FastAPI 提供，Swagger UI 位于 `/api/docs`，OpenAPI JSON 位于 `/api/openapi.json`。未匹配的 `/api` 路径返回 JSON 404，不会被 SPA fallback 转成 HTML。

## 健康检查与鉴权

`GET /api/health` 返回 `{status, service, version}`。鉴权接口包括：

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/auth/me` | `{user}`；未登录或 Cookie 无效时为 `null` |
| `POST` | `/api/auth/register` | `201 {user}`，签发短 access 与 7 天 refresh 双 Cookie |
| `POST` | `/api/auth/login` | `{user}`，签发短 access 与 7 天 refresh 双 Cookie |
| `POST` | `/api/auth/refresh` | `{user}`，轮换 refresh 密钥并下发新双 Cookie |
| `POST` | `/api/auth/logout` | `{ok: true}`，删除 Redis 会话并清除双 Cookie |

鉴权使用“短 JWT access + 不透明 refresh + Redis 会话”的双 Token 方案。Access Cookie 名为 `resume_access`，有效期 `ACCESS_TTL_MINUTES`（默认 15 分钟），`SameSite=Lax`、`Path=/`。Refresh Cookie 名为 `resume_refresh`，有效期 `SESSION_TTL_DAYS`（默认 7 天），`HttpOnly`、`SameSite=Lax`、`Path=/api/auth`。Web 调用受保护接口收到 `401` 时，会把并发请求合并到同一次 refresh，刷新成功后各自重试一次；启动检查 `/api/auth/me` 返回空用户时也会先尝试 refresh，再进入访客态。登录或刷新失败返回 `401 INVALID_CREDENTIALS`。

每次受保护请求按“Access 自洽 → Session 存活 → 用户启用”三步校验：先校验 access JWT 签名与过期，再用 `EXISTS auth:session:{sid}` 确认 Redis 会话仍在，最后从 MySQL 读取用户并要求 `status=1`。私有接口不接受客户端 `user_id`；未登录返回 `401 UNAUTHORIZED`。会话只存 Redis（`auth:session:{sid}` 哈希与 `auth:user_sessions:{uid}` 集合），不写 MySQL；撤销即删除 key。`POST /api/auth/refresh` 校验 refresh Cookie 中的 `sid.secret`，匹配 Redis 中保存的 secret 哈希后轮换密钥、续期会话并下发新 Cookie；哈希不匹配会立即撤销该会话。密码经 Argon2id 哈希后存入 `password_hash`，不保存明文。

## 语义简历契约

简历 API、Python DTO 和 TypeScript 类型统一使用 `snake_case`。数据库 ID 在 HTTP 中使用十进制字符串。`data` 是 `ResumeDocumentV1`，`style` 是 `ResumeStyleV1`，两者的 `schema_version` 当前均为字符串 `"1.0"`。`style.smart_one_page` 控制连续单页或标准 A4 导出模式，并随版本快照保存。旧 `markdown/settings/splitRatio/previewScale/lockVersion` 不再是简历写契约。

Alembic `0005` 将历史 `schema_version=1` 的 Tiptap 当前态和版本快照转换为上述 `"1.0"` 契约；原始 JSON 保存在只供迁移回滚使用的同行备份列中，不进入 API 响应。发布顺序仍为先迁移数据库、再启动新应用。

| Method | Path | 鉴权 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/resume-templates` | 否 | `{templates}` 启用模板列表 |
| `GET` | `/api/resume-templates/:id` | 否 | `{template}` |
| `GET` | `/api/resumes` | 是 | `{resumes}`，按更新时间倒序 |
| `POST` | `/api/resumes` | 是 | `201 {resume}`；请求为 `{title?, template_id?}` |
| `GET` | `/api/resumes/:id` | 是 | `{resume}` |
| `PUT` | `/api/resumes/:id` | 是 | `{resume}`；请求含 `base_lock_version` 及可选 `title/data/style` |
| `DELETE` | `/api/resumes/:id` | 是 | `{deleted}` |

空白、模板和导入创建统一受每用户最多 10 份简历的限制；创建事务先锁定用户行再检查数量，并发请求不会突破上限。达到上限返回 `409 RESUME_LIMIT_REACHED`，删除任意一份后释放名额。空白和模板创建都在同一事务写入当前简历及 `version_no=1/reason=initial` 快照。更新同时保存完整 data/style 并递增 `lock_version`，不创建历史版本；过期基准返回 `409 RESUME_EDIT_CONFLICT`。非法内容和样式分别返回 `400 INVALID_RESUME_DOCUMENT`、`400 INVALID_RESUME_STYLE`。不存在或不属于当前用户的简历统一返回 `404 RESUME_NOT_FOUND`。

## 历史版本

| Method | Path | 鉴权 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/resumes/:id/versions` | 是 | `{versions}`，版本号倒序 |
| `POST` | `/api/resumes/:id/versions` | 是 | `201 {version}`，创建 `manual` 快照 |
| `GET` | `/api/resumes/:id/versions/:version_no` | 是 | `{version}` 完整快照 |
| `DELETE` | `/api/resumes/:id/versions/:version_no` | 是 | `{deleted}`；删除指定旧版本 |
| `POST` | `/api/resumes/:id/versions/:version_no/restore` | 是 | `{resume}`；按需追加 `before_restore` 后追加 `restore` |

版本号单调递增且不复用；每份简历默认最多保存 10 个版本。创建或恢复所需的版本空间不足时返回 `409 RESUME_VERSION_LIMIT_REACHED`，不会自动删除任何历史版本；用户删除旧版本后才能继续。最新版本作为当前恢复基准不可删除，尝试删除返回 `409 LATEST_RESUME_VERSION_REQUIRED`。版本不存在返回 `404 RESUME_VERSION_NOT_FOUND`，并发兜底失败返回 `409 VERSION_CONFLICT`。

## 文件导入

`POST /api/resumes/import` 使用 `multipart/form-data`，字段为 `file` 和可选 `title`。支持 UTF-8 Markdown、DOCX 和带文字层 PDF；Markdown 直接读取，DOCX/PDF 通过配置的 tolink-rag Adapter 转为 Markdown，再经过 `SectionIR → ResumeExtractionDraft → ResumeDocumentV1`。成功返回：

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

原文件对象键不在响应中。文件为空、超限、不支持或内容非法分别返回 `EMPTY_IMPORT_FILE`、`IMPORT_FILE_TOO_LARGE`、`UNSUPPORTED_IMPORT_FORMAT`、`IMPORT_CONTENT_INVALID`；超过结构化模型输入上限返回 `413 STRUCTURING_INPUT_TOO_LARGE`，触发频率或并发保护返回 `429 IMPORT_RATE_LIMITED`。账号已有 10 份简历时会在上传和模型处理前返回 `409 RESUME_LIMIT_REACHED`；快速检查后的并发创建仍由最终事务检查兜底。RAG 或结构化模型未配置、调用失败、响应非法时返回稳定的 503/502/422 错误且不创建半成品；已上传对象执行幂等补偿。

## 对象资源

原用户级 `/api/assets` 图片接口继续保留。新增简历级资源接口：

| Method | Path | 行为 |
| --- | --- | --- |
| `POST` | `/api/resumes/:id/assets` | 接收 `file_name/data_url`，写入简历私有前缀 |
| `GET` | `/api/resumes/:id/assets/:asset_name` | 校验简历所有权后读取 |
| `DELETE` | `/api/resumes/:id/assets/:asset_name` | 当前或历史快照仍引用时返回 `409 ASSET_IN_USE` |

删除简历会删除数据库版本，并在同一事务登记导入原文件与简历资源前缀的幂等清理任务；提交后立即尝试，失败任务由后台 worker 重试，不恢复已经提交的数据库记录。
