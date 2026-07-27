# FastAPI 后端

## 当前职责

`apps/backend` 承接全部服务端能力：健康检查、用户注册登录、短 JWT access + 不透明 refresh + Redis 会话的双 Token 鉴权、简历 CRUD 和私有图片读写。

| 位置 | 职责 |
| --- | --- |
| `src/linkcv/main.py` | 创建应用、装配数据库与存储、配置 OpenAPI 和静态 Web 产物 |
| `src/linkcv/core/` | 配置、数据库、错误、安全、Redis 和 MinIO 基础设施 |
| `src/linkcv/modules/identity/` | 用户模型、注册、登录、刷新与双 Token 鉴权依赖 |
| `src/linkcv/modules/resumes/` | 简历模型、CRUD、默认内容和图片接口 |
| `migrations/sql/` | 每个 revision 对应的 `.up.sql`、`.down.sql` MySQL DDL；当前 head 为 `0002` |
| `migrations/versions/` | 只调用同 ID 的 SQL 文件，不在 Python 中声明表、字段或索引 |
| `tests/unit/` | 不访问外部资源的快速单元测试 |
| `tests/integration/` | 使用隔离 SQLite 和假对象存储的 HTTP 组合测试 |

## 接口与持久化

- OpenAPI：`/api/openapi.json`
- Swagger UI：`/api/docs`
- 健康检查：`GET /api/health`
- 业务接口：`/api/auth/**`、`/api/resumes/**`、`/api/assets/**`

Alembic 当前 head `0002` 建立 `users`、`resume_templates`、`resumes` 和 `resume_versions` 四张核心表。业务主键和外键统一使用 `BIGINT UNSIGNED`；数据库中的整数 ID 在 HTTP、JWT、TypeScript 和对象键中表示为十进制字符串。`users` 保存账号、昵称、头像对象键、`0/1` 状态和管理员标记，不再保存 `auth_version`；注册时生成以“用户”为前缀的默认昵称。`resumes` 保存当前 JSON 内容和样式、来源证据及乐观锁版本；创建简历时会在同一事务写入版本号为 `1` 的 `resume_versions` 初始快照。

核心查询索引包括邮箱唯一索引、模板 Key 唯一索引、`(user_id, updated_at DESC, id DESC)` 简历列表索引、模板外键索引，以及 `(resume_id, version_no)` 版本唯一索引。`0002` 只允许从空的 `0001` 业务表升级；revision 在 DDL 前只读检查现存业务表的记录数，发现任何数据就拒绝破坏性替换，并允许空库在 MySQL DDL 部分失败后重试。revision 固定使用四位递增编号；后续 schema 变化通过 `npm run db:revision -- -m "<message>"` 创建 Python revision 与配对 SQL。禁止手工 `ALTER TABLE` 或原地改写已进入共享环境的 revision。

`scripts/db/init_mysql.py` 只允许创建名为 `linkcv` 的 MySQL 数据库；`scripts/release/run_alembic.py` 在迁移前校验环境、host、port 和数据库并输出不含密码的摘要。FastAPI 配置支持根 `.env`、显式 `LINKCV_ENV_FILE`、同名 `.local` 和进程环境覆盖。Redis 在鉴权链路中作为唯一会话存储：`auth:session:{sid}` 保存会话哈希，`auth:user_sessions:{uid}` 索引该用户全部会话；会话不写 MySQL，撤销即删除 key。阿里云 OSS 当前仅建立配置契约。

## 测试约定

- 全量入口为根目录 `npm run test:backend`；业务测试可分别运行 `test:backend:unit` 和 `test:backend:integration`。
- 单元测试不连接真实网络、数据库或对象存储。
- 路由集成测试使用内存 SQLite 与依赖注入的假 MinIO，不占用真实端口。
- `LINKCV_TEST_MYSQL_URL` 可显式启用专用 MySQL 库的 migration 往返测试；该地址不得指向共享 Dev 或 Production。
- 真实 MinIO 和浏览器流程仍需人工端到端验收。
