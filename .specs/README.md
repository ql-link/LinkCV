# LinkCV 本地 Spec 工作区

`.specs/<KEY>/` 用于方案先行任务执行期间的阶段快照。用户当前请求、可读取的 Issue、飞书文档及用户明确指定的其他材料都可以作为需求来源；有 Issue 时完整读取并保存为可选追踪信息，没有 Issue 不阻止初始化、方案或实现。已有飞书详情文档时一起读取，需要补充上游模块决定时先在飞书中解决，再把有效来源材料收敛到本地冻结产物。Issue 可以来自任意平台，是否存在及来源系统都不改变阶段判断。

## 三条交付路径

`flow-router` 先分开判断准备程度、任务复杂度、风险和记录需要，再决定进实现前要不要方案文档；方案之后怎么走如果用户已经选择就由 `solution-generator` 直接记录并复用，尚未选择时才随方案一起确认，组合出三条路径：

- **直接实现**：不创建 Spec，直接改代码并按改动范围验证。
- **方案 → 实现**（`route=direct_build`）：`solution.md → implementation → 自动验证快照 → 按需人工验收 → 质量审查 → release_ready`。不产出 `acceptance.feature`，方案文档“验证与验收”中的结果和验证映射就是验证契约。
- **方案 → 验收契约 → 实现**（`route=acceptance_first`）：在上一条中间插入 `acceptance.feature`。

`acceptance.feature` 永远依赖 `solution.md`：方案文档未冻结时无法冻结验收契约，方案文档重新冻结会作废验收契约和全部下游证据。这条顺序由脚本强制，不靠自觉。

方案模板保留原有完整章节库和独立的“验证与验收”，不要求每份文档逐章填写。需求描述、现状问题、主要流程图、真实文件与代码实施计划、验证映射始终保留；状态机和数据模型是高优先条件章节，命中生命周期、状态关系或持久数据读写时不得省略；其他章节由任务复杂度及实际涉及面触发，未命中时整章删除。详见 `solution-generator`。不再存在独立的 `technical_design.md` 阶段，也不再有 `lane` 字段；旧状态在读取时自动升级，原 L2/L3 链路记为 `route=acceptance_first`。

## 使用

通常由 `solution-generator` 在首次处理方案先行任务时自动初始化，用户不需要手动运行。调试或人工恢复流程时可以使用：

```bash
npm run spec -- init LCV-42 --source-issue <ISSUE_URL_OR_REF>
npm run spec -- init LOCAL-20260802-AI-WORKFLOW
npm run spec -- status
npm run spec -- status LCV-42
npm run spec -- check LCV-42 acceptance
npm run spec -- freeze LCV-42 solution --next acceptance_first
npm run spec -- freeze LCV-43 solution --next direct_build
npm run spec -- route LCV-43 acceptance_first
npm run spec -- verify LCV-42 --run "npm run test:backend" --run "npm run build:backend"
npm run spec -- verify LCV-42 --run "npm run test:web" --run "npm run typecheck" --run "npm run build:web" --manual-acceptance
npm run spec -- review LCV-42 --pass --evidence "未发现阻断问题"
npm run spec -- check LCV-42 release_ready
```

`init` 只创建 `.specs/<KEY>/state.yaml`，不生成业务产物、不修改外部 Issue，也不执行 Git 操作。已有状态不会被覆盖。

冻结会把产物 SHA-256 写入 `state.yaml`。冻结后修改文件会使下游检查失败；确认新版本后使用 `freeze --refreeze`，脚本会使受影响的下游状态失效。

任务范围验证由 `spec verify --run` 自己执行已经按改动范围和风险选定的一条或多条命令，不接受手填的“已通过”字符串。脚本自动记录命令、退出码、耗时、时间和当前可提交内容的 SHA-256；验证命令失败、改变了可提交内容，或之后代码再次变化时都不会保留可信验证状态。代码指纹按内容计算，因此仅创建内容相同的 Git commit 不会触发无意义的重跑。

