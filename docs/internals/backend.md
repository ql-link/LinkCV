# FastAPI 后端

## 当前职责

`apps/backend` 是目标后端基线，目前只提供健康检查，没有承接鉴权、简历、图片资源或数据库业务。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 创建 FastAPI 应用，配置 OpenAPI，并以 `/api` 挂载路由 |
| `src/linkcv/api/router.py` | 聚合业务路由 |
| `src/linkcv/api/routes/health.py` | 实现 `/api/health` |
| `tests/unit/` | 不访问外部资源的快速单元测试，目录尽量镜像 `src/linkcv/` |
| `tests/integration/` | 模块组合和 FastAPI HTTP 边界测试 |
| `tests/tooling/` | 仓库脚本和 AI 工作流工具测试 |

## 当前接口

- OpenAPI：`/api/openapi.json`
- Swagger UI：`/api/docs`
- 健康检查：`GET /api/health`

请求、响应和服务归属见 [HTTP 契约](../api/http-contracts.md)。

## 扩展约束

- 新路由放入 `src/linkcv/api/routes/`，由 `api/router.py` 聚合。
- API schema、错误语义和前端消费类型必须同步设计。
- 引入 SQLAlchemy 模型后，结构变化必须通过 Alembic 迁移链落地；当前仓库尚未建立该基础。
- 路由从 Express 切换前，需要同时处理 Vite 代理、认证/持久化兼容、回滚和回归验证。

## 测试约定

- 使用 pytest；全量入口为根目录 `npm run test:backend`。
- pytest 使用 `importlib` 导入模式，允许 `unit` 和 `integration` 镜像目录中出现同名测试模块。
- 单元测试不连接真实网络、数据库、对象存储或第三方 API。
- FastAPI 路由集成测试使用 `httpx.ASGITransport` 在进程内调用应用，不占用真实端口。
- 跨前后端浏览器流程属于人工端到端验收，不由后端集成测试代替。
