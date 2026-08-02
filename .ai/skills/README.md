# LinkCV 项目技能

`.ai/skills/` 是项目技能的唯一来源。Codex 从 `.agents/skills` 发现这些技能，Claude 从 `.claude/skills` 发现同一份内容。

## 文件归属

| 内容 | 唯一位置 | 不应放置的位置 |
| --- | --- | --- |
| 所有任务都要读取的项目规则 | `.ai/prompts/project.md` | 各 Skill 重复副本 |
| Skill 流程和所属模板 | `.ai/skills/<skill>/` | `docs/`、`.specs/` |
| 当前模块、架构、契约和运维知识 | `docs/` | `.ai/references/`、Skill 正文副本 |
| 可执行检查和机器规则 | `scripts/quality/` | `docs/`、Skill 内手写副本 |
| 某次方案先行任务的需求与设计文档 | `.specs/<KEY>/` | `docs/`、`.ai/skills/` |

`.ai` 顶层只保留 `prompts/` 和 `skills/`。Skill 专属且只被该 Skill 使用的大型参考资料可以放在对应 Skill 的 `references/` 内；跨 Skill 的项目事实必须进入 `docs/`。

## 需求到交付主链

| 技能 | 职责 | 下一站 |
| --- | --- | --- |
| `flow-router` | 内部完整判断准备程度、四项复杂度、风险和记录需要，默认只展示路径、主导原因和额外检查 | 澄清或调查、方案文档或实现；模块尚未成形时转模块规划 |
| `module-planning` | 调查模块、主持决策、展示草稿并在确认后写入和读回飞书 | 没有继续授权时停止；已有继续授权时进入已指定的实现或方案路径，否则分流 |
| `decision-grilling` | 只沿决策树一次处理一个真实选择 | 把 `confirmed`、`blocked` 或 `replan` 结果返回调用方 |
| `solution-generator` | 需求与技术方案合一：保留完整章节库并按需求选择，固定收敛需求描述、现状问题、主流程、真实文件、实施步骤和验证映射；状态机与数据模型命中时优先完整展开，其他章节按需；直接确认真实待决选择，已有后续路径时复用、未选择时随方案确认 | 验收契约或实现 |
| `acceptance-generator` | 生成可验证行为场景；只在选定契约验收路径时执行 | 实现 |
| `contract-guard` | 分析契约结构、语义、兼容影响和同步范围 | 按需转配置核对、实现或文档同步 |
| `config-contract-sync` | 核对跨代码、配置和部署位置的具体契约值 | 诊断结束或转实现修复 |
| `doc-maintenance-sync` | 维护 `docs/` 长期项目知识 | 文档与契约门禁 |
| `implementation-execution` | 直接任务按确认来源、方案任务以 `solution.md` 为中心编码；只在已允许偏差、已接受限制或必须交接的遗留事项存在时补实施报告 | 测试 |
| `branch-pr-workflow` | 安全准备分支、提交和 PR，创建 PR 前执行完整本地检查 | 用户审核 |

## 测试与质量

| 技能 | 职责 | 边界或下一站 |
| --- | --- | --- |
| `test-authoring` | 编写前端组件/单元测试和后端单元/集成测试 | 运行验证 |
| `run-all-tests` | 按改动范围执行自动化验证 | 人工验收（适用时）或质量审查 |
| `manual-acceptance` | 生成并记录人工端到端验收；方案先行任务写 Spec，直接实现使用会话级记录 | 自动化汇总和质量审查 |
| `code-review-and-quality` | 审查正确性、契约与风险 | PR 收口 |
| `feature-completion-audit` | 对照原始需求独立核验完成度、遗漏和偏离 | 按缺口返回规格、实现、测试或审查 |

## 数据库与迁移

| 技能 | 职责 | 边界或下一站 |
| --- | --- | --- |
| `mysql-ddl-conventions` | 设计和审查 MySQL 物理表结构、约束与索引 | 由方案编写过程调用定稿；落地迁移转 `alembic-migration` |
| `alembic-migration` | 编写、校验和排查 SQL-first Alembic 迁移链与配对 up/down SQL | 业务实现转实施，文档转同步 |

## 运维与故障

| 技能 | 职责 | 边界或下一站 |
| --- | --- | --- |
| `incident-triage` | 沿 Web、代理、后端、数据和基础设施链路定位故障 | 修复代码先重新分级；迁移转 `alembic-migration` |

