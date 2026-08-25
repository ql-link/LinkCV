# LinkCV 项目技能

`.ai/skills/` 是项目技能的唯一来源。Codex 从 `.agents/skills` 发现这些技能，Claude 从 `.claude/skills` 发现同一份内容。

## 文件归属

| 内容 | 唯一位置 | 不应放置的位置 |
| --- | --- | --- |
| 所有任务都要读取的项目规则 | `.ai/prompts/project.md` | 各 Skill 重复副本 |
| Skill 流程和所属模板 | `.ai/skills/<skill>/` | `docs/`、`.specs/` |
| 当前模块、架构、契约和运维知识 | `docs/` | `.ai/references/`、Skill 正文副本 |
| 可执行检查和机器规则 | `scripts/quality/` | `docs/`、Skill 内手写副本 |
| 某次后端方案、前端原型或验收产物 | `.specs/<KEY>/` | `docs/`、`.ai/skills/` |

`.ai` 顶层只保留 `prompts/` 和 `skills/`。Skill 专属且只被该 Skill 使用的大型参考资料可以放在对应 Skill 的 `references/` 内；跨 Skill 的项目事实必须进入 `docs/`。

## 需求到交付主链

| 技能 | 职责 | 下一站 |
| --- | --- | --- |
| `flow-router` | 以最小代码证据区分纯前端、纯后端和混合领域，并原样传递用户控制项 | 纯前端转 `frontend-delivery`；纯后端和混合任务转 `backend-delivery` |
| `backend-delivery` | 当前对话的 Sol（主 Agent）完成纯后端和混合任务的七维判断、方案、工作包拆分、Luna 调度和实施复核，不引入同级 Sol | 复用 `solution-generator`、可选验收契约和 `implementation-execution`；混合任务把 UI 交给 `frontend-delivery` |
| `frontend-delivery` | 薄协调器：当前对话的 Sol（主 Agent）核对用户原型和现有代码、直接完成低风险局部修改或拆分实质工作包调度 Luna，并操控真实浏览器验收，不自行设计界面 | 非视觉直接修改或原型驱动实现；需要委派时交给 `frontend-implementation`，原型核对使用 `prototype-acceptance` |
| `module-planning` | 调查模块、主持决策，并按用户要求把初步设计写入和读回飞书 | 没有继续授权时停止；已有继续授权时进入已指定的实现或方案路径，否则分流 |
| `decision-grilling` | 只沿决策树一次处理一个真实选择 | 把 `confirmed`、`blocked` 或 `replan` 结果返回调用方 |
| `solution-generator` | 需求与技术方案合一：保留完整章节库并按需求选择，固定收敛需求描述、现状问题、主流程、真实文件、实施步骤和验证映射；状态机与数据模型命中时优先完整展开，其他章节按需；直接确认真实待决选择，已有后续路径时复用、未选择时随方案确认 | 验收契约或实现 |
| `acceptance-generator` | 生成可验证行为场景；只在选定契约验收路径时执行 | 实现 |
| `contract-guard` | 分析契约结构、语义、兼容影响和同步范围 | 按需转配置核对、实现或文档同步 |
| `config-contract-sync` | 核对跨代码、配置和部署位置的具体契约值 | 诊断结束或转实现修复 |
| `doc-maintenance-sync` | 维护 `docs/` 长期项目知识 | 文档与契约门禁 |
| `implementation-execution` | 执行纯后端任务及混合任务的后端、契约和配置工作包；方案任务以 `solution.md` 为中心 | 测试 |
| `frontend-implementation` | Luna 严格按用户原型和 Sol 的会话级映射实现具有实质实施量的代码、样式和测试工作包，不承接 Sol 可直接完成的低风险局部修改，不重新设计或改变业务契约 | 返回 `frontend-delivery`，由 Sol 整合和复核 |
| `prototype-acceptance` | 当前对话的 Sol 操控真实浏览器核对用户原型覆盖的真实消费路由、状态和响应式结果，不自行补齐设计 | 发现偏差回到 `frontend-delivery`，由 Sol 直接修正低风险局部偏差或生成 Luna 工作包；缺少设计信息时返回用户 |
| `branch-pr-workflow` | 从 `master` 准备业务分支，完成面向 `dev` 的提交与 PR，PR 前执行完整本地检查 | 用户审核与 Dev 集成测试 |

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
| `alembic-migration` | 编写、校验和排查 forward-only SQL-first Alembic 迁移链与 up SQL | 业务实现转实施，文档转同步 |

## 运维与故障

