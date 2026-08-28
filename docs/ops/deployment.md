# 构建与部署

## 当前状态

Web 构建会把统一打印文档、页面现有主题 CSS、固定字体文件和一次性 Chromium 驱动 CLI 输出到 `dist-server`，FastAPI 生产镜像复制为 `/app/pdf`。Web 当前快照与小程序正式版本都通过有界 stdin 传入该脚本并从 stdout 接收完整 PDF；小程序 PNG 再由 Python 进程内的 PDFium 临时栅格化。进程完成即退出，快照、PDF 和 PNG 都不写入服务端持久存储。FastAPI 镜像中的 Node 22 只承载该脚本，不新增常驻 PDF 服务。

根级 `Dockerfile` 构建 Vite 静态产物和 FastAPI Python 环境，并把 Node 22、锁定的 `playwright-core` 运行库和 Debian Chromium 复制/安装到运行镜像。PDF 子进程以专用非登录用户 `linkcv-pdf` 运行，保留 Chromium 沙箱；固定路径为 `/usr/bin/chromium`，智能一页默认上限为 2000mm。独立的 `deploy/Dockerfile.pi` 构建无头 Pi Service 镜像。Web 构建阶段会把 `postcss.config.cjs`、`tailwind.config.cjs`、PDF CLI 与应用源码一起复制到 `/app/apps/web`；Pi 构建阶段安装 vendored workspace 的锁定依赖并校验仓库中版本化的模型目录快照。常规 Docker 构建不访问 `models.dev`、OpenRouter、NVIDIA NIM 或 Vercel AI Gateway，只有维护者主动执行 `npm run refresh:pi-model-data` 时才联网刷新模型快照。Node 依赖查询默认使用 npmmirror，但 `npm ci` 禁止替换 `package-lock.json` 已锁定的 tarball 主机。固定版本的 `uv` 与 Python 依赖默认使用阿里云 PyPI；构建过程从 `uv.lock` 导出带哈希的 requirements。镜像构建不连接数据库。FastAPI 容器启动时 runner 先核对 `APP_ENV`、MySQL host、port 和 database，再只读比对 Alembic 当前版本与 `0030` Agent 表、`0031` 范围化提案字段、`0032` 结构化澄清消息字段、`0033` 面试中心三张表等已知 schema 标记；任一对象提前存在、缺失或部分应用都会在执行 DDL 前终止部署。目标和 schema 对齐后才升级到 Alembic head，并由 Uvicorn 在 `8000` 端口提供 `/api` 与 Web 静态文件。

仓库提供相互独立的 Dev 与 Production Jenkins Pipeline。两者都以同一 commit/build 标识生成不可变 `linkcv` 与 `linkcv-pi` 镜像，先用 `linkcv` 镜像以显式目标参数运行迁移 runner，再更新 Compose，最后等待 FastAPI `/api/health`、Pi `/health`、本环境 Promtail 和 FastAPI `/api/agent/readiness` 进入正常状态；构建镜像阶段不连接数据库。Agent readiness 会穿透 FastAPI→Pi→FastAPI 内部回调并验证当前 `pi_agent` 模型配置与 provider 映射，但不发起供应商模型调用；任一服务令牌、回调网络或模型配置无效都会阻止发布被标记为成功。

Dev 与 Production Compose 各自部署一个 `grafana/promtail:2.9.8`，读取 LinkCV 应用挂载的环境独立日志命名卷，并把 positions 保存到另一个独立命名卷。Promtail 只提升 `service`、`environment`、`log_type`、`level` 四个低基数字段为 Loki labels；request/user/target/operation 等高基数字段保留在 JSON body。Dev 推送并查询 `http://tolink-dev-loki:3100`，Production 使用 `http://tolink-loki:3100`；两者都是 LinkRag 已有、保留七天的共享实例，本仓库不创建或修改 Loki。应用写本地 JSONL，Promtail 异步采集，因此 Loki 暂时不可用不会阻断业务请求。

