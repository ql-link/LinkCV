# 构建与部署

## 当前状态

根级 `Dockerfile` 构建 Vite 静态产物和 FastAPI Python 环境。Web 构建阶段会把 `postcss.config.cjs` 与 `tailwind.config.cjs` 和应用源码一起复制到 `/app/apps/web`，确保容器内的 Vite 生产构建生成 Tailwind 工具类，而不是只打包手写 CSS。Node 依赖查询默认使用 npmmirror，但 `npm ci` 禁止替换 `package-lock.json` 已锁定的 tarball 主机：锁文件指向 npm 官方源的制品继续从官方源下载，已经指向 npmmirror 的制品仍使用镜像，避免镜像尚未同步某个锁定制品时错误改写并返回 404。固定版本的 `uv` 与 Python 依赖默认使用阿里云 PyPI，避免部署节点依赖 GHCR。构建过程静默地从 `uv.lock` 导出带哈希的 requirements 后再从指定镜像安装，既保留锁定版本与制品校验，也避免锁文件里的外部下载地址绕过镜像或把完整依赖清单写入 Jenkins 日志。镜像构建只打包 `migrations/sql/`、Alembic revision 和迁移 runner，不连接数据库。容器启动时 runner 先核对 `APP_ENV`、MySQL host、port 和 database，再升级到 Alembic head；目标不一致时拒绝启动，校验成功后才由 Uvicorn 在 `8000` 端口提供 `/api` 与 Web 静态文件。

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
- 配置：`.env.development` + 权限为 `600` 的 `.env.development.local`；后者提供部署实际 `PLUGIN_RELEASE_ORIGIN`
- 迁移门禁：`APP_ENV=development`、MySQL `100.86.10.52:13306/linkcv`

Dev Jenkins 节点需预置 `/var/jenkins_home/.ssh/primary_dev`，并能以 `root` 连接 Primary。Primary 需已有 Docker、Docker Compose、`tolink-dev-net` 和私密 env 文件。LinkCV Dev 使用独立 `linkcv` MySQL 数据库、MinIO bucket 和 Redis DB 2；本地密钥文件只保存凭据，不覆盖仓库中的地址与资源名。任一前置条件、迁移或健康检查失败都会让 Job 失败。

`linkcv-dev` 的 Generic Webhook Trigger 只接受 `refs/heads/dev`。token 通过 Jenkins Secret Text 凭据 `linkcv-dev-webhook-token` 注入，仓库不保存 token；GitHub 仓库 webhook 只订阅 push 事件。

## Production Pipeline

Production Jenkins Job 使用根目录 `Jenkinsfile`。Jenkins 位于 Primary，只负责 checkout、可选质量检查和 `git archive`；随后通过专用 SSH 密钥把当前提交归档上传到 Cloud `100.77.31.79`，由 `deploy/scripts/build-production-on-cloud.sh` 在真实生产主机本地构建、迁移和部署。Production 不再使用 Primary 的 Docker socket 创建生产镜像或容器。

- 镜像：`linkcv:prod-<commit>-b<build-number>`、`linkcv-pi:prod-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/LinkCV`
- Compose：`deploy/docker-compose.production.yml`
- 容器：`linkcv`、`linkcv-worker`、`linkcv-pi`、`linkcv-promtail`
- 网络：外部网络 `tolink-app-net`
- 宿主机端口：`4174`（容器内 FastAPI 仍监听 `8000`，保持现有生产反向代理上游）
- 配置：`.env.production` + 权限为 `600` 的 `.env.production.local`；后者必须提供 HTTPS `PLUGIN_RELEASE_ORIGIN`
- 迁移门禁：`APP_ENV=production`、MySQL `tolink-mysql:3306/linkcv`

`linkcv-prod` 的 Generic Webhook Trigger 复用 Jenkins Secret Text 凭据
`linkcv-dev-webhook-token`，但只接受 `refs/heads/master`。同一个 GitHub push
webhook 因此会分别把 `dev` 推送交给 Dev Job、把 PR 合并产生的 `master` 推送交给
Production Job。首次加入触发器后需手动运行一次 `linkcv-prod`，让 Jenkins 从根
`Jenkinsfile` 加载并注册触发器；后续 `master` push 自动构建。

