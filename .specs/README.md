# LinkCV 本地 Spec 工作区

`.specs/<LCV-key>/` 用于 L2/L3 任务执行期间的阶段快照。Multica Issue 仍是长期需求、范围和验收标准的主记录；本目录不是第二套需求系统。

## 车道

- L1：不创建 Spec，直接实现和验证。
- L2：`brief.md → acceptance.feature → implementation → 自动化验证 → 按需人工验收 → verified`。
- L3：`brief.md → acceptance.feature → technical_design.md → implementation → 自动化验证 → 按需人工验收 → verified`。

## 使用

通常由 `brief-generator` 在首次处理 L2/L3 任务时自动初始化，用户不需要手动运行。调试或人工恢复流程时可以使用：

```bash
npm run spec -- init LCV-42 --lane L3 --source-system multica --issue-id <ISSUE_ID>
npm run spec -- init LCV-43 --lane L2 --source-system github --issue-id <ISSUE_ID>
npm run spec -- init LCV-44 --lane L2 --source-system manual
npm run spec -- status LCV-42
npm run spec -- check LCV-42 acceptance
npm run spec -- freeze LCV-42 brief
npm run spec -- verify LCV-42 --evidence "npm run check"
npm run spec -- verify LCV-42 --evidence "npm run check" --evidence "人工验收：.specs/LCV-42/manual_acceptance.md（通过）"
```

`init` 只创建 `.specs/<KEY>/state.yaml`，不生成业务产物、不修改外部 Issue，也不执行 Git 操作。已有状态不会被覆盖。

冻结会把产物 SHA-256 写入 `state.yaml`。冻结后修改文件会使下游检查失败；确认新版本后使用 `freeze --refreeze`，脚本会使受影响的下游状态失效。

当任务包含跨浏览器、跨服务、上传下载、PDF 或视觉行为，且现有自动化测试无法完整覆盖时，由 `manual-acceptance` 在 `.specs/<KEY>/manual_acceptance.md` 生成和记录人工端到端验收。该记录是验证证据，不是需要冻结的需求或设计输入；仍有必要项未执行、失败或阻塞时，不得运行 `spec verify` 标记完成。

具体 Issue 目录默认被 Git 忽略。仓库只长期保留本文；PR 中摘要人工验收结论，但不复制整份本地清单。产物模板由对应的 `.ai/skills/<skill>/` 管理，避免全局模板与 Skill 规则漂移。
