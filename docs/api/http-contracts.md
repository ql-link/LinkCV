# HTTP 接口契约

本文记录当前调用方可观察的 HTTP 行为。全部 `/api` 路径由 FastAPI 提供，Swagger UI 位于 `/api/docs`，OpenAPI JSON 位于 `/api/openapi.json`。未匹配的 `/api` 路径返回 JSON 404，不会被 SPA fallback 转成 HTML。

## 健康检查与鉴权

`GET /api/health` 返回 `{status, service, version}`。鉴权接口包括：

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/auth/me` | `{user}`；未登录时为 `null` |
| `POST` | `/api/auth/register` | `201 {user}` 并设置 HttpOnly Cookie |
| `POST` | `/api/auth/login` | `{user}` 并设置 Cookie |
| `POST` | `/api/auth/logout` | `{ok: true}` 并清除 Cookie |

私有接口从 Cookie 会话解析当前用户，不接受客户端 `user_id`。未登录返回 `401 UNAUTHORIZED`。

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

空白和模板创建都在同一事务写入当前简历及 `version_no=1/reason=initial` 快照。更新同时保存完整 data/style 并递增 `lock_version`，不创建历史版本；过期基准返回 `409 RESUME_EDIT_CONFLICT`。非法内容和样式分别返回 `400 INVALID_RESUME_DOCUMENT`、`400 INVALID_RESUME_STYLE`。不存在或不属于当前用户的简历统一返回 `404 RESUME_NOT_FOUND`。

## 历史版本

| Method | Path | 鉴权 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/resumes/:id/versions` | 是 | `{versions}`，版本号倒序 |
| `POST` | `/api/resumes/:id/versions` | 是 | `201 {version}`，创建 `manual` 快照 |
| `GET` | `/api/resumes/:id/versions/:version_no` | 是 | `{version}` 完整快照 |
| `POST` | `/api/resumes/:id/versions/:version_no/restore` | 是 | `{resume}`；按需追加 `before_restore` 后追加 `restore` |

版本号单调递增且不复用；每份简历默认最多保留 20 个版本，超限淘汰与新版本写入在同一事务中。版本不存在返回 `404 RESUME_VERSION_NOT_FOUND`，并发兜底失败返回 `409 VERSION_CONFLICT`。

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

原文件对象键不在响应中。文件为空、超限、不支持或内容非法分别返回 `EMPTY_IMPORT_FILE`、`IMPORT_FILE_TOO_LARGE`、`UNSUPPORTED_IMPORT_FORMAT`、`IMPORT_CONTENT_INVALID`；超过结构化模型输入上限返回 `413 STRUCTURING_INPUT_TOO_LARGE`，触发频率或并发保护返回 `429 IMPORT_RATE_LIMITED`。RAG 或结构化模型未配置、调用失败、响应非法时返回稳定的 503/502/422 错误且不创建半成品；已上传对象执行幂等补偿。

## 对象资源

原用户级 `/api/assets` 图片接口继续保留。新增简历级资源接口：

| Method | Path | 行为 |
| --- | --- | --- |
| `POST` | `/api/resumes/:id/assets` | 接收 `file_name/data_url`，写入简历私有前缀 |
| `GET` | `/api/resumes/:id/assets/:asset_name` | 校验简历所有权后读取 |
| `DELETE` | `/api/resumes/:id/assets/:asset_name` | 当前或历史快照仍引用时返回 `409 ASSET_IN_USE` |

删除简历会删除数据库版本，并在同一事务登记导入原文件与简历资源前缀的幂等清理任务；提交后立即尝试，失败任务由后台 worker 重试，不恢复已经提交的数据库记录。
