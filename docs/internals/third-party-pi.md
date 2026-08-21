# third_party/pi（pi agent 工具包）

## 现状事实

`third_party/pi` 是 [earendil-works/pi](https://github.com/earendil-works/pi)（Node/TypeScript AI agent 工具包：统一 LLM API、agent loop、TUI、coding-agent CLI）的一次性代码引入，通过：

```bash
git subtree add --prefix=third_party/pi https://github.com/earendil-works/pi.git main --squash
```

这是**一次性引入，不是持续跟踪上游的 vendoring**：当前导入的功能已满足需求，团队没有计划执行 `git subtree pull` 拉取上游后续更新。后续对 `third_party/pi` 内代码的修改直接作为 LinkCV 仓库自己的提交处理，等同于修改仓库内其他代码，不再区分"上游代码"和"本地补丁"。

已删除上游原有但与 LinkCV 无关的内容：`packages/coding-agent/examples/extensions/` 下的玩具/演示扩展（`doom-overlay`、`gondolin`、`snake.ts`、`tic-tac-toe.ts`、`space-invaders.ts`、`pirate.ts` 等纯 UI/游戏示例），以及 pi 自身的开源治理文档和 Windows 专用脚本（`CONTRIBUTING.md`、`SECURITY.md`、`tui-plan.md`、`pi-test.bat`、`pi-test.ps1`）。

## 构建隔离

`third_party/pi` 是完整独立的 npm workspaces monorepo（自带 `package.json`、`packages/*`、`biome.json`、`tsgo` 配置）。LinkCV 根目录 `package.json` 没有 `workspaces` 字段，逐个显式枚举 `apps/web`、`apps/extension`、`apps/backend`，因此 `third_party/pi` 不会被 `npm run dev`、`npm run check`、`npm run check:app` 等根脚本感知或纳管；在其中执行 npm 命令必须先 `cd third_party/pi`。

## 验证状态

- `cd third_party/pi && npm install`：已验证通过（333 个包）。
- `npm run build:offline`：`packages/tui`、`packages/telemetry` 构建成功。
- `packages/ai` 的构建依赖联网执行 `hydrate:model-data` 拉取 models.dev 的模型元数据；在无出网权限的环境下会在这一步失败。**这一步尚未在有正常外网的环境中验证通过**，接入前需要在联网环境重新执行 `npm run hydrate:model-data && npm run build:offline` 确认。
- `packages/agent`、`packages/session-backends`、`packages/protocol`、`packages/client`、`packages/server`、`packages/coding-agent` 依赖 `packages/ai` 的构建产物，尚未继续验证。
- pi 源码中未发现内置的 MCP client/server 支持（协议、client、server 三个包内搜索确认），与 LinkCV 后端对接不走 MCP 协议。

## 对接约束（尚未实现，未来对接时必须遵守）

以下是 LinkCV 后端与 `third_party/pi` 对接时已确定的架构原则，用于约束未来的实现，**当前没有任何代码落地**：不存在任何具体的 `AgentTool`、`/internal/agent/*` 接口或独立的集成服务应用。

- **业务逻辑不迁移。** LinkCV 现有的 Python 业务能力（例如 AI 改简历相关能力）不得移植成 TypeScript 塞进 `third_party/pi`。真正的业务逻辑、数据库读写、鉴权始终留在 `apps/backend`（FastAPI/Python）。
- **pi 只做编排，通过工具桥接调用后端。** pi 侧以自定义 `AgentTool`（接口定义见 `third_party/pi/packages/agent/src/types.ts`，`execute()` 是普通异步函数）实现，`execute()` 内部通过 HTTP 请求调用 FastAPI 新增的**内部专用接口**，由 Python 侧执行实际业务逻辑并返回结果。
- **内部接口使用服务间鉴权，不复用用户 session cookie。** 面向 pi 调用的内部接口必须使用独立的服务间鉴权机制（如固定 token），避免复用现有面向浏览器的用户 Cookie 鉴权，防止内部接口成为无鉴权后门。
- **不使用 MCP 协议对接**（pi 未内置支持，见上文验证状态）。

以下集成细节尚未决策，实现时需要先确认，不得默认某一种：

- 调用方向：是用户在 pi 的 TUI/CLI 中主动触发调用 LinkCV 后端，还是 LinkCV 后端把 pi 当作无头 worker 调用；
- 集成层的落点：是否需要新增独立应用（例如 `apps/pi-service`）承载"如何启动 pi、暴露什么接口"的胶水代码，以及该应用是否要被根级 `npm run dev`/`check` 纳管。