`deploy/docker-compose.yml` 只用于本地启动 MySQL 8.4、Redis、MinIO 和 RabbitMQ。Dev 与 Production Compose 使用 `linkcv` 镜像分别启动包含静态 Web 与 FastAPI 的容器及执行 `python -m linkcv.workers` 的 Worker，并使用 `linkcv-pi` 镜像启动独立无头 Agent 服务。Pi 只加入环境内网，不映射宿主机端口；FastAPI 是浏览器唯一业务入口。两套远端环境复用平台 RabbitMQ，不在应用 Compose 内创建 Broker。
Worker 将结构化日志写入共享日志卷的独立子目录，Promtail 同时采集 Web/FastAPI 与 Worker，避免多个进程并发轮转同一个文件。本机日志联调另使用 `deploy/docker-compose.observability.local.yml` 启动 LinkCV 自己的 Promtail，并复用 LinkRag 本地 Compose 已部署的 Loki；它不创建第二个 Loki，也不停止 LinkRag 的采集器。

## Dev Pipeline

Dev Jenkins Job 使用 `deploy/jenkins/Jenkinsfile.development`。Jenkins 将当前 checkout 通过 `git archive` 打包并上传 Primary `100.86.10.52`，由 `deploy/scripts/build-development-on-primary.sh` 在 `/opt/tolink/dev` 内完成构建和部署，因此远端构建内容与 Jenkins 当前 commit 一致。

- 镜像：`linkcv:dev-<commit>-b<build-number>`、`linkcv-pi:dev-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/dev/linkcv`
- Compose：`deploy/docker-compose.development.yml`
- 容器：`linkcv-dev`、`linkcv-worker-dev`、`linkcv-pi-dev`、`linkcv-dev-promtail`
- 网络：外部网络 `tolink-dev-net`
- 宿主机端口：`18002`
- 配置：`.env.development` + 权限为 `600` 的 `.env.development.local`；后者必须提供非空的 `WECHAT_APPID` 和 `WECHAT_SECRET`
- 迁移门禁：`APP_ENV=development`、MySQL `100.86.10.52:13306/linkcv`

Dev Jenkins 节点需预置 `/var/jenkins_home/.ssh/primary_dev`，并能以 `root` 连接 Primary。Primary 需已有 Docker、Docker Compose、`tolink-dev-net` 和私密 env 文件。发布脚本在迁移与容器替换前检查私密文件权限，并通过 FastAPI `Settings` 拒绝缺失、空值或占位的微信凭据，避免 Jenkins 成功但扫码登录不可用。LinkCV Dev 使用独立 `linkcv` MySQL 数据库、MinIO bucket 和 Redis DB 2；本地密钥文件只保存凭据，不覆盖仓库中的地址与资源名。任一前置条件、迁移或健康检查失败都会让 Job 失败。

`linkcv-dev` 的 Generic Webhook Trigger 只接受 `refs/heads/dev`。token 通过 Jenkins Secret Text 凭据 `linkcv-dev-webhook-token` 注入，仓库不保存 token；GitHub 仓库 webhook 只订阅 push 事件。

## Production Pipeline

Production Jenkins Job 使用根目录 `Jenkinsfile`。Jenkins 位于 Primary，只负责 checkout、可选质量检查和 `git archive`；随后通过专用 SSH 密钥把当前提交归档上传到 Cloud `100.77.31.79`，由 `deploy/scripts/build-production-on-cloud.sh` 在真实生产主机本地构建、迁移和部署。Production 不再使用 Primary 的 Docker socket 创建生产镜像或容器。

- 镜像：`linkcv:prod-<commit>-b<build-number>`、`linkcv-pi:prod-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/LinkCV`
- Compose：`deploy/docker-compose.production.yml`
- 容器：`linkcv`、`linkcv-worker`、`linkcv-pi`、`linkcv-promtail`
- 网络：外部网络 `tolink-app-net`
- 宿主机端口：`4174`（容器内 FastAPI 仍监听 `8000`，保持现有生产反向代理上游）
- 配置：`.env.production` + 权限为 `600` 的 `.env.production.local`
- 迁移门禁：`APP_ENV=production`、MySQL `tolink-mysql:3306/linkcv`

