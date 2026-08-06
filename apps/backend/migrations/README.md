# LinkCV Alembic 迁移约束

本目录管理 LinkCV MySQL schema 版本。迁移采用 **SQL-first**：表、字段、索引、外键和可表达的数据变更写在 SQL 文件中，Python revision 只负责按版本顺序调用 SQL 文件。

## 当前迁移链

根 revision `0001` 用于建立旧版 `users` 与 `resumes`；`0002` 在确认旧业务表为空后
建立正式鉴权、模板、简历和历史版本结构。后续 revision 依次补充模板删除兼容、
对象清理任务、语义简历迁移、LLM 治理、用户私有 JD 和管理员操作审计。`0008`
在建立 Chat 候选和当前绑定前，按外键依赖顺序永久清空旧模型配置及调用日志；
`0009` 新增 `admin_operation_logs`；`0010` 移除对象存储清理任务表；`0011`
删除仅写不读的管理员操作审计表；`0012` 删除已停用的旧版简历内容与样式备份列。
当前唯一 head 为 `0012`。每个版本都提供配对升级和降级 SQL；原型 SQLite 数据
仍不迁移到 MySQL。

```text
migrations/
├── env.py                       # Alembic 连接与执行入口
├── script.py.mako               # 新 revision 的 SQL-first Python 模板
├── sql/
│   ├── <revision>.up.sql         # 升级 SQL
│   └── <revision>.down.sql       # 降级 SQL
└── versions/
    └── <revision>_<name>.py      # 仅调用对应 SQL 文件
```

## 新建迁移

不要使用 `alembic revision --autogenerate`，它会生成难以审查的 `op.create_table` 等 Python DDL。

在仓库根目录执行：

```bash
npm run db:revision -- -m "create resume tables"
```

该命令自动生成：

```text
apps/backend/migrations/versions/<revision>_create_resume_tables.py
apps/backend/migrations/sql/<revision>.up.sql
apps/backend/migrations/sql/<revision>.down.sql
```

必须在提交前完成两个 SQL 文件：

- `up.sql`：从上一版本升级到当前版本的 MySQL SQL。当前基线使用已部署
  MySQL 8.0 与目标 MySQL 8.4 都支持的语法。
- `down.sql`：可安全回退时的反向 SQL；确实不可逆时写明原因，并在 Python revision 中显式失败，不得伪装成成功回滚。

新 revision 的 Python 文件不应手写 `op.create_table`、`op.add_column`、`op.create_index` 等 DDL。

## SQL 文件规则

- 每条语句以英文分号结尾，并在分号后换行。
- 单行说明使用 `--` 注释。
- 不允许 `CREATE DATABASE`、`DROP DATABASE` 或 `USE`；迁移 runner 已锁定目标为 `linkcv`。
- 使用 MySQL 8.4 语法，明确字符集、排序规则、外键和索引。
- 破坏性变更优先采用“扩展 → 回填 → 切换 → 收缩”；不要把生产数据删除与应用切换混在同一不可恢复步骤。
- SQL 无法安全表达的分批回填、外部调用等逻辑才允许少量 Python，且必须在 revision 文件头说明原因、幂等性与回滚方式。

## 执行与核验

```bash
# 查看迁移链和当前数据库版本；heads 应只有 0012
uv run --directory apps/backend alembic heads
uv run --directory apps/backend alembic current

# 升级到 head
npm run db:migrate

# 首次创建 linkcv 数据库后升级到 head
npm run db:init
```

共享 Dev 环境使用前，显式选择基础环境文件：

```bash
LINKCV_ENV_FILE=.env.development npm run db:migrate
```

部署时不直接运行 Alembic CLI；Jenkins 和容器通过 `scripts/release/run_alembic.py` 先核对 `APP_ENV`、MySQL host、port 与 database，再升级到 head。

真实 MySQL 往返测试需要显式提供专用、可清理的 `linkcv` 测试库，测试会执行
`upgrade → downgrade → upgrade`，不得指向共享 Dev 或 Production：

```bash
LINKCV_TEST_MYSQL_URL='mysql+pymysql://<user>:<password>@127.0.0.1:<port>/linkcv' \
  uv run --directory apps/backend pytest tests/integration/migrations
```

## 禁止项

- 不手工在共享数据库执行未进入版本控制的 `ALTER TABLE`。
- 不原地修改已被共享环境执行过的 revision 或 SQL 文件；修正通过新的 revision 完成。
- 不在镜像 `docker build` 阶段连接数据库或执行迁移。
- 不向 `tolink_rag_db` 或 Production 数据库执行 Dev 迁移。
