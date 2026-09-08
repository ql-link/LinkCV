# 微信小程序架构

## 架构职责

`apps/miniprogram` 是独立原生微信客户端，适配账号、简历和求职中心领域：游客可查看一份内置虚构示例，登录用户可完成扫码确认、本人资料维护和本人简历只读浏览。它复用现有用户、简历和求职模型，不提供简历编辑、岗位导入或管理端。

账号业务规则见 [账号与身份功能](../features/identity-account.md)，接口见 [HTTP 接口契约](../api/http-contracts.md)，环境配置见 [本地开发](../ops/development.md)。

## 客户端组成

- `pages/`：简历列表/详情、统一登录、扫码确认、“我的”，以及求职中心列表、时间表、详情与表单。
- `services/`：认证、资料、简历与求职 API，以及正式版本预览缓存。
- `utils/request.js`：Bearer access、refresh、并发刷新与受控重试。
- `config/`：开发、体验和正式环境 API 地址选择。
- `custom-tab-bar/`：游客和登录态共用的“简历 / 求职 / 我的”渠道导航。

## 后端适配

`apps/backend/src/linkcv/modules/miniprogram/` 提供本人简历列表/详情、PDF、PNG 预览和本人资料适配；登录协议仍由 `modules/identity/wechat_routes.py` 和统一 session 服务负责。小程序 Bearer 依赖只允许访问明确白名单接口，不能复用 Web Cookie 权限面。启用管理员与普通账号都可使用这些本人业务接口和扫码确认能力，停用账号仍会被拒绝；扫码确认会建立独立的 Web Cookie 与小程序 Bearer 会话。

| 入口 | 职责 |
| --- | --- |
| `modules/miniprogram/routes.py` | 本人简历列表、详情、PDF 和 PNG |
| `modules/miniprogram/account_routes.py` | 小程序本人昵称和头像适配 |
| `modules/miniprogram/pdf_service.py` | 可读版本选择与 PDFium PNG 栅格化 |
| `modules/identity/wechat_routes.py` | 小程序登录、账号存在性、刷新和退出协议 |
| `services/auth.js`、`utils/request.js` | token 保存、刷新、重试和失效处理 |
| `services/resumePreviewCache.js` | 正式版本预览索引和本地文件缓存 |

## 预览与缓存链

详情选择最新手动版本，缺失时使用初始版本。FastAPI 复用 Web 打印核心生成智能一页 PDF，再由 PDFium 栅格化为 PNG；服务端不保存 PDF/PNG 成品。客户端按用户、简历和版本缓存在 `wx.env.USER_DATA_PATH`，退出、会话失效或账号切换会清理索引和文件。

游客首页使用双列画廊卡片展示一份明确标注“内容为虚构信息”的内置示例，点击进入完全本地的静态详情，不调用账号或个人简历接口。登录后列表展示真实简历并异步预取正式版本 PNG；页面内部 `scroll-view` 负责滚动和下拉刷新，底部导航位于滚动区域外并固定在安全区上方。真实详情在 `movable-area`/`movable-view` 中支持双指缩放与自由拖动。

## 网络边界

游客冷启动不请求身份或个人数据。用户从“我的”主动进入登录页并确认微信隐私保护指引后，后端才复用已有 openid 账号或在明确同意时创建普通账号；重试路径不能静默完成首次建号，`privacy_accepted` 也不等同于服务端持久化的同意审计记录。环境明确为 `develop` 时，开发者工具默认读取生成的 `local.js`，优先使用 `devtoolsApiBaseUrl` 的本机地址；真机开发版同样自动读取 `local.js` 中的局域网地址。开关为 `false` 可关闭自动本地联调，删除开关恢复平台默认。显式 `linkcv_api_base_url` 覆盖优先于自动配置，且同样只在 `develop` 生效。环境异常、本地文件不可用时回退 `https://linkresume.cn`；`trial/release` 完全不读取开发 storage、设备信息或 `local.js`，第三方平台覆盖也必须使用 HTTPS。启动器生成的端口跟随实际 profile：共享 Dev 使用 `LINKCV_LOCAL_BACKEND_PORT`（默认 18000），Local 使用 `BACKEND_PORT`（默认 8000）。配置在冷启动时解析，网络失败不会触发跨环境回退。新增小程序写能力必须先在所属业务功能建立权限与契约，再由该客户端做渠道适配。

## 个人资料交互

