# FastAPI 后端

## 当前职责

`apps/backend` 承接全部服务端能力：健康检查、用户注册登录、JWT Cookie 鉴权、简历 CRUD 和私有图片读写。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 创建应用、装配数据库与存储、配置 OpenAPI 和静态 Web 产物 |
| `src/linkcv/core/` | 配置、数据库、错误、安全和 MinIO 基础设施 |
| `src/linkcv/modules/identity/` | 用户模型、注册、登录和鉴权依赖 |
| `src/linkcv/modules/resumes/` | 简历模型、CRUD、默认内容和图片接口 |
| `migrations/` | Alembic 迁移链；生产启动前自动执行，开发用 `npm run db:migrate` |
| `tests/unit/` | 不访问外部资源的快速单元测试 |
| `tests/integration/` | 使用隔离 SQLite 和假对象存储的 HTTP 组合测试 |

## 接口与持久化

- OpenAPI：`/api/openapi.json`
- Swagger UI：`/api/docs`
- 健康检查：`GET /api/health`
- 业务接口：`/api/auth/**`、`/api/resumes/**`、`/api/assets/**`

SQLAlchemy ORM 和 Alembic migration 是 MySQL Schema 的共同事实源。禁止手工 `ALTER TABLE` 或原地改写已经进入共享环境的 revision。原型 SQLite 数据不迁移到 MySQL。

## 测试约定

- 全量入口为根目录 `npm run test:backend`；业务测试可分别运行 `test:backend:unit` 和 `test:backend:integration`。
- 单元测试不连接真实网络、数据库或对象存储。
- 路由集成测试使用内存 SQLite 与依赖注入的假 MinIO，不占用真实端口。
- 真实 MySQL、MinIO 和浏览器流程仍需端到端验收。
