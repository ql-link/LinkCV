# Web 模块

## 职责与入口

- `apps/web/src/main.tsx`：React 启动入口。
- `apps/web/src/App.tsx`：页面状态与主要功能组合。
- `apps/web/src/features/`：鉴权、首页、编辑器、预览和临时 JD 管理功能。
- `apps/web/src/store/resumeStore.ts`：简历编辑状态。
- `apps/web/src/api/client.ts`：鉴权、简历、JD 和资源 API 客户端。
- `apps/web/src/api/resumeContract.ts`：语义简历 TypeScript 契约，以及领域 JSON、Markdown 和现有 Tiptap 编辑器之间的过渡适配。
- `apps/web/vite.config.mjs`：开发服务器、FastAPI 代理和本地图片预览插件。

## API 调用

API 客户端只发送相对 `/api/...` 请求并携带 cookie，不在业务组件中写死后端主机。开发期全部 `/api` 请求由 Vite 代理到 FastAPI，见 [架构文档](architecture.md#本地请求路径)。短 access 过期后，受保护请求会复用单个 `/api/auth/refresh` 请求轮换双 Cookie，并重试一次原请求；应用启动时 `/api/auth/me` 返回空用户也会先尝试 refresh，再判定为访客。

新增或迁移接口时同时检查：

1. `src/api/client.ts` 的路径和响应类型；
2. `vite.config.mjs` 的路由归属和目标；
3. FastAPI 的真实路由；
4. [HTTP 契约](../api/http-contracts.md)。

简历 API 已统一使用 `snake_case`、`ResumeDocumentV1 data` 和 `ResumeStyleV1 style`。当前编辑器仍以 Markdown/Tiptap 提供整页编辑体验：读取时把完整语义字段渲染为 Markdown；用户修改正文后，把受限 Markdown 写入 `custom_section_editor`，同时保留导入生成的结构化字段作为来源基线，后续读取以该自定义正文为准，不把整份 Tiptap JSON 写入后端。完整字段级双向编辑器属于后续产品改造。

简历主页删除使用站内确认弹窗并立即请求后端，只有接口成功才从本地列表移除；失败时保留卡片并显示错误，不再使用刷新会取消的前端延迟计时器。主页提供 Markdown、DOCX 和 PDF 导入入口，通过 multipart 请求调用已有导入 API；成功后立即进入新简历编辑页，失败时按格式、大小、数量上限、限流和外部服务配置状态显示站内提示。前端不持有结构化模型或文档转换服务的密钥。编辑路由根据 API 状态区分不存在或无权访问、登录失效、数据格式不兼容、服务端故障和网络不可达。

版本抽屉直接读取后端不可变版本列表。自动保存请求串行执行，并在每次成功后接续服务端返回的 `lock_version`；用户点击“保存版本”时先保存草稿，再调用版本创建接口。恢复历史版本前会先保存未提交草稿，恢复期间临时禁止编辑，成功后使用后端快照刷新。`smartOnePage` 作为 `ResumeStyleV1.smart_one_page` 随当前快照和历史版本持久化。编辑器图片上传使用当前简历的私有资源接口。

JD 临时管理界面使用可恢复路由 `/jobs`、`/jobs/new`、`/jobs/:jobId` 和 `/jobs/:jobId/edit`，与简历页面共享现有 Cookie 会话和工作区侧边栏；在简历、模板、JD 列表、JD 详情及编辑页之间切换时只替换右侧内容区。列表支持活动、已归档、全部范围，关键词搜索和游标加载更多；详情页提供编辑、归档和恢复，只有归档记录在列表及详情页展示站内确认后的永久删除入口。新建页允许手工填写最终结构化字段和可选来源链接。编辑页把来源身份完整显示为只读，不向更新接口发送来源字段。创建遇到来源重复时，页面根据服务端 `allowed_actions` 显示取消、恢复原内容或更新原记录；动作回传记录 ID 和 `lock_version`。浏览器采集插件是独立的 `apps/extension` 应用，通过相同 Cookie 会话调用后端导入接口；Web 不承载页面抓取或插件 API Key 管理。

## 本地资源预览

Vite 插件在 `/__local_asset__` 提供开发期本地图片读取，只允许工作区和用户 `Documents` 目录内的文件。它不是生产 API，不应扩大允许目录或用于暴露任意本地路径。

## 当前测试边界

- 单元和组件测试使用 Vitest、React Testing Library 与 jsdom；配置入口为 `apps/web/vitest.config.ts`，公共初始化在 `src/test/setup.ts`。
- 测试文件与被测源码相邻，命名为 `*.test.ts` 或 `*.test.tsx`，优先验证可见行为和公开接口。
- 前端测试不得访问真实后端、数据库或对象存储，跨模块依赖在 API Client 边界使用受控 Mock。
- JD 页面测试覆盖列表筛选、归档版本、永久删除确认、重复来源动作和编辑来源只读契约。
- 当前没有自动化 E2E；涉及 Web、FastAPI、MySQL 和 MinIO 的完整浏览器流程仍需人工验证。
