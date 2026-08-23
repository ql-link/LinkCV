# LinkCV Alembic 迁移约束

本目录管理 LinkCV MySQL schema 版本。迁移采用 **SQL-first、forward-only**：表、字段、索引、外键和可表达的数据变更写在 up SQL 中，Python revision 按版本顺序执行；仓库不保存 down SQL，也不支持数据库降级。

## 目录

```text
migrations/
├── env.py                       # Alembic 连接与执行入口
├── script.py.mako               # 新 revision 的 SQL-first 模板
├── sql/
│   └── <revision>.up.sql         # 从上一版本升级到当前版本
└── versions/
    └── <revision>_<name>.py      # upgrade 执行 up SQL，downgrade 明确拒绝
```

当前唯一 head 以 `alembic heads` 的真实输出为准。仓库存在 revision 不代表目标环境已经迁移到 head；执行前必须读取目标数据库的 current revision。

## 新建迁移

不要使用 `alembic revision --autogenerate`，它会生成难以审查的 Python DDL。在仓库根目录执行：

```bash
npm run db:revision -- -m "create resume tables"
```

该命令只生成：

```text
apps/backend/migrations/versions/<revision>_create_resume_tables.py
apps/backend/migrations/sql/<revision>.up.sql
```

`up.sql` 使用 MySQL 8.4 语法表达从上一版本到当前版本的变化。Python 文件不手写 `op.create_table`、`op.add_column` 或 `op.create_index` 等 DDL；`downgrade()` 固定抛出 forward-only 错误。

## SQL 规则

- 每条语句以英文分号结尾，并在分号后换行。
- 单行说明使用 `--` 注释。
- 不允许 `CREATE DATABASE`、`DROP DATABASE` 或 `USE`；runner 已锁定目标为 `linkcv`。
- 明确字符集、排序规则、外键、约束和索引。
- 破坏性变更优先“扩展 → 回填 → 切换 → 收缩”。
- 分批回填、外部调用等 SQL 无法安全表达的逻辑才允许少量 Python，并说明原因和幂等性。
- 已进入共享环境的 revision 和 up SQL 不原地修改；用新 revision 向前修正。

## 执行与核验

```bash
uv run --directory apps/backend alembic heads
uv run --directory apps/backend alembic current
npm run db:migrate
npm run db:init
```

共享 Dev 环境显式选择配置：

```bash
LINKCV_ENV_FILE=.env.development npm run db:migrate
```

部署通过 `scripts/release/run_alembic.py` 核对环境、MySQL host、port 和 database 后升级到 head。迁移测试只覆盖空库到 head、受支持历史版本到 head 和重复 upgrade；不执行升级降级往返：

```bash
LINKCV_TEST_MYSQL_URL='mysql+pymysql://<user>:<password>@127.0.0.1:<port>/linkcv' \
  uv run --directory apps/backend pytest tests/integration/migrations
```

测试 URL 只能指向可清理的本地 `linkcv` 库，不能指向共享 Dev 或 Production。

## 恢复策略

- 数据库发布前必须按风险准备可用备份并明确恢复目标。
- schema 或数据问题通过新的 forward revision 修正。
- 只有旧应用兼容新 schema 时才回退应用镜像；回退镜像不会回退数据库。
- 需要恢复旧数据库状态时使用已验证备份，不执行 Alembic downgrade。

## 禁止项

- 不生成、恢复或执行 `.down.sql`。
- 不手工在共享数据库执行未进入版本控制的 `ALTER TABLE`。
- 不在镜像构建阶段连接数据库或执行迁移。
- 不向其他业务库或 Production 执行 Dev 迁移。