| 技能 | 职责 | 边界或下一站 |
| --- | --- | --- |
| `incident-triage` | 沿 Web、代理、后端、数据和基础设施链路定位故障 | 修复代码先重新分级；迁移转 `alembic-migration` |

运行 `npm run check:ai` 校验技能的头部元数据、占位内容、链接、过期技术栈引用，以及方案模板的完整章节库、重点条件章节、施工契约和按需选择能力。长期模块知识从 [docs/README.md](../../docs/README.md) 按需读取；三个契约治理技能共享 [契约面与事实源映射](../../docs/internals/contract-governance.md)，不各自复制模块映射。

用户当前请求、Issue、飞书文档及用户明确指定的其他材料都可以作为来源。Issue 存在时必须完整读取，但没有 Issue 不阻止开发，也不算例外。`flow-router` 只区分纯前端、纯后端或混合领域：纯前端进入 `frontend-delivery`，纯后端和混合任务进入 `backend-delivery`。当前对话的 Sol（主 Agent）完成原型映射或七维判断、方案、工作包拆分、Luna 调度和验收复核，不引入同级 Sol。纯前端由 Sol 直接操控真实浏览器；低风险局部修改由 Sol 直接实施，具有实质实施量且委派收益高于交接开销的工作包才交给一个或多个 Luna Max，通过 `frontend-implementation` 落地。原型核对通过 `prototype-acceptance` 完成，不建立 Playwright 截图基线。复杂后端任务进入 `solution.md` 方案链，混合任务先固定跨端契约，持久记录本身不升级路径。

飞书文档只作为方案形成前的初始输入。确认后的 `solution.md` 是后端和混合方案的实施依据，保存业务、API、权限、数据与失败语义；前端以用户提供的 PNG、JPG、截图、HTML 原型或 Figma 为可见依据，Sol 结合现有代码、`DESIGN.md`、Token 和组件形成会话级映射，不生成独立设计文档或替代原型。混合任务的 UI 实现只消费并从属于 `solution.md`；契约变化必须先改 `solution.md`。

## 单向交付层次

| 层次 | 载体 | 负责什么 | 边界 |
| --- | --- | --- | --- |
| 初始设计层 | 飞书文档 | 记录模块方向、背景和供人讨论的初步设计 | 进入开发链后不跟随 Spec 或代码反复修改，不裁决实现 |
| 任务入口与跟踪层 | Issue 正文 | 标识本次目标、边界、验收期望和关联材料 | 可选，不是开工许可证；交接后不要求与 Spec、代码保持逐字一致 |
| 可执行设计层 | `solution.md`、用户原型或 Figma | `solution.md` 保存后端或混合任务的业务与契约；用户提供并确认的原型或 Figma 保存前端可见依据，Sol 只在会话中维护映射 | 非视觉直接修改可以没有原型；新增页面、主要区域、可见结构或视觉重做不能由 AI 自行设计 |
| 实施真相层 | 代码、配置、迁移和测试 | 保存真正运行的行为和可验证证据 | 不能用代码静默改需求；普通内部实现差异不反向修改上游文档 |
| 交付审阅层 | PR | 基于最终差异说明实际交付、重要来源差异、验证、风险和未完成项 | 不在 PR 中重新发明需求；代码变化后优先保持 PR 正文准确 |
| 跟踪收尾层 | 来源 Issue 的交付评论 | 用一条评论给出 PR 链接、实际结果、重要差异和遗留项 | 不修改 Issue 正文或状态，不发送逐阶段进度和重复规格同步评论 |

```text
当前请求 / 飞书初步设计 / Issue 正文
                    │
                    ↓
                flow-router（只判领域）
                    ├── 纯前端 → frontend-delivery → 用户原型映射（必要时向用户索取）
                    │                    ├── 低风险局部修改 → Sol 直接实施
                    │                    └── 实质工作包 → frontend-implementation → Luna
                    │                    → Sol 使用 prototype-acceptance 操作真实浏览器 ─┐
                    └── 后端/混合 → backend-delivery（七维判断）           │
                                      ├── 直接实现 ───────────────────────┤
                                      └── solution.md → 用户原型 / Figma 输入 ┤
                                                                         ↓
                                                              代码与测试 → PR → 一条 Issue 交付评论
```

主链只向右推进。前端实现优先复用现有组件和 Token；原型未覆盖且真实代码已有明确行为时保守复用，无法确定且会改变结果时返回用户补充。`docs/` 是代码实现后的长期事实旁路，只在真实架构、接口、数据、配置或部署事实改变时同步，不参与任务方向裁决。

## Sol 调度与 Luna 工作包