Production 公网 Nginx 对 `/assets/` 保留一年 `immutable` 缓存，并为 JS、CSS、JSON 和 SVG 开启 gzip；FastAPI 静态文件层提供相同的压缩与缓存兜底。`index.html` 不做长期缓存，保证新部署能及时引用新的哈希资源。网关调整后必须同时验证 `Content-Encoding: gzip`、`Cache-Control`、LinkCV 健康接口和共享网关上的其他域名。

`linkcv-prod` 的 Generic Webhook Trigger 复用 Jenkins Secret Text 凭据
`linkcv-dev-webhook-token`，但只接受 `refs/heads/master`。同一个 GitHub push
webhook 因此会分别把 `dev` 推送交给 Dev Job、把 PR 合并产生的 `master` 推送交给
Production Job。首次加入触发器后需手动运行一次 `linkcv-prod`，让 Jenkins 从根
`Jenkinsfile` 加载并注册触发器；后续 `master` push 自动构建。

Jenkins 容器需预置权限为 `600` 的 `/var/jenkins_home/.ssh/cloud_prod`，Cloud 只授权这把发布密钥并限制来源。Production Pipeline 会把仓库中的非敏感 `.env.production`、Compose 和 Promtail 配置复制到部署目录；私密覆盖必须由部署密钥存储预先提供且权限为 `600`。除 JWT、MySQL 和 MinIO 凭据外，新版本还要求覆盖提供有效的 `LLM_CREDENTIAL_ENCRYPTION_KEYS`、`LINKPARSE_API_KEY`、`RABBITMQ_URL`、`WECHAT_APPID`、`WECHAT_SECRET` 与两枚不同的 `PI_SERVICE_TOKEN`/`LINKCV_INTERNAL_AGENT_TOKEN`，否则相关 preflight、Settings、Pi 服务或微信登录会安全失败。生产网络还必须允许后端访问 `api.weixin.qq.com`。LLM 密钥环用于解密 MySQL 中的模型凭据，不是供应商 API key；轮换时先发布“新 key 在首项、旧 key 仍保留”的配置，确认旧密文已经重包后才能移除旧 key。LinkParse Key、微信 AppSecret 和 Agent 服务令牌都只供服务端使用，不进入 Web 或小程序制品。

Production 使用 `APP_ENV=production`，普通 Web 用户只能通过微信小程序扫码登录；管理员仍使用独立 `/admin/login`。微信公众平台必须把 `https://linkresume.cn` 同时配置为 request 与 downloadFile 合法域名并使用有效公网 HTTPS 证书；简历以 PNG 在小程序当前页面阅读，不使用 `web-view`，个人主体无需配置业务域名。上线前还要核对既有邮箱账号：系统不会仅凭同一使用者自动把新 openid 关联到旧邮箱账号，未绑定账号会生成新的微信账号而看不到旧简历；必须先完成受控账号映射或明确接受账号分离，不能直接假设历史数据会自动归并。

### 首次 Production SQLite 切换

旧 Express Production 使用 `/opt/tolink/LinkCV/data/resume_app.sqlite`。首次切换到 FastAPI/MySQL 时，维护者手动运行 Production Job 并显式开启 `IMPORT_LEGACY_SQLITE`；该参数默认关闭，Pipeline 也明确拒绝 webhook 构建开启它，因此自动构建不会重复导入。远端脚本在旧应用继续服务时完成镜像构建、空 `linkcv` database 初始化和 Alembic 升级；进入导入窗口后才短暂停止旧容器，通过 SQLite `.backup` 合并 WAL 并生成一致只读快照。随后先对全部旧记录执行 dry-run，最后仅在目标 `users`、`resumes`、`resume_versions` 都为空时用单事务导入。快照或导入失败会立即恢复旧容器。

