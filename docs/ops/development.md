# 本地开发与配置

## 分支与发布流程

新的业务需求分支以 `master` 为唯一创建基线。开始开发前先获取远端状态，并从最新 `origin/master` 创建独立业务分支；不得从 `dev` 或其他业务分支派生。完整实现和本地验证完成后，推送业务分支并创建 `业务分支 -> dev` PR，由用户或远端审核合并。

`dev` 是业务需求的共享集成分支，禁止默认直推、自动合并、强推或改写历史。分支创建命令、PR 检查、授权边界和中文提交规范以 [`branch-pr-workflow`](../../.ai/skills/branch-pr-workflow/SKILL.md) 为唯一操作策略来源。

## 环境要求

- Node.js 22 LTS 和 npm 10+
- Python 3.11–3.13，由 uv 管理
- Docker 和 Docker Compose

新环境执行 `npm run setup` 安装 Web、浏览器插件、Pi workspace/服务和后端依赖。复制 `.env.example` 为被 Git 忽略的 `.env` 后，使用 `npm run infra:up` 启动 MySQL、Redis、MinIO 与 RabbitMQ，`npm run db:init` 创建独立 `linkcv` 数据库并应用 Alembic，`npm run dev` 同时启动 Web、FastAPI、文档解析 Worker和独立 Pi 服务。当前 Alembic head `0034`；`0002`–`0022` 建立并演进既有业务结构，`0023` 为历史简历版本新增非空名称，`0024`–`0027` 增加并刷新官方模板，`0028`–`0029` 扩展并收敛多能力模型配置，`0030` 新增 Agent 会话、运行、消息、工具审计与简历修改提案，并允许历史版本使用 `reason=agent`；`0031` 为提案增加稳定定位、诊断、类型化操作、修改依据与资料引用；`0032` 为 Agent 消息增加结构化澄清类型和版本化元数据；`0033` 增加面试求职进程、排期复盘和素材元数据；`0034` 删除存量已归档 JD 并移除 JD 归档字段和索引。

本地开发把 Git 主工作目录中的 `.env.local` 与 `.env.development.local` 作为所有 worktree 的共享私密覆盖层。`npm run dev`/`npm run dev:local` 优先使用当前 worktree 的 `.env`，否则回退主工作目录 `.env`；两处基础文件都不存在时，完整的主目录 `.env.local` 仍可单独作为 Local 配置。`npm run dev:development` 使用当前 worktree 已跟踪的 `.env.development`，再加载主工作目录 `.env.development.local`，并把同一结果注入 Web、FastAPI、Worker 与 Pi Service。新建 worktree 后不需要复制密钥文件。需要临时隔离时可显式设置 `LINKCV_SECRET_ENV_FILE=/absolute/path/to/override.local`。

FastAPI 和 Worker 单独启动时也支持 `LINKCV_ENV_FILE` + `LINKCV_SECRET_ENV_FILE`；未显式指定私密文件且当前目录是 linked worktree 时，会自动寻找主工作目录中的同名 `.local`。Production 仍使用 `.env.production` + `.env.production.local`：仓库文件维护 Cloud Docker DNS 地址，私密文件只提供账号、密码和密钥，不覆盖 `DATABASE_URL`、`REDIS_URL` 或 `MINIO_ENDPOINT`。进程环境变量优先级最高，启动日志只显示配置文件路径，不输出变量值。

`APP_ENV=local|development` 时，Web 登录页开放普通邮箱密码注册和登录，注册成功后直接进入空的简历主页；`APP_ENV=production` 时两个普通入口均隐藏且后端返回 404，只允许普通用户通过微信身份进入。管理员始终使用独立的 `/admin/login`。

`npm run dev:development` 先通过 `scripts/dev/run_with_env_profile.mjs` 加载当前 worktree 的 `.env.development` 与 Git 主工作目录共享的 `.env.development.local`，再转入 `scripts/dev/start-development.sh` 同时启动 Web、FastAPI、解析 Worker 与 Pi。Agent 启动脚本把 Web 到 FastAPI、FastAPI 到 Pi 及 Pi 回调 FastAPI 改为本机回环地址，并把仅在 Docker 网络内可解析的 RabbitMQ 主机名在进程内替换为 Development 主机地址；原始 URL 的账号、密码和 vhost 不会被输出或改写到文件。默认使用 FastAPI 18000、Pi 8010 和 AMQP 5672，可用 `LINKCV_LOCAL_BACKEND_PORT`、`LINKCV_LOCAL_PI_PORT`、`LINKCV_LOCAL_RABBITMQ_HOST`、`LINKCV_LOCAL_RABBITMQ_PORT` 覆盖。两枚仅用于本地进程间鉴权的 Agent token 首次启动时自动生成到被忽略且权限为 600 的 `.runtime/development-agent.env`；脚本不会生成 LLM 密钥环，共享 Development 的 `LLM_CREDENTIAL_ENCRYPTION_KEYS` 仍必须从受控密钥来源写入 `.env.development.local`。

