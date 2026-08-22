# third_party/pi（pi agent 工具包）

## 现状事实

`third_party/pi` 是 [earendil-works/pi](https://github.com/earendil-works/pi)（Node/TypeScript AI agent 工具包：统一 LLM API、agent loop、TUI、coding-agent CLI）的一次性代码引入，通过：

```bash
git subtree add --prefix=third_party/pi https://github.com/earendil-works/pi.git main --squash
```

这是**一次性引入，不是持续跟踪上游的 vendoring**：当前导入的功能已满足需求，团队没有计划执行 `git subtree pull` 拉取上游后续更新。后续对 `third_party/pi` 内代码的修改直接作为 LinkCV 仓库自己的提交处理，等同于修改仓库内其他代码，不再区分"上游代码"和"本地补丁"。

已删除上游原有但与 LinkCV 无关的内容：`packages/coding-agent/examples/extensions/` 下的玩具/演示扩展（`doom-overlay`、`gondolin`、`snake.ts`、`tic-tac-toe.ts`、`space-invaders.ts`、`pirate.ts` 等纯 UI/游戏示例），以及 pi 自身的开源治理文档和 Windows 专用脚本（`CONTRIBUTING.md`、`SECURITY.md`、`tui-plan.md`、`pi-test.bat`、`pi-test.ps1`）。

## 构建与 LinkCV 适配层

`third_party/pi` 仍是独立的 npm workspaces monorepo。LinkCV 一期适配层位于 `apps/pi-service`，不修改 Pi 核心源码，直接复用 vendored `Agent`、OpenAI-compatible provider、模型目录、事件流和参数校验源码，并只映射这些模块实际需要的 `pi-ai` 运行时。LinkCV 将经过 Pi manifest 校验的生成模型目录作为版本化快照保存在 `third_party/pi/packages/ai/src/providers/data/`；根级 `sync`、CI 和 Docker 只执行 `check:model-data`，因此常规安装与发布不依赖 `models.dev`、OpenRouter、NVIDIA NIM 或 Vercel AI Gateway 的实时可达性。只有主动执行 `npm run refresh:pi-model-data` 时才联网刷新快照，刷新后必须将模型分片与 `.manifest.json` 一并评审和提交。`dev`、`typecheck`、`build` 和 `test` 已纳管 Pi Service。

## 验证状态

- `npm ci --prefix third_party/pi` 已验证通过。
- Pi 完整模型数据 hydrate、`packages/ai build:offline` 与 `packages/agent build` 已验证通过；hydrate 是新环境 `npm run setup`、CI 和镜像构建的显式前置，不要求每次启动开发服务时重复执行。
- `apps/pi-service` 的固定 probe Tool 测试、TypeScript 类型检查和 bundle 构建已验证；测试确认 DeepSeek 与 DashScope 解析到对应 Pi profile，请求级 API Key 只传给原生 provider，并由 `Agent` 执行 Tool。
- pi 源码中未发现内置的 MCP client/server 支持（协议、client、server 三个包内搜索确认），与 LinkCV 后端对接不走 MCP 协议。

## 当前 LinkCV 接入状态（一期技术验证）

`apps/pi-service` 提供管理端专用的无头 probe Run。管理员绑定 `pi_agent` 时，FastAPI 保存候选配置版本快照、创建调用记录并在请求期解密凭据，然后通过受 `PI_SERVICE_TOKEN` 保护的 `POST /internal/probes` 发送 adapter、模型名、API 地址和 API Key。Pi Service 从 vendored 模型目录选择受控 profile，只覆盖管理员配置的模型名和地址，再使用 Pi 原生 provider 直连供应商；模型必须调用固定、无副作用的 `probe` Tool，成功后才产生验证证据并切换 binding。

一期只验证模型直连、Pi profile 和 Tool Call。当前只支持 DeepSeek 与 DashScope 的受控 OpenAI-compatible profile；未知模型复用对应供应商 profile，无法识别的 adapter 会在发送供应商请求前拒绝。当前没有用户侧 Agent 页面、业务 Tool、持久化 Run/会话/记忆、审批或恢复机制。

## 对接约束

- **业务逻辑不迁移。** LinkCV 现有的 Python 业务能力（例如 AI 改简历相关能力）不得移植成 TypeScript 塞进 `third_party/pi`。真正的业务逻辑、数据库读写、鉴权始终留在 `apps/backend`（FastAPI/Python）。
- **pi 只做模型执行与编排，业务工具仍桥接后端。** pi 侧以自定义 `AgentTool`（接口定义见 `third_party/pi/packages/agent/src/types.ts`，`execute()` 是普通异步函数）实现；一期 probe 是 Pi Service 本地的固定无副作用工具，后续业务 Tool 必须通过内部专用接口调用 FastAPI，由 Python 侧执行真实业务逻辑和权限校验。模型生成流由 Pi 原生 provider 直连供应商，供应商 API Key 只在 FastAPI 加密存储，并在受鉴权的单次 Pi 请求内存中短暂出现。
- **内部接口使用服务间鉴权，不复用用户 session cookie。** FastAPI 到 Pi Service 的调用使用独立 Bearer token；后续 Pi Tool 回调 FastAPI 时也必须使用独立服务身份，避免内部接口成为无鉴权后门。含凭据的请求正文禁止记录、回显或持久化。当前远端部署只在未发布端口的同主机 Docker 网络内传输；若 Pi Service 以后跨主机部署，必须增加 TLS。
- **不使用 MCP 协议对接**（pi 未内置支持，见上文验证状态）。

当前已选择 FastAPI 主动调用无头 Pi Service；二期如果增加用户 Run，仍需单独设计持久化、权限、Tool 白名单、取消与恢复协议。