验证成功后固定进入 `quality_review`，跨会话恢复会指向 `code-review-and-quality`，不会直接跳到 PR。只有审查没有阻断问题时，Agent 才自动运行 `spec review <KEY> --pass` 进入 `release_ready`。这里的 `release_ready` 只表示同一代码快照通过了本任务记录范围的验证和质量审查，不等于已经满足 PR 门槛；准备创建 PR 时仍必须在当前可提交内容上运行完整 `npm run check`，共享 CI 也继续运行完整入口。这些元数据都由工具维护，开发者不需要填写哈希、退出码、时间或状态字段。

旧版 `state.yaml` 会在读取时自动升级。旧任务只有 `brief.md` 时，工具会在冻结哈希吻合且不会覆盖其他内容的前提下迁移为 `solution.md`；此前已经升级到 schema v7 但仍遗留 `brief.md` 的任务也会自动补做这一步。两个文件内容相同时保留 `solution.md` 并清理旧副本，内容不同时停止并要求人工确认，不静默覆盖。旧的字符串验证证据会保留在 `legacy_evidence` 供追溯，但不会继续作为可信证明；任务会退回 `implementation`，由 Agent 自动重跑任务范围验证。

## 需求来源与实施偏差

用户当前请求、可读取的 Issue、关联的飞书周开发文档、详情文档、用户明确指定的其他材料和方案阶段确认的结论都可以构成需求输入。方案文档和 Acceptance 是当前工作区的执行快照；冻结后仍由本地哈希门禁保证这些本地产物没有被静默修改。

`source_issue` 是可选字段，只在存在 Issue 时原样保存一个完整链接或稳定引用，方便恢复上下文、PR 关联和人工追踪；缺失不属于异常或降级。状态中不拆分 `source.system`、`issue_id` 或 `workspace_id`，也不给 Multica、Linear、GitHub 或其他平台附加不同流程语义。工具不会访问外部 Issue 校验正文，不维护需求指纹、评论链、漂移状态或对账状态，也不会向任何 Issue 系统写回评论。

只有实施中存在已允许的实际方案偏差、已接受限制，或必须跨会话交接的遗留风险与下一步时，才创建 `implementation_report.md`，并且只写命中的增量章节。数据库、跨端、权限、部署、多模块或严格风险本身都不触发报告；正常实现、验证命令、人工验收和 PR 内容不在报告中重复。若偏差会改变范围、验收、权限、数据安全或兼容承诺，返回 `solution-generator` 重新确认并修订冻结产物；只有相关结论已经写入并读回飞书详情文档时，才先经 `module-planning` 更新该文档。

## 跨会话恢复

新会话先运行 `npm run spec -- status`。不带 KEY 时扫描当前工作区全部 Spec；每个可信的在途任务会显示后续路径、阶段、下一站 Skill、最小待读文件和本地阶段门禁。发现 `state.yaml` 结构错误、冻结文件缺失、规格或代码 SHA-256 漂移、人工验收变化，或阶段与产物不一致时返回非零，修复前不得继续。

已经进入 `release_ready` 的任务不再计入无参数查询的“在途”列表，避免历史任务持续制造选择负担；需要复查或发布时仍可用 `npm run spec -- status <KEY>` 精确查询。

有多个在途任务时必须由用户指定继续哪一个。`.specs/<KEY>/` 默认被 Git 忽略，因此该恢复能力覆盖同一工作区中的跨会话续做，不承诺跨设备或跨 worktree 自动复制本地产物；跨环境恢复时重新读取当前请求、可选 Issue、对应详情文档及其他已确认材料，并重新建立本地快照。

当方案先行任务包含跨浏览器、跨服务、上传下载、PDF 或视觉行为，且现有自动化测试无法完整覆盖时，由 `manual-acceptance` 在 `.specs/<KEY>/manual_acceptance.md` 生成和记录人工端到端验收。最终运行 `spec verify --manual-acceptance` 时，脚本自动校验总体结论、统计、占位内容和文件哈希；仍有必要项未执行、失败或阻塞时不会进入质量审查。人工步骤执行后若相关代码或配置变化，受影响项必须恢复为未执行并重新验收；最终自动化快照不能代替较早的人工证据。直接实现的同类检查只保留会话级记录，不创建 Spec。

具体任务目录默认被 Git 忽略。仓库只长期保留本文；PR 中摘要人工验收结论，但不复制整份本地清单。产物模板由对应的 `.ai/skills/<skill>/` 管理，避免全局模板与 Skill 规则漂移。