导入保留账号邮箱、bcrypt 密码摘要、账号时间、简历标题、Markdown 和可映射样式；每份简历创建一个“初始版本”。旧字符串主键会映射到新的自增主键。登录同时兼容 bcrypt 与 Argon2，旧账号首次成功登录后立即把摘要升级为 Argon2。旧 SQLite 会话不迁移，切换后用户必须重新登录。任何记录无法安全转换、目标表非空或事务失败都会停止发布，不允许部分导入。

首次切换完成后，确认 MySQL revision、用户/简历/版本数量、登录、简历读取、Worker、Pi、Promtail、`http://127.0.0.1:4174/api/health` 和 `/api/agent/readiness` 全部正确，才允许恢复正常自动发布。旧 SQLite 与切换备份不得立即删除。

本期没有管理员开通接口。发布方还需在受控流程中确保至少一个既有用户被标记为 `users.is_admin=true`；公开注册始终是普通用户。没有管理员只会使 `/api/admin/llm/**` 无法使用，不会放宽权限。

生产容器通过 `tolink-app-net` 使用 Docker DNS 连接 MySQL、Redis、MinIO 和平台 RabbitMQ，并须能访问仓库配置的 LinkParse。MySQL、Redis、MinIO、RabbitMQ 与 LinkParse 都不由 Production Compose 创建。Worker 使用 V2 RabbitMQ durable queue、固定 `resume.import.v2` 路由和独立 DLX/DLT；业务解析失败落 MySQL 终态且不自动重试，Redis、数据库或对象存储等公共依赖不可用时保留消息等待恢复。

PDF layout 与消息 V2 必须按兼容窗口发布：先发布支持 `include_layout=true` 的 LinkParse 并验证旧默认请求仍兼容，再启动连接 V2 topology 的新 LinkCV Worker，确认 V2 queue 只有新消费者后才替换 FastAPI 生产者。V1 exchange、queue 和 DLT 在确认旧队列无在途/重试消息且观察窗口结束前保留，不自动删除；若新 FastAPI 误连旧 LinkParse，PDF 导入会安全失败为 `RESUME_LAYOUT_UNSUPPORTED`，不得回退到旧 Markdown 成功路径。

模板创建与异步导入是同一版本的跨端契约，Web、FastAPI、Worker 和迁移必须一起发布。执行 `0017` 前先运行 `uv run --directory apps/backend python scripts/release/cleanup_legacy_resume_imports.py` 获取 dry-run 清单，人工确认后再加 `--execute`；旧导入未归零时迁移会拒绝继续。

执行 `0021` 前必须确认目标数据库已有可恢复备份。该 revision 先迁移全部 `resume_imports` 数据并回填 `resumes.parse_task_id`，随后删除旧表；旧应用不能在新 schema 上运行，新应用也不能在旧 schema 上运行，因此迁移成功后必须立即整体替换 FastAPI 与 Worker，不设灰度兼容窗口。需要恢复旧数据库状态时只能使用迁移前备份。

执行 `0022` 前必须同时确认数据库和对象存储已有可恢复备份，并先运行 `uv run --directory apps/backend python scripts/release/cleanup_legacy_user_datasets.py` 核对清理清单；人工确认后才加 `--execute`，再迁移数据库。该 revision 删除上线前全部 `user_dataset` 行，扩展通用解析任务以承载 `dataset` 来源及失败分类，并为资料记录增加任务指针；旧资料与源文件只能从备份恢复。迁移成功后必须同时替换 FastAPI 与 Worker，使资料任务与既有简历导入共用同一消费链路。

执行 `0023` 前必须确认目标数据库已有可恢复备份。该 revision 为 `resume_versions` 增加非空 `name` 并回填已有版本名称。新后端依赖该列读取和写入版本，旧后端不能向新 schema 创建缺少名称的版本，因此迁移成功后必须配套替换 FastAPI 与 Web，不能让新旧应用与该 schema 混用。

两条 Pipeline 都提供 `RUN_TESTS` 参数；开启后会在镜像构建前运行 `npm run setup && npm run check`。常规 PR/push 质量检查仍由 GitHub Actions 执行。

