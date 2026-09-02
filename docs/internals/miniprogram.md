# 微信小程序架构

## 架构职责

`apps/miniprogram` 是独立原生微信客户端，只适配账号和简历领域：游客可查看一份内置虚构示例，登录用户可完成扫码确认、本人资料维护和本人简历只读浏览。它不拥有第二套用户或简历模型，也不承载编辑、求职中心或管理端。

账号业务规则见 [账号与身份功能](../features/identity-account.md)，接口见 [HTTP 接口契约](../api/http-contracts.md)，环境配置见 [本地开发](../ops/development.md)。

## 客户端组成

- `pages/`：简历列表/详情、统一登录、扫码确认和“我的”。
- `services/`：认证、资料、简历 API 和正式版本预览缓存。
- `utils/request.js`：Bearer access、refresh、并发刷新与受控重试。
- `config/`：开发、体验和正式环境 API 地址选择。
- `custom-tab-bar/`：游客和登录态共用的“简历 / 我的”渠道导航。

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

游客冷启动不请求身份或个人数据。用户从“我的”主动进入登录页并确认微信隐私保护指引后，后端才复用已有 openid 账号或在明确同意时创建普通账号；重试路径不能静默完成首次建号，`privacy_accepted` 也不等同于服务端持久化的同意审计记录。只有环境明确为 `develop` 且设备本地 `linkcv_local_debug_enabled === true` 时，客户端才读取生成的 `local.js`；显式 `linkcv_api_base_url` 覆盖优先于 `local.js`，且同样只在 `develop` 生效。环境异常、未 opt-in、地址缺失或读取失败都回退 `https://linkresume.cn`；`trial/release` 忽略开发 storage 与 `local.js`，第三方平台覆盖也必须使用 HTTPS。新增小程序写能力必须先在所属业务功能建立权限与契约，再由该客户端做渠道适配。

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
