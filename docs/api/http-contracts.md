# HTTP 接口契约

本文记录当前调用方可观察的 HTTP 行为。FastAPI 路由以 `apps/backend/src/linkcv/api/` 和 `apps/backend/src/linkcv/modules/` 为事实源，前端调用以 `apps/web/src/api/client.ts` 为消费方。

全部 `/api` 路径均由 FastAPI 提供。Swagger UI 位于 `/api/docs`，OpenAPI JSON 位于 `/api/openapi.json`。

## 健康检查

`GET /api/health` 返回 HTTP `200`：

```json
{
  "status": "ok",
  "service": "linkcv-backend",
  "version": "0.1.0"
}
```

## 鉴权接口

| Method | Path | 鉴权 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/auth/me` | 否 | `{user}`；未登录或 Cookie 无效时为 `null` |
| `POST` | `/api/auth/register` | 否 | `201 {user}`，设置七天 JWT HttpOnly Cookie |
| `POST` | `/api/auth/login` | 否 | `{user}`，设置七天 JWT HttpOnly Cookie |
| `POST` | `/api/auth/logout` | 否 | `{ok: true}`，清除 Cookie |

Cookie 默认名为 `resume_session`，使用 `SameSite=Lax`。注册错误码为 `INVALID_EMAIL`、`WEAK_PASSWORD`、`EMAIL_EXISTS`；登录失败返回 `401 INVALID_CREDENTIALS`。

用户身份持久化在 MySQL `users` 表，邮箱保持唯一；`status` 默认为 `1`（启用），`is_admin` 默认为 `0`（普通用户），注册时由服务端生成昵称。`auth_version` 已从 MySQL 模型移除；当前 Cookie JWT 解析后仍会从 MySQL 读取用户并检查账号启用状态。Redis Auth Session 与双 Token 刷新接口尚未启用。

JWT 只保存用户 ID、签发时间和有效期。`users.is_admin` 不进入 JWT；管理员接口每次请求都从数据库读取该 `0/1` 标记，因此提权或降权对现有 Cookie 的下一次请求即时生效。公开注册始终创建普通用户。

## 简历接口

| Method | Path | 鉴权 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/resumes` | 是 | `{resumes}` 摘要列表，按更新时间倒序 |
| `POST` | `/api/resumes` | 是 | `201 {resume}` |
| `GET` | `/api/resumes/:id` | 是 | `{resume}` |
| `PUT` | `/api/resumes/:id` | 是 | `{resume}`；请求字段可部分提交，但必须携带当前 `lockVersion` |
| `DELETE` | `/api/resumes/:id` | 是 | `{deleted: boolean}` |

对外 ID 使用十进制字符串，避免 JavaScript 大整数精度丢失。简历摘要新增 `sourceType` 和 `lockVersion`，其他字段继续使用前端兼容的 `createdAt`、`updatedAt`、`splitRatio`、`previewScale`。更新成功后 `lockVersion` 加 `1`；缺少或提交过期版本时返回 `409 RESUME_EDIT_CONFLICT`，并且不覆盖数据库中的新内容。所有查询和修改都按当前用户过滤；不存在或不属于当前用户的简历返回 `404 RESUME_NOT_FOUND`。未登录请求返回 `401 UNAUTHORIZED`。

简历当前内容和样式分别持久化在 `resumes.data_json` 与 `style_json`，接口兼容层继续收发当前前端使用的 `markdown`、`settings`、`splitRatio` 和 `previewScale`。创建简历时在同一事务写入一条 `reason=initial` 的不可变版本快照。简历通过外键归属用户，用户存在简历时数据库限制删除用户；删除简历会级联删除其版本。数据库完整性约束不替代 API 的当前用户过滤。

## 图片接口

| Method | Path | 鉴权 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/assets` | 是 | 接收 `fileName` 和图片 data URL，成功返回 `201 {asset}` |
| `GET` | `/api/assets/:objectName` | 是 | 读取当前用户前缀下的私有 MinIO 对象 |

上传只接受 APNG、AVIF、GIF、JPEG、PNG、SVG 和 WebP data URL，单个解码后文件不超过 10 MiB。错误包括 `INVALID_IMAGE`、`IMAGE_TOO_LARGE`、`ASSET_UPLOAD_FAILED`、`ASSET_NOT_FOUND` 和 `ASSET_READ_FAILED`；跨用户对象路径返回 `403 FORBIDDEN`。

## 大模型管理接口

以下接口只允许当前数据库用户的 `is_admin=true` 时访问。未登录返回 `401 UNAUTHORIZED`，普通用户返回 `403 FORBIDDEN`。本期不公开普通用户或第三方可调用的通用 chat、stream HTTP API；模型调用只作为 FastAPI 后端内部 Python 服务提供。

| Method | Path | 成功结果 |
| --- | --- | --- |
| `GET` | `/api/admin/llm/models` | `{models}`，包含启用与停用配置 |
| `POST` | `/api/admin/llm/models` | `201 {model}` |
| `PATCH` | `/api/admin/llm/models/:modelConfigId` | `{model}`，字段可部分更新 |
| `POST` | `/api/admin/llm/models/:modelConfigId/test` | `{ok: true, callId}`，测试指定配置 |
| `GET` | `/api/admin/llm/calls` | `{calls, summary, nextCursor}` |

模型配置接受 `model`、`apiBase`、只写的 `apiKey`、`enabled`、`priority`、`inputPricePerMillion` 和 `outputPricePerMillion`。响应只用 `keyConfigured` 表示是否已有凭据，绝不返回明文或数据库密文。PATCH 省略 `apiKey` 时保留原凭据，传 `null` 时清除，传非空字符串时替换；模型配置不提供硬删除接口。

模型配置 `id`、调用记录 `userId` 和 `modelConfigId` 与其他 MySQL 业务 ID 一致，对外使用十进制字符串，内部数据库列仍为 `BIGINT UNSIGNED`。

调用记录可用 `userId`、`modelConfigId`、`from`、`to`、`cursor` 和 `limit` 查询，默认每页 50、最大 200，按创建时间和内部 ID 倒序稳定分页。每条记录只包含调用标识、用户、实际模型快照、状态、耗时、Token、价格快照、估算成本和非敏感错误分类，不保存或返回消息、模型完整响应和凭据。汇总只聚合已知值，并用 `incompleteMeteringCount` 表明不完整计量。

管理错误包括 `INVALID_LLM_MODEL_CONFIG`、`INVALID_LLM_CALL_QUERY`、`LLM_MODEL_NOT_FOUND`、`LLM_CREDENTIALS_UNAVAILABLE` 和 `LLM_CONNECTION_FAILED`。供应商原始错误不会透传。
