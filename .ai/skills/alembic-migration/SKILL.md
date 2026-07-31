---
name: alembic-migration
description: 为 LinkCV 编写、校验和排查 SQLAlchemy 与 SQL-first Alembic schema 迁移，覆盖 revision 链、配对 up/down SQL、数据回填、升级降级、兼容发布和文档同步。适用于新增业务 revision，新增或修改表、字段、关系、约束、索引，处理多 head、模型与数据库漂移或迁移失败；单纯设计字段与索引先使用 mysql-ddl-conventions，数据库改动一律走方案先行。
---

# Alembic 迁移

## 1. 目的与边界

把“物理 schema 已确认 → 修改 ORM → 编写 migration → 往返验证 → 同步长期文档”固化为可执行流程。schema 演进建立后，权威源必须是 SQLAlchemy 模型与 Alembic 迁移链，不能通过手工 `ALTER TABLE` 绕开版本管理。

本技能负责迁移本身，不负责：

- 决定业务字段语义、旧数据是否迁移或兼容窗口，返回 `solution-generator` 确认，再按影响修订并重新冻结方案文档或 Acceptance；
- 从零设计字段、类型、约束和索引，转 `mysql-ddl-conventions`；
- 编写完整业务实现，转 `implementation-execution`；
- 泛化维护长期文档，转 `doc-maintenance-sync`。

## 2. LinkCV 当前基线

- FastAPI 已有鉴权、简历和图片路由，`core/database.py`、业务模型、Alembic 环境、SQL-first revision 模板与 `db:revision`、`db:migrate`、`db:init` 入口已经存在。
- 根 revision `0001` 已通过配对 SQL 创建 `users`、`resumes`，并与当前 SQLAlchemy 模型保持一致；仓库存在 revision 不等于每个目标环境都已经迁移到 head。
- 后端集成测试使用隔离 SQLite，只能证明应用层组合行为；迁移链必须在 MySQL 8.4 上单独验证。
- 原型 SQLite 数据默认不迁移到 MySQL，除非新的冻结需求明确改变这一点。

因此每次 schema 变化都必须先核对方案文档中的定稿 DDL、现有模型、当前 head、目标环境 current revision 和部署 runner，再明确测试数据库、执行者、部署顺序和回滚。不存在的 revision、表或验证结果必须明确写“尚未建立”，不得把仓库 head 存在描述成目标环境已经迁移。

## 3. 必读材料

存在时读取：

1. 冻结的方案文档及其数据模型章节与定稿 DDL，以及 Acceptance；
2. `apps/backend` 中相关 SQLAlchemy 模型、配置、仓储和测试；
3. Alembic 配置、`env.py`、版本目录及全部相关 revision；
4. 当前迁移 heads、history、目标数据库 current revision；
5. [MySQL 表结构规范](../mysql-ddl-conventions/SKILL.md)；
6. Compose、环境变量模板、部署入口与数据库长期文档；
7. 正确基线到当前分支的完整模型与 migration 差异。

## 4. 迁移基础与 schema 变更

新增业务 revision，或确需修改迁移基础时，至少确认：

1. SQLAlchemy metadata 的唯一入口和命名约定；
2. Alembic 如何读取与应用相同的非敏感数据库配置，同时避免在日志中输出凭据；
3. 初始 revision 是空库建表还是既有 schema baseline，不能混淆；
4. 哪些环境由谁执行迁移，应用启动不得静默执行高风险 schema 变更；
5. 测试如何创建隔离 MySQL schema、升级到 head 并清理；
6. 如何检查单一 head、模型漂移、升级和回滚；
7. 模型或 migration 变化触发哪些文档同步和机器门禁。

## 5. 编写迁移

1. **确认版本链**：读取 heads 与 history。新 revision 的 `down_revision` 必须接到预期 head；出现多个 head 时先判断是合法分支还是遗漏，不盲目生成 merge。
2. **先核对 ORM**：模型字段、外键、关系、约束和索引必须与已确认物理 schema 一致；已有模型不正确时先同步修订，不能让 migration 迁就错误模型。
3. **创建 SQL-first revision**：统一运行 `npm run db:revision -- -m "<message>"`，生成 Python revision 与同 ID 的 `.up.sql`、`.down.sql` 文件对。禁止使用 `alembic revision --autogenerate` 作为最终或草稿入口，也禁止把 `op.create_table`、`op.add_column`、`op.create_index` 等 Python DDL 留在最终 revision。
4. **编写并审查 SQL**：DDL、索引、约束和 SQL 可表达的数据变更写入配对 SQL 文件；Python revision 只调用对应文件。逐项核对列名、类型、长度、默认值、可空性、外键、约束、索引、注释和意外删除。只有 SQL 无法安全表达的受控迁移才允许少量 Python，并在 revision 文件头说明原因、幂等性和回滚方式。
5. **处理兼容**：破坏性变化优先采用“扩展 → 回填或双写 → 切换 → 收缩”。新增非空字段通常先允许空值或提供安全默认值，回填完成后再加约束。
6. **处理数据**：回填必须限定范围、分批、幂等、可重试并能校验结果；不要把演示数据或真实用户数据写进 migration。
7. **实现回滚**：`.down.sql` 与 `.up.sql` 表达相反变更。无法无损回退时在 SQL、revision 和发布方案中明确标记不可逆，并给出应用回滚、备份恢复或补偿方案；不能用空文件或空 `downgrade()` 伪装成功。
8. **保护历史**：已经进入共享环境的 revision 及其 SQL 文件不得原地改写；修正通过新的 revision 完成。

## 6. MySQL 风险核实

- 评估 DDL 隐式提交、锁等待、全表扫描、索引构建和大表回填时间；
- 字段收窄、字符集或排序规则变化、唯一约束新增前先检查存量冲突；
- 迁移中的事务假设必须符合 MySQL 8.4，不用 SQLite 成功代替 MySQL 验证；
- 发布顺序必须说明旧应用是否能在新 schema 上运行，新应用是否能在旧 schema 上启动；
- 数据删除、列删除和不可逆转换前明确备份、恢复目标与验证方式。

## 7. 验证流程

根据仓库当时真实入口执行并记录：

1. heads 只有预期结果，history 连续且 revision 唯一；
2. 每个 revision 都有同 ID 的 `.up.sql`、`.down.sql`，Python 文件只调用配对 SQL；
3. 空 MySQL 8.4 数据库从零升级到 head；
4. 具有上一版本 schema 和代表性虚构数据的 MySQL 数据库升级到 head；
5. 可逆 migration 执行“升级 → 降级 → 再升级”；
6. 模型 metadata 与 head schema 没有未解释差异；
7. 约束、索引、外键、默认值、时区、回填幂等与失败恢复测试通过；
8. 文档同步和完整 `npm run check` 通过。

未实际运行的命令必须写成“未验证”。生产规模、锁时间和备份恢复无法在本地证明时，列为发布前门槛。

## 8. 输出与转交

最终说明：

- 修改的 ORM 文件和新增 migration 文件；
- revision、down_revision、当前 heads 与链路结论；
- upgrade、downgrade、数据回填和幂等策略；
- 兼容发布、锁风险、备份与恢复方式；
- 实际验证命令、结果和未覆盖项；
- 需要同步的数据库文档与机器规则。

定稿 DDL 无法落地时返回 `solution-generator` 修订并重新冻结；需要真正改代码时转 `implementation-execution`；迁移链或运行故障的只读定位可与 `incident-triage` 协作。