LLM 模型 API key 通过管理员 API 加密进入 MySQL，Fernet 根密钥环必须留在私密 env。格式为 `LLM_CREDENTIAL_ENCRYPTION_KEYS=<keyId>:<fernetKey>`；轮换时把新 key 放在首项，旧 key 以逗号分隔继续保留。可用以下命令生成一个虚构开发 key，输出只应写入被 Git 忽略的 `.env.local` 或 `.env.development.local`：

仓库环境模板中的大模型凭据与鉴权会话说明使用中文注释；环境变量键名及上述密钥环格式仍是稳定的英文机器契约，不随注释语言改变。

```bash
uv run --directory apps/backend python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

local/test 未配置密钥环时，原有非 LLM 接口仍可启动，但保存或解密模型凭据会返回 `LLM_CREDENTIALS_UNAVAILABLE`。Production 必须配置有效密钥环，否则后端拒绝启动。真实模型联调还需要管理员账号、供应商凭据和余额；自动化测试使用 Fake gateway，不访问外部服务。

`.env.development` 复用 LinkRag Dev 的 MySQL、Redis 与 MinIO 服务地址，但数据库固定为独立的 `linkcv`，Redis 固定使用隔离的 DB 2，MinIO 固定使用独立 `linkcv` bucket；不得改为 `tolink_rag_db` 或 DB 0。首次初始化使用：

```bash
LINKCV_ENV_FILE=.env.development npm run db:init
```

命令先校验并创建 `linkcv`，再升级到当前 Alembic head `0034`。图片、导入源文件、面试素材和插件制品读写使用 `MINIO_*` 配置；Bucket 保持私有。面试素材默认最多 500 MiB，由 `INTERVIEW_ASSET_UPLOAD_MAX_BYTES` 在 Local、Development 和 Production 分别配置；上传直接进入 FastAPI 和 MinIO，不经过 RabbitMQ，RabbitMQ 仍只服务异步文档解析等既有 Worker 流程。

微信自动建号、小程序登录和网页扫码确认要求同时配置 `WECHAT_APPID` 与 `WECHAT_SECRET`；密钥只放 `.env.local`、环境对应 `.local` 或进程环境。`WECHAT_LOGIN_PAGE` 默认 `pages/login/index`，`WECHAT_SCENE_TTL_SECONDS` 默认 300 秒，`WECHAT_QRCODE_REQUESTS_PER_MINUTE` 默认每 IP 每分钟 10 次，`WECHAT_LOGIN_REQUESTS_PER_MINUTE` 默认每 IP 每分钟 30 次，`WECHAT_API_TIMEOUT_SECONDS` 控制微信上游超时。未配置时应用仍可启动，但微信登录接口返回 `503 WECHAT_SERVICE_UNAVAILABLE`。

## 微信小程序开发

用微信开发者工具直接导入 `apps/miniprogram`。直接打开时先进入游客首页 `pages/home/index`：该页展示功能介绍、示例简历预览和登录入口，不发起任何账号识别、登录或隐私授权请求；底部提供“首页 / 我的简历”两个标签页，未登录进入“我的简历”只显示可返回的登录引导。用户从首页或引导态主动进入 `pages/login/index` 后，客户端才使用当前微信临时 code 调用只读账号状态接口，根据结果分别显示“同意并登录”或“同意并注册”；登录页与网页登录确认页是两个独立页面，各自在标题下展示单行用途说明（“登录后即可在小程序中查看本人简历”与“来自网页端的登录请求，确认后浏览器将登录 LinkCV”）；该状态查询不创建账号或会话。用户必须查看并勾选微信公众平台配置的小程序隐私保护指引，再主动点击对应按钮（未勾选时在协议区显示行内提示，不使用系统弹窗），也可以选择“暂不登录”返回首页；已有本地会话会直接进入简历列表。扫描 Web 生成的码按 `WECHAT_LOGIN_PAGE`（默认 `pages/login/index`）落地并立即转交独立的 `pages/confirm/index` 确认页（首页收到 scene 参数同样转交），未同意隐私指引时不能确认登录，仍可取消并返回首页。客户端使用基础库 2.32.3 起提供的 `wx.getPrivacySetting`、`agreePrivacyAuthorization` 和 `wx.openPrivacyContract`；隐私 API 不可用时失败关闭并提示升级微信，不能绕过协议自动建号。明确注册和扫码确认携带 `privacy_accepted=true`，后端仅在该值为真时为未知 openid 建号；已有账号的登录以及 refresh 失效后的恢复携带 `privacy_accepted=false`，因而不能静默建号；恢复彻底失败时清除本地凭据并回到“我的简历”登录引导。服务端不把该请求字段保存为同意审计记录。简历详情按最新手动版本下载智能一页 PNG 到本机阅读；本地联调预览图需要 PDF CLI，根级 `npm run dev:local` / `npm run dev:development` 会监听构建，单独启动后端时先执行 `npm --prefix apps/web run build:pdf-cli`。开发版默认访问 `http://127.0.0.1:8000`；后端位于其他内网地址时，在开发者工具控制台执行 `wx.setStorageSync("linkcv_api_base_url", "http://<内网地址>:8000")` 后重新进入小程序，并关闭合法域名校验。该本地覆盖只对 `develop` 生效。体验版和正式版固定使用 `https://linkresume.cn`、强制 HTTPS 并忽略本地存储覆盖；第三方平台代开发时仍可用 `extConfig.apiBaseUrl` 覆盖。发布前还要在微信公众平台登记 request 与 downloadFile 合法域名并发布用户隐私保护指引。API URL 会打入小程序包，本来就是公开信息；仓库和小程序包内不得放 AppSecret。小程序界面与 Web 内部功能区共用同一套 `--ui-*` 设计 Token（`apps/web/src/design-system/tokens.css`，经 `apps/miniprogram/app.wxss` 移植）：冷灰页面背景、白色圆角卡片、蓝色 accent 实心主操作按钮与描边次按钮（同 Web 内容主操作），不使用落地页的营销样式。布局保持小屏简洁：游客首页为居中单列，按标题、示例简历、登录入口、三点说明的顺序排布（登录按钮位于示例内容之后；示例简历为虚构信息的真实文字排版，默认姓名张三，不含任何真实用户数据），简历列表为紧凑单行列表项（小图标 + 标题时间 + 箭头）。两个标签页统一使用自定义导航，顶部间距按 `wx.getWindowInfo` 的 `statusBarHeight` 动态预留（`apps/miniprogram/utils/system.js`），不依赖 CSS 安全区变量；登录与扫码确认成功后先展示完成提示再切换页面，避免切换动画叠加加载态残影。

