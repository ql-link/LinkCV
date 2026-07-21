# LinkCV 项目技能

`.ai/skills/` 是项目技能的唯一来源。Codex 从 `.agents/skills` 发现这些技能，Claude 从 `.claude/skills` 发现同一份内容。

| 技能 | 职责 | 下一站 |
| --- | --- | --- |
| `flow-router` | 判断 L1/L2/L3 并识别阻塞性决策 | 盘问、需求简报或实现 |
| `decision-grilling` | 沿决策树一次收敛一个真实选择 | 返回调用它的需求或设计技能 |
| `brief-generator` | 收敛范围、边界与风险 | 验收契约 |
| `acceptance-generator` | 生成可验证行为场景 | L2 实现；L3 技术设计 |
| `technical-design` | 生成跨模块技术方案 | 实现 |
| `implementation-execution` | 按冻结规格编码 | 测试 |
| `run-all-tests` | 按改动范围验证 | 质量审查 |
| `code-review-and-quality` | 审查正确性、契约与风险 | PR 收口 |
| `branch-pr-workflow` | 安全准备分支、提交和 PR | 用户审核 |

运行 `npm run check:ai` 校验技能的头部元数据、占位内容、链接和过期技术栈引用。

固定结构的产物模板跟随所属技能保存：需求简报、验收契约、技术设计和按需生成的实施报告分别由对应技能维护。`agents/openai.yaml` 仅在需要 Codex 界面展示元数据时按需添加，不是项目技能的必需文件。

需求简报和技术设计初稿都是一致性探针：发现新分歧时转 `decision-grilling`，事实由 Agent 自行核实，真实决策按依赖顺序每轮只询问一个；结论回写原章节并重新扫描，阻塞项清空且用户确认后才允许冻结。
