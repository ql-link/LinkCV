# 账号与身份功能

## 功能范围

LinkResume 的账号功能覆盖普通用户注册和登录、微信扫码登录、小程序登录、Web、小程序与 desktop 会话刷新与退出、微信绑定、本人资料维护，以及管理员查询和启停用户。它为简历、求职中心、AI 助手和资料集提供统一身份，不包含这些领域自己的业务操作。

浅色 Web 工作区的页面背景统一使用暖白背景 Token，账号页的卡片和交互层仍保持独立表面层级。

完整 HTTP 路径、请求字段和错误码见 [HTTP 接口契约](../api/http-contracts.md)；运行时鉴权与渠道关系见 [Backend 架构](../internals/backend.md) 和 [小程序架构](../internals/miniprogram.md)。

## 用户入口

- Web `features/auth/`：登录、注册和微信扫码；Local/Development 支持邮箱密码，Production 普通用户只显示微信扫码。
- Web `/account`：个人信息、安全、偏好与求职资料。昵称、头像和个人画像沿用真实接口；最近会话放在共享侧栏。邮箱修改、改密、微信绑定/解绑、提醒和注销的设计交互目前标有“需后端”，只做本地模拟，不发送账号写请求，也不更改真实邮箱、绑定、密码或注销账号。退出登录继续使用真实接口。
- 小程序登录页、“我的”页和扫码确认页：用户主动确认隐私指引后登录或建号。
- 管理端用户页：管理员查询用户、查看统计并启用或禁用账号。

## 代码地图

| 层级 | 入口 | 职责 |
| --- | --- | --- |
| HTTP | `modules/identity/routes.py` | Web 注册、登录、能力查询、刷新、退出和当前用户 |
| 微信 | `modules/identity/wechat_routes.py` | 二维码、轮询、确认/取消、小程序登录与刷新 |
| 账号 | `modules/identity/account_routes.py` | 本人资料、头像，以及个人画像的读取和整体替换 |
| 管理 | `modules/identity/admin_routes.py` | 管理员用户列表、详情、状态和统计；详情中的累计 LLM 调用数与估算费用读取 `llm_call_logs` |
| 管理台统计 | `modules/admin_insights/` | 用户总数、新增、活跃、禁用、管理员数和 14 天注册趋势等只读统计 |
| 会话 | `modules/identity/session_service.py` | 统一凭据准备、Web/小程序创建与轮换、三渠道撤销基础原语 |
| 桌面 | `modules/identity/desktop_routes.py`、`desktop_login_service.py` | 桌面扫码证明、原子领取与轮换、短期密文恢复、验证 secret 的退出 |
| 鉴权依赖 | `modules/identity/dependencies.py` | 统一认证上下文及 Web、mini、desktop、只读 workspace 和管理员的显式渠道边界 |
| Web | `features/auth/`、`features/account/` | 登录与用户中心界面 |

## 核心规则

