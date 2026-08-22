# LinkCV 项目文档

`docs/` 保存 LinkCV 当前已经实现的长期项目知识，供开发者、运维人员和 AI 按需调阅。代码与运行配置是事实源；文档负责解释模块职责、调用关系和稳定契约。

临时需求与交付产物不放在这里：方案文档、Acceptance、实施报告和人工验收记录属于 [`.specs/`](../.specs/README.md)。尚未实现的计划不得写成当前项目事实。

## 按任务阅读

| 任务 | 入口 |
| --- | --- |
| 理解整体架构 | [internals/architecture.md](internals/architecture.md) |
| 查找契约事实源和消费方 | [internals/contract-governance.md](internals/contract-governance.md) |
| 修改 React/Vite 前端 | [internals/web.md](internals/web.md) |
| 理解视觉语言或设计内部功能页面 | [`DESIGN.md`](../DESIGN.md) |
| 修改或侧载岗位采集插件 | [internals/extension.md](internals/extension.md) |
| 修改 FastAPI 后端 | [internals/backend.md](internals/backend.md) |
| 了解 third_party/pi 引入方式与对接约束 | [internals/third-party-pi.md](internals/third-party-pi.md) |
| 对接或修改 HTTP API | [api/http-contracts.md](api/http-contracts.md) |
| 配置本地开发环境 | [ops/development.md](ops/development.md) |
| 创建业务分支并完成 Dev 交付 | [ops/development.md#分支与发布流程](ops/development.md#分支与发布流程) |
| 编写或运行应用测试 | [ops/development.md#测试分层](ops/development.md#测试分层) |
| 理解当前构建与部署拓扑 | [ops/deployment.md](ops/deployment.md) |

## 目录职责

- `api/`：调用方可观察的接口、错误和数据契约。
- `internals/`：模块职责、内部调用关系、架构边界和扩展位置。
- `ops/`：运行配置、开发环境、构建、部署和回滚事实。

## 维护约定

- 一个事实只在一份文档中正式描述，其他文档用链接引用。
- 文档与代码冲突时，先核实真实运行行为，再修正文档；不能为了让文档成立而擅自改变代码。
- 模块、接口、配置或部署事实变化时，使用 `doc-maintenance-sync` 更新最小必要文档。
- `scripts/quality/doc-sync-rules.yaml` 保存机器可执行的代码到文档同步规则；不要在多个 Skill 中复制同一映射。