运行 `npm run check:ai` 校验技能的头部元数据、占位内容、链接、过期技术栈引用，以及方案模板的完整章节库、重点条件章节、施工契约和按需选择能力。长期模块知识从 [docs/README.md](../../docs/README.md) 按需读取；三个契约治理技能共享 [契约面与事实源映射](../../docs/internals/contract-governance.md)，不各自复制模块映射。

用户当前请求、Issue、飞书文档及用户明确指定的其他材料都可以作为来源。Issue 存在时必须完整读取，但没有 Issue 不阻止开发，也不算例外。`flow-router` 内部完成全部七维判断，默认只展示路径、主导原因和额外检查；准备不足、风险严格、需要持久记录或用户主动询问时才展开完整依据。准备可实施且复杂度简单或中等时可以直接开工，复杂任务进入方案先行；持久记录本身不升级路径。已有经 `module-planning` 确认并读回的飞书详情文档时，其结论优先于本地推断。项目 Skill 不维护外部需求指纹、不核验评论链，也不向任何 Issue 系统写回评论。

产物模板跟随所属技能保存：方案模板保留完整章节库，由生成规则按任务选择实际章节；验收契约和人工验收记录按需创建。`implementation_report.md` 只补充已允许的实际方案偏差、已接受限制和必须跨会话交接的遗留风险或下一步事项，不复述正常实现、验证命令或 PR 内容。`agents/openai.yaml` 仅在需要 Codex 界面展示元数据时按需添加，不是项目技能的必需文件。

技能调用保持单向且由上层拥有产物：`module-planning` 和 `solution-generator` 都可以调用 `decision-grilling` 处理单个选择，只有 `confirmed` 才写入结论，`blocked` 暂停，`replan` 交回上层重建决策树；`lark-doc` 只由 `module-planning` 调用执行已确认的文档写入，两个被调用技能都不接管规划。

方案先行任务的需求确认权归 `solution-generator`：会改变范围、业务规则、数据归属、权限、状态流转或兼容策略的不确定点由它直接向用户提问，一次一个问题并给出推荐答案，结论写入方案文档的“已确认决策”。只有整个模块的目标或商业前提尚未成形，或结论需要沉淀到飞书供他人协作时才转 `module-planning`。`acceptance-generator` 和方案先行的实现都以当前 `solution.md` 为中心；直接实现消费来源材料、当前确认结论和分流给出的严格检查项。发现新的高影响决策时先重新分流，方案先行后返回 `solution-generator` 更新方案并确认受影响决定，不在下游自行改变结论。

契约治理技能不要求固定串行：结构或语义影响用 `contract-guard`，同一具体值的多处一致性用 `config-contract-sync`，更新长期 `docs/` 用 `doc-maintenance-sync`。已有上游结论时直接消费，不重复扫描同一问题。

测试职责保持单向：`acceptance-generator` 定义可观察规则，`test-authoring` 编写自动化测试，`run-all-tests` 直接执行范围与风险匹配的命令并报告当前结果，`manual-acceptance` 记录必要的人工端到端结果，`code-review-and-quality` 审查实际差异和证据。代码变化后由 AI 判断受影响的验证与审查；跨会话不继承旧测试结论。准备创建 PR 时再由 `branch-pr-workflow` 要求完整 `npm run check`，共享 CI 继续运行完整检查。

专项能力按需叠加，不延长所有任务的固定主链：表结构设计与迁移执行分别由 `mysql-ddl-conventions`、`alembic-migration` 承接；完成度问题由 `feature-completion-audit` 做需求到证据的独立对账；运行故障由 `incident-triage` 先定位，获得修复授权后再回主链。当前会话实现的完成度审计必须使用独立子 Agent，外部 PR 或历史分支可由当前 Agent 直接核验。

跨会话续做时，方案先行任务重新读取当前请求、匹配的 `solution.md` 和实际存在的附件，直接实现任务重新读取当前请求和来源材料；两条路径都要核对 Git 提交、工作区差异和真实代码，再由 AI 判断下一步。多个 Spec 都可能匹配时让用户选择。`.worktreeinclude` 只在 Codex 新建本地托管 worktree 时复制一次被忽略的 `.specs/*/`，不是实时同步，也不覆盖跨设备或多个已有 worktree。恢复后重新运行当前交付需要的验证，不继承较早会话的“已通过”结论。
