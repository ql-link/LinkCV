# 当前架构

## Monorepo 组成

| 模块 | 位置 | 当前职责 |
| --- | --- | --- |
| Web | `apps/web` | React 19、TypeScript、Vite 单页应用，承载用户工作区、公共分享和管理端界面 |
| Browser extension | `apps/extension` | WXT、React、TypeScript Chrome MV3 插件；读取当前 BOSS 详情页并提交确认后的采集字段 |
| WeChat miniprogram | `apps/miniprogram` | 原生小程序渠道，提供游客示例、主动登录、扫码确认、本人资料和简历只读浏览；详见 [小程序架构](miniprogram.md) |
| Backend | `apps/backend` | FastAPI 业务 API、内部 Agent 工具、Worker、SQLAlchemy 模型与 SQL-first Alembic 迁移 |
| Pi Agent service | `apps/pi-service` | 独立无头 Node 服务；运行 Pi Agent loop，并仅通过受控 HTTP 工具调用 FastAPI |
| Infrastructure | `deploy` | MySQL、Redis、MinIO、消息队列、可观测性依赖和 Dev/Production Jenkins、Compose 拓扑 |
| pi agent 工具包（第三方，一次性引入） | `third_party/pi` | Node/TypeScript AI agent 工具包和离线模型目录快照；由根级 Pi 安装、测试和检查脚本显式纳管，详见 [internals/third-party-pi.md](third-party-pi.md) |
| AI workflow | `.ai`、`.specs`、`scripts/quality` | 项目规则、以方案为中心的本地 Spec 和质量检查 |

长期文档分别提供[功能视图](../README.md#功能文档)和[架构视图](../README.md#架构文档)。功能域不等于部署单元：例如求职中心跨越 Web 与两个 FastAPI 包，小程序则作为独立客户端适配账号和简历功能。

## 本地请求路径

Web 页面统一请求相对 `/api` 路径。`apps/web/vite.config.mjs` 将全部 `/api` 流量代理到 FastAPI，默认目标为 `http://127.0.0.1:8000`。

同一 Vite 配置把 `@` 解析到 `apps/web/src`，与 TypeScript、Vitest 和 `components.json` 的路径约定一致；集中 UI 组件和 shadcn 生成源码使用该别名，不影响浏览器请求路径。

浏览器插件从独立的 `chrome-extension://` 源运行，默认通过 `http://127.0.0.1:5173` 或 `http://localhost:5173` 调用同一 Vite `/api` 代理，并携带用户已经在对应 Web 源站建立的 HttpOnly Cookie 会话。插件 Manifest 只声明 BOSS 站点、本地 LinkCV 源站和构建时显式配置的 LinkCV 源站权限；内容脚本不直接访问 LinkCV API。

FastAPI 在 `apps/backend/src/linkcv/main.py` 以 `/api` 前缀挂载浏览器路由，并在根路径挂载不出现在 OpenAPI 的 `/internal/agent` 服务间路由。智能助手请求由 FastAPI 写入 MySQL 后以服务 token 转发到独立 Pi 服务；Pi 再用另一枚 token 调用受控内部工具，浏览器不直接访问 Pi。Vite 为最长 180 秒的同步导入设置 190 秒代理预算，避免代理先于后端业务 deadline 关闭连接。PDF 和 DOCX 导入由 FastAPI 使用后端 Secret 直接访问 `http://100.86.10.52:18743/v1/parse`；浏览器不连接 LinkParse，Markdown 在 Worker 内本地转换。详细接口见 [HTTP 契约](../api/http-contracts.md)。

## 数据与鉴权

- MySQL 是用户、简历、Agent 会话/提案、结构化 JD 和治理数据的权威存储，表结构只通过 Alembic 迁移演进。各业务对象归属见对应[功能文档](../README.md#功能文档)。
- Web 登录态使用短 JWT access Cookie 与不透明 refresh Cookie；小程序使用 Bearer access 与 JSON refresh，Redis session channel 阻止两端凭据混用并支持统一撤销。小程序游客示例、主动登录、只读简历、预览缓存和本地调试安全回退见 [小程序架构](miniprogram.md)。
- 普通 Web 登录页由 `/api/auth/capabilities` 控制：Development 可使用邮箱密码或微信扫码，Production 只显示微信小程序码；管理员密码表单只存在于 `/admin/login`。
- 图片存储在私有 MinIO bucket 中；现有兼容资源位于 `users/<user-id>/assets/`，简历编辑器新增资源位于 `users/<user-id>/resumes/<resume-id>/assets/`，两者都由服务端生成对象键并在读取时校验所有权。
- 原型 Express/SQLite 数据不迁移到 MySQL。

## 配置真值

- FastAPI 读取 `BACKEND_HOST` 和 `BACKEND_PORT`，默认 `127.0.0.1:8000`。
- Vite 使用 `BACKEND_PORT` 构造默认代理目标，也允许 `BACKEND_PROXY_TARGET` 覆盖完整地址。
- Pi 服务默认监听 `127.0.0.1:8010`；FastAPI 与 Pi 使用相反方向的内网 URL 和两枚独立服务 token，不复用用户 Cookie。
- 数据库、JWT、MinIO 和 LinkParse 变量以 `.env.example` 为入口；本地依赖端口以 `deploy/docker-compose.yml` 为入口。LinkParse API Key 只进入被忽略的 `.local` 覆盖或进程环境。