“我的”页游客态不请求账号资料，头像和“登录 / 注册 LinkResume”昵称文案分别作为明确的登录入口。登录态点击昵称后才挂载可见的原生 `input type="nickname"`，静态昵称在编辑期间隐藏，避免透明原生输入框与展示文字叠加；键盘“完成”或失焦都会直接调用 `PATCH /api/miniprogram/account/profile`，无需额外保存按钮。confirm 与 blur 连续触发时由保存状态阻止重复请求；空昵称或接口失败会恢复最近一次服务端昵称并显示错误信息。昵称旁保留编辑提示图标，不再展示与编辑提示竞争空间的“微信已绑定”状态。

## 状态、降级与安全

- access 失效时请求层只允许一次受控 refresh；refresh 失败会清理凭据并回到游客态，不能循环重试。
- 列表可在基础数据返回后异步预取预览；单个预览失败不影响其他简历列表，但详情页应保留可重试错误。
- PDF/PNG 仅接受当前用户可读的最新手动或 initial 版本；客户端传入的 `version_id` 不能扩大可读范围。
- 渲染并发、PDF/PNG 大小、尺寸和像素均有限制；超限或渲染失败不写缓存索引。
- 本地缓存属于可重建派生数据，账号切换和退出必须清理，不能作为服务端版本真值。

## 修改联动与验证

修改登录、token、API 地址或页面行为时，需同步[账号功能](../features/identity-account.md)、HTTP 契约、`docs/ops/development.md` 和 `doc-sync-rules.yaml`；修改预览还需同步简历打印链。主要验证入口为后端 `test_miniprogram_account.py`、`test_miniprogram_resume_pdf.py`、`test_miniprogram_pdf.py`，以及小程序 `auth`、`account`、`request`、`resume`、`pages` 和 `env` 测试。

## 求职中心客户端

`pages/career/index` 默认展示面试安排，顶部透明文字导航按“面试安排 / 求职记录”排列，选中项使用蓝色、较大字号和下划线。时间表以北京时间显示所选日的真实场次，重叠场次分列，跨天和非工作时段安排仍可见。日期选择与“添加安排”位于看板顶部，时间表填充底部导航上方的可用高度；场次块显示公司、阶段与起止时间，详情通过点击查看。求职记录支持公司/岗位搜索，以及待投递、已投递、Offer、已终止筛选。游客只显示主动登录入口，不请求本人求职数据。

`application` 展示当前阶段、有序历史、场次和岗位资料；`session` 展示排期、准备和文字记录；首页“添加安排”打开 `components/schedule-sheet` 同页弹窗，仅列出已投递、有效、未归档、非 Offer 且处于 `awaiting_result` 的流程，选择后填写下一阶段及排期。普通筛选阶段也可进入此入口安排首次面试；已有排期的阶段需显式完成当前场次。当前阶段待安排时，从求职详情添加安排，仅创建当前阶段场次，不出现在首页选择列表。类型限测评、笔试、AI 面试与普通面试；开始和结束时间均必填，保存后回到安排日期并刷新看板。普通面试使用开始时间与 30 / 60 / 90 分钟或自定义整数时长生成结束时间；测评按整数天数生成完成期限；笔试与 AI 面试分别选择起止时间。`components/career-time-picker` 提供按月日历和时、分滚轮，确认后才写回表单，取消保留原值。弹窗开启时隐藏底部标签栏并锁住背景滚动；关闭或更换流程会确认丢弃未保存内容，提交后的重试保持原请求标识和内容。`select` 保留旧路由兼容；`form` 按业务类型切换阶段、排期、记录、准备、Offer 和终止表单。页面采用连续白色信息面板与底部黑色主操作，状态文字与图标同时提供反馈。阶段与场次状态以服务端结果为准，保存记录不会自动完成场次，完成场次不会追加阶段。

`career_routes.py` 通过小程序 Bearer 依赖调用现有 interviews 应用服务，复用资源归属、乐观锁、阶段/排期幂等与冲突检查。独立表单与弹窗共用 `utils/careerEditor.js` 的保存行为。阶段成功而安排失败时保留阶段，客户端原位重试安排；时间冲突必须显式确认后才能使用 `allow_conflict`。岗位内容读取这次求职保存的快照；投递简历通过求职专用 PNG 端点读取实际绑定的不可变版本，不能用当前最新版本替换，也不能由客户端指定其他版本。该预览只作临时文件使用，离开页面清理。简历中心原有“只读最新正式版本”规则保持不变。
