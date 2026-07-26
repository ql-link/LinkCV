# FastAPI 后端

## 当前职责

`apps/backend` 承接全部服务端能力：健康检查、用户注册登录、JWT Cookie 鉴权、简历 CRUD 和私有图片读写。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 创建应用、装配数据库与存储、配置 OpenAPI 和静态 Web 产物 |
| `src/linkcv/core/` | 配置、数据库、错误、安全和 MinIO 基础设施 |
| `src/linkcv/modules/identity/` | 用户模型、注册、登录和鉴权依赖 |
| `src/linkcv/modules/resumes/` | 简历模型、CRUD、默认内容和图片接口 |
| `migrations/sql/` | 每个 revision 对应的 `.up.sql`、`.down.sql` MySQL DDL；当前根 revision 为 `0001` |
| `migrations/versions/` | 只调用同 ID 的 SQL 文件，不在 Python 中声明表、字段或索引 |
| `tests/unit/` | 不访问外部资源的快速单元测试 |
| `tests/integration/` | 使用隔离 SQLite 和假对象存储的 HTTP 组合测试 |

## 接口与持久化

- OpenAPI：`/api/openapi.json`
- Swagger UI：`/api/docs`
- 健康检查：`GET /api/health`
- 业务接口：`/api/auth/**`、`/api/resumes/**`、`/api/assets/**`

Alembic 根 revision `0001` 在空 MySQL `linkcv` 数据库建立 `users`、`resumes`，包含邮箱唯一约束、用户级联外键、按用户更新时间查询的联合索引，以及认证版本和布局比例的正值检查。Markdown 使用 `LONGTEXT` 保留原型中的长文本语义，布局比例使用 `DOUBLE`，时间列使用 `DATETIME(6)`。revision 固定使用四位递增编号 `0001`、`0002`；后续 schema 变化通过 `npm run db:revision -- -m "<message>"` 创建 Python revision 与同 ID 的 `.up.sql`、`.down.sql` 文件对，DDL、索引、外键和数据变更优先写入 SQL 文件。Python revision 只负责执行文件；仅当 SQL 无法表达受控数据迁移时才允许少量 Python，并必须在 revision 注释中说明原因。禁止手工 `ALTER TABLE` 或原地改写已进入共享环境的 revision。原型 SQLite 数据默认不迁移到 MySQL。

`scripts/db/init_mysql.py` 只允许创建名为 `linkcv` 的 MySQL 数据库；`scripts/release/run_alembic.py` 在迁移前校验环境、host、port 和数据库并输出不含密码的摘要。FastAPI 配置支持根 `.env`、显式 `LINKCV_ENV_FILE`、同名 `.local` 和进程环境覆盖。Redis 与阿里云 OSS 当前仅建立配置契约，业务缓存和 OSS 存储尚未启用。

## 测试约定

- 全量入口为根目录 `npm run test:backend`；业务测试可分别运行 `test:backend:unit` 和 `test:backend:integration`。
- 单元测试不连接真实网络、数据库或对象存储。
- 路由集成测试使用内存 SQLite 与依赖注入的假 MinIO，不占用真实端口。
- `LINKCV_TEST_MYSQL_URL` 可显式启用专用 MySQL 库的 migration 往返测试；该地址不得指向共享 Dev 或 Production。
- 真实 MinIO 和浏览器流程仍需人工端到端验收。