简历列表和详情元数据使用 `/api/miniprogram/resumes*`，页面内预览使用 `GET /api/miniprogram/resumes/{id}/preview.png`；`/pdf` 端点仍保留文字 PDF 响应。资料设置页 `pages/profile/index` 从“我的简历”进入，采用居中大头像布局（头像下方文字提示可更换）：`button open-type="chooseAvatar"` 让用户主动选择微信头像，`input type="nickname"` 支持一键使用微信昵称；昵称走 `PATCH /api/miniprogram/account/profile` 并同步本地会话用户，头像以 data URL 走 `PUT /api/miniprogram/account/avatar`，展示用 `wx.downloadFile` 从 `GET /api/miniprogram/account/avatar` 下载本机文件（普通 `/api/assets/*` 只接受 Web Cookie）。该页为可选设置项，不并入注册或登录流程；上线前需在微信公众平台《小程序用户隐私保护指引》中声明收集“头像、昵称”。根级本地启动脚本会同时监听构建 `apps/web/dist-server/render-resume-pdf.cjs`；若单独启动 FastAPI，先运行 `npm --prefix apps/web run build:pdf-cli`。首次打开由 `wx.downloadFile` 把 PNG 保存到 `USER_DATA_PATH`，详情页用 `<image mode="widthFix">` 直接展示；同一正式版本后续复用本地文件，退出、会话失效和账号切换清理缓存。发布前须把 `https://linkresume.cn` 同时配置为 request 与 downloadFile 合法域名，不需要业务域名。纯逻辑测试运行 `npm run test:miniprogram`；页面内图片缩放、全部模板排版、私有图片、文件持久化和合法域名仍需开发者工具与真机验收，不能描述为自动化 E2E。

## 默认端口与覆盖

