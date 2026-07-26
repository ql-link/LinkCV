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
| `POST` | `/api/auth/register` | 否 | `201 {user}`，签发短 access 与 7 天 refresh 双 Cookie |
| `POST` | `/api/auth/login` | 否 | `{user}`，签发短 access 与 7 天 refresh 双 Cookie |
| `POST` | `/api/auth/refresh` | 否 | `{user}`，轮换 refresh 密钥并下发新双 Cookie |
| `POST` | `/api/auth/logout` | 否 | `{ok: true}`，删除 Redis 会话并清除双 Cookie |

鉴权使用“短 JWT access + 不透明 refresh + Redis 会话”的双 Token 方案。Access Cookie 名为 `resume_access`，有效期 `ACCESS_TTL_MINUTES`（默认 15 分钟），`SameSite=Lax`、`Path=/`。Refresh Cookie 名为 `resume_refresh`，有效期 `SESSION_TTL_DAYS`（默认 7 天），`HttpOnly`、`SameSite=Lax`、`Path=/api/auth`。注册错误码同上；登录或刷新失败返回 `401 INVALID_CREDENTIALS`。

每次受保护请求按“Access 自洽 → Session 存活 → 用户启用”三步校验：先校验 access JWT 签名与过期，再用 `EXISTS auth:session:{sid}` 确认 Redis 会话仍在，最后从 MySQL 读取用户并要求 `status=1`。会话只存 Redis（`auth:session:{sid}` 哈希与 `auth:user_sessions:{uid}` 集合），不写 MySQL；撤销即删除 key，不再依赖 `auth_version`。账号被禁用或改密时，遍历该用户的 `auth:user_sessions:{uid}` 删除其全部会话，达到旧 `auth_version` 全局失效的同等效果。`POST /api/auth/refresh` 读取 refresh Cookie，拆出 `sid.secret`，校验 `sha256(secret)` 与 Redis 中存储的 `rhash` 一致后轮换密钥：重写 `rhash`、续期会话并下发新的双 Cookie。哈希不匹配即判定 refresh 窃用并立即删除该会话。密码经 Argon2id 哈希后存入 `password_hash`，不保存明文。

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