Jenkins 容器需预置权限为 `600` 的 `/var/jenkins_home/.ssh/cloud_prod`，Cloud 只授权这把发布密钥并限制来源。Production Pipeline 会把仓库中的非敏感 `.env.production`、Compose 和 Promtail 配置复制到部署目录；私密覆盖必须由部署密钥存储预先提供且权限为 `600`。除 JWT、MySQL 和 MinIO 凭据外，新版本还要求覆盖提供有效的 `LLM_CREDENTIAL_ENCRYPTION_KEYS`、`LINKPARSE_API_KEY`、`RABBITMQ_URL`、`WECHAT_APPID`、`WECHAT_SECRET`、两枚不同的 `PI_SERVICE_TOKEN`/`LINKCV_INTERNAL_AGENT_TOKEN` 与实际 HTTPS `PLUGIN_RELEASE_ORIGIN`，否则相关 preflight、Settings、Pi 服务或微信登录会安全失败。生产网络还必须允许后端访问 `api.weixin.qq.com`。Origin 不是密钥，但因为部署域名不提交到仓库而通过同一覆盖文件提供。LLM 密钥环用于解密 MySQL 中的模型凭据，不是供应商 API key；轮换时先发布“新 key 在首项、旧 key 仍保留”的配置，确认旧密文已经重包后才能移除旧 key。LinkParse Key、微信 AppSecret 和 Agent 服务令牌都只供服务端使用，不进入 Web 或小程序制品。

Production 使用 `APP_ENV=production`，普通 Web 用户只能通过微信小程序扫码登录；管理员仍使用独立 `/admin/login`。微信公众平台必须把 `https://linkresume.cn` 配置为 request 合法域名并使用有效公网 HTTPS 证书。上线前还要核对既有邮箱账号：系统不会仅凭同一使用者自动把新 openid 关联到旧邮箱账号，未绑定账号会生成新的微信账号而看不到旧简历；必须先完成受控账号映射或明确接受账号分离，不能直接假设历史数据会自动归并。

### 首次 Production SQLite 切换

旧 Express Production 使用 `/opt/tolink/LinkCV/data/resume_app.sqlite`。首次切换到 FastAPI/MySQL 时，维护者手动运行 Production Job 并显式开启 `IMPORT_LEGACY_SQLITE`；该参数默认关闭，Pipeline 也明确拒绝 webhook 构建开启它，因此自动构建不会重复导入。远端脚本在旧应用继续服务时完成镜像构建、空 `linkcv` database 初始化和 Alembic 升级；进入导入窗口后才短暂停止旧容器，通过 SQLite `.backup` 合并 WAL 并生成一致只读快照。随后先对全部旧记录执行 dry-run，最后仅在目标 `users`、`resumes`、`resume_versions` 都为空时用单事务导入。快照或导入失败会立即恢复旧容器。

导入保留账号邮箱、bcrypt 密码摘要、账号时间、简历标题、Markdown 和可映射样式；每份简历创建一个“初始版本”。旧字符串主键会映射到新的自增主键。登录同时兼容 bcrypt 与 Argon2，旧账号首次成功登录后立即把摘要升级为 Argon2。旧 SQLite 会话不迁移，切换后用户必须重新登录。任何记录无法安全转换、目标表非空或事务失败都会停止发布，不允许部分导入。

首次切换完成后，确认 MySQL revision、用户/简历/版本数量、登录、简历读取、Worker、Pi、Promtail、`http://127.0.0.1:4174/api/health` 和 `/api/agent/readiness` 全部正确，才允许恢复正常自动发布。旧 SQLite 与切换备份不得立即删除。

本期没有管理员开通接口。发布方还需在受控流程中确保至少一个既有用户被标记为 `users.is_admin=true`；公开注册始终是普通用户。没有管理员只会使 `/api/admin/llm/**` 无法使用，不会放宽权限。

生产容器通过 `tolink-app-net` 使用 Docker DNS 连接 MySQL、Redis、MinIO 和平台 RabbitMQ，并须能访问仓库配置的 LinkParse。MySQL、Redis、MinIO、RabbitMQ 与 LinkParse 都不由 Production Compose 创建。Worker 使用 RabbitMQ durable queue、固定 `resume.import` 路由和 DLX/DLT；业务解析失败落 MySQL 终态且不自动重试，Redis、数据库或对象存储等公共依赖不可用时保留消息等待恢复。

