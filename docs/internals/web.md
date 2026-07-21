# Web 模块

## 职责与入口

- `apps/web/src/main.tsx`：React 启动入口。
- `apps/web/src/App.tsx`：页面状态与主要功能组合。
- `apps/web/src/features/`：鉴权、首页、编辑器和预览功能。
- `apps/web/src/store/resumeStore.ts`：简历编辑状态。
- `apps/web/src/api/client.ts`：鉴权、简历和资源 API 客户端。
- `apps/web/vite.config.mjs`：开发服务器、API 分流和本地图片预览插件。

## API 调用

API 客户端只发送相对 `/api/...` 请求并携带 cookie，不在业务组件中写死后端主机。开发期服务归属由 Vite 代理决定，当前分流见 [架构文档](architecture.md#本地请求路径)。

新增或迁移接口时同时检查：

1. `src/api/client.ts` 的路径和响应类型；
2. `vite.config.mjs` 的路由归属和目标；
3. FastAPI 或 Express 的真实路由；
4. [HTTP 契约](../api/http-contracts.md)。

## 本地资源预览

Vite 插件在 `/__local_asset__` 提供开发期本地图片读取，只允许工作区和用户 `Documents` 目录内的文件。它不是生产 API，不应扩大允许目录或用于暴露任意本地路径。

## 当前测试边界

前端当前只有 TypeScript 检查和生产构建，没有单元测试或 E2E 框架。类型检查与构建通过不能替代浏览器交互验证。
