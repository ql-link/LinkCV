# 本地开发与配置

## 环境要求

- Node.js 22 LTS 和 npm 10+
- Python 3.13 与 uv
- Docker 和 Docker Compose
- 处理 Multica 来源的 L2/L3 任务时，需要已安装并认证的 `multica` CLI；普通本地开发不依赖它

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
| `npm run test:web` | 前端 Vitest 单元和组件测试 |
| `npm run test:backend:unit` | 后端快速单元测试 |
| `npm run test:backend:integration` | 后端模块和 FastAPI HTTP 集成测试 |
| `npm run test:backend` | 全部后端测试，包括工作流工具测试 |
| `npm test` | 依次运行前端和后端自动化测试 |
| `npm run check:app` | 前后端测试、前端类型检查和前后端构建 |
| `npm run check` | 完整本地质量入口 |
| `npm run spec -- status` | 校验并恢复当前工作区的 L2/L3 在途任务 |
| `npm run spec:source -- ...` | 只读核验 Multica 标题和描述是否发生需求漂移 |

`npm run check` 是 CI 的统一入口，因此新增的前后端自动化测试会随 PR 和共享分支检查执行。

Multica 来源的 Spec 在各阶段推进前通过需求指纹门禁读取 Issue。CLI、认证、权限或网络失败时保持未核验并停止推进，不回退到浏览器、Linear 或旧缓存。该门禁不会修改外部 Issue；详细状态与恢复命令见 [.specs/README.md](../../.specs/README.md)。

## 测试分层

- 前端测试使用 Vitest、React Testing Library 和 jsdom，测试文件与源码相邻，命名为 `*.test.ts` 或 `*.test.tsx`。组件测试通过 Mock 隔离 API 和外部服务。
- 后端单元测试放在 `apps/backend/tests/unit/`，不访问网络、数据库或外部服务；集成测试放在 `apps/backend/tests/integration/`，FastAPI 路由使用进程内 ASGI Transport 验证。
- `apps/backend/tests/tooling/` 只验证仓库脚本和 AI 工作流工具，不归入业务单元或集成测试。
- 跨 Web、FastAPI、临时 Express 和基础设施的端到端流程当前由人工验证，不提供 `test:e2e` 命令。适用的 L2/L3 任务由 `manual-acceptance` 在 `.specs/<KEY>/manual_acceptance.md` 记录环境、步骤、预期、实际结果、状态和证据；该目录默认不提交，PR 只摘要结论。

前端组件测试、后端接口测试、类型检查和构建均不能替代人工端到端结果。