| 服务          | 默认端口 | 配置入口                                            |
| ------------- | -------: | --------------------------------------------------- |
| Vite Web      |     5173 | Vite 默认值                                         |
| FastAPI       |     8000 | `BACKEND_HOST`、`BACKEND_PORT`                      |
| FastAPI（`dev:development`） | 18000 | `LINKCV_LOCAL_BACKEND_PORT`             |
| Pi Agent      |     8010 | `PI_SERVICE_HOST`、`PI_SERVICE_PORT`                 |
| MySQL         |     3306 | `MYSQL_HOST`、`MYSQL_PORT`                          |
| Redis         |     6379 | `REDIS_HOST`、`REDIS_PORT`、`REDIS_DB`、`REDIS_URL` |
| MinIO API     |     9000 | `MINIO_API_PORT`、`MINIO_ENDPOINT`                  |
| MinIO Console |     9001 | `MINIO_CONSOLE_PORT`                                |
| RabbitMQ AMQP |     5672 | `RABBITMQ_PORT`、`RABBITMQ_URL`                     |
| RabbitMQ UI   |    15672 | `RABBITMQ_MANAGEMENT_PORT`                          |

`BACKEND_PROXY_TARGET` 可以覆盖 Vite 使用的完整 FastAPI 地址。数据库可以用完整 `DATABASE_URL` 覆盖分项 MySQL 配置，Redis 可以用 `REDIS_URL` 覆盖分项配置。`AGENT_ENABLED` 控制用户 Agent 入口；`PI_SERVICE_BASE_URL` 是 FastAPI 调 Pi 的内网地址，`LINKCV_BASE_URL` 是 Pi 回调 FastAPI 的内网地址。`PI_SERVICE_TOKEN` 与 `LINKCV_INTERNAL_AGENT_TOKEN` 必须使用两枚不同的高熵值，只写入被忽略的本地或环境私密覆盖。`AGENT_RUN_TIMEOUT_SECONDS`、`AGENT_TOOL_TIMEOUT_SECONDS` 和 `AGENT_PROPOSAL_TTL_DAYS` 分别限制运行、工具调用和待确认提案寿命。Production 开启 Agent 时缺 token 会拒绝启动。鉴权会话和简历导入幂等共用 `REDIS_*` 指向的隔离数据库。

Web 源码中的 `@/` 指向 `apps/web/src/`；Vite、TypeScript 与 Vitest 都维护相同别名。新增 shadcn 组件时从 `apps/web` 运行 CLI，使 `components.json` 能把源码写入 `src/components/ui/`。

## 日志配置

| 环境变量 | 默认/环境值 | 作用 |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | Python 根日志级别 |
| `LOG_SERVICE_NAME` | `linkcv` | JSONL 与 Loki 的固定服务标识，非 `linkcv` 输入会归一化 |
| `LOG_DIRECTORY` | local `.runtime/logs`；容器 `/app/logs` | 本地 JSONL 缓冲目录；为空时只写 stderr |
| `LOG_RETENTION_DAYS` | `7` | 本地轮转文件清理窗口，非 7 输入会归一化 |
| `LOKI_QUERY_URL` | local 空；Dev/Production 为对应内网 DNS | 仅 FastAPI 管理查询使用，Web 不读取 |
| `LOKI_QUERY_TIMEOUT_SECONDS` | `5` | 单次 Loki 查询预算，不自动重试 |
| `LOKI_PUSH_URL` | local 空；Dev/Production 为对应 push URL | 仅 Promtail 读取，应用 Settings 忽略 |

本地直接运行 FastAPI 不要求 Loki 或 Promtail；JSONL 仍写入 `.runtime/logs`，管理查询在 `LOKI_QUERY_URL` 为空时返回 `503 LOG_QUERY_UNAVAILABLE`。不要把 Loki 地址或任意 LogQL 暴露给浏览器。真实日志联调使用虚构账号和内容，并检查 request ID、审计目标、脱敏与七天时间窗。

需要与本机 LinkRag 的 Loki 联调时，先确认 LinkRag 本地 Compose 的 `loki` 和 `promtail` 已启动，再执行 `npm run observability:up`。该命令启动独立的 `linkcv-local-promtail`，默认加入 `tolink-rag-local_tolink-net`、读取 `.runtime/logs`，并推送到网络内的 `http://loki:3100`。LinkRag 和 LinkCV 因此各自维护 Promtail 与 positions，互不读取对方文件；停止 LinkCV 采集器使用 `npm run observability:down`，不会停止或删除共享 Loki。

