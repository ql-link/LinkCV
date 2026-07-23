# 本地开发与配置

## 环境要求

- Node.js 22 LTS 和 npm 10+
- Python 3.11–3.13，由 uv 管理
- Docker 和 Docker Compose

新环境执行 `npm run setup` 安装前后端依赖。复制 `.env.example` 为 `.env` 后，使用 `npm run infra:up` 启动 MySQL 与 MinIO，`npm run db:migrate` 应用 Alembic 迁移，`npm run dev` 同时启动 Web 和 FastAPI。

## 默认端口与覆盖

| 服务 | 默认端口 | 配置入口 |
| --- | ---: | --- |
| Vite Web | 5173 | Vite 默认值 |
| FastAPI | 8000 | `BACKEND_HOST`、`BACKEND_PORT` |
| MySQL | 3306 | `MYSQL_HOST`、`MYSQL_PORT` |
| MinIO API | 9000 | `MINIO_API_PORT`、`MINIO_ENDPOINT` |
| MinIO Console | 9001 | `MINIO_CONSOLE_PORT` |

`BACKEND_PROXY_TARGET` 可以覆盖 Vite 使用的完整 FastAPI 地址。数据库也可以用完整 `DATABASE_URL` 覆盖分项 MySQL 配置。生产环境必须设置足够随机的 `JWT_SECRET`，通过 HTTPS 部署时设置 `COOKIE_SECURE=true`。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run db:migrate` | 将数据库升级到 Alembic 最新版本 |
| `npm run db:revision -- -m <message>` | 根据 ORM 变化生成待审核 migration |
| `npm run test:web` | 前端 Vitest 单元和组件测试 |
| `npm run test:backend:unit` | 后端快速单元测试 |
| `npm run test:backend:integration` | 后端隔离 HTTP 集成测试 |
| `npm run test:backend` | 全部后端和仓库工具测试 |
| `npm run check` | 完整本地质量入口 |

## 测试分层

- 前端测试使用 Vitest、React Testing Library 和 jsdom，通过 Mock 隔离 API。
- 后端单元测试不访问外部服务；集成测试使用内存 SQLite 和假 MinIO。
- 跨 Web、FastAPI、真实 MySQL 和 MinIO 的完整流程由浏览器人工验证。