Sol 是当前对话的规划、拆分、调度、整合和复核者，不创建同级 Sol。纯前端中目标明确、局限在现有组件且不新增交互状态、API、共享契约或跨文件协调的低风险局部修改由 Sol 直接完成；新增行为、结构、响应式布局、共享能力或其他具有实质实施量的工作包才调度 Luna。Sol 根据已确认的 `solution.md` 或用户原型映射、委派收益、依赖关系、写冲突和文件边界决定实施队列：可独立、边界清楚且文件所有权不重叠的工作包可以并行交给多个 Luna；共享契约、迁移链、同一核心文件或存在前后依赖的工作包必须串行。不要为了并行或满足工作流形式而拆分本来紧密耦合的工作。

每个工作包都要写清目标、可观察结果、允许与禁止文件、文件所有权、依赖、严格检查和最小验证。Sol 负责整合多个 Luna 的差异并复核证据；实施失败后由 Sol 根据具体证据判断继续原 Luna，还是把未完成工作重新分派给另一个 Luna，不能引入同级 Sol。共享契约或迁移链的变更不得由并行工作包各自决定。

普通文件拆分、命名、测试落点或不改变外部结果的实现调整，直接在代码中完成并按需写入 PR。同一目标内确实改变用户行为、权限、数据语义、状态、兼容、迁移或发布承诺时，后端与混合任务修订当前 `solution.md`；纯前端的实现必须服从用户原型，原型变化由用户重新提供或确认，混合任务也先服从上游契约。所有受影响决定都需要重新确认。

产物模板跟随所属技能保存：方案模板保留完整章节库，由生成规则按任务选择实际章节；验收契约和人工验收记录按需创建。`implementation_report.md` 只补充已允许的实际方案偏差、已接受限制和必须跨会话交接的遗留风险或下一步事项，不复述正常实现、验证命令或 PR 内容。`agents/openai.yaml` 仅在需要 Codex 界面展示元数据时按需添加，不是项目技能的必需文件。

技能调用保持单向且由上层拥有产物：`module-planning` 和 `solution-generator` 都可以调用 `decision-grilling` 处理单个选择，只有 `confirmed` 才写入结论，`blocked` 暂停，`replan` 交回上层重建决策树；`lark-doc` 只由 `module-planning` 调用执行已确认的文档写入，两个被调用技能都不接管规划。

后端和混合方案任务的需求确认权归 `solution-generator`。纯前端的主任务以用户提供的原型为依据；`frontend-delivery` 只核对原型来源、真实路由、行为契约和现有组件，形成会话级映射，再选择由 Sol 直接完成低风险局部修改或把实质工作包交给 Luna，不能替用户决定信息结构、交互方式、布局或视觉方向。混合任务不得在 UI 阶段重新决定上游契约。直接实现消费当前请求、来源材料、已确认结论和 `backend-delivery` 给出的七维简报与严格检查项。

契约治理技能不要求固定串行：结构或语义影响用 `contract-guard`，同一具体值的多处一致性用 `config-contract-sync`，更新长期 `docs/` 用 `doc-maintenance-sync`。已有上游结论时直接消费，不重复扫描同一问题。

测试职责保持单向：`acceptance-generator` 定义可观察规则，`test-authoring` 编写自动化测试，`run-all-tests` 直接执行范围与风险匹配的命令并报告当前结果，`manual-acceptance` 记录必要的人工端到端结果，`code-review-and-quality` 审查实际差异和证据。代码变化后由 AI 判断受影响的验证与审查；跨会话不继承旧测试结论。准备创建 PR 时再由 `branch-pr-workflow` 要求完整 `npm run check`，共享 CI 继续运行完整检查。

专项能力按需叠加，不延长所有任务的固定主链：表结构设计与迁移执行分别由 `mysql-ddl-conventions`、`alembic-migration` 承接；完成度问题由 `feature-completion-audit` 做需求到证据的独立对账；运行故障由 `incident-triage` 先定位，获得修复授权后再回主链。当前会话实现的完成度审计必须使用独立子 Agent，外部 PR 或历史分支可由当前 Agent 直接核验。

跨会话续做时，后端或混合方案任务重新读取当前请求、匹配的 `solution.md` 和实际附件；前端任务重新读取用户提供并确认的原型/Figma、目标真实路由和当前差异，混合任务同时读上游方案。原型不可访问时请用户重新附上或恢复权限，不根据聊天记忆猜测。所有路径都核对 Git 提交、工作区差异和真实代码，再由 AI 判断下一步；恢复后重新运行当前交付需要的验证。