如 LinkRag 使用了其他 Compose project/network，可通过 `LOKI_DOCKER_NETWORK` 覆盖网络名；LinkCV 日志目录可通过 `LINKCV_LOG_PATH` 覆盖。需要让本地 FastAPI 管理端查询该 Loki 时，为进程设置 `LOKI_QUERY_URL=http://127.0.0.1:3100`，该地址不传给浏览器。

## 简历导入与版本配置

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `RESUME_VERSION_LIMIT` | `10` | 单份简历可保存的版本上限，达到后拒绝新增并由用户手动删除旧版本；最小为 2 |
| `DATASET_UPLOAD_MAX_BYTES` | `10485760` | 知识库资料单文件上传大小上限 |
| `RESUME_IMPORT_MAX_BYTES` | `10485760` | 上传原文件大小上限 |
| `RESUME_MARKDOWN_MAX_BYTES` | `2097152` | 转换后 Markdown 大小上限 |
| `RESUME_STRUCTURING_MAX_BYTES` | `131072` | 允许发送到结构化模型的 Markdown 大小上限 |
| `RESUME_IMPORT_REQUESTS_PER_MINUTE` | `3` | 单用户每分钟最多进入的导入请求数 |
| `RESUME_IMPORT_GLOBAL_CONCURRENCY` | `4` | 单个 FastAPI 进程的导入全局并发上限 |
| `RESUME_IMPORT_USER_CONCURRENCY` | `1` | 单个 FastAPI 进程内单用户导入并发上限 |
| `RESUME_STRUCTURING_TIMEOUT_SECONDS` | `60` | 统一模型结构化阶段的最大时限 |
| `RESUME_IMPORT_UPLOAD_STALE_SECONDS` | `120` | 上传中记录的陈旧收口时限 |
| `RESUME_IMPORT_PARSE_DEADLINE_SECONDS` | `180` | Worker 单个任务解析业务时限 |
| `RESUME_IMPORT_PARSE_STALE_SECONDS` | `240` | 解析中记录的陈旧收口时限，必须大于解析时限 |
| `RESUME_IMPORT_WORKER_LOCK_SECONDS` | `240` | Redis Worker 防重锁时长 |
| `RESUME_IMPORT_IDEMPOTENCY_BIND_TTL_SECONDS` | `30` | 请求占有但尚未绑定导入 ID 的短 TTL |
| `RESUME_IMPORT_IDEMPOTENCY_TTL_SECONDS` | `900` | 请求指纹到导入 ID 映射的重放窗口 |
| `RESUME_IMPORT_WORKER_CONCURRENCY` | `4` | Worker 消费预取并发 |
| `MQ_VENDOR` | `rabbitmq` | Broker 实现，可显式切换为 `kafka` |
| `RABBITMQ_URL` | 本地 RabbitMQ | AMQP 地址；Dev/Production 由私密覆盖提供 |
| `RABBITMQ_EXCHANGE_NAME` | `tolink.cv.resume_import` | durable direct exchange |
| `RABBITMQ_QUEUE` | `linkcv.resume_import.worker` | durable Worker queue |
| `RABBITMQ_ROUTING_KEY` | `resume.import` | RabbitMQ 固定业务路由 |
| `LINKPARSE_BASE_URL` | `http://100.86.10.52:18743` | PDF/DOCX 解析服务地址 |
| `LINKPARSE_API_KEY` | 空 | LinkParse Bearer 凭据，只放 `.local` 或进程环境 |
| `LINKPARSE_PARSE_PATH` | `/v1/parse` | 同步 PDF/DOCX 解析路径 |
| `LINKPARSE_TIMEOUT_SECONDS` | `90` | 单次 LinkParse 阶段时限，不自动重试 |
| `LINKPARSE_RESPONSE_MAX_BYTES` | `3145728` | LinkParse 响应读取上限 |
| `WECHAT_APPID` | 空 | 微信小程序 appid；与 `WECHAT_SECRET` 同时配置才启用微信登录 |
| `WECHAT_SECRET` | 空 | 微信小程序密钥，只放 `.local` 或进程环境 |
| `WECHAT_LOGIN_PAGE` | `pages/login/index` | 网页扫码进入的小程序确认页 |
| `WECHAT_SCENE_TTL_SECONDS` | `300` | 网页扫码场景有效期，30~600 秒 |
| `WECHAT_QRCODE_REQUESTS_PER_MINUTE` | `10` | 每 IP 每分钟生成网页登录码上限 |
| `WECHAT_LOGIN_REQUESTS_PER_MINUTE` | `30` | 每 IP 每分钟小程序自动登录上限 |
| `WECHAT_API_TIMEOUT_SECONDS` | `5` | 单次微信开放平台调用超时 |
| `REDIS_CONNECT_TIMEOUT_SECONDS` | `2` | Redis 连接超时 |
| `REDIS_SOCKET_TIMEOUT_SECONDS` | `2` | Redis 操作超时 |
| `LLM_TIMEOUT_SECONDS` | `75` | 统一托管 LLM Gateway 的单次请求超时 |