模板创建与异步导入是同一版本的跨端契约，Web、FastAPI、Worker 和迁移必须一起发布。执行 `0017` 前先运行 `uv run --directory apps/backend python scripts/release/cleanup_legacy_resume_imports.py` 获取 dry-run 清单，人工确认后再加 `--execute`；旧导入未归零时迁移会拒绝继续。

执行 `0021` 前必须确认目标数据库已有可恢复备份。该 revision 先迁移全部 `resume_imports` 数据并回填 `resumes.parse_task_id`，随后删除旧表；旧应用不能在新 schema 上运行，新应用也不能在旧 schema 上运行，因此迁移成功后必须立即整体替换 FastAPI 与 Worker，不设灰度兼容窗口。降级会重建旧表；若已经存在非 `resume_import` 的通用解析任务则拒绝降级。

执行 `0022` 前必须同时确认数据库和对象存储已有可恢复备份，并先运行 `uv run --directory apps/backend python scripts/release/cleanup_legacy_user_datasets.py` 核对清理清单；人工确认后才加 `--execute`，再迁移数据库。该 revision 删除上线前全部 `user_dataset` 行，扩展通用解析任务以承载 `dataset` 来源及失败分类，并为资料记录增加任务指针；旧资料与源文件不能由 downgrade 恢复。迁移成功后必须同时替换 FastAPI 与 Worker，使资料任务与既有简历导入共用同一消费链路。

执行 `0023` 前必须确认目标数据库已有可恢复备份。该 revision 为 `resume_versions` 增加非空 `name` 并回填已有版本名称；downgrade 会删除该列和所有名称。新后端依赖该列读取和写入版本，旧后端不能向新 schema 创建缺少名称的版本，因此迁移成功后必须配套替换 FastAPI 与 Web，不能让新旧应用与该 schema 混用。

两条 Pipeline 都提供 `RUN_TESTS` 参数；开启后会在镜像构建前运行 `npm run setup && npm run check`。常规 PR/push 质量检查仍由 GitHub Actions 执行。

## CI

