# 临时 Express API

## 定位

`server/` 保留原型阶段的服务端能力，直到对应功能完成 FastAPI 迁移。它不是新功能的默认扩展方向，但在迁移完成前仍是线上行为的事实源。

| 位置 | 职责 |
| --- | --- |
| `server/index.mjs` | Express 入口、API 路由和响应 |
| `server/auth.mjs` | 密码哈希、SQLite session 和鉴权中间件 |
| `server/db.mjs` | SQLite 初始化与数据库位置 |
| `server/minio.mjs` | MinIO 配置、图片校验、对象名和读写 |
| `server/defaultResume.mjs` | 新简历默认内容与设置 |

## 持久化与认证

- SQLite 默认文件为 `data/resume_app.sqlite`，可通过 `DATA_DIR` 改变所在目录。
- 会话 cookie 名为 `resume_session`，服务端在 SQLite 中保存 session。
- 鉴权后的资源查询按 `user_id` 限制；图片对象名还必须位于 `users/<user-id>/assets/` 前缀下。
- 图片文件存入 MinIO，连接和 bucket 由 `MINIO_*` 环境变量控制。

## 运行方式

本地端口读取 `API_PORT`，默认 `4174`。当前旧部署也暴露 `4174`，详见 [部署文档](../ops/deployment.md)。完整接口见 [HTTP 契约](../api/http-contracts.md)。

## 删除条件

只有对应 FastAPI 路由、持久化、权限校验和端到端回归全部完成，并且 Vite 与部署流量已经切换后，才能删除旧模块。删除前必须明确回滚方式；原型 SQLite 数据不迁移到 MySQL。