## CI

`.github/workflows/quality.yml` 在面向 `dev`、`master` 的 PR 和对应分支 push 上执行根级 `npm run check`。业务需求从最新 `origin/master` 创建独立业务分支，完成后向 `dev` 提 PR。本地和 CI 复用同一质量入口，完整分支规则见 [本地开发与配置](development.md#分支与发布流程)。

CI 会安装锁定的 `third_party/pi` 与独立 `apps/pi-service` 依赖，并先校验仓库内版本化模型目录快照。独立 Pi 镜像在关闭网络的构建层再次校验该快照并执行离线构建，不在 Production 构建时访问实时模型目录。

## 恢复与应用回退

- 应用回滚必须把 `TAG` 与 `PI_TAG` 一起切回同一环境、同一版本的两个不可变镜像标签并重新执行 Compose；不得把 Dev 标签部署到 Production。
- 数据库迁移是 forward-only：当前与历史 revision 都不提供 down SQL，禁止执行 Alembic downgrade，也不做升级降级往返测试。
- 发布前按迁移风险准备并验证数据库及相关对象存储备份。需要恢复旧数据库状态时使用备份；普通 schema 或数据缺陷通过新的向前 revision 修正。
- 当前 head `0044`；`0032` 为 Agent 消息增加结构化澄清字段，`0033` 新增面试求职进程、单场面试和素材元数据，`0034` 删除存量已归档 JD 并移除对应字段和索引，`0035`–`0043` 继续收敛简历快照、模板、可见性与用户个人画像 schema，`0044` 只恢复后续 `classic-technical-cn` 模板快照的紧凑字号、行距与主题色，既有简历和版本不变。
- 如果使用执行 `0033` 前的数据库备份恢复，必须同时处理备份之后写入 MinIO 的面试对象；只恢复数据库会产生失去元数据索引的对象。
- 只有旧应用兼容当前新 schema 时才允许回退应用镜像。若不兼容，必须继续向前修复或按完整恢复方案同时恢复数据库与应用，不能只回切镜像。
- MySQL DDL 可能隐式提交；迁移失败后停止自动重试，核对实际 current 和 schema，再决定新 revision 或备份恢复。
- 回滚到旧镜像时仍要保留新旧完整 LLM 密钥环，直到确认没有运行实例或密文依赖待移除的 key。
- 只有首次 Production 切换会通过受控工具把旧 Express/SQLite 的账号和简历导入 MySQL；本地原型 SQLite 不进入远端数据库。旧 SQLite 只作为切换前应用的短时回退依据，不能接收或合并新 MySQL 写入。
- 新增环境配置的回滚只恢复应用与 Compose；不得自动删除已有 `linkcv` 数据库或 Redis volume。
- 日志链路回滚可恢复上一版应用与 Compose，并让 `--remove-orphans` 停止 LinkCV Promtail；不得删除日志或 positions 命名卷，也不得修改共享 Loki。重新启用采集器后可能至少一次重复投递，管理查询会按 `event_id` 去重。
- 简历导入回滚采用上一版 Web 与 FastAPI 整体镜像；不删除新简历、MinIO 原件或 Redis 幂等 key，也不静默切回未验收的旧转换服务。
- 进入新契约后应用替换必须同时覆盖 Web、FastAPI 与 Worker，避免页面、任务状态和消费者契约错配。
- 插件发布失败不覆盖 `current.json` 时继续使用上一版本；应用镜像回滚不删除 `system/plugin-releases/` 对象。当前版本内容有误时发布更高补丁版本，不覆盖同版本 ZIP。

Promtail 配置可以复用到后续系统级日志采集：在 `deploy/observability/promtail-config.yml` 增加新的 scrape job，并在 Compose 增加最小只读 mount 即可继续推送到相同 Loki。新增宿主机 journal 或 `/var/log` 采集前必须单独评审读取权限、日志量、敏感字段和 label 基数；不能直接把整台宿主机目录授权给当前容器。
