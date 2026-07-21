# FastAPI 后端

## 当前职责

`apps/backend` 是目标后端基线，目前只提供健康检查，没有承接鉴权、简历、图片资源或数据库业务。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 创建 FastAPI 应用，配置 OpenAPI，并以 `/api` 挂载路由 |
| `src/linkcv/api/router.py` | 聚合业务路由 |
| `src/linkcv/api/routes/health.py` | 实现 `/api/health` |
| `tests/test_health.py` | 验证健康检查契约 |

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
