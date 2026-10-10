# 构建与部署

## 当前状态

Vite 与根级 Docker Web 构建仅使用 `index.html` 作为 HTML 入口；落地页演示截图随源码作为静态资源打包，`landing-demo.html` 仅用于开发期生成截图。演示边界见 [Web 公共落地页](../internals/web.md#公共落地页与产品演示)。

Web 构建会把统一打印文档、页面现有主题 CSS、固定字体文件和一次性 Chromium 驱动 CLI 输出到 `dist-server`，FastAPI 生产镜像复制为 `/app/pdf`。Web 当前快照与小程序正式版本都通过有界 stdin 传入该脚本并从 stdout 接收完整 PDF；小程序 PNG 再由 Python 进程内的 PDFium 临时栅格化。进程完成即退出，快照、PDF 和 PNG 都不写入服务端持久存储。FastAPI 镜像中的 Node 22 只承载该脚本，不新增常驻 PDF 服务。

根级 `Dockerfile` 构建 Vite 静态产物和 FastAPI Python 环境，并把 Node 22、锁定的 `playwright-core` 运行库和 Debian Chromium 复制/安装到运行镜像。PDF 子进程以专用非登录用户 `linkresume-pdf` 运行，保留 Chromium 沙箱；固定路径为 `/usr/bin/chromium`，智能一页默认上限为 2000mm。独立的 `deploy/Dockerfile.pi` 构建无头 Pi Service 镜像。Web 构建阶段会把 `postcss.config.cjs`、`tailwind.config.cjs`、PDF CLI 与应用源码一起复制到 `/app/apps/web`；Pi 构建阶段安装 vendored workspace 的锁定依赖并校验仓库中版本化的模型目录快照。常规 Docker 构建不访问 `models.dev`、OpenRouter、NVIDIA NIM 或 Vercel AI Gateway，只有维护者主动执行 `npm run refresh:pi-model-data` 时才联网刷新模型快照。Node 依赖查询默认使用 npmmirror，但 `npm ci` 禁止替换 `package-lock.json` 已锁定的 tarball 主机。固定版本的 `uv` 与 Python 依赖默认使用阿里云 PyPI；Production Cloud 还通过 `DEBIAN_MIRROR` build arg 使用阿里云 Debian 镜像，apt 继续校验 Debian 仓库签名，本地及其他构建默认使用官方 `deb.debian.org`。构建过程从 `uv.lock` 导出带哈希的 requirements。镜像构建不连接数据库。FastAPI 容器启动时 runner 先核对 `APP_ENV`、MySQL host、port 和 database，再只读比对 Alembic 当前版本与 `0030` Agent 表、`0031` 范围化提案字段、`0032` 结构化澄清消息字段、`0033` 面试中心三张表等已知 schema 标记；任一对象提前存在、缺失或部分应用都会在执行 DDL 前终止部署。目标和 schema 对齐后才升级到 Alembic head，并由 Uvicorn 在 `8000` 端口提供 `/api` 与 Web 静态文件。

其中 `0051` 的发布门禁还核对 `user_profiles` 的画像目标列和已删除旧列。未应用但已经是完整目标结构时允许 migration 自身做 no-op；已应用后若目标列缺失或旧列残留，runner 会在任何后续 DDL 前停止。`0065` 门禁同样会拦截提前删除或在 revision 已应用后仍残留的 `agent_sessions.resume_id`。

仓库提供相互独立的 Dev 与 Production Jenkins Pipeline。两者都关闭 Declarative Pipeline 的隐式 Checkout，只对显式 `checkout scm` 最多尝试三次，避免同一构建重复拉取仓库并缓解短暂 GitHub 连接中断。随后以同一 commit/build 标识生成不可变 `linkresume` 与 `linkresume-pi` 镜像，先停止会读写旧 schema 的当前 LinkResume Web、Worker 和 Pi，再用新 `linkresume` 镜像以显式目标参数运行迁移 runner、更新 Compose，最后等待 FastAPI `/api/health`、Pi 容器健康状态和本环境 Promtail 正常；构建镜像阶段不连接数据库。发布成功时单独检查 FastAPI `/api/agent/readiness` 并报告非 200 状态，不以模型尚未配置或探测过期阻止部署。Agent readiness 会穿透 FastAPI→Pi→FastAPI 内部回调并验证当前 `assistant_conversation` 用例存在可用的 Pi 对话线路，但不发起供应商模型调用；非 200 表示对话能力不可用，仍需配置或排障，不代表基础服务部署失败。首次从 SQLite `linkcv` 切换是例外：旧栈在独立导入窗口前保持服务。

Dev 与 Production Compose 各自部署一个 `grafana/promtail:2.9.8`，读取 LinkResume 应用挂载的环境独立日志命名卷，并把 positions 保存到另一个独立命名卷。Promtail 只提升 `service`、`environment`、`log_type`、`level` 四个低基数字段为 Loki labels；request/user/target/operation 等高基数字段保留在 JSON body。Dev 推送并查询 `http://tolink-dev-loki:3100`，Production 使用 `http://tolink-loki:3100`；两者都是 LinkRag 已有、保留七天的共享实例，本仓库不创建或修改 Loki。应用写本地 JSONL，Promtail 异步采集，因此 Loki 暂时不可用不会阻断业务请求。

`deploy/docker-compose.yml` 只用于本地启动 MySQL 8.4、Redis、MinIO 和 RabbitMQ。Dev 与 Production Compose 使用 `linkresume` 镜像分别启动包含静态 Web 与 FastAPI 的容器及执行 `python -m linkresume.workers` 的 Worker，并使用 `linkresume-pi` 镜像启动独立无头 Agent 服务。Pi 只加入环境内网，不映射宿主机端口；FastAPI 是浏览器唯一业务入口。两套远端环境复用平台 RabbitMQ，不在应用 Compose 内创建 Broker。
Worker 将结构化日志写入共享日志卷的独立子目录，Promtail 同时采集 Web/FastAPI 与 Worker，避免多个进程并发轮转同一个文件。本机日志联调另使用 `deploy/docker-compose.observability.local.yml` 启动 LinkResume 自己的 Promtail，并复用 LinkRag 本地 Compose 已部署的 Loki；它不创建第二个 Loki，也不停止 LinkRag 的采集器。

## Dev Pipeline

Dev Jenkins Job 使用 `deploy/jenkins/Jenkinsfile.development`。Jenkins 将当前 checkout 通过 `git archive` 打包并上传 Primary `100.86.10.52`，由 `deploy/scripts/build-development-on-primary.sh` 在 `/opt/tolink/dev` 内完成构建和部署，因此远端构建内容与 Jenkins 当前 commit 一致。

- 镜像：`linkresume:dev-<commit>-b<build-number>`、`linkresume-pi:dev-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/dev/linkresume`
- Compose：`deploy/docker-compose.development.yml`
- 容器：`linkresume-dev`、`linkresume-worker-dev`、`linkresume-pi-dev`、`linkresume-dev-promtail`
- 网络：外部网络 `tolink-dev-net`
- 宿主机端口：`18002`
- 配置：`.env.development` + 权限为 `600` 的 `.env.development.local`；开发环境不要求微信凭据
- 迁移门禁：`APP_ENV=development`、MySQL `100.86.10.52:13306/linkresume`

共享 Dev 的 `18002` 直接映射到 FastAPI `8000`，没有 LinkResume 专用 Nginx；`/api/mock-interviews/{id}/speech` 的 WebSocket 握手由 FastAPI 直接处理。用本地 Vite 页面联调时，通过其同源 WebSocket 代理转发，见 [Web 模块](../internals/web.md#api-调用)。

Dev Jenkins 节点需预置 `/var/jenkins_home/.ssh/primary_dev`，并能以 `root` 连接 Primary。Primary 需已有 Docker、Docker Compose、`tolink-dev-net` 和私密 env 文件。发布脚本在迁移与容器替换前检查私密文件权限，并通过 FastAPI `Settings` 校验必需的中间件与服务配置；开发环境仅开放邮箱密码认证。LinkResume Dev 使用独立 `linkresume` MySQL 数据库、MinIO bucket 和 Redis DB 2；本地密钥文件只保存凭据，不覆盖仓库中的地址与资源名。任一前置条件、迁移或健康检查失败都会让 Job 失败。

`linkresume-dev` 的 Generic Webhook Trigger 只接受 `refs/heads/dev`。token 通过 Jenkins Secret Text 凭据 `linkresume-dev-webhook-token` 注入，仓库不保存 token；GitHub 仓库 webhook 只订阅 push 事件。

## Production Pipeline

Production Jenkins Job 使用根目录 `Jenkinsfile`。Jenkins 位于 Primary，只负责 checkout、可选质量检查和 `git archive`；随后通过专用 SSH 密钥把当前提交归档上传到 Cloud `100.77.31.79`，由 `deploy/scripts/build-production-on-cloud.sh` 在真实生产主机本地构建、发布 Web 静态资源、迁移和部署。Production 不再使用 Primary 的 Docker socket 创建生产镜像或容器。

- 镜像：`linkresume:prod-<commit>-b<build-number>`、`linkresume-pi:prod-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/LinkResume`
- Compose：`deploy/docker-compose.production.yml`
- 容器：`linkresume`、`linkresume-worker`、`linkresume-pi`、`linkresume-promtail`
- 网络：外部网络 `tolink-app-net`
- 宿主机端口：`4174`（容器内 FastAPI 仍监听 `8000`，保持现有生产反向代理上游）
- 配置：`.env.production` + 权限为 `600` 的 `.env.production.local`
- 迁移门禁：`APP_ENV=production`、MySQL `tolink-mysql:3306/linkresume`

生产公网入口由 Cloud 上的 `linkrag-web` Nginx 容器承载，LinkResume 虚拟主机配置从宿主机 `/opt/tolink/LinkRag-Web/nginx/linkresume.conf` 单文件挂载。`/api/mock-interviews/{id}/speech` 的独立代理规则转发到 `172.20.0.1:4174`，使用 HTTP/1.1，传递 `Host`、`X-Forwarded-Proto`、`Upgrade` 和 `Connection`，读写超时均为 600 秒；普通 `/api` 请求仍走既有根路径代理。变更该外部配置后，在 `linkrag-web` 容器内执行 `nginx -t` 并核对已加载配置；如果宿主机文件被原子替换，须重启容器以重新挂载，单纯热重载仍会读取旧 inode。语音 WebSocket 必须由页面同源发起，后端还会校验 `Origin` 与 `Host`；代理配置生效不代表未部署语音后端的环境已经通过语音联调。

Production Web 只把 Vite 生成的哈希 `/assets/*` 发布到阿里云 OSS Bucket 的 `LinkResume/assets/` 前缀，并把入口 favicon 发布到 `LinkResume/favicon.png`，由浏览器直接通过 `https://qingluo-public.oss-cn-shanghai.aliyuncs.com/LinkResume/` 读取；不使用 CDN、自定义静态域名或独立证书。`index.html`、SPA 路由和 `/api/*` 仍由 `https://linkresume.cn` 的公网 Nginx 与 FastAPI 提供。根 `Dockerfile` 通过 `VITE_ASSET_BASE_URL` 把 OSS 地址写进生产 HTML，同时继续在镜像 `/app/web/assets` 保留哈希资源和在 `/app/web/favicon.png` 保留入口图标。发布脚本从即将部署的不可变镜像提取这些文件，由 `deploy/scripts/publish_web_assets.py` 使用最多 8 个并发 OSS HTTPS HEAD 请求比较本地内容 MD5、对象 ETag、长度与响应头。内容和响应头均一致的对象跳过上传；ETag 无法证明内容相等（如分片上传）时，下载对象比较内容摘要；缺失、变化或缓存头不符的资源才交给 `ossutil 2.4.0` 上传。哈希资源设置一年 `immutable`，favicon 单独比较并设置一小时缓存。新增或重新上传的对象再次检查内容、缓存头与可用性，JavaScript/字体还检查跨域响应，favicon 检查 `image/png`；错误 CORS 仍阻断发布，不修改 Bucket CORS。校验使用兼容生产 `curl 7.29.0` 的 `--retry 2`、连接超时和总超时设置，日志记录上传和跳过数量；全部成功后才允许初始化数据库、迁移和切换应用。上传或 OSS 验证失败发生在切换前，旧生产版本继续服务。

`index.html` 继续 `no-cache`，新版本能及时引用新的哈希资源。发布过程不删除 `LinkResume/` 下的历史 OSS 对象，因为上一版镜像回退后仍会引用旧哈希；未来清理必须基于明确的保留发布清单独立实施。当前 `qingluo-public` 是多个项目前缀共用的公共读 Bucket，发布对象使用 `default` ACL 继承 Bucket 权限，不修改 Bucket ACL；RAM 写权限必须限制在 `qingluo-public/LinkResume/*`。Bucket CORS 必须允许 `https://linkresume.cn` 和 `https://www.linkresume.cn` 对公开对象发起 `GET`、`HEAD`，允许请求头 `*`，从而保证浏览器可加载跨域 JavaScript 与字体；该规则不授予上传、修改或删除权限。对象的长期缓存由上传时写入的 `Cache-Control` 控制。

`linkresume-prod` 的 Generic Webhook Trigger 复用 Jenkins Secret Text 凭据
`linkresume-dev-webhook-token`，但只接受 `refs/heads/master`。同一个 GitHub push
webhook 因此会分别把 `dev` 推送交给 Dev Job、把 PR 合并产生的 `master` 推送交给
Production Job。首次加入触发器后需手动运行一次 `linkresume-prod`，让 Jenkins 从根
`Jenkinsfile` 加载并注册触发器；后续 `master` push 自动构建。

Jenkins 容器需预置权限为 `600` 的 `/var/jenkins_home/.ssh/cloud_prod`，Cloud 只授权这把发布密钥并限制来源。Production Pipeline 会把仓库中的非敏感 `.env.production`、Compose 和 Promtail 配置复制到部署目录；应用私密覆盖必须由部署密钥存储预先提供到 `.env.production.local` 且权限为 `600`。OSS 发布凭据使用另一个不进入 Compose 的 `/opt/tolink/LinkResume/.env.oss-cdn.local`，格式见 `deploy/oss-cdn.env.example`；文件必须为 `600`，包含目标 Bucket、OSS Region 和专用最小权限 RAM 凭据，可选设置 OSS Endpoint。发布脚本通过 ossutil 官方环境变量读取凭据，不把 AccessKey 放入命令参数、镜像、应用进程或日志。除 JWT、MySQL 和 MinIO 凭据外，新版本还要求覆盖提供有效的 `LLM_CREDENTIAL_ENCRYPTION_KEYS`、`LINKPARSE_API_KEY`、`RABBITMQ_URL`、`WECHAT_APPID`、`WECHAT_SECRET` 与两枚不同的 `PI_SERVICE_TOKEN`/`LINKRESUME_INTERNAL_AGENT_TOKEN`，否则相关 preflight、Settings、Pi 服务或微信登录会安全失败。生产网络还必须允许后端访问 `api.weixin.qq.com`。LLM 密钥环用于解密 MySQL 中的模型凭据，不是供应商 API key；轮换时先发布“新 key 在首项、旧 key 仍保留”的配置，确认旧密文已经重包后才能移除旧 key。LinkParse Key、微信 AppSecret 和 Agent 服务令牌都只供服务端使用，不进入 Web 或小程序制品。
首次从旧 `linkcv` 生产栈切换到 `linkresume` 时，发布前必须为新资源完成数据库与对象存储的一致性迁移，并保留旧 `/opt/tolink/LinkCV` 配置、数据库、bucket 和镜像。Cloud 发布脚本允许仍由 `linkcv` 独占 4174 的受控首次切换：新镜像构建和迁移完成后才停止旧 Web、Worker、Pi 与 Promtail，再整体启动 `linkresume`；新栈健康检查失败时先撤下新 Compose，再用旧目录、旧配置和原镜像标签恢复 `linkcv`。首次切换验证完成前不得删除任何旧资源。

首次从旧 `linkcv` 生产栈切换到 `linkresume` 时，发布前必须为新资源完成数据库与对象存储的一致性迁移，并保留旧 `/opt/tolink/LinkCV` 配置、数据库、bucket 和镜像。Cloud 发布脚本允许仍由 `linkcv` 独占 4174 的受控首次切换：新镜像构建和迁移完成后才停止旧 Web、Worker、Pi 与 Promtail，再整体启动 `linkresume`；新栈健康检查失败时先撤下新 Compose，再用旧目录、旧配置和原镜像标签恢复 `linkcv`。首次切换验证完成前不得删除任何旧资源。

Production 使用 `APP_ENV=production`，普通 Web 用户只能通过微信小程序扫码登录；管理员仍使用独立 `/admin/login`。微信公众平台必须把 `https://linkresume.cn` 同时配置为 request 与 downloadFile 合法域名并使用有效公网 HTTPS 证书；简历以 PNG 在小程序当前页面阅读，不使用 `web-view`，个人主体无需配置业务域名。上线前还要核对既有邮箱账号：系统不会仅凭同一使用者自动把新 openid 关联到旧邮箱账号，未绑定账号会生成新的微信账号而看不到旧简历；必须先完成受控账号映射或明确接受账号分离，不能直接假设历史数据会自动归并。

### 首次 Production SQLite 切换

旧 Express Production 使用 `/opt/tolink/LinkResume/data/resume_app.sqlite`。首次切换到 FastAPI/MySQL 时，维护者手动运行 Production Job 并显式开启 `IMPORT_LEGACY_SQLITE`；该参数默认关闭，Pipeline 也明确拒绝 webhook 构建开启它，因此自动构建不会重复导入。远端脚本在旧应用继续服务时完成镜像构建、空 `linkresume` database 初始化和 Alembic 升级；进入导入窗口后才短暂停止旧容器，通过 SQLite `.backup` 合并 WAL 并生成一致只读快照。随后先对全部旧记录执行 dry-run，最后仅在目标 `users`、`resumes`、`resume_templates` 都为空时用单事务导入。快照或导入失败会立即恢复旧容器。

导入保留账号邮箱、bcrypt 密码摘要、账号时间、简历标题、Markdown 和可映射样式；每份简历创建一个“初始版本”。旧字符串主键会映射到新的自增主键。登录同时兼容 bcrypt 与 Argon2，旧账号首次成功登录后立即把摘要升级为 Argon2。旧 SQLite 会话不迁移，切换后用户必须重新登录。任何记录无法安全转换、目标表非空或事务失败都会停止发布，不允许部分导入。

首次切换完成后，确认 MySQL revision、用户/简历/版本数量、登录、简历读取、Worker、Pi、Promtail 和 `http://127.0.0.1:4174/api/health` 正常，才允许恢复正常自动发布。另行核对 `/api/agent/readiness`；如果模型尚未配置或探测过期，记录并处理对话能力不可用状态，不把它误判为基础部署失败。旧 SQLite 与切换备份不得立即删除。

本期没有管理员开通接口。发布方还需在受控流程中确保至少一个既有用户被标记为 `users.is_admin=true`；公开注册始终是普通用户。没有管理员只会使 `/api/admin/llm/**` 无法使用，不会放宽权限。

生产容器通过 `tolink-app-net` 使用 Docker DNS 连接 MySQL、Redis、MinIO 和平台 RabbitMQ，并须能访问仓库配置的 LinkParse。MySQL、Redis、MinIO、RabbitMQ 与 LinkParse 都不由 Production Compose 创建。Worker 使用 RabbitMQ durable queue、`tolink.resume.resume_import.v2` exchange、`linkresume.resume_import.worker.v2` queue 和 `resume.import.v2` routing key，并保留 DLX/DLT。简历导入的业务解析失败落 MySQL 终态且不自动重试，公共依赖不可用时保留消息；资料任务额外以 MySQL `queued` 为持久待分发标记，由 Worker 扫描补发、原子抢占并恢复陈旧尝试，不依赖 Outbox。

模板创建与异步导入是同一版本的跨端契约，Web、FastAPI、Worker 和迁移必须一起发布。执行 `0017` 前先运行 `uv run --directory apps/backend python scripts/release/cleanup_legacy_resume_imports.py` 获取 dry-run 清单，人工确认后再加 `--execute`；旧导入未归零时迁移会拒绝继续。

执行 `0021` 前必须确认目标数据库已有可恢复备份。该 revision 先迁移全部 `resume_imports` 数据并回填 `resumes.parse_task_id`，随后删除旧表；旧应用不能在新 schema 上运行，新应用也不能在旧 schema 上运行，因此迁移成功后必须立即整体替换 FastAPI 与 Worker，不设灰度兼容窗口。需要恢复旧数据库状态时只能使用迁移前备份。

执行 `0022` 前必须同时确认数据库和对象存储已有可恢复备份，并先运行 `uv run --directory apps/backend python scripts/release/cleanup_legacy_user_datasets.py` 核对清理清单；人工确认后才加 `--execute`，再迁移数据库。该 revision 删除上线前全部 `user_dataset` 行，扩展通用解析任务以承载 `dataset` 来源及失败分类，并为资料记录增加任务指针；旧资料与源文件只能从备份恢复。迁移成功后必须同时替换 FastAPI 与 Worker，使资料任务与既有简历导入共用同一消费链路。

执行 `0023` 前必须确认目标数据库已有可恢复备份。该 revision 为 `resume_versions` 增加非空 `name` 并回填已有版本名称。新后端依赖该列读取和写入版本，旧后端不能向新 schema 创建缺少名称的版本，因此迁移成功后必须配套替换 FastAPI 与 Web，不能让新旧应用与该 schema 混用。

执行 `0043` 前必须确认数据库已有可恢复备份。迁移会给历史资料回填幂等键与请求指纹，但保留原有解析状态和对象引用；历史 `processing` 任务由新 Worker 按陈旧租约规则恢复。新 FastAPI、Worker 和 Web 依赖新增字段与 `queued` 状态。发布顺序固定为迁移、Worker、FastAPI、Web，应用回退必须评估新旧任务状态兼容性，不能只回退其中一个组件。

执行 `0049` 前必须确认数据库已有可恢复备份，并先在维护窗口运行迁移预检。该 revision 只为活动 `resume_import` 任务回填受理时的完整 `TemplateDefinition` 快照；缺少模板 ID、模板行不存在或定义无效会在 DDL 前终止，资料集和终态历史任务保持空值。迁移成功后必须同时替换 FastAPI 与 Worker，确认 Worker 使用任务快照而不是当前模板行；数据库迁移为 forward-only，失败或应用回退依赖备份，不执行 downgrade。

`0049` 的维护窗口必须先停止简历导入受理入口和 Worker 消费，并等待正在执行的受理事务、上传确认和 Worker 终态写入结束；从预检开始到 `0050` postverify 完成期间禁止创建新的活动 `resume_import` 任务。`0050` 会在首笔写入前校验 `resume_templates`、`resumes` 与 `resume_versions` 的全部 canonical 快照，只把白名单内完整的历史 `:icon[Name]:` 标记转换为结构化图标；未知或不完整标记保留原文，结构化图标与旧标记并存等语义冲突会中止迁移。RabbitMQ 中的待消费消息保留不删除，待迁移完成且数据库 current 已核对为 `0050` 后，再按“Worker、FastAPI、Web”顺序恢复。不能依赖新增的可空列来容忍迁移中途受理，否则新任务可能绕过本次预检而形成未完成快照。

执行 `0051` 前必须确认目标数据库已有可恢复备份并停止画像写入。runner 和 revision 只接受完整的旧画像结构或完整的当前画像结构；旧结构会在本 revision 内完成 0045/0046 规则的前向转换，当前结构只验证后推进版本。已应用 `0051` 的数据库还必须通过目标画像列存在、旧列（包括中间 `professional_directions`）消失的门禁。未知或部分结构在任何 DDL 前停止；MySQL DDL 失败只能依赖备份整体恢复或新的 forward revision，不能执行 downgrade。

执行 `0065` 前必须验证可恢复的 MySQL 备份，并停止旧 Web、Worker 和 Pi 容器。该 revision 先更新缺少上下文的历史 Agent 用户消息，再删除旧应用仍会访问的 `agent_sessions.resume_id` 及索引；迁移时间同时受历史消息回填量影响。迁移开始后发布脚本不得自动恢复旧镜像。若新应用健康检查失败，保持旧容器停止，核对实际 schema 后选择前向修复，或先恢复迁移前数据库备份再恢复与之匹配的旧镜像。runner 同时核对该列和 `idx_agent_sessions_resume_pinned_updated` 索引，拒绝 revision 与物理 schema 不一致的数据库。

两条 Pipeline 都提供 `RUN_TESTS` 参数；开启后会在镜像构建前运行 `npm run setup && npm run check`。常规 PR/push 质量检查仍由 GitHub Actions 执行。

## CI

`.github/workflows/quality.yml` 在面向 `dev`、`master` 的 PR 和对应分支 push 上按改动路径并行执行质量检查：`extension`、`desktop`、`miniprogram`、`pi`、`devenv` 与 `contracts` 各为独立 job，只在对应目录有改动时运行；共享分支 push、无法确定基线或改动了根 `package.json`、lockfile、`scripts/quality/` 与该 workflow 时全部运行。`check` 是汇总 job，保留 `Quality / check` 状态名，被跳过的 job 视为通过、任一 job 失败或取消则失败；同一 PR 连续推送会取消较早的运行。业务需求从最新 `origin/master` 创建独立业务分支，完成后向 `dev` 提 PR。本地的 `npm run check` 与 CI 各 job 复用同一组质量脚本，完整分支规则见 [本地开发与配置](development.md#分支与发布流程)。

CI 会安装锁定的 `third_party/pi` 与独立 `apps/pi-service` 依赖，并先校验仓库内版本化模型目录快照。CI 不再运行 Web 与后端的完整测试和构建（`web`、`backend` job 已移除），这两类检查改由本地 `npm run check:web`、`npm run test:backend` 等命令在提 PR 前运行。MySQL 迁移校验拆为独立的 `migrations` job，使用一次性 MySQL 8.4 服务：PR 只有改动迁移目录、迁移测试、ORM `models.py`、`migration_sql.py`、`alembic.ini`、`uv.lock` 或该 workflow 时才运行，推送到 `dev`、`master` 时总是运行。它从空库执行两次 `alembic upgrade head` 验证完整链路与幂等，并按本次新增 revision 编号运行 `test_mysql_migrations.py` 中同名测试；该数据库只包含虚构测试数据，不连接 Development 或 Production。应用检查 job 不启动 MySQL。独立的 `rules` job 只安装 uv 与后端依赖，始终运行 AI 入口、项目 Skill 和文档同步检查，文档未同步时无需等待 Node 依赖安装即可失败；需要 Web 依赖的运行时契约由 `contracts` job 在 Web、后端、部署或脚本有改动时运行。独立 Pi 镜像在关闭网络的构建层再次校验该快照并执行离线构建，不在 Production 构建时访问实时模型目录。

## 恢复与应用回退

- 应用回滚必须把 `TAG` 与 `PI_TAG` 一起切回同一环境、同一版本的两个不可变镜像标签并重新执行 Compose；不得把 Dev 标签部署到 Production。
- 数据库迁移是 forward-only：当前与历史 revision 都不提供 down SQL，禁止执行 Alembic downgrade，也不做升级降级往返测试。
- 发布前按迁移风险准备并验证数据库及相关对象存储备份。需要恢复旧数据库状态时使用备份；普通 schema 或数据缺陷通过新的向前 revision 修正。
- 面试录音转写需要在部署覆盖中设置 `MINIO_PUBLIC_ENDPOINT`（阿里云语音服务可访问的 MinIO 公网地址，用于生成 6 小时预签名下载链接；为空时转写任务失败为 `INTERVIEW_TRANSCRIPTION_STORAGE_UNAVAILABLE`），并在 LLM 治理中为 `speech_to_text` 配置阿里云线路且开通对应录音文件识别模型；`INTERVIEW_TRANSCRIPTION_ENABLED`、`INTERVIEW_TRANSCRIPTION_POLL_SECONDS`、`INTERVIEW_TRANSCRIPTION_MODEL` 见 `.env.example`。转写轮询运行在 Worker 进程。
- 当前仓库 head `0115`。`0111–0115` 按阿里巴巴 MySQL 规约整改全部表（补注释、布尔字段改为 `is_xxx`、删除全部数据库外键、补齐 `id` 与 `create_time`/`update_time`、表名改为单数），细节见[后端内部说明](../internals/backend.md#阿里巴巴-mysql-规约整改)。它们会改动所有表名，必须在停服窗口内先备份再迁移；`0115` 之后旧镜像无法运行，失败只能从备份恢复。更早的 revision 说明如下：`0034` 删除存量已归档 JD 并移除对应字段和索引，`0035` 为 JD 图片智能导入新增空的 `job_image_structuring` 模型能力绑定，`0043` 为资料上传增加幂等、可靠排队与解析尝试字段，`0049` 为活动简历导入任务回填受理时冻结的模板定义快照，`0050` 将白名单内完整的历史 Markdown 图标标记规范化为 canonical 结构化图标，`0051` 为已登记画像结构漂移提供 forward-only 修复和发布门禁，`0052` 为 Agent 会话增加持久化置顶状态及列表索引，`0053` 将历史 OC/书面 Offer 合并为统一状态并增加可选 Offer 详情字段，`0054` 将 Offer 薪资区间收敛为单值字段，`0055` 删除手工岗位职位描述的非空白检查约束，`0056` 将岗位用工类型约束收敛为 `internship/campus/full_time` 或空值并拒绝不兼容存量值，`0057` 新增求职生命周期与阶段历史并在回填后拒绝孤立排期或缺失当前阶段，`0058` 增加固定场次/开放窗口类型和开放窗口个人作答计划字段，`0059` 增加岗位 Logo URL 与独立全局公司资料表，`0060` 增加资料库文件夹分类，`0061` 增加资料当前正文指针、替换操作与对象清理记录，`0062` 增加公司 Logo 内容指纹，并只对已登记的 Development 旧 `0059` 完整结构执行缺失基础 DDL 的增量补齐；已有 `user_preferences` 不删除。`0063` 为独立简历翻译提案增加新标题与结果简历字段，`0064` 增加分享页 PDF 下载权限，`0065` 先把旧绑定回填为消息上下文，再删除 Agent 会话上已废弃的持久化简历绑定字段及其复合索引，会话、运行和消息记录保留。`0066`–`0081` 分批扩充、调整和退役简历模板目录；`0082` 将面试录制或上传的音视频素材统一迁入 `user_dataset`，并增加素材类型、面试关联、时长和旧素材 ID 的完整性约束。 `0083` 新增 Agent 操作轨迹；`0084` 建立当前简历复制幂等和求职可选关联；`0094` 新增应用内公告与用户已读时间点两张空表，属于纯加法变更；`0095`、`0096` 新增模拟面试表及其语音作答字段；`0097` 为 `llm_models` 增加默认值为 1 的 `user_selectable` 列，升级后存量模型保持可选。
- 如果使用执行 `0033` 前的数据库备份恢复，必须同时处理备份之后写入 MinIO 的面试对象；只恢复数据库会产生失去元数据索引的对象。
- 只有旧应用兼容当前新 schema 时才允许回退应用镜像。若不兼容，必须继续向前修复或按完整恢复方案同时恢复数据库与应用，不能只回切镜像。
- MySQL DDL 可能隐式提交；迁移失败后停止自动重试，核对实际 current 和 schema，再决定新 revision 或备份恢复。
- 回滚到旧镜像时仍要保留新旧完整 LLM 密钥环，直到确认没有运行实例或密文依赖待移除的 key。
- 只有首次 Production 切换会通过受控工具把旧 Express/SQLite 的账号和简历导入 MySQL；本地原型 SQLite 不进入远端数据库。旧 SQLite 只作为切换前应用的短时回退依据，不能接收或合并新 MySQL 写入。
- 新增环境配置的回滚只恢复应用与 Compose；不得自动删除已有 `linkresume` 数据库或 Redis volume。
- 静态资源回滚不删除 OSS 中的新旧哈希对象；应用回到上一镜像后，其 `index.html` 会重新引用仍然保留的旧对象。OSS 上传或公网验证故障发生在发布验证阶段时不得继续数据库迁移或应用切换；已上传但未引用的新对象可以保留。
- 日志链路回滚可恢复上一版应用与 Compose，并让 `--remove-orphans` 停止 LinkResume Promtail；不得删除日志或 positions 命名卷，也不得修改共享 Loki。重新启用采集器后可能至少一次重复投递，管理查询会按 `event_id` 去重。
- 简历导入回滚采用上一版 Web 与 FastAPI 整体镜像；不删除新简历、MinIO 原件或 Redis 幂等 key，也不静默切回未验收的旧转换服务。
- 进入新契约后应用替换必须同时覆盖 Web、FastAPI 与 Worker，避免页面、任务状态和消费者契约错配。
- 插件发布失败不覆盖 `current.json` 时继续使用上一版本；应用镜像回滚不删除 `system/plugin-releases/` 对象。当前版本内容有误时发布更高补丁版本，不覆盖同版本 ZIP。

Promtail 配置可以复用到后续系统级日志采集：在 `deploy/observability/promtail-config.yml` 增加新的 scrape job，并在 Compose 增加最小只读 mount 即可继续推送到相同 Loki。新增宿主机 journal 或 `/var/log` 采集前必须单独评审读取权限、日志量、敏感字段和 label 基数；不能直接把整台宿主机目录授权给当前容器。


## 资料操作表退役（0089）

历史 Dev 数据库已应用过 `0088` 的供应商目录迁移，因此迁移链保留了该 revision 的原始 SQL：`0087 → 0088 → 0089 → 0090 → 0091 → 0092 → 0093 → 0094 → 0095 → 0096 → 0097`。从 `0087` 升级的其他环境也会执行 `0088`；它会清空旧模型配置和验证记录，而 `0091` 会重建旧调用日志表。`0093` 只在历史 `llm_provider_models` 与 `llm_providers` 均为空时删除它们；非空时停止迁移并先核对、导出。升级前须备份数据库，核对旧模型表、调用日志、`resume_versions`、运行中 Agent 任务及对象存储；不能仅改写 `alembic_version` 跳过 `0088`。

Dev 发布脚本在停止旧容器前使用新镜像运行只读 Alembic 预检，检查目标版本链、已知 schema 标记以及待退役表是否仍有记录。预检失败时旧服务保持运行；停机后正式迁移会重复这些检查。Jenkins 的 `RUN_TESTS` 默认为关闭；打开它需要 Jenkins 执行节点具备 Node/npm、uv 和相应测试依赖，PR/push 的完整质量检查由 GitHub Actions 执行。

`0089` 删除旧的 `dataset_replacements` 和 `dataset_object_cleanup`，需要 API、Web 和 Worker 同批切换。先备份数据库及对象存储，停止旧 API 写入与全部解析 Worker，并等待在途上传/解析退出。不要在旧进程仍写入时清空或删除表。

使用目标环境的同一配置先只读检查，再执行一次性收尾。例如共享 Dev 显式设置 `LINKRESUME_ENV_FILE=.env.development`：

```bash
LINKRESUME_ENV_FILE=.env.development uv run --directory apps/backend python ../../scripts/release/retire_dataset_operations.py
LINKRESUME_ENV_FILE=.env.development uv run --directory apps/backend python ../../scripts/release/retire_dataset_operations.py --execute
LINKRESUME_ENV_FILE=.env.development npm run db:migrate
```

收尾命令保留当前资料及正在引用的源文件/正文，放弃尚未采用的旧候选，同步删除无引用对象及候选任务，最后清空两张旧操作表。默认只打印数量，不修改数据；删除失败会中止数据库事务，可在 MinIO 恢复后重跑。它只用于这次升级，不作为定时任务运行。`0089` 在任何 DROP 前检查两张表必须为空；空库升级无需收尾。MySQL 若只提交了首条 DROP，可重跑该迁移完成第二张表删除。

升级后启动新 API 与 Worker，再切换 Web。资料替换失败不再恢复旧文件；旧客户端的替换操作接口已移除。不能直接回滚到依赖旧表的应用；恢复依赖备份，后续修正使用新的向前迁移。同步操作仍可能在网络或进程中断时部分完成，此类异常记录日志，不引入持久化清理队列。

## 面试素材与简历历史表退役（0090）

`0090` 删除 `interview_assets`、`resume_versions` 以及 `job_applications.resume_version_id` 的外键、索引和列。当前简历和 `resume_id` 关联保留；历史快照永久删除，旧版本读取、复制及恢复接口全部移除。恢复历史内容只能使用升级前备份。

维护窗口先备份数据库与对象存储，停止旧 API 和 Worker 并等待在途操作结束；按上一节完成 `0089` 收尾。使用新代码中的一次性脚本将旧面试素材迁到现有 `user_dataset`（默认 dry-run）：

```bash
uv run --directory apps/backend python scripts/release/migrate_interview_assets.py
uv run --directory apps/backend python scripts/release/migrate_interview_assets.py --execute
```

确认脚本成功、旧素材表为空后，通过部署迁移入口升级至 `0090`，再启动配套新 API、Web 和 Worker。迁移会在任何 DDL 前阻止非空旧素材表被删除；空库不需要运行脚本。旧应用不能在删表后重新启动。MySQL DDL 不支持事务回滚，部分失败必须先核对实际 schema 与 revision，再修复或从备份恢复，不能盲目重跑。


## 账号清理配置与启用

环境认证方式与注销语义见[账号功能](../features/identity-account.md)。开发环境不需要微信凭据；生产微信认证要求 WECHAT_APPID/WECHAT_SECRET，敏感注销确认的小程序码页面由 WECHAT_QR_PAGE 指定，默认 pages/account-confirm/index。

ACCOUNT_DELETION_ENABLED 默认 false；ACCOUNT_DELETION_POLL_SECONDS 默认 10，ACCOUNT_DELETION_LEASE_SECONDS 默认 60。关闭受理开关不停止已受理任务的清理。部署前先查询目标真实 Alembic current 并备份，按既有升级流程应用 0106；必须在独立目标测试账号确认同身份真机扫码、租约恢复、MinIO 私有前缀及真实 LinkRag 文件清理，再决定开启受理。不能将 SQLite、假对象存储和替身微信测试视作上述验收。

需要人工处理的任务可在配置或外部故障修复后运行 `uv run --directory apps/backend python -m linkresume.workers.account_deletion_worker retry --job-id <public-id>` 重排，不能恢复账号。完成回执仅保留七天。租约、重试与 schema 事实源见[Backend](../internals/backend.md#账号偏好联系邮箱与持久注销)。
