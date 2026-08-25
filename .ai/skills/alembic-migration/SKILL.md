---
name: alembic-migration
description: 为 LinkCV 编写、校验和排查 forward-only 的 SQLAlchemy 与 SQL-first Alembic schema 迁移，覆盖 revision 链、up SQL、数据回填、向前升级、兼容发布和文档同步。适用于新增业务 revision，新增或修改表、字段、关系、约束、索引，处理多 head、模型与数据库漂移或迁移失败；单纯设计字段与索引先使用 mysql-ddl-conventions，自动分流时数据库 schema 或数据迁移默认走方案先行。
---

# Alembic 迁移

## 1. 目的与边界

把“物理 schema 已确认 → 修改 ORM → 编写 migration → 向前验证 → 同步长期文档”固化为可执行流程。schema 演进建立后，权威源必须是 SQLAlchemy 模型与 Alembic 迁移链，不能通过手工 `ALTER TABLE` 绕开版本管理。

本技能负责迁移本身；字段与索引设计转 `mysql-ddl-conventions`，完整业务实现返回 `backend-delivery`，由当前 Sol 拆分工作包并调度 Luna 使用 `implementation-execution`，长期文档维护转 `doc-maintenance-sync`。

## 2. LinkCV 基线

- LinkCV 使用 MySQL 8.4 与 SQL-first Alembic；Python revision 的 `upgrade()` 调用同 ID 的 up SQL。
- 迁移是 forward-only：仓库不保存 `.down.sql`，所有 `downgrade()` 明确拒绝执行。
- 数据库恢复依赖发布前备份；schema 或数据修正通过新的向前 revision 完成。
- 后端 SQLite 测试不能替代真实 MySQL 迁移验证；仓库 head 也不代表目标环境已升级。

每次 schema 变化都先核对方案、ORM、当前 head、目标环境 current revision 和部署 runner，再明确执行者、发布顺序、备份恢复与向前修复方案。

## 3. 必读材料

1. 当前方案及数据模型、存量数据处理规则和实际存在的 Acceptance；
2. 相关 SQLAlchemy 模型、配置、仓储和测试；
3. Alembic 配置、`env.py`、版本目录及相关 revision；
4. 当前 heads、history 和目标数据库 current revision；
5. [MySQL 表结构规范](../mysql-ddl-conventions/SKILL.md)；
6. Compose、环境变量、部署入口和数据库长期文档；
7. 正确基线到当前分支的完整模型与 migration 差异。

## 4. 编写迁移

1. **确认版本链**：新 revision 的 `down_revision` 接到预期唯一 head；多 head 先查明原因。
2. **核对 ORM**：字段、外键、关系、约束和索引与确认后的物理 schema 一致。
3. **创建 SQL-first revision**：运行 `npm run db:revision -- -m "<message>"`，生成 Python revision，并且只生成同 ID 的 `.up.sql`。禁止使用 `alembic revision --autogenerate` 作为最终入口，禁止创建 `.down.sql`。
4. **编写 up SQL**：DDL、索引、约束和 SQL 可表达的数据变更写入 up SQL；`upgrade()` 只调用对应文件。只有 SQL 无法安全表达的受控迁移才允许少量 Python，并说明原因与幂等性。
5. **兼容发布**：破坏性变化优先“扩展 → 回填或双写 → 切换 → 收缩”，明确旧应用与新 schema、新应用与旧 schema 的兼容窗口。
6. **处理数据**：回填限定范围、分批、幂等、可重试并校验结果；不写入演示数据或真实用户数据。
7. **坚持 forward-only**：`downgrade()` 明确抛出 forward-only 错误，不生成或执行 down SQL，也不测试升级降级往返。恢复使用备份，修正使用新的向前 revision。
8. **保护历史**：已进入共享环境的 revision 和 up SQL 不原地改写；修正通过新 revision 完成。

## 5. MySQL 风险

- 评估 DDL 隐式提交、锁等待、全表扫描、索引构建和大表回填时间；
- 字段收窄、字符集变化和新增唯一约束前检查存量冲突；
- 不用 SQLite 成功替代 MySQL 8.4 验证；
- 删除数据、列或不可逆转换前确认备份、恢复目标和演练方式；
- 失败后依据真实 current/schema 决定新的向前修复，不自动重试未知的半完成 DDL。

## 6. 验证流程

1. heads 唯一、history 连续、revision 唯一；
2. 每个 revision 只有同 ID 的 `.up.sql`，不存在 `.down.sql`；`upgrade()` 只调用 up SQL，`downgrade()` 明确拒绝；
3. 空 MySQL 8.4 数据库从零升级到 head；
4. 具有受支持历史版本 schema 和代表性虚构数据的 MySQL 数据库升级到 head；
5. 模型 metadata 与 head schema 没有未解释差异；
6. 约束、索引、外键、默认值、时区、回填幂等和失败恢复测试通过；
7. 迁移范围匹配的后端集成、契约和文档检查通过；创建 PR 前运行完整 `npm run check`。

未运行的命令标为“未验证”。生产规模、锁时间和备份恢复无法在本地证明时，列为发布前门槛。

## 7. 输出与转交

最终说明 ORM 与 migration 文件、revision 链、up/回填/幂等策略、兼容发布、锁风险、备份恢复、向前修复方式，以及实际验证和未覆盖项。
