# 当前架构

## Monorepo 组成

| 模块 | 位置 | 当前职责 |
| --- | --- | --- |
| Web | `apps/web` | React 19、TypeScript、Vite 前端，以及简历和临时 JD 管理页面 |
| Browser extension | `apps/extension` | WXT、React、TypeScript Chrome MV3 插件；读取当前 BOSS 详情页并提交确认后的采集字段 |
| WeChat miniprogram | `apps/miniprogram` | 原生小程序，界面采用与 Web 内部功能区同源 `--ui-*` Token 的小屏简洁单列布局；冷启动进入游客可浏览的首页，登录由用户主动进入登录页并确认平台隐私保护指引后完成，可随时暂不登录返回；扫码进入独立确认页确认或取消网页登录，登录后以紧凑列表只读查看本人简历并以智能一页图片阅读详情 |
| Backend | `apps/backend` | FastAPI、JWT/Redis 鉴权、简历与 JD API、MinIO 图片接口、SQLAlchemy 模型和 Alembic 迁移 |
| Infrastructure | `deploy` | MySQL、Redis、MinIO 本地依赖和 Dev/Production Jenkins、Compose 拓扑 |
| pi agent 工具包（第三方，一次性引入） | `third_party/pi` | Node/TypeScript AI agent 工具包，独立 npm workspace，不被根级脚本纳管；引入方式、验证状态与对接约束见 [internals/third-party-pi.md](third-party-pi.md) |
| AI workflow | `.ai`、`.specs`、`scripts/quality` | 项目规则、以方案为中心的本地 Spec 和质量检查 |

## 本地请求路径

Web 页面统一请求相对 `/api` 路径。`apps/web/vite.config.mjs` 将全部 `/api` 流量代理到 FastAPI，默认目标为 `http://127.0.0.1:8000`。

同一 Vite 配置把 `@` 解析到 `apps/web/src`，与 TypeScript、Vitest 和 `components.json` 的路径约定一致；集中 UI 组件和 shadcn 生成源码使用该别名，不影响浏览器请求路径。

浏览器插件从独立的 `chrome-extension://` 源运行，默认通过 `http://127.0.0.1:5173` 或 `http://localhost:5173` 调用同一 Vite `/api` 代理，并携带用户已经在对应 Web 源站建立的 HttpOnly Cookie 会话。插件 Manifest 只声明 BOSS 站点、本地 LinkCV 源站和构建时显式配置的 LinkCV 源站权限；内容脚本不直接访问 LinkCV API。

FastAPI 在 `apps/backend/src/linkcv/main.py` 以 `/api` 前缀挂载路由。Vite 为最长 180 秒的同步导入设置 190 秒代理预算，避免代理先于后端业务 deadline 关闭连接。PDF 和 DOCX 导入由 FastAPI 使用后端 Secret 直接访问 `http://100.86.10.52:18743/v1/parse`；浏览器不连接 LinkParse，Markdown 在 Worker 内本地转换。详细接口见 [HTTP 契约](../api/http-contracts.md)。

## 数据与鉴权

- MySQL 是用户、简历、结构化 JD 和治理数据的权威存储，表结构只通过 Alembic 迁移演进。
- Web 登录态使用短 JWT access Cookie 与不透明 refresh Cookie；小程序使用 Bearer access 与 JSON refresh。Redis session 的 channel 阻止两端凭据混用并支持统一撤销；小程序 Bearer 只能访问 `/api/miniprogram/resumes*` 专用只读接口。小程序冷启动落在游客首页，该页不发起任何账号识别、登录或隐私授权请求；登录页只能由用户从首页或“我的简历”引导态主动进入，进入后才以当前微信临时 code 只读判断账号是否存在，分别展示登录或注册动作；该探测不建号、不发 session。客户端在取得新会话前要求用户勾选微信平台隐私保护指引并主动确认，可暂不登录返回游客状态，不能从简历页或请求重试路径静默建号；后端对未知 openid 还要求本次请求携带 `privacy_accepted=true`，但不把该请求字段当作持久化的同意审计记录。
- 小程序简历详情先查询最新手动版本（缺失时初始版本），本机不存在同版本文件时从 FastAPI 下载由共享 React-PDF 核心生成并经 PDFium 栅格化的智能一页 PNG，保存到 `wx.env.USER_DATA_PATH` 后用小程序 `<image mode="widthFix">` 在当前详情页阅读；服务端不保存 PDF 或 PNG 成品。退出、会话失效或账号切换会清理本地索引和文件。
- 普通 Web 登录页由 `/api/auth/capabilities` 控制：Development 可使用邮箱密码或微信扫码，Production 只显示微信小程序码；管理员密码表单只存在于 `/admin/login`。小程序 `develop` 默认访问本机 API 8000 端口并允许开发者工具覆盖内网地址；`trial/release` 固定访问 `https://linkresume.cn`，第三方平台扩展配置可覆盖但必须使用 HTTPS。
- 图片存储在私有 MinIO bucket 中；现有兼容资源位于 `users/<user-id>/assets/`，简历编辑器新增资源位于 `users/<user-id>/resumes/<resume-id>/assets/`，两者都由服务端生成对象键并在读取时校验所有权。
- 原型 Express/SQLite 数据不迁移到 MySQL。

## 配置真值

- FastAPI 读取 `BACKEND_HOST` 和 `BACKEND_PORT`，默认 `127.0.0.1:8000`。
- Vite 使用 `BACKEND_PORT` 构造默认代理目标，也允许 `BACKEND_PROXY_TARGET` 覆盖完整地址。
- 数据库、JWT、MinIO 和 LinkParse 变量以 `.env.example` 为入口；本地依赖端口以 `deploy/docker-compose.yml` 为入口。LinkParse API Key 只进入被忽略的 `.local` 覆盖或进程环境。
