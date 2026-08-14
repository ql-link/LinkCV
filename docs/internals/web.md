# Web 模块

## 职责与入口

- `apps/web/src/main.tsx`：React 启动入口。
- `apps/web/src/App.tsx`：页面状态与主要功能组合。
- `apps/web/src/features/`：鉴权、首页、编辑器、预览、临时 JD 管理和管理端功能。
- `apps/web/src/store/resumeStore.ts`：简历编辑状态。
- `apps/web/src/api/client.ts`：鉴权、模板、简历与异步导入、JD、资源、日志上报和管理员查询 API 客户端。
- `apps/web/src/api/resumeContract.ts`：语义简历 TypeScript 契约，以及领域 JSON、Markdown 和现有 Tiptap 编辑器之间的过渡适配。
- `apps/web/vite.config.mjs`：开发服务器、FastAPI 代理和本地图片预览插件。

## API 调用

API 客户端只发送相对 `/api/...` 请求并携带 cookie，不在业务组件中写死后端主机。每次请求附加 `X-Request-ID`，错误对象保留服务端回传的追踪值；API 5xx 会异步上报稳定错误码和追踪值，不发送原响应 body。开发期全部 `/api` 请求由 Vite 代理到 FastAPI，见 [架构文档](architecture.md#本地请求路径)。短 access 过期后，受保护请求会复用单个 `/api/auth/refresh` 请求轮换双 Cookie，并重试一次原请求；应用启动时 `/api/auth/me` 返回空用户也会先尝试 refresh，再判定为访客。

React 根入口用 Error Boundary 和 `error` / `unhandledrejection` 监听器捕获登录态页面的未处理异常，通过 FastAPI 受保护入口进入统一日志链路；上报失败被吞掉，不能形成递归上报或替代原始页面错误。上报内容限制为错误类型、消息、栈和可选 request ID，不发送 Store、表单、简历正文或浏览器 Cookie。

普通登录页 `/login` 不区分登录或注册模式，也不渲染表单，挂载后立即用 `WechatQrLogin` 请求二维码并每 2 秒轮询 scene。`success` 时后端设置双 Cookie并进入工作区，`cancelled/expired` 或生成失败时停止轮询并提供刷新。Landing 的登录和开始按钮都进入同一入口。个人资料页不再显示改密或微信绑定操作；管理员密码表单只保留在 `/admin/login`。

新增或迁移接口时同时检查：

1. `src/api/client.ts` 的路径和响应类型；
2. `vite.config.mjs` 的路由归属和目标；
3. FastAPI 的真实路由；
4. [HTTP 契约](../api/http-contracts.md)。

简历 API 已统一使用 `snake_case`、`ResumeDocumentV1 data` 和 `ResumeStyleV1 style`。当前编辑器仍以 Markdown/Tiptap 提供整页编辑体验：读取时把完整语义字段渲染为 Markdown；用户修改正文后，把受限 Markdown 写入 `custom_section_editor`，同时保留导入生成的结构化字段作为来源基线，后续读取以该自定义正文为准，不把整份 Tiptap JSON 写入后端。完整字段级双向编辑器属于后续产品改造。

简历主页卡片使用后端摘要中的真实 `data/style` 只读预览；预览纸张和编辑工作台都使用 `ResumeStyleV1.template_key` 对应的主题类，模板内的 `::: left/right` 结构由同一 Markdown 渲染链处理。历史结构无效时显示“预览不可用”，不阻断列表。新建统一进入 `/resumes/new`，用户必须选择启用模板并输入名称；空白简历也是模板。注册成功后只进入空主页，不自动创建第一份简历。模板库和新建页复用同一真实模板预览链。

主页导入弹窗必须同时选择模板和 Markdown、DOCX 或 PDF 文件，每次提交生成新的 UUID `Idempotency-Key`；access 刷新重放保持同一个 Key。API 在请求内同步返回正式简历后，Store 合并摘要、保存本次 warnings 并打开编辑器；失败则保留原列表和当前简历。页面不展示上传中、解析中或失败任务卡，也不轮询导入状态。前端不持有 MinIO、LinkParse 或结构化模型凭据。

版本抽屉直接读取后端不可变版本列表。自动保存请求串行执行，并在每次成功后接续服务端返回的 `lock_version`；用户点击“保存版本”时先保存草稿，再调用版本创建接口。恢复历史版本前会先保存未提交草稿，恢复期间临时禁止编辑，成功后使用后端快照刷新。`smartOnePage` 作为 `ResumeStyleV1.smart_one_page` 随当前快照和历史版本持久化。编辑器图片上传使用当前简历的私有资源接口。

JD 临时管理界面使用可恢复路由 `/jobs`、`/jobs/new`、`/jobs/:jobId` 和 `/jobs/:jobId/edit`，与简历页面共享现有 Cookie 会话和工作区侧边栏；在简历、模板、JD 列表、JD 详情及编辑页之间切换时只替换右侧内容区。列表支持活动、已归档、全部范围，关键词搜索和游标加载更多；详情页提供编辑、归档和恢复，只有归档记录在列表及详情页展示站内确认后的永久删除入口。新建页允许手工填写最终结构化字段和可选来源链接。编辑页把来源身份完整显示为只读，不向更新接口发送来源字段。创建遇到来源重复时，页面根据服务端 `allowed_actions` 显示取消、恢复原内容或更新原记录；动作回传记录 ID 和 `lock_version`。浏览器采集插件是独立的 `apps/extension` 应用，通过相同 Cookie 会话调用后端导入接口；Web 不承载页面抓取或插件 API Key 管理。

管理端入口为 `/admin`，模型配置页使用 `/admin/llm/models`，日志中心使用 `/admin/logs/system`、`/admin/logs/audit` 和兼容原 LLM 页的 `/admin/logs`。模型页突出可点击的系统 `Chat 模型` 能力区，展示唯一当前模型和多个候选；管理员只填写模型供应商、模型名称、可选 API Base 与 API Key，不填写能力、优先级或价格。供应商选项展示用户可识别的名称，不暴露 LiteLLM adapter 代码；当前支持列表包含以 `dashscope` 路由调用的阿里云百炼（千问）。保存普通候选不改变当前项，“设为当前”会先执行真实测试再切换；编辑当前项也必须先验证拟议配置。密钥字段只写，编辑留空时不进入 PATCH，显式清除才发送 `null`。

日志中心的系统页支持按级别、依赖、request ID 和关键词筛选；审计页支持按固定动作、操作者、目标和结果筛选；两者展示最近 24 小时摘要、部分脏行提示和游标分页。LLM 页继续读取 MySQL 中的真实调用记录，支持来源、状态、模型、用户、精确 `callId` 和时间范围筛选。三个页面都只通过 FastAPI 查询，不直连 Loki，也不轮询。PDF 保存完成或失败后会按当前 `resumeId` 上报审计；审计上报失败不改变 PDF 的保存结果或原始导出异常。

管理端新增 `/admin/templates` 模板工作区，可查看启用、停用和结构无效模板，上传严格 JSON 包、真实预览并幂等启停；不提供覆盖或删除。`/admin/plugins` 提供插件发布管理。

## 视觉与交互基线

- 登录后功能区的视觉语言与机器可读 Token 见根目录 [`DESIGN.md`](../../DESIGN.md)。`src/design-system/tokens.css` 是浏览器运行实现，`tailwind.config.cjs` 提供语义 utility 映射，`src/design-system/utilities.css` 是 Tailwind utilities 的全局入口；保持 `preflight: false`。
- shadcn primitive 与 LinkCV 通用组合组件只放在 `src/components/ui/`，页面统一从 `@/components/ui` 导入；`components.json` 保存 shadcn CLI 与 Registry 配置，MCP 连接由 Codex 配置管理。UI 目录不保存 API、权限和页面状态，也不另建 `components/product`。
- 普通工作区在 `WorkspaceLayout` 上显式使用 `data-ui-theme="light"`，保持既有浅色行为；入口层和管理端沿用各自主题。新增主题必须在 Token 层定义，不能在页面重复声明整套颜色。
- 页面视觉方向、Design Brief、shadcn 选型、Vercel Web Interface Guidelines 审查和浏览器验收流程由 [frontend-design Skill](../../.ai/skills/frontend-design/SKILL.md) 维护。该 Skill 把 Anthropic 官方 frontend-design 方法适配到 LinkCV 的四类视觉边界；21st.dev 等外部参考只提供局部布局、材质和动效意图，最终使用 LinkCV Token 与组件重写。
- 可在本地运行的 Web 改动由 Agent 启动并查看实际页面；大幅视觉修改先确认设计来源，按选定效果的布局、密度、间距、色彩、字体、内容和层级实现。新反馈只有在实现完成后才更新本节；尚未实现的决定留在对应 Spec。
- 公共 `/` 欢迎页位于 `src/features/landing/`，所有普通登录/开始 CTA 都进入 `/login`。登录页使用独立 `features/auth/auth.css` 保留入口构图和 Shader，但只有微信小程序码，没有注册或密码表单。
- 默认简历使用虚构示例，当前姓名为“张三”。产品约束是不使用已经移除的 Google CJK serif 字体族；当前 `resumeStore.ts` 和 `tokens.css` 仍保留 `Noto Serif CJK SC` 或 `Noto Serif SC` 作为本地 fallback，这是尚未消解的既有不一致，不能写成已经满足。UI 中的霞鹜文楷由 Web Font 依赖提供，不能依赖用户系统安装。
- 简历标题用字号、间距和分隔线建立层级，不自动加粗；显式 Markdown 粗体使用中等字重和略浅于正文的墨色，并在网页预览和 PDF 中保持可见。
- 左右结构不自动加粗左侧内容。编辑器继续兼容旧版 `::: left` / `::: right`：把当前正文行转换为左右行时保留原内容到左侧，右侧立即可输入；聚焦提示只用于编辑，不进入导出结果。
- 编辑器工具栏不提供固定字号快捷项；全局字号只从页面设置调整。编辑器聚焦时不显示包围整张 A4 的浏览器默认外框，但保留光标、选区和左右分栏提示。
- 登录、简历主页和编辑器使用可恢复 URL：`/login`、`/resumes`、`/resumes/:resumeId/edit`；刷新、收藏及浏览器前进后退保持当前简历定位。
- “智能一页”在工作台保留可操作入口和选中状态，并控制连续单页与标准 A4 分页两种 PDF 导出模式。
- 工作台支持 `Command/Ctrl + 滚轮` 缩放纸张预览；普通滚轮只滚动，预览缩放不改变 PDF 的实际页面尺寸。
- 管理端以黑白中性设计为基线，使用按下反馈、可中断的弹簧动效和半透明材质，并为减少动态效果、减少透明度和键盘焦点提供降级。登录页保持内部工具气质，不使用巨型营销口号或宣传式数据堆叠。

## 本地资源预览

Vite 插件在 `/__local_asset__` 提供开发期本地图片读取，只允许工作区和用户 `Documents` 目录内的文件。它不是生产 API，不应扩大允许目录或用于暴露任意本地路径。

## 当前测试边界

- 单元和组件测试使用 Vitest、React Testing Library 与 jsdom；配置入口为 `apps/web/vitest.config.ts`，公共初始化在 `src/test/setup.ts`。
- 测试文件与被测源码相邻，命名为 `*.test.ts` 或 `*.test.tsx`，优先验证可见行为和公开接口。
- 前端测试不得访问真实后端、数据库或对象存储，跨模块依赖在 API Client 边界使用受控 Mock。
- JD 页面测试覆盖列表筛选、归档版本、永久删除确认、重复来源动作和编辑来源只读契约。
- 管理端组件测试在 API Client 边界使用 Mock，覆盖 Chat 当前项/候选与真实日志渲染、错误与空状态、密钥更新语义、测试后启用、筛选和游标交互。
- 当前没有自动化 E2E；涉及 Web、FastAPI、MySQL 和 MinIO 的完整浏览器流程仍需人工验证。
# 插件安装与发布入口

JD 中心页头提供“安装岗位采集插件”入口。`PluginInstallDialog.tsx` 只向普通用户展示开发者模式安装、使用、手工更新说明和统一下载按钮，不展示版本、Manifest、发布时间、大小或 SHA-256；只有后端返回可用版本时才渲染同源下载入口，未发布、下架或存储故障时不猜测地址。

管理台 `/admin/plugins` 由 `PluginReleasePanel.tsx` 承担，并按无插件、已上架、已下架三态显示卡片。无插件时只显示“上传插件”；已上架时显示“更新插件 / 下架插件 / 删除插件”；已下架时显示“更新插件 / 重新上架 / 删除插件”。管理员选择单个 ZIP 后，客户端先检查扩展名与 20 MiB 上限，二次确认后以 multipart 上传；版本、环境和权限仍由后端作可信校验。校验失败的文件可显式清除并重选。更新成功后后端自动删除旧版本 ZIP；下架保留当前 ZIP，重新上架无需上传；永久删除经二次确认后物理删除 ZIP 和发布指针。面板不编译源码，也不提供历史版本或回滚。
