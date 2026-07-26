# LinkCV 本地 Spec 工作区

`.specs/<LCV-key>/` 用于 L2/L3 任务执行期间的阶段快照。普通团队任务从来源 Issue 正文开始；已有飞书详情文档时一起读取，需要补充实现决策时先在飞书中解决，再把 Issue 与详情材料收敛到本地冻结产物。Issue 可以来自任意平台，来源系统不改变阶段判断。

## 车道

- L1：不创建 Spec，直接实现和验证。
- L2：`brief.md → acceptance.feature → implementation → 自动验证快照 → 按需人工验收 → 质量审查 → release_ready`。
- L3：`brief.md → acceptance.feature → technical_design.md → implementation → 自动验证快照 → 按需人工验收 → 质量审查 → release_ready`。

## 使用

通常由 `brief-generator` 在首次处理 L2/L3 任务时自动初始化，用户不需要手动运行。调试或人工恢复流程时可以使用：

```bash
npm run spec -- init LCV-42 --lane L3 --source-issue <ISSUE_URL_OR_REF>
npm run spec -- init LCV-43 --lane L2 --source-issue <ISSUE_URL_OR_REF>
npm run spec -- init LCV-44 --lane L2
npm run spec -- status
npm run spec -- status LCV-42
npm run spec -- check LCV-42 acceptance
npm run spec -- freeze LCV-42 brief
npm run spec -- verify LCV-42 --run "npm run check"
npm run spec -- verify LCV-42 --run "npm run check" --manual-acceptance
npm run spec -- review LCV-42 --pass --evidence "未发现阻断问题"
npm run spec -- check LCV-42 release_ready
```

`init` 只创建 `.specs/<KEY>/state.yaml`，不生成业务产物、不修改外部 Issue，也不执行 Git 操作。已有状态不会被覆盖。

冻结会把产物 SHA-256 写入 `state.yaml`。冻结后修改文件会使下游检查失败；确认新版本后使用 `freeze --refreeze`，脚本会使受影响的下游状态失效。

最终验证由 `spec verify --run` 自己执行命令，不接受手填的“已通过”字符串。脚本自动记录命令、退出码、耗时、时间和当前可提交内容的 SHA-256；验证命令失败、改变了可提交内容，或之后代码再次变化时都不会保留可信验证状态。代码指纹按内容计算，因此仅创建内容相同的 Git commit 不会触发无意义的重跑。

验证成功后固定进入 `quality_review`，跨会话恢复会指向 `code-review-and-quality`，不会直接跳到 PR。只有审查没有阻断问题时，Agent 才自动运行 `spec review <KEY> --pass` 进入 `release_ready`。这些元数据都由工具维护，开发者不需要填写哈希、退出码、时间或状态字段。

旧版 `state.yaml` 会在读取时自动升级。旧的字符串验证证据会保留在 `legacy_evidence` 供追溯，但不会继续作为可信证明；任务会退回 `implementation`，由 Agent 自动重跑最终验证。

## 需求来源与实施偏差

来源 Issue 正文是初始需求输入，关联的飞书周开发文档、详情文档和用户明确确认的补充内容用于展开和确认实现前决策。Brief、Acceptance 和 Technical Design 是当前工作区的执行快照；冻结后仍由本地哈希门禁保证这些本地产物没有被静默修改。

`source_issue` 只原样保存一个完整链接或稳定引用，方便恢复上下文、PR 关联和人工追踪。状态中不拆分 `source.system`、`issue_id` 或 `workspace_id`，也不给 Multica、Linear、GitHub 或其他平台附加不同流程语义。工具不会访问外部 Issue 校验正文，不维护需求指纹、评论链、漂移状态或对账状态，也不会向任何 Issue 系统写回评论。

实施中出现不改变核心产品目标的必要偏差时，在 `implementation_report.md` 和 PR 中说明原方案、实际实现、原因、影响、验证和遗留风险。若偏差会改变范围、验收、权限、数据安全或兼容承诺，先回到飞书确认，再修订和重新冻结受影响的本地产物。

## 跨会话恢复

新会话先运行 `npm run spec -- status`。不带 KEY 时扫描当前工作区全部 Spec；每个可信的在途任务会显示车道、阶段、下一站 Skill、最小待读文件和本地阶段门禁。发现 `state.yaml` 结构错误、冻结文件缺失、规格或代码 SHA-256 漂移、人工验收变化，或阶段与产物不一致时返回非零，修复前不得继续。

已经进入 `release_ready` 的任务不再计入无参数查询的“在途”列表，避免历史任务持续制造选择负担；需要复查或发布时仍可用 `npm run spec -- status <KEY>` 精确查询。

有多个在途任务时必须由用户指定继续哪一个。`.specs/<KEY>/` 默认被 Git 忽略，因此该恢复能力覆盖同一工作区中的跨会话续做，不承诺跨设备或跨 worktree 自动复制本地产物；跨环境恢复时重新读取来源 Issue 和对应详情文档，并重新建立本地快照。

当 L2/L3 任务包含跨浏览器、跨服务、上传下载、PDF 或视觉行为，且现有自动化测试无法完整覆盖时，由 `manual-acceptance` 在 `.specs/<KEY>/manual_acceptance.md` 生成和记录人工端到端验收。最终运行 `spec verify --manual-acceptance` 时，脚本自动校验总体结论、统计、占位内容和文件哈希；仍有必要项未执行、失败或阻塞时不会进入质量审查。人工步骤执行后若相关代码或配置变化，受影响项必须恢复为未执行并重新验收；最终自动化快照不能代替较早的人工证据。L1 的同类检查只保留会话级记录，不创建 Spec。

具体 Issue 目录默认被 Git 忽略。仓库只长期保留本文；PR 中摘要人工验收结论，但不复制整份本地清单。产物模板由对应的 `.ai/skills/<skill>/` 管理，避免全局模板与 Skill 规则漂移。
