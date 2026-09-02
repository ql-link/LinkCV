# 账号与身份功能

## 功能范围

账号功能覆盖普通用户注册和登录、微信扫码登录、小程序登录、双端会话刷新与退出、微信绑定、本人资料维护，以及管理员查询和启停用户。它为简历、求职中心、AI 助手和资料集提供统一身份，不包含这些领域自己的业务操作。

完整 HTTP 路径、请求字段和错误码见 [HTTP 接口契约](../api/http-contracts.md)；运行时鉴权与渠道关系见 [Backend 架构](../internals/backend.md) 和 [小程序架构](../internals/miniprogram.md)。

## 用户入口

- Web `features/auth/`：登录、注册和微信扫码；Local/Development 支持邮箱密码，Production 普通用户只显示微信扫码。
- Web `features/account/`：昵称、头像，以及跨简历共享的个人画像查看与编辑。
- 小程序登录页、“我的”页和扫码确认页：用户主动确认隐私指引后登录或建号。
- 管理端用户页：管理员查询用户、查看统计并启用或禁用账号。

## 代码地图

| 层级 | 入口 | 职责 |
| --- | --- | --- |
| HTTP | `modules/identity/routes.py` | Web 注册、登录、能力查询、刷新、退出和当前用户 |
| 微信 | `modules/identity/wechat_routes.py` | 二维码、轮询、确认/取消、小程序登录与刷新 |
| 账号 | `modules/identity/account_routes.py` | 本人资料、头像，以及个人画像的读取和整体替换 |
| 管理 | `modules/identity/admin_routes.py` | 管理员用户列表、详情、状态和统计 |
| 会话 | `modules/identity/session_service.py` | Web/小程序 channel、session 创建、轮换与撤销 |
| 鉴权依赖 | `modules/identity/dependencies.py` | 当前用户、可选用户、管理员和小程序用户边界 |
| Web | `features/auth/`、`features/account/` | 登录与用户中心界面 |

## 核心规则

- Web 使用 Cookie 会话，小程序使用 Bearer 会话，两种凭据不能跨渠道混用。
- Web 冷启动先独立确认当前用户，再加载简历概览；概览或其他业务数据返回普通 `5xx` 时保留已经确认的登录态并显示加载错误，只有当前用户为空或后续请求明确返回 `401` 才进入访客状态。
- 微信 openid 已存在时复用账号；首次建号必须由用户主动操作并携带 `privacy_accepted=true`，不能由冷启动、重试或状态探测静默触发。
- 普通用户只能维护本人资料；头像保存为私有对象，读取继续经过归属校验。
- 个人画像独立于简历保存，通过唯一的 `GET/PUT /api/account/user-profile` 入口维护；保存使用乐观锁，过期版本返回最新画像供用户刷新后重试。
- `GET /api/account/profile` 只聚合账号、已成功创建的简历数量和最近简历摘要，不内嵌个人画像，也不把失败或仍在处理的导入任务计入简历数量。
- 工作性质只接受实习和全职；应届生必须填写毕业年份且工作年限固定为 0，非应届生只填写工作年限。薪资上下限、币种和计薪周期按同一组约束校验。
- 被禁用账号不能继续使用既有会话；退出和刷新由统一 session 生命周期处理。
- 管理员身份与普通用户身份使用同一 `users` 表，但管理员登录入口、依赖和授权检查独立。

## 数据归属

`users` 是账号、状态、管理员标记、昵称、头像对象键和微信绑定信息的权威表。`user_profiles` 与用户一对一，保存城市、工作性质、薪资、工作经验、教育背景和技能成果，不复制到简历内容。Redis 保存可撤销 session；对象存储保存头像二进制。业务模块不能自行解析 Cookie/Bearer token 或复制用户状态。

## 关键流程

1. Web 登录验证账号后创建 Web channel session，并以 HttpOnly Cookie 返回 access/refresh。
2. 小程序以微信 code 换取 openid，在隐私门禁通过后复用或创建用户，再返回小程序 channel token。
3. 网页扫码由 Web 创建二维码状态，小程序主动确认后建立网页端会话；取消、过期和已消费状态不能重复签发。
4. 账号资料修改先校验当前用户；头像写入受控对象键，替换或删除时同步处理旧对象。
5. 个人画像保存先比较 `base_lock_version`，再整体替换可编辑字段；版本冲突不覆盖数据库，客户端保留编辑窗口并使用响应中的最新画像刷新。
6. 管理员启停用户只改变账号状态，其他模块在鉴权依赖处统一阻止禁用账号继续访问。

## 权限与失败边界

- 未登录、普通用户、管理员和小程序用户使用不同依赖，不以客户端传入的用户 ID 代替会话身份。
- Production 不公开普通邮箱注册、密码登录或普通改密入口；能力开关由后端返回，不由前端猜测环境。
- 微信上游失败、二维码过期、channel 不匹配、refresh 重放和账号禁用都必须收敛为稳定 HTTP 错误，具体值见接口契约。
- 头像对象存储失败不能留下数据库引用与实际对象不一致的成功结果。

## 修改联动与验证

修改会话、Cookie、Bearer、微信、用户或个人画像字段时，需同步 `schemas.py`、Web API client、小程序请求层、数据库迁移、[HTTP 契约](../api/http-contracts.md)和[小程序架构](../internals/miniprogram.md)。主要自动化入口为 `test_account_routes.py`、画像迁移测试、`test_wechat_routes.py`、`test_identity_resumes_assets.py`、`test_wechat_bind_service.py`，以及 Web `AuthPage`、`WechatQrLogin`、`AccountPage`、`UserProfilePanel` 测试和小程序 `auth/account/request` 测试。
