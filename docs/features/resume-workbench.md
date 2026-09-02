# 简历与工作台功能

## 功能范围

简历功能覆盖模板创建、文件导入、编辑与自动保存、正式版本、模板切换、资源、分享和 PDF 输出。浏览器维护编辑中的交互状态，服务端当前简历和正式版本是持久化权威数据。

具体 schema、稳定错误和并发冲突见 [HTTP 接口契约](../api/http-contracts.md)，编辑器视觉与交互基线见 [Web 架构](../internals/web.md)。

## 用户入口

- `/resumes`：简历列表、创建、导入、重命名、删除和分享。
- `/resumes/new`：从启用模板创建简历。
- `/resumes/:resumeId/edit`：正文编辑、页面设置、模板切换、版本记录、AI 侧栏和 PDF 导出。
- `/templates`：模板浏览与预览。
- `/share/:token`：受可见性与过期时间约束的只读分享页。
- 管理端 `/admin/templates`：严格模板包导入、预览和启停。

## 代码地图

| 层级 | 入口 | 职责 |
| --- | --- | --- |
| 领域契约 | `src/linkcv/domain/resume/` | `CanonicalResumeDocument`、`TemplateDefinition`、`ResumePresentation`、`LayoutPlan`、`SourceGraph` 与确定性组合 |
| 应用服务 | `application/resumes/` | 创建、保存、版本、模板切换和分享事务 |
| HTTP/ORM | `modules/resumes/` | 简历、版本、模板、导入、资源、分享和 PDF 路由与模型 |
| 导入 | `workers/resume_import_worker.py`、`services/resume_import_service.py` | 异步解析、结构化、规范化和结果事务 |
| Web 状态 | `store/resumeStore.ts`、`api/resumeContract.ts` | 编辑状态与 TypeScript 领域契约 |
| Web 功能 | `features/home/`、`workbench/`、`preview/`、`templates/`、`share/` | 列表、编辑、打印、模板与分享界面 |

## 核心对象与规则

- `resumes` 保存当前 canonical 内容、呈现、模板、分享状态和 `lock_version`；保存和模板切换必须通过乐观锁。正文只保存模板无关的 identity、语义章节、块、章节内 row 和来源引用，不能保存 sidebar/main、CSS 或分页投影。
- `resume_versions` 保存用户明确创建的正式版本；恢复会替换当前简历，但不自动创建新正式版本。
- `resume_templates` 保存 `TemplateDefinition` 与默认 canonical 内容；普通用户只消费启用且结构有效的模板。模板拥有区域、插槽、列宽和头像显示策略，`LayoutPlan` 是后端编译的只读投影结果。
- Web 默认简历中的图片占位标签使用随应用发布的霞鹜文楷；它只负责示例占位图呈现，不覆盖用户保存的简历字体设置。
- canonical 正文把白名单内的简历图标保存为结构化 `InlineIcon`，章节标题使用独立 `title_icon`；`:icon[Name]:` 只作为 Markdown、Agent 和旧数据兼容边界的序列化形式，不能作为预览中可见的普通正文。未知或不完整标记继续按原文字保留，避免静默改写用户内容。
- `document_parse_tasks` 保存简历导入和资料集共用的上传/解析状态。简历导入在受理时同时冻结 `selected_template_id` 与规范化的 `selected_template_style_json`（完整 `TemplateDefinition`），并把确定性的 `SourceGraph` 保存到私有对象；Worker 只使用任务快照，因此模板之后更新或停用不会改变已受理任务的版式。资料集任务额外使用 `queued`、派发时间和尝试版本完成 MQ 恢复。PDF/DOCX 由 LinkParse 转换文字并可附带有界布局提示，Markdown 在 Worker 本地转换。
- 分享实时读取最新正式版本，不另存内容快照；PDF 使用当前已保存快照生成且不持久化成品。

## 依赖边界

该功能依赖身份、MySQL、MinIO、Redis、消息队列、LinkParse 和统一 LLM。求职进程可引用正式版本；AI 助手只能先创建提案，用户确认后才写入简历。删除简历时同步清理其 Agent 数据，但不能越过其他领域的引用约束。

## 关键流程

### 创建与编辑

1. 创建时校验用户额度、名称和启用模板，在同一事务写入当前简历和 initial 版本。
2. 编辑器根据当前 `LayoutPlan` 把 canonical 内容投影为可编辑视图；自动保存先反投影为 canonical 文档，再串行发送 `base_lock_version`，成功后接续服务端新锁版本。
3. 模板切换把当前标题、canonical 内容、目标模板和锁版本一次提交。服务端校验切换前后正文摘要一致，只替换模板身份和 presentation，并在同一事务递增一次锁；头像仍属于 identity，模板只决定是否和在哪里展示。

### 导入与版本

1. 导入弹窗通过带可访问名称的原生文件输入支持点击选择和拖放，选择后展示候选文件并由用户确认名称；提交后在校验启用模板的同一受理事务中写入原件、导入任务、模板 ID 与完整模板定义快照，再发布消息，队列失败不会伪装成已受理。
2. Worker 根据格式选择本地 Markdown 转换或 LinkParse，把解析块与可用坐标统一成稳定 `source_id` 的 `SourceGraph`。LLM 只返回可选的稀疏语义增强，未标注源块由确定性组合器按来源顺序保留；结构化调用未配置、超时、供应商失败、响应无效或标注校验失败时记录脱敏 warning 并返回匹配该来源图的空标注，因此不会因增强不可用而让整份导入失败，也不会生成“未分类内容”。
3. 组合器把 canonical 内容注入任务冻结的模板定义，编译并校验 `LayoutPlan` 后，在同一事务创建简历、initial 版本并完成任务；任务快照缺失、模板身份不一致、来源图或布局任一不一致时不创建半成品。
4. 正式版本由用户明确创建；重命名只改版本名，恢复以版本快照替换当前简历，删除受版本数量和外部引用约束。

### 分享与输出

分享 token 只定位当前最新正式版本并执行可见性、过期和所有者判断。PDF 先完成当前保存，再由后端读取受控图片、调用一次性 Node/Chromium 渲染器返回文件；打印 DOM 与浏览器只读预览消费同一快照和样式事实源。

## 权限、并发与失败边界

- 所有简历、版本和资源操作同时校验 `resume_id + user_id`，不能仅凭资源路径授权。
- 乐观锁冲突、保存失败、模板无效、渲染失败或 Agent 提案冲突都保留客户端当前内容，不触发后续下载或部分写入。
- 私有图片只允许受控对象键和格式；PDF 渲染不联网读取正文资源，也不持久化输出。
- 删除简历、版本、模板或资源时必须先核对求职进程、分享、Agent 和对象存储影响。

## 修改联动与验证

修改快照结构时需同步 Python/TypeScript 契约、迁移、模板包、编辑器、预览、分享、PDF 和小程序预览；修改导入需同步 Worker、MQ、LinkParse、LLM 和开发/部署说明。主要测试入口包括后端 `test_resume_lifecycle.py`、`test_resume_imports.py`、`test_resume_share.py`、`test_resume_pdf.py`、模板管理与迁移测试，前端 `ResumeWorkbench`、`resumeStore`、`resumeContract`、打印、模板和分享测试，以及 Worker/导入服务单元测试。
