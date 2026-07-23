# Web 模块

## 职责与入口

- `apps/web/src/main.tsx`：React 启动入口。
- `apps/web/src/App.tsx`：页面状态与主要功能组合。
- `apps/web/src/features/`：鉴权、首页、编辑器和预览功能。
- `apps/web/src/store/resumeStore.ts`：简历编辑状态。
- `apps/web/src/api/client.ts`：鉴权、简历和资源 API 客户端。
- `apps/web/vite.config.mjs`：开发服务器、FastAPI 代理和本地图片预览插件。

## API 调用

API 客户端只发送相对 `/api/...` 请求并携带 cookie，不在业务组件中写死后端主机。开发期全部 `/api` 请求由 Vite 代理到 FastAPI，见 [架构文档](architecture.md#本地请求路径)。

新增或迁移接口时同时检查：

1. `src/api/client.ts` 的路径和响应类型；
2. `vite.config.mjs` 的路由归属和目标；
3. FastAPI 的真实路由；
4. [HTTP 契约](../api/http-contracts.md)。

## 本地资源预览

Vite 插件在 `/__local_asset__` 提供开发期本地图片读取，只允许工作区和用户 `Documents` 目录内的文件。它不是生产 API，不应扩大允许目录或用于暴露任意本地路径。

## 当前测试边界

- 单元和组件测试使用 Vitest、React Testing Library 与 jsdom；配置入口为 `apps/web/vitest.config.ts`，公共初始化在 `src/test/setup.ts`。
- 测试文件与被测源码相邻，命名为 `*.test.ts` 或 `*.test.tsx`，优先验证可见行为和公开接口。
- 前端测试不得访问真实后端、数据库或对象存储，跨模块依赖在 API Client 边界使用受控 Mock。
- 当前没有自动化 E2E；涉及 Web、FastAPI、MySQL 和 MinIO 的完整浏览器流程仍需人工验证。
