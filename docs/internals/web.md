# Web 模块

## 职责与入口

- `apps/web/src/main.tsx`：React 启动入口。
- `apps/web/src/App.tsx`：页面状态与主要功能组合。
- `apps/web/src/features/`：鉴权、首页、编辑器和预览功能。
- `apps/web/src/store/resumeStore.ts`：简历编辑状态。
- `apps/web/src/api/client.ts`：鉴权、简历和资源 API 客户端。
- `apps/web/src/api/resumeContract.ts`：语义简历 TypeScript 契约，以及领域 JSON、Markdown 和现有 Tiptap 编辑器之间的过渡适配。
- `apps/web/vite.config.mjs`：开发服务器、FastAPI 代理和本地图片预览插件。

## API 调用

API 客户端只发送相对 `/api/...` 请求并携带 cookie，不在业务组件中写死后端主机。开发期全部 `/api` 请求由 Vite 代理到 FastAPI，见 [架构文档](architecture.md#本地请求路径)。

新增或迁移接口时同时检查：

1. `src/api/client.ts` 的路径和响应类型；
2. `vite.config.mjs` 的路由归属和目标；
3. FastAPI 的真实路由；
4. [HTTP 契约](../api/http-contracts.md)。

简历 API 已统一使用 `snake_case`、`ResumeDocumentV1 data` 和 `ResumeStyleV1 style`。当前编辑器仍以 Markdown/Tiptap 提供整页编辑体验：读取时把语义字段渲染为 Markdown，写回时把编辑内容序列化为受限 Markdown 并放入领域 `custom_sections`，不会把整份 Tiptap JSON 写入后端。完整字段级编辑器属于后续产品改造；这个过渡适配优先保证单一事实源和内容不以编辑器 JSON 形式持久化。

版本抽屉直接读取后端不可变版本列表。自动保存只更新当前草稿；用户点击“保存版本”时先保存草稿，再调用版本创建接口；恢复历史版本后，编辑器使用后端返回的当前快照刷新，不再维护 IndexedDB 本地版本副本。编辑器图片上传使用当前简历的私有资源接口。

## 本地资源预览

Vite 插件在 `/__local_asset__` 提供开发期本地图片读取，只允许工作区和用户 `Documents` 目录内的文件。它不是生产 API，不应扩大允许目录或用于暴露任意本地路径。

## 当前测试边界

- 单元和组件测试使用 Vitest、React Testing Library 与 jsdom；配置入口为 `apps/web/vitest.config.ts`，公共初始化在 `src/test/setup.ts`。
- 测试文件与被测源码相邻，命名为 `*.test.ts` 或 `*.test.tsx`，优先验证可见行为和公开接口。
- 前端测试不得访问真实后端、数据库或对象存储，跨模块依赖在 API Client 边界使用受控 Mock。
- 当前没有自动化 E2E；涉及 Web、FastAPI、MySQL 和 MinIO 的完整浏览器流程仍需人工验证。
