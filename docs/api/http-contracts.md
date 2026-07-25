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

用户身份持久化在 MySQL `users` 表，邮箱保持唯一；默认状态为 `active`、认证版本为 `1`。这些持久化默认值不改变上述 HTTP 字段和错误语义。

## 简历接口

| Method | Path | 鉴权 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/resumes` | 是 | `{resumes}` 摘要列表，按更新时间倒序 |
| `POST` | `/api/resumes` | 是 | `201 {resume}` |
| `GET` | `/api/resumes/:id` | 是 | `{resume}` |
| `PUT` | `/api/resumes/:id` | 是 | `{resume}`；请求字段可部分提交 |
| `DELETE` | `/api/resumes/:id` | 是 | `{deleted: boolean}` |

对外字段继续使用前端兼容的 `createdAt`、`updatedAt`、`splitRatio`、`previewScale`。所有查询和修改都按当前用户过滤；不存在或不属于当前用户的简历返回 `404 RESUME_NOT_FOUND`。未登录请求返回 `401 UNAUTHORIZED`。

简历持久化在 MySQL `resumes` 表，Markdown 使用 `LONGTEXT`，布局比例由正值检查约束保护，并由外键归属当前用户；删除用户会级联删除其简历。数据库完整性约束不替代 API 的当前用户过滤。

## 图片接口

| Method | Path | 鉴权 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/assets` | 是 | 接收 `fileName` 和图片 data URL，成功返回 `201 {asset}` |
| `GET` | `/api/assets/:objectName` | 是 | 读取当前用户前缀下的私有 MinIO 对象 |

上传只接受 APNG、AVIF、GIF、JPEG、PNG、SVG 和 WebP data URL，单个解码后文件不超过 10 MiB。错误包括 `INVALID_IMAGE`、`IMAGE_TOO_LARGE`、`ASSET_UPLOAD_FAILED`、`ASSET_NOT_FOUND` 和 `ASSET_READ_FAILED`；跨用户对象路径返回 `403 FORBIDDEN`。
