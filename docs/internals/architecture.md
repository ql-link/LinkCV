# 当前架构

## Monorepo 组成

| 模块 | 位置 | 当前职责 |
| --- | --- | --- |
| Web | `apps/web` | React 19、TypeScript、Vite 前端，以及简历和临时 JD 管理页面 |
| Browser extension | `apps/extension` | WXT、React、TypeScript Chrome MV3 插件；读取当前 BOSS 详情页并提交确认后的采集字段 |
| WeChat miniprogram | `apps/miniprogram` | 原生小程序，界面采用与 Web 内部功能区同源 `--ui-*` Token 的小屏简洁单列布局与深色/中性 accent 主操作；冷启动直接展示游客可浏览的“简历”列表壳层，底部仅有“简历 / 我的”两个标签页，两页游客态都不请求个人数据。“我的”页面在游客态完整呈现自然通透的开放头部框架、默认头像、分组卡片与操作入口并明确提示未登录，点击引导可跳转至登录页。登录由用户主动进入统一登录页并确认平台隐私保护指引后完成，后端自动复用已有微信账号或创建普通账号；扫码进入独立确认页确认或取消网页登录。登录后可用紧凑列表只读查看本人简历、以智能一页图片阅读详情，并在“我的”维护可选头像与昵称或退出登录。 |
| Backend | `apps/backend` | FastAPI、JWT/Redis 鉴权、简历与 JD API、MinIO 图片接口、SQLAlchemy 模型和 Alembic 迁移 |
| Pi Agent service | `apps/pi-service` | 独立无头 Node 服务；运行 Pi Agent loop，并仅通过受控 HTTP 工具调用 FastAPI |
| Infrastructure | `deploy` | MySQL、Redis、MinIO 本地依赖和 Dev/Production Jenkins、Compose 拓扑 |
| pi agent 工具包（第三方，一次性引入） | `third_party/pi` | Node/TypeScript AI agent 工具包和离线模型目录快照；由根级 Pi 安装、测试和检查脚本显式纳管，详见 [internals/third-party-pi.md](third-party-pi.md) |
| AI workflow | `.ai`、`.specs`、`scripts/quality` | 项目规则、以方案为中心的本地 Spec 和质量检查 |

## 本地请求路径

Web 页面统一请求相对 `/api` 路径。`apps/web/vite.config.mjs` 将全部 `/api` 流量代理到 FastAPI，默认目标为 `http://127.0.0.1:8000`。

同一 Vite 配置把 `@` 解析到 `apps/web/src`，与 TypeScript、Vitest 和 `components.json` 的路径约定一致；集中 UI 组件和 shadcn 生成源码使用该别名，不影响浏览器请求路径。

浏览器插件从独立的 `chrome-extension://` 源运行，默认通过 `http://127.0.0.1:5173` 或 `http://localhost:5173` 调用同一 Vite `/api` 代理，并携带用户已经在对应 Web 源站建立的 HttpOnly Cookie 会话。插件 Manifest 只声明 BOSS 站点、本地 LinkCV 源站和构建时显式配置的 LinkCV 源站权限；内容脚本不直接访问 LinkCV API。

FastAPI 在 `apps/backend/src/linkcv/main.py` 以 `/api` 前缀挂载浏览器路由，并在根路径挂载不出现在 OpenAPI 的 `/internal/agent` 服务间路由。智能助手请求由 FastAPI 写入 MySQL 后以服务 token 转发到独立 Pi 服务；Pi 再用另一枚 token 调用受控内部工具，浏览器不直接访问 Pi。Vite 为最长 180 秒的同步导入设置 190 秒代理预算，避免代理先于后端业务 deadline 关闭连接。PDF 和 DOCX 导入由 FastAPI 使用后端 Secret 直接访问 `http://100.86.10.52:18743/v1/parse`；浏览器不连接 LinkParse，Markdown 在 Worker 内本地转换。详细接口见 [HTTP 契约](../api/http-contracts.md)。

## 数据与鉴权

- MySQL 是用户、简历、Agent 会话/提案、结构化 JD 和治理数据的权威存储，表结构只通过 Alembic 迁移演进。
- Web 登录态使用短 JWT access Cookie 与不透明 refresh Cookie；小程序使用 Bearer access 与 JSON refresh。Redis session 的 channel 阻止两端凭据混用并支持统一撤销；小程序 Bearer 只能访问 `/api/miniprogram/resumes*` 只读接口与 `/api/miniprogram/account/*` 本人资料接口。小程序冷启动落在“简历”游客态，可切换“我的”游客态，两页都不发起账号识别、登录、隐私授权或个人数据请求；登录页只能由用户从页面引导主动进入，也不预先探测账号。客户端在取得新会话前要求用户勾选微信平台隐私保护指引并主动确认（未勾选时在协议区行内提示），后端自动复用已有 openid 账号，或在 `privacy_accepted=true` 时创建普通账号；登录可取消并返回原标签页。扫码确认同样只在用户主动确认后建号或登录，并以新的微信 code 建立独立小程序会话；请求重试路径不能静默触发首次建号。`privacy_accepted` 不作为服务端持久化的同意审计记录。
- 小程序简历列表采用双列一体化画廊海报卡片（通顶真实预览图 + 标题时间 + 查阅胶囊，消除内外框线嵌套），并在列表加载后异步预取正式版本 PNG 缩略图并直出真实外观。简历详情先查询最新手动版本（缺失时初始版本），本机不存在同版本文件时从 FastAPI 下载由共享 React-PDF 核心生成并经 PDFium 栅格化的智能一页 PNG，保存到 `wx.env.USER_DATA_PATH` 后，在当前详情页专门划分的交互视口（`movable-area` 与 `movable-view`）中直接进行双指手势缩放与自由拖拽平移查阅；服务端不保存 PDF 或 PNG 成品。退出、会话失效或账号切换会清理本地索引和文件。
- 普通 Web 登录页由 `/api/auth/capabilities` 控制：Development 可使用邮箱密码或微信扫码，Production 只显示微信小程序码；管理员密码表单只存在于 `/admin/login`。小程序 `develop` 默认自动识别启动时生成的 `local.js` 局域网地址直连 API 8000 端口，并允许开发者工具覆盖内网地址；`trial/release` 固定访问 `https://linkresume.cn`，第三方平台扩展配置可覆盖但必须使用 HTTPS。
- 图片存储在私有 MinIO bucket 中；现有兼容资源位于 `users/<user-id>/assets/`，简历编辑器新增资源位于 `users/<user-id>/resumes/<resume-id>/assets/`，两者都由服务端生成对象键并在读取时校验所有权。
- 原型 Express/SQLite 数据不迁移到 MySQL。

## 配置真值

- FastAPI 读取 `BACKEND_HOST` 和 `BACKEND_PORT`，默认 `127.0.0.1:8000`。
- Vite 使用 `BACKEND_PORT` 构造默认代理目标，也允许 `BACKEND_PROXY_TARGET` 覆盖完整地址。
- Pi 服务默认监听 `127.0.0.1:8010`；FastAPI 与 Pi 使用相反方向的内网 URL 和两枚独立服务 token，不复用用户 Cookie。
- 数据库、JWT、MinIO 和 LinkParse 变量以 `.env.example` 为入口；本地依赖端口以 `deploy/docker-compose.yml` 为入口。LinkParse API Key 只进入被忽略的 `.local` 覆盖或进程环境。
