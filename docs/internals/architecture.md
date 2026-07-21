# 当前架构与迁移边界

## Monorepo 组成

| 模块 | 位置 | 当前职责 |
| --- | --- | --- |
| Web | `apps/web` | React 19、TypeScript、Vite 前端和相对路径 API 客户端 |
| Backend | `apps/backend` | Python 3.13、FastAPI 应用；当前只承接健康检查 |
| Legacy API | `server` | 临时 Express API；继续承接鉴权、简历和图片资源 |
| Infrastructure | `deploy` | MySQL、MinIO 本地依赖和旧 Express 部署拓扑 |
| AI workflow | `.ai`、`.specs`、`scripts` | 项目规则、交付 Skill、阶段状态和质量门禁 |

## 本地请求路径

浏览器请求统一使用相对 `/api` 路径，由 `apps/web/vite.config.mjs` 在开发期分流：

```text
/api/health  → FastAPI，默认 http://127.0.0.1:8000
其他 /api   → Express，默认 http://127.0.0.1:4174
```

FastAPI 在 `apps/backend/src/linkcv/main.py` 以 `/api` 前缀挂载路由。Express 在 `server/index.mjs` 直接注册完整 `/api/...` 路径。详细接口见 [HTTP 契约](../api/http-contracts.md)。

## 迁移约束

- 未完成对应实现和回归验证前，不改变现有路由归属。
- 鉴权与简历 CRUD 需要协调迁移，因为旧实现使用 SQLite session cookie，目标后端尚未建立对应持久化和认证基础。
- 图片资源接口依赖 MinIO 和用户资源路径校验，迁移时必须保留资源归属语义。
- 全部 `/api` 切到 FastAPI 并完成端到端验证后，才能删除 `server`、SQLite 依赖和旧部署拓扑。
- 原型 SQLite 数据不迁移到 MySQL。

## 配置真值

- FastAPI 本地端口由根级 `dev:backend` 命令读取 `BACKEND_PORT`，默认 `8000`。
- Vite 使用同一个 `BACKEND_PORT` 构造默认 FastAPI 代理目标，也允许 `BACKEND_PROXY_TARGET` 覆盖完整地址。
- Express 读取 `API_PORT`，默认 `4174`；Vite 可通过 `LEGACY_API_PROXY_TARGET` 覆盖代理目标。
- 本地依赖变量以 `.env.example` 和 `deploy/docker-compose.yml` 为入口，具体说明见 [开发环境](../ops/development.md)。
