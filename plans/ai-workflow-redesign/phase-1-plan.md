# 第一批改造计划：最小跨会话 Change（已暂停候选）

> 状态：已暂停，不得据此开始代码实施。复杂度复核确认本方案会在现有 Spec 之外增加第二套任务身份、状态和命令；随后发现 `.specs + .worktreeinclude` 已能以更低成本覆盖新建本地 Codex 托管 worktree 的初始恢复。本文件仅保留为被否决方向的取证材料。

## 1. 这一批交付什么

交付一个最小闭环：

```text
创建跨会话任务
→ 自动生成一份当前 change.md 和机器状态
→ AI 更新目标、进度和下一步
→ 新会话根据当前分支恢复
→ 核对 Git 与真实代码后继续
```

完成后能够解决：

- 没有 Issue 或飞书时也能建立可恢复任务；
- 直接实施任务不再只能依赖聊天记录；
- 新会话不用重新生成整份方案；
- 提交并共享分支后，可以在其他 worktree 或设备恢复；
- 多个活动任务不会被系统静默猜错。

这一批不宣称已经解决验证证据复用、自然续改或完整交付状态。

## 2. 为什么先做这个，而不是先做 `amend`

当前 `flow_guard.py` 只管理被 Git 忽略的 `.specs/<KEY>/`，并且状态结构绑定方案、验收、实现、质量审查和 `release_ready`。先在旧状态里增加 `amend` 会产生三个问题：

1. 只能帮助方案先行任务，直接实施和调查任务仍然没有通用身份；
2. 后续引入 Git 管理的 Change 时，还要再次迁移检查点、命令和 Skill；
3. 活动记录一旦受 Git 管理，现有整仓代码指纹会把记录更新也当成代码变化，需要先划清边界。

因此第一批只前移阶段 2 中的“最小 Change 骨架”，不把 Tasks、Design、风险路由和外部同步一起前移。检查点和 `amend` 紧随其后实施。

## 3. 第一版文件结构

正式实现候选结构：

```text
changes/
  README.md
  <稳定编号>/
    change.md
    state.yaml
```

- `change.md`：AI 和人都能直接阅读的当前有效记录；
- `state.yaml`：工具维护任务身份、分支、基线提交、结构版本和时间，人不手填；
- `tasks.md`、`design.md`、`decisions.md`、人工验收和证据文件本批不自动创建。

`change.md` 的最小内容：

- 目标；
- 明确不做；
- 完成标准；
- 范围和约束；
- 风险及原因；
- 已确认决定和待确认问题；
- 已完成、阻塞和唯一下一步；
- 来源、分支和相关链接。

## 4. 第一版命令

候选入口：

```bash
npm run change -- init <ID> --title <标题> [--source <引用>]
npm run change -- status [ID]
```

### `init`

- 校验稳定编号；
- 拒绝覆盖已有目录；
- 创建且只创建 `change.md` 和 `state.yaml`；
- 记录当前分支和基线提交；
- 不要求外部 Issue；
- 不创建空的 Tasks、Design 或 Acceptance。

### `status`

- 先核对仓库、分支和 Git 状态；
- 指定 ID 时恢复该任务；未指定时优先匹配当前分支；
- 多个任务无法可靠区分时要求选择，不自行猜测；
- 检查主记录存在、必要章节完整、状态结构有效、记录分支与当前分支一致；
- 输出一屏摘要：目标、风险、当前进度、阻塞、唯一下一步和待读文件；
- 有未提交内容时明确说明只能保证同一 worktree 恢复；
- 不把“记录可读取”描述成“代码已经验证”。

第一批不单独增加 `resume` 命令，`status` 就是恢复入口；也不增加 `close`、`checkpoint` 和 `amend`，避免在检查点数据契约确定前制造半套历史。

## 5. 预计修改的正式文件

| 文件 | 改动 |
| --- | --- |
| `changes/README.md` | 说明活动记录职责、创建条件、恢复和收尾边界 |
| `scripts/change/change_guard.py` | 实现 `init`、`status` 和结构校验 |
| `scripts/change/change.template.md` | 保存唯一的最小主记录模板 |
| `package.json` | 增加 `npm run change -- ...` 入口 |
| `apps/backend/tests/tooling/test_change_workflow.py` | 新增通用 Change 工具测试 |
| `scripts/spec/flow_guard.py` | 仅做兼容调整：旧 Spec 的代码指纹不把 `changes/<ID>/` 活动记录当作产品代码，但仍检查永久的 `changes/README.md` |
| `apps/backend/tests/tooling/test_ai_workflow.py` | 增加上述兼容回归测试，其他旧测试保持通过 |
| `.ai/prompts/project.md`、`.ai/skills/README.md` | 行为实际落地后增加最短入口和兼容期说明 |

如果实施时发现不需要修改某个文件，就不为了对齐清单制造空改动。

## 6. 与旧流程如何共存

- `.specs` 和 schema v7 本批保持原样，不迁移、不双写；
- 已存在 `.specs` 的任务继续按旧流程完成，第一批不同时创建 Change；
- 新 Change 先用于明确需要跨会话、但没有 `.specs` 的任务和显式试点；
- `flow-router`、三条现有路径和所有高风险底线不改变；
- 第一批不把 `change.md` 当成新的验证契约，因此活动记录更新不能冒充代码或验收已经变化；
- 下一批确定检查点结构后，再把旧 Spec 和通用 Change 收敛到一套身份与证据模型。

## 7. 自动化验收

至少覆盖以下情况：

1. 没有 Issue 也能初始化；
2. 初始化只创建最小两个文件；
3. 重复 ID 不覆盖已有内容；
4. 缺少章节、状态损坏或目录 ID 不一致时明确失败；
5. 指定 ID 可以恢复；当前分支只有一个匹配任务时可以自动找到；
6. 多个匹配任务时要求选择；
7. 分支不一致时不能静默继续；
8. 本地有未提交内容时不声称可以跨设备恢复；
9. 形成提交并在另一个 worktree 读取时能得到相同目标和下一步；
10. 修改活动 `change.md` 不会让无关旧 Spec 的代码验证自我失效；
11. 当前 schema v7、Spec 路径和现有测试全部继续通过。

## 8. 验证命令

实施阶段至少运行：

```bash
uv run --directory apps/backend pytest tests/tooling/test_change_workflow.py tests/tooling/test_ai_workflow.py -q
npm run check:ai
git diff --check
```

准备提交或 PR 前运行完整：

```bash
npm run check
```

## 9. 本批明确不做

- 不自动判断直接实施、计划实施和调查先行；
- 不自动执行常规或严格风险路由；
- 不实现 `amend` 和历史检查点；
- 不做按模块复用验证证据；
- 不创建或同步 Issue、飞书；
- 不迁移或删除 `.specs`；
- 不自动生成 Tasks、Design 或 Acceptance；
- 不修改业务代码、数据库和部署；
- 不修改共享 CI。

## 10. 完成条件和回退

完成条件：新任务能够从任意来源建立最小记录，新会话能够稳定恢复，旧流程无回归，项目入口准确描述真实能力。

如果试点失败，可以删除新命令、脚本、模板和 `changes/README.md`，恢复旧代码指纹逻辑。由于本批不迁移 `.specs`、不改业务数据，也不写外部系统，回退不需要转换历史任务。
