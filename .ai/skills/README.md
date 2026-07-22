# LinkCV 项目技能

`.ai/skills/` 是项目技能的唯一来源。Codex 从 `.agents/skills` 发现这些技能，Claude 从 `.claude/skills` 发现同一份内容。

## 文件归属

| 内容 | 唯一位置 | 不应放置的位置 |
| --- | --- | --- |
| 所有任务都要读取的项目规则 | `.ai/prompts/project.md` | 各 Skill 重复副本 |
| Skill 流程和所属模板 | `.ai/skills/<skill>/` | `docs/`、`.specs/` |
| 当前模块、架构、契约和运维知识 | `docs/` | `.ai/references/`、Skill 正文副本 |
| 可执行检查和机器规则 | `scripts/quality/` | `docs/`、Skill 内手写副本 |
| 某次 L2/L3 需求与设计快照 | `.specs/<KEY>/` | `docs/`、`.ai/skills/` |

`.ai` 顶层只保留 `prompts/` 和 `skills/`。Skill 专属且只被该 Skill 使用的大型参考资料可以放在对应 Skill 的 `references/` 内；跨 Skill 的项目事实必须进入 `docs/`。

## 需求到交付主链

| 技能 | 职责 | 下一站 |
| --- | --- | --- |
| `flow-router` | 判断 L1/L2/L3 并识别阻塞性决策 | 盘问、需求简报或实现 |
| `decision-grilling` | 沿决策树一次收敛一个真实选择 | 返回调用它的需求或设计技能 |
| `brief-generator` | 收敛范围、边界与风险 | 验收契约 |
| `acceptance-generator` | 生成可验证行为场景 | L2 实现；L3 技术设计 |
| `technical-design` | 生成跨模块技术方案 | 实现 |
| `contract-guard` | 分析契约结构、语义、兼容影响和同步范围 | 按需转配置核对、实现或文档同步 |
| `config-contract-sync` | 核对跨代码、配置和部署位置的具体契约值 | 诊断结束或转实现修复 |
| `doc-maintenance-sync` | 维护 `docs/` 长期项目知识 | 文档与契约门禁 |
| `implementation-execution` | 按冻结规格编码 | 测试 |
| `branch-pr-workflow` | 安全准备分支、提交和 PR | 用户审核 |

## 测试与质量

| 技能 | 职责 | 边界或下一站 |
| --- | --- | --- |
| `test-authoring` | 编写前端组件/单元测试和后端单元/集成测试 | 运行验证 |
| `run-all-tests` | 按改动范围执行自动化验证 | 人工验收（适用时）或质量审查 |
| `manual-acceptance` | 生成并记录任务级人工端到端验收 | 质量审查 |
| `code-review-and-quality` | 审查正确性、契约与风险 | PR 收口 |
| `feature-completion-audit` | 对照原始需求独立核验完成度、遗漏和偏离 | 按缺口返回规格、实现、测试或审查 |

## 数据库与迁移

| 技能 | 职责 | 边界或下一站 |
| --- | --- | --- |
| `mysql-ddl-conventions` | 设计和审查 MySQL 物理表结构、约束与索引 | 落地迁移转 `alembic-migration` |
| `alembic-migration` | 编写、校验和排查 SQLAlchemy/Alembic 迁移链 | 业务实现转实施，文档转同步 |

## 运维与故障

| 技能 | 职责 | 边界或下一站 |
| --- | --- | --- |
| `incident-triage` | 沿 Web、代理、后端、数据和基础设施链路定位故障 | 修复代码先重新分级；迁移转 `alembic-migration` |

运行 `npm run check:ai` 校验技能的头部元数据、占位内容、链接和过期技术栈引用。长期模块知识从 [docs/README.md](../../docs/README.md) 按需读取；三个契约治理技能共享 [契约面与事实源映射](../../docs/internals/contract-governance.md)，不各自复制模块映射。Multica 来源的阶段 Skill 通过 `npm run spec:source -- ...` 复用同一权威需求指纹门禁，不各自实现外部同步逻辑。除 `brief-generator` 在用户确认具体业务差异后调用 `sync-comment` 追加结构化需求变更评论外，其余阶段只读核验。

固定结构的产物模板跟随所属技能保存：需求简报、验收契约、技术设计、按需生成的实施报告和人工验收记录分别由对应技能维护。`agents/openai.yaml` 仅在需要 Codex 界面展示元数据时按需添加，不是项目技能的必需文件。

需求简报和技术设计初稿都是一致性探针：发现新分歧时转 `decision-grilling`，事实由 Agent 自行核实，真实决策按依赖顺序每轮只询问一个；结论回写原章节并重新扫描，阻塞项清空且用户确认后才允许冻结。

契约治理技能不要求固定串行：结构或语义影响用 `contract-guard`，同一具体值的多处一致性用 `config-contract-sync`，更新长期 `docs/` 用 `doc-maintenance-sync`。已有上游结论时直接消费，不重复扫描同一问题。

测试职责保持单向：`acceptance-generator` 定义可观察规则，`test-authoring` 编写自动化测试，`run-all-tests` 通过统一命令执行并自动记录验证结果与代码快照，`manual-acceptance` 记录必要的人工端到端结果，`code-review-and-quality` 审查同一代码快照并把无阻断结论推进到 `release_ready`。开发者不手填哈希、退出码或阶段字段。

专项能力按需叠加，不延长所有任务的固定主链：表结构设计与迁移执行分别由 `mysql-ddl-conventions`、`alembic-migration` 承接；完成度问题由 `feature-completion-audit` 做需求到证据的独立对账；运行故障由 `incident-triage` 先定位，获得修复授权后再回主链。当前会话实现的完成度审计必须使用独立子 Agent，外部 PR 或历史分支可由当前 Agent 直接核验。

跨会话续做先运行 `npm run spec -- status`：脚本验证本地状态、规格冻结哈希、自动验证代码快照和质量审查快照，并给出唯一下一站、待读文件和门禁命令。验证成功后下一站固定为 `code-review-and-quality`，不会直接跳到 PR。它只恢复当前工作区的 `.specs`；跨 worktree 或设备时从 Multica 长期主记录重新建立本地快照，不把 Git 忽略目录当作共享状态。