- Web 使用 Cookie，mini 与 desktop 使用各自 Bearer，三渠道不能互换或混合认证 Cookie。桌面拥有简历只读、岗位看板与面试排期的明确方法/路径白名单，管理员角色不能扩大渠道权限，详见 [桌面会话契约](../api/http-contracts.md#桌面-bearer-会话)。
- 桌面 Core 的 access 仅驻留内存，refresh 与固定请求 ID 的恢复日志通过原子安全存储接口保存；网络失败保留日志，明确失效清理。共享续期负责统一保存，退出以会话代次拒绝迟到写回，远端撤销失败不冒充成功。两端正式 App 已注入 HTTP 与 Keychain/Credential Locker，支持扫码及状态消费；进程唯一所有者、凭据保存和验收边界见 [`apps/native/README.md`](../../apps/native/README.md)。
- Web 受保护请求遇到 `401` 时共用一次续期并最多重试一次；支持 Web Locks 的浏览器还会跨同源标签页串行续期，取得锁后先检查当前登录态，复用其他标签页已经更新的 Cookie，避免并发轮换触发会话撤销。不支持 Web Locks 时保留单标签页内的并发合并。对话发送与恢复订阅同样遵守该规则，续期期间取消的对话不会重发。
- Web 冷启动先独立确认当前用户，再加载简历概览；概览或其他业务数据返回普通 `5xx` 时保留已经确认的登录态并显示加载错误，只有当前用户为空或后续请求明确返回 `401` 才进入访客状态。
- 用户中心的保存、上传和个人画像提交反馈统一通过页面根层在视口上方居中展示，不使用占据业务卡片或编辑弹窗位置的局部错误块，并在 3 秒后自动消失；首次页面加载失败保留完整错误状态和重试入口。
- 微信 openid 已存在时复用账号；首次建号必须由用户主动操作并携带 `privacy_accepted=true`，不能由冷启动、重试或状态探测静默触发。
- 普通用户只能维护本人资料；头像保存为私有对象，读取继续经过归属校验。
- 个人画像独立于简历保存，通过唯一的 `GET/PUT /api/account/user-profile` 入口维护；保存使用乐观锁，过期版本返回最新画像供用户刷新后重试。
- `GET /api/account/profile` 只聚合账号、已成功创建的简历数量和最近简历摘要，不内嵌个人画像，也不把失败或仍在处理的导入任务计入简历数量。
- 工作性质只接受实习和全职；应届生必须填写毕业年份且工作年限固定为 0，非应届生只填写工作年限。薪资上下限、币种和计薪周期按同一组约束校验。
- 被禁用账号不能继续使用既有会话；退出和刷新由统一 session 生命周期处理。
- 管理员身份与普通用户身份使用同一 `users` 表，但管理员登录入口、依赖和授权检查独立。

- 新账号在建号的同一事务内写入一条 `user_registered` 产品漏斗事件（方式为 `wechat_qr`、`wechat_miniprogram` 或 `email`）；复用已有账号或并发建号回查时不写，建号失败则事件一并回滚。口径见 `docs/internals/observability.md`。

## 数据归属

`users` 是账号、状态、管理员标记、昵称、头像对象键和微信绑定信息的权威表。`user_profiles` 与用户一对一，保存城市、工作性质、薪资、工作经验、教育背景和技能成果，不复制到简历内容。Redis 保存可撤销 session；对象存储保存头像二进制。业务模块不能自行解析 Cookie/Bearer token 或复制用户状态。

## 关键流程

1. Web 登录验证账号后创建 Web channel session，并以 HttpOnly Cookie 返回 access/refresh。
2. 小程序以微信 code 换取 openid，在隐私门禁通过后复用或创建用户，再返回小程序 channel token。
3. 网页扫码由 Web 创建二维码状态，小程序主动确认后建立网页端会话；取消、过期和已消费状态不能重复签发。
4. 账号资料修改先校验当前用户；头像写入受控对象键，替换或删除时同步处理旧对象。
5. 个人画像保存先比较 `base_lock_version`，再整体替换可编辑字段；版本冲突不覆盖数据库，客户端保留编辑窗口并使用响应中的最新画像刷新。
6. 管理员启停用户只改变账号状态，其他模块在鉴权依赖处统一阻止禁用账号继续访问。管理台统计中的“活跃”只计算最近登录在窗口内且仍为启用状态的账号。

## 权限与失败边界

- 未登录、普通用户、管理员和小程序用户使用不同依赖，不以客户端传入的用户 ID 代替会话身份。
- Production 不公开普通邮箱注册、密码登录或普通改密入口；能力开关由后端返回，不由前端猜测环境。
- 微信上游失败、二维码过期、channel 不匹配、refresh 重放和账号禁用都必须收敛为稳定 HTTP 错误，具体值见接口契约。
- 头像对象存储失败不能留下数据库引用与实际对象不一致的成功结果。

## 修改联动与验证

修改会话、Cookie、Bearer、微信、用户或个人画像字段时，需同步 `schemas.py`、Web API client、小程序请求层、数据库迁移、[HTTP 契约](../api/http-contracts.md)和[小程序架构](../internals/miniprogram.md)。主要自动化入口为 `test_account_routes.py`、画像迁移测试、`test_wechat_routes.py`、`test_identity_resumes_assets.py`、`test_wechat_bind_service.py`，以及 Web `AuthPage`、`WechatQrLogin`、`AccountPage`、`UserProfilePanel` 测试和小程序 `auth/account/request` 测试。

桌面文字模拟面试的受限接口由 `get_current_mock_interview_user` 校验，支持本人练习流程与只读资料选择；语音和资料写入仍拒绝 desktop Bearer。精确范围见 [HTTP 契约](../api/http-contracts.md#桌面文字模拟面试权限)。
