# LinkCV 项目文档

`docs/` 保存 LinkCV 当前已经实现的长期项目知识，供开发者、运维人员和 AI 按需调阅。代码与运行配置是事实源；文档负责解释模块职责、调用关系和稳定契约。

临时需求与交付产物不放在这里：方案文档、Acceptance、实施报告和人工验收记录属于 [`.specs/`](../.specs/README.md)。尚未实现的计划不得写成当前项目事实。

## 按任务阅读

| 任务 | 入口 |
| --- | --- |
| 理解整体架构 | [internals/architecture.md](internals/architecture.md) |
| 按用户功能理解业务规则 | [功能文档](#功能文档) |
| 按技术架构定位运行组件 | [架构文档](#架构文档) |
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

## 功能文档

功能文档从用户能力和业务聚合出发，回答“能做什么、核心对象是什么、必须遵守哪些规则”。它们不重复进程拓扑、配置值或完整 HTTP schema。

| 功能域 | 文档 | 主要用户入口 |
| --- | --- | --- |
| 账号与身份 | [features/identity-account.md](features/identity-account.md) | 登录、注册、微信、用户中心、管理员用户管理 |
| 简历与工作台 | [features/resume-workbench.md](features/resume-workbench.md) | 简历、编辑器、模板、版本、分享、PDF |
| 求职中心 | [features/career-center.md](features/career-center.md) | 求职记录、岗位导入、排期、记录内复盘 |
| AI 求职助手 | [features/ai-assistant.md](features/ai-assistant.md) | 独立助手、编辑器侧栏、提案确认 |
| 用户资料集 | [features/datasets.md](features/datasets.md) | 资料上传、解析状态、预览、助手引用 |

## 架构文档

架构文档从部署单元、客户端渠道、运行时和基础设施出发，回答“由哪些组件组成、如何调用、数据与外部依赖在哪里”。

| 架构域 | 文档 | 主要代码或配置 |
| --- | --- | --- |
| 整体架构 | [internals/architecture.md](internals/architecture.md) | Monorepo、请求路径、数据和配置真值 |
| Web 客户端 | [internals/web.md](internals/web.md) | `apps/web` |
| FastAPI 与 Worker | [internals/backend.md](internals/backend.md) | `apps/backend` |
| 微信小程序 | [internals/miniprogram.md](internals/miniprogram.md) | `apps/miniprogram`、后端渠道适配 |
| 浏览器采集插件 | [internals/extension.md](internals/extension.md) | `apps/extension` |
| Agent 与统一 LLM 运行时 | [internals/agent-runtime.md](internals/agent-runtime.md) | `modules/agent`、`modules/llm`、`apps/pi-service` |
| 第三方 Pi 工具包 | [internals/third-party-pi.md](internals/third-party-pi.md) | `third_party/pi` |
| 可观测性与业务审计 | [internals/observability.md](internals/observability.md) | `modules/observability`、Promtail、Loki |
| 浏览器插件制品 | [internals/plugin-delivery.md](internals/plugin-delivery.md) | `modules/plugin_releases`、MinIO 发布指针 |
| 构建与部署 | [ops/deployment.md](ops/deployment.md) | Docker、Compose、Jenkins |

## 目录职责

- `api/`：调用方可观察的接口、错误和数据契约。
- `features/`：用户能力、业务聚合、核心规则和功能依赖。
- `internals/`：客户端、服务、运行时、调用关系和架构边界。
- `ops/`：运行配置、开发环境、构建、部署和回滚事实。

## 维护约定

- 一个事实只在一份文档中正式描述，其他文档用链接引用。
- 文档与代码冲突时，先核实真实运行行为，再修正文档；不能为了让文档成立而擅自改变代码。
- 模块、接口、配置或部署事实变化时，使用 `doc-maintenance-sync` 更新最小必要文档。
- `scripts/quality/doc-sync-rules.yaml` 保存机器可执行的代码到文档同步规则；不要在多个 Skill 中复制同一映射。
