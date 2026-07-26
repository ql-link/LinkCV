# 本地开发与配置

## 环境要求

- Node.js 22 LTS 和 npm 10+
- Python 3.11–3.13，由 uv 管理
- Docker 和 Docker Compose

新环境执行 `npm run setup` 安装前后端依赖。复制 `.env.example` 为被 Git 忽略的 `.env` 后，使用 `npm run infra:up` 启动 MySQL、Redis 与 MinIO，`npm run db:init` 创建独立 `linkcv` 数据库并应用 Alembic，`npm run dev` 同时启动 Web 和 FastAPI。当前 Alembic 根 revision 会建立 `users` 和 `resumes` 业务表。

后端默认读取仓库根目录 `.env`。设置 `LINKCV_ENV_FILE=.env.development` 可选择共享 Dev 基础配置；如果同目录存在 `.env.development.local`，其密码和密钥会覆盖基础文件。Production 同理使用 `.env.production` + `.env.production.local`：仓库文件维护 Cloud Docker DNS 地址，私密文件只提供账号、密码和密钥，不覆盖 `DATABASE_URL`、`REDIS_URL` 或 `MINIO_ENDPOINT`。进程环境变量优先级最高，配置路径不受当前工作目录影响。

`.env.development` 复用 LinkRag Dev 的 MySQL、Redis 与 MinIO 服务地址，但数据库固定为独立的 `linkcv`，Redis 固定使用隔离的 DB 2，MinIO 固定使用独立 `linkcv` bucket；不得改为 `tolink_rag_db` 或 DB 0。首次初始化使用：

```bash
LINKCV_ENV_FILE=.env.development npm run db:init
```

命令先校验并创建 `linkcv`，再升级到当前 Alembic head。阿里云 OSS 字段目前仅为预留配置，图片读写仍只使用 `MINIO_*`。

## 默认端口与覆盖

| 服务 | 默认端口 | 配置入口 |
| --- | ---: | --- |
| Vite Web | 5173 | Vite 默认值 |
| FastAPI | 8000 | `BACKEND_HOST`、`BACKEND_PORT` |
| MySQL | 3306 | `MYSQL_HOST`、`MYSQL_PORT` |
| Redis | 6379 | `REDIS_HOST`、`REDIS_PORT`、`REDIS_DB`、`REDIS_URL` |
| MinIO API | 9000 | `MINIO_API_PORT`、`MINIO_ENDPOINT` |
| MinIO Console | 9001 | `MINIO_CONSOLE_PORT` |

`BACKEND_PROXY_TARGET` 可以覆盖 Vite 使用的完整 FastAPI 地址。数据库可以用完整 `DATABASE_URL` 覆盖分项 MySQL 配置，Redis 可以用 `REDIS_URL` 覆盖分项配置。Production 必须通过私密覆盖提供足够随机的 `JWT_SECRET`、MySQL 和 MinIO 凭据，否则后端拒绝启动。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run db:migrate` | 将数据库升级到 Alembic 最新版本 |
| `npm run db:init` | 仅允许创建 `linkcv` 数据库并升级到 Alembic head |
| `npm run db:revision -- -m <message>` | 创建只调用 SQL 的 revision，以及同 ID 的 `.up.sql`、`.down.sql` 文件 |
| `npm run test:web` | 前端 Vitest 单元和组件测试 |
| `npm run test:backend:unit` | 后端快速单元测试 |
| `npm run test:backend:integration` | 后端隔离 HTTP 集成测试 |
| `npm run test:backend` | 全部后端和仓库工具测试 |
| `npm run check` | 完整本地质量入口 |

## 测试分层

- 前端测试使用 Vitest、React Testing Library 和 jsdom，通过 Mock 隔离 API。
- 后端单元测试不访问外部服务；集成测试使用内存 SQLite 和假 MinIO。
- 跨 Web、FastAPI、真实 MySQL、Redis 和 MinIO 的完整流程由浏览器人工验证。
