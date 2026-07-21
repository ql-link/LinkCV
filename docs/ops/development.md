# 本地开发与配置

## 环境要求

- Node.js 22 LTS 和 npm 10+
- Python 3.13 与 uv
- Docker 和 Docker Compose

新环境执行 `npm run setup` 安装前后端依赖并建立 AI 入口链接。复制 `.env.example` 为本地 `.env` 后，可用 `npm run infra:up` 启动 MySQL 与 MinIO，用 `npm run dev` 同时启动 Web、FastAPI 和临时 Express。

## 默认端口与覆盖

| 服务 | 默认端口 | 配置入口 |
| --- | ---: | --- |
| Vite Web | 5173 | Vite 默认值 |
| FastAPI | 8000 | `BACKEND_PORT` |
| Express | 4174 | `API_PORT`；Vite 可用 `LEGACY_API_PROXY_TARGET` 覆盖目标 |
| MySQL | 3306 | `MYSQL_PORT` |
| MinIO API | 9000 | `MINIO_API_PORT`、`MINIO_ENDPOINT` |
| MinIO Console | 9001 | `MINIO_CONSOLE_PORT` |

`BACKEND_PROXY_TARGET` 可以覆盖 Vite 使用的完整 FastAPI 地址。只修改 FastAPI 启动端口时，应让 `BACKEND_PORT` 同时作用于根级启动命令和 Vite。

## 质量命令

| 命令 | 作用 |
| --- | --- |
| `npm run check:ai` | AI 链接、Skill、长期文档和契约规则 |
| `npm run check:app` | 前端类型/构建和后端测试/构建 |
| `npm run check` | 完整本地质量入口 |

前端尚无单元测试和 E2E。浏览器行为需要按改动范围人工验证，不能由构建结果代替。
