# 当前架构

## Monorepo 组成

| 模块 | 位置 | 当前职责 |
| --- | --- | --- |
| Web | `apps/web` | React 19、TypeScript、Vite 前端和相对路径 API 客户端 |
| Backend | `apps/backend` | FastAPI、JWT 鉴权、简历 CRUD、MinIO 图片接口、SQLAlchemy 模型和 Alembic 迁移 |
| Infrastructure | `deploy` | MySQL、Redis、MinIO 本地依赖和 Dev/Production Jenkins、Compose 拓扑 |
| AI workflow | `.ai`、`.specs`、`scripts` | 项目规则、阶段状态和质量门禁 |

## 本地请求路径

浏览器统一请求相对 `/api` 路径。`apps/web/vite.config.mjs` 将全部 `/api` 流量代理到 FastAPI，默认目标为 `http://127.0.0.1:8000`。

FastAPI 在 `apps/backend/src/linkcv/main.py` 以 `/api` 前缀挂载路由。详细接口见 [HTTP 契约](../api/http-contracts.md)。

## 数据与鉴权

- MySQL 是用户和简历数据的权威存储，表结构只通过 Alembic 迁移演进。
- 登录态是有效期七天的 JWT HttpOnly Cookie，Cookie 名保持为 `resume_session`。
- 图片存储在私有 MinIO bucket 中；现有兼容资源位于 `users/<user-id>/assets/`，简历编辑器新增资源位于 `users/<user-id>/resumes/<resume-id>/assets/`，两者都由服务端生成对象键并在读取时校验所有权。
- 原型 Express/SQLite 数据不迁移到 MySQL。

## 配置真值

- FastAPI 读取 `BACKEND_HOST` 和 `BACKEND_PORT`，默认 `127.0.0.1:8000`。
- Vite 使用 `BACKEND_PORT` 构造默认代理目标，也允许 `BACKEND_PROXY_TARGET` 覆盖完整地址。
- 数据库、JWT 和 MinIO 变量以 `.env.example` 为入口；本地依赖端口以 `deploy/docker-compose.yml` 为入口。
