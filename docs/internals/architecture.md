# 当前架构

## Monorepo 组成

| 模块 | 位置 | 当前职责 |
| --- | --- | --- |
| Web | `apps/web` | React 19、TypeScript、Vite 前端，以及简历和临时 JD 管理页面 |
| Browser extension | `apps/extension` | WXT、React、TypeScript Chrome MV3 插件；读取当前 BOSS 详情页并提交确认后的采集字段 |
| WeChat miniprogram | `apps/miniprogram` | 原生小程序（免构建，开发者工具直接导入）；扫码进入登录确认页，把 wx.login code 与 scene/mode/昵称/头像提交到后端 |
| Backend | `apps/backend` | FastAPI、JWT/Redis 鉴权、简历与 JD API、MinIO 图片接口、SQLAlchemy 模型和 Alembic 迁移 |
| Infrastructure | `deploy` | MySQL、Redis、MinIO 本地依赖和 Dev/Production Jenkins、Compose 拓扑 |
| AI workflow | `.ai`、`.specs`、`scripts/quality` | 项目规则、以方案为中心的本地 Spec 和质量检查 |

## 本地请求路径

Web 页面统一请求相对 `/api` 路径。`apps/web/vite.config.mjs` 将全部 `/api` 流量代理到 FastAPI，默认目标为 `http://127.0.0.1:8000`。

浏览器插件从独立的 `chrome-extension://` 源运行，默认通过 `http://127.0.0.1:5173` 或 `http://localhost:5173` 调用同一 Vite `/api` 代理，并携带用户已经在对应 Web 源站建立的 HttpOnly Cookie 会话。插件 Manifest 只声明 BOSS 站点、本地 LinkCV 源站和构建时显式配置的 LinkCV 源站权限；内容脚本不直接访问 LinkCV API。

FastAPI 在 `apps/backend/src/linkcv/main.py` 以 `/api` 前缀挂载路由。Vite 为最长 180 秒的同步导入设置 190 秒代理预算，避免代理先于后端业务 deadline 关闭连接。PDF 导入由 FastAPI 使用后端 Secret 直接访问 `http://100.86.10.52:18743/v1/parse`；浏览器不连接 LinkParse，DOCX 和 Markdown 也不经过该服务。详细接口见 [HTTP 契约](../api/http-contracts.md)。

## 数据与鉴权

- MySQL 是用户、简历、结构化 JD 和治理数据的权威存储，表结构只通过 Alembic 迁移演进。
- 登录态使用短 JWT access Cookie `resume_access` 与七天不透明 refresh Cookie `resume_refresh`，Redis 保存可撤销会话。
- 图片存储在私有 MinIO bucket 中；现有兼容资源位于 `users/<user-id>/assets/`，简历编辑器新增资源位于 `users/<user-id>/resumes/<resume-id>/assets/`，两者都由服务端生成对象键并在读取时校验所有权。
- 原型 Express/SQLite 数据不迁移到 MySQL。

## 配置真值

- FastAPI 读取 `BACKEND_HOST` 和 `BACKEND_PORT`，默认 `127.0.0.1:8000`。
- Vite 使用 `BACKEND_PORT` 构造默认代理目标，也允许 `BACKEND_PROXY_TARGET` 覆盖完整地址。
- 数据库、JWT、MinIO 和 LinkParse 变量以 `.env.example` 为入口；本地依赖端口以 `deploy/docker-compose.yml` 为入口。LinkParse API Key 只进入被忽略的 `.local` 覆盖或进程环境。