Markdown 导入不调用 LinkParse，但 Worker 仍需要数据库中已配置当前 `resume_structuring` binding。PDF 和 DOCX 会把原始二进制和安全文件名发送到 LinkParse；浏览器不读取地址或 Key。API 的频率与受理并发限制保存在 FastAPI 进程内，请求幂等和 Worker 防重保存在 Redis，任务终态保存在 MySQL。默认自动化测试注入 Fake，不访问真实地址或读取 Key。

简历导入使用数据库驱动的统一 LLM 服务和当前 `resume_structuring` binding。模型地址、模型调用名与 API Key 通过管理员 API 管理，凭据由 `LLM_CREDENTIAL_ENCRYPTION_KEYS` 加解密；调用不自动重试，也不回退其他候选。环境只保留密钥环与统一的 `LLM_TIMEOUT_SECONDS`，不再配置导入专用 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 或重试参数。

本地 PDF/DOCX 联调时，把 `LINKPARSE_API_KEY=<受控凭据>` 写入被 Git 忽略的 `.env.local` 或 `.env.development.local`，不要写入三份仓库环境文件、命令行历史、日志或测试 fixture。Key 缺失时 Development 仍可启动，Markdown 可测，PDF/DOCX 明确返回 `DOCUMENT_CONVERSION_UNAVAILABLE`。

## 常用命令

| 命令                                  | 作用                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `npm run db:migrate`                  | 将数据库升级到 Alembic 最新版本                                      |
| `npm run db:init`                     | 仅允许创建 `linkcv` 数据库并升级到 Alembic head                      |
| `npm run db:revision -- -m <message>` | 创建 forward-only 的 SQL revision，以及同 ID 的 `.up.sql` 文件       |
| `npm run dev:development`             | 使用共享 Development 中间件，一键启动 Web、FastAPI、Worker 与 Pi    |
| `npm run test:web`                    | 前端 Vitest 单元和组件测试                                           |
| `npm run dev:pi`                      | 单独启动无头 Pi Agent 服务                                           |
| `npm run test:pi`                     | 运行 Pi 服务单元测试                                                  |
| `npm run check:pi`                    | 校验静态模型目录、离线构建 Pi 并测试服务                              |
| `npm run prepare:pi`                  | 校验仓库内版本化 Pi 模型目录快照，不访问在线模型目录                  |
| `npm run refresh:pi-model-data`       | 维护时显式刷新并重新生成 Pi 模型目录快照                              |
| `npm run test:miniprogram`            | 小程序纯逻辑 Node 测试                                               |
| `npm run dev:extension`               | 启动 WXT 插件开发模式                                                |
| `npm run test:extension`              | 插件 DOM 提取与 API 客户端测试                                       |
| `npm run build:extension`             | 构建可侧载的 Chrome MV3 目录                                         |
| `uv run --directory apps/backend python ../../scripts/release/build_extension_release.py ...` | 生成并校验 Development/Production 插件发布 ZIP 与 SHA256SUMS |
| `npm run test:backend:unit`           | 后端快速单元测试                                                     |
| `npm run test:backend:integration`    | 后端隔离 HTTP 集成测试                                               |
| `npm run test:backend`                | 全部后端和仓库工具测试                                               |
| `npm run check`                       | 完整本地质量入口                                                     |

## 测试分层

- 前端测试使用 Vitest、React Testing Library 和 jsdom，通过 Mock 隔离 API。
- 后端单元测试不访问外部服务；集成测试使用内存 SQLite 和假 MinIO。
- Pi 服务测试不访问真实模型或 FastAPI；真实 Agent 联调需要管理员配置并验证当前 `pi_agent` 模型，并启动 FastAPI 与 Pi 两个进程。
- 跨浏览器插件、BOSS 页面、Web、FastAPI、真实 MySQL 和 Redis 的完整导入流程由浏览器人工验证。侧载目录和步骤见 [`apps/extension/README.md`](../../apps/extension/README.md)。