`.github/workflows/quality.yml` 在面向 `dev`、`release`、`master` 的 PR 和对应分支 push 上执行根级 `npm run check`。业务需求先由独立业务分支合入 `release`，合并后的 `release` push 检查成功才算 Release 测试通过；随后仍由同一业务分支向 `master` 提 PR，不使用 `release -> master` PR。本地和 CI 复用同一质量入口，完整分支规则见 [本地开发与配置](development.md#分支与发布流程)。

## 回滚

- 应用回滚必须把 `TAG` 与 `PI_TAG` 一起切回同一环境、同一版本的两个不可变镜像标签并重新执行 Compose；不得把 Dev 标签部署到 Production。
- 当前 head `0030`。`0016` 新增旧版 `resume_imports` 且非空时拒绝 downgrade；`0017` 删除旧同步导入证据列，执行前必须完成不可逆的旧对象、版本和简历清理；`0018` 新增用户数据集表；`0019`–`0020` 增加微信绑定并支持无邮箱密码账号；`0021` 将旧导入表迁移为 `document_parse_tasks`；`0022` 将资料解析接入该任务表，并在迁移前清理旧资料；`0023` 为历史简历版本新增名称；`0024`–`0025` 增加并修订官方经典技术模板；`0026` 新增四套职能与设计模板；`0027` 受保护地刷新四套模板；`0028`–`0029` 扩展并收敛多能力模型配置；`0030` 增加 Agent 状态和提案表。
- `0030 → 0029` 会永久删除全部 Agent 会话、消息、运行、工具审计和待确认提案，并把已经生成的 `reason=agent` 简历版本改记为 `manual`。降级前先停止 Pi 服务、阻断新 Agent 请求并确认这些数据允许丢弃；只回切 Pi 镜像或只降 schema 都不是有效回滚。
- `0021 → 0020` 会从 `document_parse_tasks` 和 `resumes.parse_task_id` 镜像重建 `resume_imports`，并拒绝丢弃非简历类型任务。由于升级已删除旧表，执行前仍需以部署前备份作为完整恢复保障；应用与 schema 必须配套回滚，不能单独回切镜像。
- `0022 → 0021` 会删除全部资料及 `source_type=dataset` 的解析任务，再移除资料任务指针和失败分类；它不能恢复升级前删除的资料记录或对象。降级前必须确认不存在需要保留的资料任务，并与应用整体回滚。
- `0023 → 0022` 会删除 `resume_versions.name`，不能恢复升级后创建或重命名的版本名称；降级前必须确认数据库备份可用，并与应用整体回滚。
- `0026 → 0025` 只在四套新增模板均未被简历引用时删除模板；存在任一引用会拒绝降级。已经从模板创建的简历持有内容与样式快照，但来源模板仍须保留以满足追溯约束。
- `0027 → 0026` 只在四套官方模板仍保持 `0027` 发布内容时恢复旧默认快照；任一模板被现场定制后会拒绝整次降级，避免覆盖定制内容。该迁移只修改模板默认快照，不回填已创建简历。
- `0017` 后旧镜像依赖已删除字段，禁止直接回切；只能向前修复。尚未产生新导入简历且确认可恢复空列结构时才允许 downgrade 到 `0016`，存在 `source_type=import` 行时 downgrade 会拒绝执行。
- `0012 → 0011` 只重新增加空的旧版备份列，不恢复已经删除的 JSON；如需恢复旧值或继续回滚到依赖旧格式的应用，必须使用执行 `0012` 前的外部数据库备份。不要把 schema 降级成功描述为数据已恢复。
- 如必须在隔离环境继续执行 `0011 → 0010`，先回滚应用，down 会重建空的 `admin_operation_logs`；`0010 → 0009` 还会重建空的对象存储清理任务表。继续执行 `0009 → 0008` 前须备份数据库，down 会删除 `admin_operation_logs`；继续执行 `0008 → 0007` 会保留升级后新写入的模型和日志主体，但不会恢复 `0008` 升级前清理的数据，同时会删除 binding 及能力、adapter、调用名、来源等附加快照。不要在新应用运行时执行。MySQL DDL 非事务，失败后停止自动重试并按实际 schema 或备份处理。
- 回滚到旧镜像时仍要保留新旧完整 LLM 密钥环，直到确认没有运行实例或密文依赖待移除的 key。
- 只有首次 Production 切换会通过受控工具把旧 Express/SQLite 的账号和简历导入 MySQL；本地原型 SQLite 不进入远端数据库。旧 SQLite 只作为切换前应用的短时回退依据，不能接收或合并新 MySQL 写入。
- 新增环境配置的回滚只恢复应用与 Compose；不得自动删除已有 `linkcv` 数据库或 Redis volume。
- 日志链路回滚可恢复上一版应用与 Compose，并让 `--remove-orphans` 停止 LinkCV Promtail；不得删除日志或 positions 命名卷，也不得修改共享 Loki。重新启用采集器后可能至少一次重复投递，管理查询会按 `event_id` 去重。
- 简历导入回滚采用上一版 Web 与 FastAPI 整体镜像；不删除新简历、MinIO 原件或 Redis 幂等 key，也不静默切回未验收的旧转换服务。
- `0015 → 0014` 只移除官方现代双栏和紧凑技术型模板新增的受控 Markdown，已经从模板创建的用户简历仍保留自己的快照。MySQL DDL 非事务，Production 不自动 downgrade。
- 进入新契约后应用替换必须同时覆盖 Web、FastAPI 与 Worker，避免页面、任务状态和消费者契约错配。
- 插件发布失败不覆盖 `current.json` 时继续使用上一版本；应用镜像回滚不删除 `system/plugin-releases/` 对象。当前版本内容有误时发布更高补丁版本，不覆盖同版本 ZIP。

Promtail 配置可以复用到后续系统级日志采集：在 `deploy/observability/promtail-config.yml` 增加新的 scrape job，并在 Compose 增加最小只读 mount 即可继续推送到相同 Loki。新增宿主机 journal 或 `/var/log` 采集前必须单独评审读取权限、日志量、敏感字段和 label 基数；不能直接把整台宿主机目录授权给当前容器。
