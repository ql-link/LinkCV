# LinkCV 本地 Spec 工作区

`.specs/<LCV-key>/` 用于 L2/L3 任务执行期间的阶段快照。Multica Issue 仍是长期需求、范围和验收标准的主记录；本目录不是第二套需求系统。

## 车道

- L1：不创建 Spec，直接实现和验证。
- L2：`brief.md → acceptance.feature → implementation → 自动验证快照 → 按需人工验收 → 质量审查 → release_ready`。
- L3：`brief.md → acceptance.feature → technical_design.md → implementation → 自动验证快照 → 按需人工验收 → 质量审查 → release_ready`。

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
npm run spec:source -- reconcile LCV-42 --no-change
# 仅在用户确认具体业务差异后，由 Agent 使用临时文件执行：
npm run spec:source -- sync-comment LCV-42 \
  --change-file .specs/LCV-42/requirement-change.tmp.md --confirmed-by-user
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

## Multica 权威需求与漂移门禁

Multica 来源在每个关键阶段先运行 `npm run spec:source -- check <KEY> --gate <GATE>`。可用 gate 为 `brief`、`acceptance`、`technical_design`、`implementation`、`verification` 和 `release`。除下面的显式 `sync-comment` 外，脚本只读取 Issue，不改字段、不切换状态。

首次 `capture` 保存权威需求指纹：Issue 标识、标题、描述，以及所有有效的 `LinkCV 已确认需求变更` 顶层结构化评论。普通评论、回复线程和机器人讨论被忽略；没有结构化评论的旧任务仍得到原正文指纹。负责人、状态、标签等元数据变化只刷新检查时间，不会误判为需求变化；正文或结构化评论链变化会使 Brief 及全部下游冻结状态失效并退回 `brief`。重新读取需求、修订 Brief 后，使用 `accept <KEY> --gate brief` 明确采用当前权威需求作为新基线。

Brief 冻结前必须完成对账。没有实质差异时，Agent 运行 `reconcile <KEY> --no-change`；存在新增、修改、删除的范围或验收要求时，Agent 先让用户只审业务差异，确认后再运行 `sync-comment --confirmed-by-user`。临时输入的第一段是给开发者和审核员快速阅读的概述，后续才列具体业务变化；工具将评论固定排成“概述 → 具体变化 → 工具记录”，并在写后重新读取 Multica 验证其已进入需求指纹。原需求指纹、变更 ID、评论 ID、内容哈希、时间和 `supersedes` 替代关系均由工具维护，开发者无需填写或理解 `state.yaml` 字段。

结构化评论不可编辑。纠错时使用 `--correct-latest` 追加一条新评论；工具自动选择最近一条当前有效评论并生成替代关系，不接收原始评论 ID。历史仍可审计；没有有效评论、格式损坏、标识重复、替代未知或已失效评论、写后无法核验都会失败关闭门禁。每条评论中的原需求指纹记录“确认这次差异时所依据的权威需求版本”；整体指纹则由当前 Issue 正文和归一化的结构化评论记录共同生成，因此后续正文变化仍会触发漂移，但不会让旧评论变成无法恢复的死链。

写评论前，工具先保存带变更 ID 的 `syncing` 意图。写入可能成功但复核失败时，后续 `sync-comment` 会被拒绝，Agent 使用 `recover-comment <KEY>` 只读恢复，不会重复追加；只有反复核验并确认评论确实不存在后，才可用 `abandon-sync <KEY> --confirmed-comment-absent` 清除意图。异常恢复所需标识仍由工具维护。GitHub Issue 不参与这套需求回写。

Multica CLI 不可用、认证失效、对象无权访问或网络失败时，命令返回非零且不更新核验 gate。恢复连接后重试原命令；不要用旧缓存声称需求未变化。

## 跨会话恢复

新会话先运行 `npm run spec -- status`。不带 KEY 时扫描当前工作区全部 Spec；每个可信的在途任务会显示车道、阶段、下一站 Skill、最小待读文件、阶段门禁和 Multica 核验命令。发现 `state.yaml` 结构错误、冻结文件缺失、规格或代码 SHA-256 漂移、人工验收变化，或阶段与产物不一致时返回非零，修复前不得继续。

已经进入 `release_ready` 的任务不再计入无参数查询的“在途”列表，避免历史任务持续制造选择负担；需要复查或发布时仍可用 `npm run spec -- status <KEY>` 精确查询。

有多个在途任务时必须由用户指定继续哪一个。`.specs/<KEY>/` 默认被 Git 忽略，因此该恢复能力覆盖同一工作区中的跨会话续做，不承诺跨设备或跨 worktree 自动复制本地产物；长期需求仍从 Multica 恢复。

当任务包含跨浏览器、跨服务、上传下载、PDF 或视觉行为，且现有自动化测试无法完整覆盖时，由 `manual-acceptance` 在 `.specs/<KEY>/manual_acceptance.md` 生成和记录人工端到端验收。最终运行 `spec verify --manual-acceptance` 时，脚本自动校验总体结论、统计、占位内容和文件哈希；仍有必要项未执行、失败或阻塞时不会进入质量审查。

具体 Issue 目录默认被 Git 忽略。仓库只长期保留本文；PR 中摘要人工验收结论，但不复制整份本地清单。产物模板由对应的 `.ai/skills/<skill>/` 管理，避免全局模板与 Skill 规则漂移。
