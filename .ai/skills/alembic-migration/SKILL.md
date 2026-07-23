---
name: alembic-migration
description: 为 LinkCV 编写、校验和排查 SQLAlchemy 与 Alembic schema 迁移，覆盖 revision 链、自动生成审查、数据回填、升级降级、兼容发布和文档同步。适用于首次建立 FastAPI 持久化基础，新增或修改表、字段、关系、约束、索引，处理多 head、模型与数据库漂移或迁移失败；单纯设计字段与索引先使用 mysql-ddl-conventions，数据库改动一律按 L3 处理。
---

# Alembic 迁移

## 1. 目的与边界

把“物理 schema 已确认 → 修改 ORM → 编写 migration → 往返验证 → 同步长期文档”固化为可执行流程。schema 演进建立后，权威源必须是 SQLAlchemy 模型与 Alembic 迁移链，不能通过手工 `ALTER TABLE` 绕开版本管理。

本技能负责迁移本身，不负责：

- 决定业务字段语义、旧数据是否迁移或兼容窗口，返回 Brief、Acceptance 或 `decision-grilling`；
- 从零设计字段、类型、约束和索引，转 `mysql-ddl-conventions`；
- 编写完整业务实现，转 `implementation-execution`；
- 泛化维护长期文档，转 `doc-maintenance-sync`。

## 2. LinkCV 当前基线

- FastAPI 当前只有健康检查，尚未引入 SQLAlchemy、Alembic、业务模型或迁移目录。
- `deploy/docker-compose.yml` 提供本地 MySQL 8.4，不代表数据库已经进入 FastAPI 运行链或生产部署。
- 临时 Express 继续使用 SQLite；当前约束是原型 SQLite 数据不迁移到 MySQL，除非新的冻结需求明确改变这一点。

因此首次持久化任务必须先在技术设计中明确依赖、连接配置、模型目录、Alembic 目录、命令入口、初始 revision、测试数据库、部署顺序和回滚。仓库没有这些文件时，明确写“尚未建立”，不得照搬 LinkRag 路径或编造已可运行的命令。

## 3. 必读材料

存在时读取：

1. 冻结的 Brief、Acceptance 与 Technical Design；
2. `apps/backend` 中相关 SQLAlchemy 模型、配置、仓储和测试；
3. Alembic 配置、`env.py`、版本目录及全部相关 revision；
4. 当前迁移 heads、history、目标数据库 current revision；
5. [MySQL 表结构规范](../mysql-ddl-conventions/SKILL.md)；
6. Compose、环境变量模板、部署入口与数据库长期文档；
7. 正确基线到当前分支的完整模型与 migration 差异。

## 4. 首次建立迁移基础

首次引入时至少确认：

1. SQLAlchemy metadata 的唯一入口和命名约定；
2. Alembic 如何读取与应用相同的非敏感数据库配置，同时避免在日志中输出凭据；
3. 初始 revision 是空库建表还是既有 schema baseline，不能混淆；
4. 哪些环境由谁执行迁移，应用启动不得静默执行高风险 schema 变更；
5. 测试如何创建隔离 MySQL schema、升级到 head 并清理；
6. 如何检查单一 head、模型漂移、升级和回滚；
7. 模型或 migration 变化触发哪些文档同步和机器门禁。

## 5. 编写迁移

1. **确认版本链**：读取 heads 与 history。新 revision 的 `down_revision` 必须接到预期 head；出现多个 head 时先判断是合法分支还是遗漏，不盲目生成 merge。
2. **先定 ORM**：模型字段、外键、关系、约束和索引与已确认物理 schema 一致。
3. **生成或手写 revision**：自动生成只能作为草稿，逐项核对列名、类型、长度、默认值、可空性、外键、约束、索引、表注释以及意外删除。
4. **处理兼容**：破坏性变化优先采用“扩展 → 回填或双写 → 切换 → 收缩”。新增非空字段通常先允许空值或提供安全默认值，回填完成后再加约束。
5. **处理数据**：回填必须限定范围、分批、幂等、可重试并能校验结果；不要把演示数据或真实用户数据写进 migration。
6. **实现回滚**：`downgrade()` 与 `upgrade()` 对称。无法无损回退时明确标记不可逆，并给出应用回滚、备份恢复或补偿方案，不能用空实现伪装可回滚。
7. **保护历史**：已经进入共享环境的 revision 不得原地改写；修正通过新的 revision 完成。

## 6. MySQL 风险核实

- 评估 DDL 隐式提交、锁等待、全表扫描、索引构建和大表回填时间；
- 字段收窄、字符集或排序规则变化、唯一约束新增前先检查存量冲突；
- 迁移中的事务假设必须符合 MySQL 8.4，不用 SQLite 成功代替 MySQL 验证；
- 发布顺序必须说明旧应用是否能在新 schema 上运行，新应用是否能在旧 schema 上启动；
- 数据删除、列删除和不可逆转换前明确备份、恢复目标与验证方式。

## 7. 验证流程

根据仓库当时真实入口执行并记录：

1. heads 只有预期结果，history 连续且 revision 唯一；
2. 空数据库从零升级到 head；
3. 具有上一版本 schema 和代表性虚构数据的数据库升级到 head；
4. 可逆 migration 执行“升级 → 降级 → 再升级”；
5. 模型 metadata 与 head schema 没有未解释差异；
6. 约束、索引、外键、默认值、时区、回填幂等与失败恢复测试通过；
7. 文档同步和完整 `npm run check` 通过。

未实际运行的命令必须写成“未验证”。生产规模、锁时间和备份恢复无法在本地证明时，列为发布前门槛。

## 8. 输出与转交

最终说明：

- 修改的 ORM 文件和新增 migration 文件；
- revision、down_revision、当前 heads 与链路结论；
- upgrade、downgrade、数据回填和幂等策略；
- 兼容发布、锁风险、备份与恢复方式；
- 实际验证命令、结果和未覆盖项；
- 需要同步的数据库文档与机器规则。

迁移设计不成立时返回 `technical-design`；需要真正改代码时转 `implementation-execution`；迁移链或运行故障的只读定位可与 `incident-triage` 协作。
