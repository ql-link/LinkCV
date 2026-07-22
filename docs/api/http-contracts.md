# HTTP 接口契约

本文记录当前调用方可观察的 HTTP 行为。FastAPI 路由以 `apps/backend/src/linkcv/api/routes/` 为事实源，迁移期业务接口以 `server/index.mjs` 为事实源，前端调用以 `apps/web/src/api/client.ts` 为消费方。

## 服务归属

| 路径 | 当前服务 | 说明 |
| --- | --- | --- |
| `/api/health` | FastAPI（开发期） | Vite 精确分流到 FastAPI；旧 Express 自身仍保留部署健康检查 |
| `/api/auth/**` | Express | Cookie session 鉴权 |
| `/api/resumes/**` | Express | 用户简历 CRUD |
| `/api/assets/**` | Express | 用户图片上传和读取 |

## FastAPI 健康检查

`GET /api/health` 返回 HTTP `200`：

```json
{
  "status": "ok",
  "service": "linkcv-backend",
  "version": "0.1.0"
}
```

FastAPI 文档位于 `/api/docs`，OpenAPI JSON 位于 `/api/openapi.json`。

## Express 鉴权接口

| Method | Path | 鉴权 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/auth/me` | 否 | `{user}`；未登录时为 `null` |
| `POST` | `/api/auth/register` | 否 | `201` 和 `{user}`，同时设置 session cookie |
| `POST` | `/api/auth/login` | 否 | `{user}`，同时设置 session cookie |
| `POST` | `/api/auth/logout` | 否 | `{ok: true}`，清除 session |

注册错误码：`INVALID_EMAIL`、`WEAK_PASSWORD`、`EMAIL_EXISTS`。登录失败返回 `401 INVALID_CREDENTIALS`。

## Express 简历接口

| Method | Path | 鉴权 | 成功结果 |
| --- | --- | --- | --- |
| `GET` | `/api/resumes` | 是 | `{resumes}` 摘要列表 |
| `POST` | `/api/resumes` | 是 | `201` 和 `{resume}` |
| `GET` | `/api/resumes/:id` | 是 | `{resume}` |
| `PUT` | `/api/resumes/:id` | 是 | `{resume}` |
| `DELETE` | `/api/resumes/:id` | 是 | `{deleted: true}` |

所有查询和修改都按当前用户过滤；不存在或不属于当前用户的简历返回 `404 RESUME_NOT_FOUND`。未登录请求返回 `401 UNAUTHORIZED`。

## Express 图片接口

| Method | Path | 鉴权 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/assets` | 是 | 接收 `fileName` 和图片 data URL，成功返回 `201 {asset}` |
| `GET` | `/api/assets/:objectName` | 是 | 读取当前用户前缀下的 MinIO 对象 |

上传只接受受支持的图片 data URL，单个解码后文件不超过 10 MiB。错误语义包括 `INVALID_IMAGE`、`IMAGE_TOO_LARGE`、`ASSET_UPLOAD_FAILED`；跨用户对象路径返回 `403`。

## 迁移规则

接口切换服务归属时，必须同步前端 API 类型、Vite 代理、认证与数据兼容、本文档和回滚方案。不得仅删除 Express 路由或只修改代理目标。
