# LinkCV 本地 Spec 工作区

`.specs/<LCV-key>/` 用于 L2/L3 任务执行期间的阶段快照。Multica Issue 仍是长期需求、范围和验收标准的主记录；本目录不是第二套需求系统。

## 车道

- L1：不创建 Spec，直接实现和验证。
- L2：`brief.md → acceptance.feature → implementation → 自动化验证 → 按需人工验收 → verified`。
- L3：`brief.md → acceptance.feature → technical_design.md → implementation → 自动化验证 → 按需人工验收 → verified`。

## 使用

通常由 `brief-generator` 在首次处理 L2/L3 任务时自动初始化，用户不需要手动运行。调试或人工恢复流程时可以使用：

```bash
npm run spec -- init LCV-42 --lane L3 --source-system multica \
  --issue-id <ISSUE_UUID> --workspace-id <WORKSPACE_UUID>
npm run spec:source -- capture LCV-42 --gate brief
npm run spec -- init LCV-43 --lane L2 --source-system github --issue-id <ISSUE_ID>
npm run spec -- init LCV-44 --lane L2 --source-system manual
npm run spec -- status
npm run spec -- status LCV-42
npm run spec:source -- check LCV-42 --gate acceptance
npm run spec -- check LCV-42 acceptance
npm run spec -- freeze LCV-42 brief
npm run spec -- verify LCV-42 --evidence "npm run check"
npm run spec -- verify LCV-42 --evidence "npm run check" --evidence "人工验收：.specs/LCV-42/manual_acceptance.md（通过）"
```

`init` 只创建 `.specs/<KEY>/state.yaml`，不生成业务产物、不修改外部 Issue，也不执行 Git 操作。已有状态不会被覆盖。

冻结会把产物 SHA-256 写入 `state.yaml`。冻结后修改文件会使下游检查失败；确认新版本后使用 `freeze --refreeze`，脚本会使受影响的下游状态失效。

## Multica 需求漂移门禁

Multica 来源在每个关键阶段先运行 `npm run spec:source -- check <KEY> --gate <GATE>`。可用 gate 为 `brief`、`acceptance`、`technical_design`、`implementation`、`verification` 和 `release`。脚本只读取 Issue，不评论、不改字段、不切换状态。

首次 `capture` 保存由 Issue 标识、标题和描述生成的需求指纹，同时单独记录 `updated_at`。因此负责人、状态、标签或其他元数据变化只会刷新检查时间，不会误判为需求变化；标题或描述变化会使 Brief 及全部下游冻结状态失效并退回 `brief`。评论线程不进入机器指纹，因为讨论、机器人消息和正式范围无法可靠自动区分；会改变范围或验收的评论应先整理进 Issue 描述。重新读取 Issue、修订 Brief 后，使用 `accept <KEY> --gate brief` 明确采用当前正文作为新基线，但仍须用户确认范围后才能重新冻结。

Multica CLI 不可用、认证失效、对象无权访问或网络失败时，命令返回非零且不更新核验 gate。恢复连接后重试原命令；不要用旧缓存声称需求未变化。

## 跨会话恢复

新会话先运行 `npm run spec -- status`。不带 KEY 时扫描当前工作区全部 Spec；每个可信的在途任务会显示车道、阶段、下一站 Skill、最小待读文件、阶段门禁和 Multica 核验命令。发现 `state.yaml` 结构错误、冻结文件缺失、SHA-256 漂移或阶段与产物不一致时返回非零，修复前不得继续。

有多个在途任务时必须由用户指定继续哪一个。`.specs/<KEY>/` 默认被 Git 忽略，因此该恢复能力覆盖同一工作区中的跨会话续做，不承诺跨设备或跨 worktree 自动复制本地产物；长期需求仍从 Multica 恢复。

当任务包含跨浏览器、跨服务、上传下载、PDF 或视觉行为，且现有自动化测试无法完整覆盖时，由 `manual-acceptance` 在 `.specs/<KEY>/manual_acceptance.md` 生成和记录人工端到端验收。该记录是验证证据，不是需要冻结的需求或设计输入；仍有必要项未执行、失败或阻塞时，不得运行 `spec verify` 标记完成。

具体 Issue 目录默认被 Git 忽略。仓库只长期保留本文；PR 中摘要人工验收结论，但不复制整份本地清单。产物模板由对应的 `.ai/skills/<skill>/` 管理，避免全局模板与 Skill 规则漂移。
