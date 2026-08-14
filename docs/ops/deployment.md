# 构建与部署

## 当前状态

根级 `Dockerfile` 构建 Vite 静态产物和 FastAPI Python 环境。Node 依赖默认使用 npmmirror，固定版本的 `uv` 与 Python 依赖默认使用阿里云 PyPI，避免部署节点依赖 GHCR。构建过程静默地从 `uv.lock` 导出带哈希的 requirements 后再从指定镜像安装，既保留锁定版本与制品校验，也避免锁文件里的外部下载地址绕过镜像或把完整依赖清单写入 Jenkins 日志。镜像构建只打包 `migrations/sql/`、Alembic revision 和迁移 runner，不连接数据库。容器启动时 runner 先核对 `APP_ENV`、MySQL host、port 和 database，再升级到 Alembic head；目标不一致时拒绝启动，校验成功后才由 Uvicorn 在 `8000` 端口提供 `/api` 与 Web 静态文件。

仓库提供相互独立的 Dev 与 Production Jenkins Pipeline。两者都使用不可变镜像标签，先以显式目标参数运行迁移 runner，再更新 Compose，最后等待 `/api/health` 和本环境 Promtail 进入 running；构建镜像阶段不连接数据库。

Dev 与 Production Compose 各自部署一个 `grafana/promtail:2.9.8`，读取 LinkCV 应用挂载的环境独立日志命名卷，并把 positions 保存到另一个独立命名卷。Promtail 只提升 `service`、`environment`、`log_type`、`level` 四个低基数字段为 Loki labels；request/user/target/operation 等高基数字段保留在 JSON body。Dev 推送并查询 `http://tolink-dev-loki:3100`，Production 使用 `http://tolink-loki:3100`；两者都是 LinkRag 已有、保留七天的共享实例，本仓库不创建或修改 Loki。应用写本地 JSONL，Promtail 异步采集，因此 Loki 暂时不可用不会阻断业务请求。

`deploy/docker-compose.yml` 只用于本地启动 MySQL 8.4、Redis、MinIO 和 RabbitMQ。Dev 与 Production Compose 使用同一镜像分别启动包含静态 Web 与 FastAPI 的 `linkcv` 容器，以及执行 `python -m linkcv.workers` 的 `linkcv-worker` 容器；两套远端环境复用平台 RabbitMQ，不在应用 Compose 内创建 Broker。
Worker 将结构化日志写入共享日志卷的独立子目录，Promtail 同时采集 Web/FastAPI 与 Worker，避免多个进程并发轮转同一个文件。本机日志联调另使用 `deploy/docker-compose.observability.local.yml` 启动 LinkCV 自己的 Promtail，并复用 LinkRag 本地 Compose 已部署的 Loki；它不创建第二个 Loki，也不停止 LinkRag 的采集器。

## Dev Pipeline

Dev Jenkins Job 使用 `deploy/jenkins/Jenkinsfile.development`。Jenkins 将当前 checkout 通过 `git archive` 打包并上传 Primary `100.86.10.52`，由 `deploy/scripts/build-development-on-primary.sh` 在 `/opt/tolink/dev` 内完成构建和部署，因此远端构建内容与 Jenkins 当前 commit 一致。

- 镜像：`linkcv:dev-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/dev/linkcv`
- Compose：`deploy/docker-compose.development.yml`
- 容器：`linkcv-dev`、`linkcv-worker-dev`、`linkcv-dev-promtail`
- 网络：外部网络 `tolink-dev-net`
- 宿主机端口：`18002`
- 配置：`.env.development` + 权限为 `600` 的 `.env.development.local`；后者提供部署实际 `PLUGIN_RELEASE_ORIGIN`
- 迁移门禁：`APP_ENV=development`、MySQL `100.86.10.52:13306/linkcv`

Dev Jenkins 节点需预置 `/var/jenkins_home/.ssh/primary_dev`，并能以 `root` 连接 Primary。Primary 需已有 Docker、Docker Compose、`tolink-dev-net` 和私密 env 文件。LinkCV Dev 使用独立 `linkcv` MySQL 数据库、MinIO bucket 和 Redis DB 2；本地密钥文件只保存凭据，不覆盖仓库中的地址与资源名。任一前置条件、迁移或健康检查失败都会让 Job 失败。

`linkcv-dev` 的 Generic Webhook Trigger 只接受 `refs/heads/dev`。token 通过 Jenkins Secret Text 凭据 `linkcv-dev-webhook-token` 注入，仓库不保存 token；GitHub 仓库 webhook 只订阅 push 事件。

## Production Pipeline

Production Jenkins Job 使用根目录 `Jenkinsfile`，在生产 Jenkins 节点本地构建并部署：

- 镜像：`linkcv:prod-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/LinkCV`
- Compose：`deploy/docker-compose.production.yml`
- 容器：`linkcv`、`linkcv-worker`、`linkcv-promtail`
- 网络：外部网络 `tolink-app-net`
- 宿主机端口：`8000`
- 配置：`.env.production` + 权限为 `400` 或 `600` 的 `.env.production.local`；后者必须提供 HTTPS `PLUGIN_RELEASE_ORIGIN`
- 迁移门禁：`APP_ENV=production`、MySQL `tolink-mysql:3306/linkcv`

Production Pipeline 会把仓库中的非敏感 `.env.production`、Compose 和 Promtail 配置复制到部署目录；私密覆盖必须由部署密钥存储预先提供。除 JWT、MySQL 和 MinIO 凭据外，新版本还要求覆盖提供有效的 `LLM_CREDENTIAL_ENCRYPTION_KEYS`、`LINKPARSE_API_KEY`、`RABBITMQ_URL` 与实际 HTTPS `PLUGIN_RELEASE_ORIGIN`，否则 Settings 会在启动前安全失败。Origin 不是密钥，但因为部署域名不提交到仓库而通过同一覆盖文件提供。LLM 密钥环用于解密 MySQL 中的模型凭据，不是供应商 API key；轮换时先发布“新 key 在首项、旧 key 仍保留”的配置，确认旧密文已经重包后才能移除旧 key。LinkParse Key 只供后端 Bearer 请求使用，不进入 Web 制品。

本期没有管理员开通接口。发布方还需在受控流程中确保至少一个既有用户被标记为 `users.is_admin=true`；公开注册始终是普通用户。没有管理员只会使 `/api/admin/llm/**` 无法使用，不会放宽权限。

生产容器通过 `tolink-app-net` 使用 Docker DNS 连接 MySQL、Redis、MinIO 和平台 RabbitMQ，并须能访问仓库配置的 LinkParse。MySQL、Redis、MinIO、RabbitMQ 与 LinkParse 都不由 Production Compose 创建。Worker 使用 RabbitMQ durable queue、固定 `resume.import` 路由和 DLX/DLT；业务解析失败落 MySQL 终态且不自动重试，Redis、数据库或对象存储等公共依赖不可用时保留消息等待恢复。

模板创建与异步导入是同一版本的跨端契约，Web、FastAPI、Worker 和迁移必须一起发布。执行 `0017` 前先运行 `uv run --directory apps/backend python scripts/release/cleanup_legacy_resume_imports.py` 获取 dry-run 清单，人工确认后再加 `--execute`；旧导入未归零时迁移会拒绝继续。

两条 Pipeline 都提供 `RUN_TESTS` 参数；开启后会在镜像构建前运行 `npm run setup && npm run check`。常规 PR/push 质量检查仍由 GitHub Actions 执行。

## CI

`.github/workflows/quality.yml` 在面向 `dev`、`release`、`master` 的 PR 和对应分支 push 上执行根级 `npm run check`。业务需求先由独立业务分支合入 `release`，合并后的 `release` push 检查成功才算 Release 测试通过；随后仍由同一业务分支向 `master` 提 PR，不使用 `release -> master` PR。本地和 CI 复用同一质量入口，完整分支规则见 [本地开发与配置](development.md#分支与发布流程)。

## 回滚

- 应用回滚通过把 `TAG` 切回上一环境的不可变镜像标签并重新执行对应 Compose 完成；不得把 Dev 标签部署到 Production。
- 当前 head `0018`。`0016` 新增 `resume_imports` 且非空时拒绝 downgrade；`0017` 删除旧同步导入证据列，执行前必须完成不可逆的旧对象、版本和简历清理；`0018` 新增用户数据集表。
- `0017` 后旧镜像依赖已删除字段，禁止直接回切；只能向前修复。尚未产生新导入简历且确认可恢复空列结构时才允许 downgrade 到 `0016`，存在 `source_type=import` 行时 downgrade 会拒绝执行。
- `0012 → 0011` 只重新增加空的旧版备份列，不恢复已经删除的 JSON；如需恢复旧值或继续回滚到依赖旧格式的应用，必须使用执行 `0012` 前的外部数据库备份。不要把 schema 降级成功描述为数据已恢复。
- 如必须在隔离环境继续执行 `0011 → 0010`，先回滚应用，down 会重建空的 `admin_operation_logs`；`0010 → 0009` 还会重建空的对象存储清理任务表。继续执行 `0009 → 0008` 前须备份数据库，down 会删除 `admin_operation_logs`；继续执行 `0008 → 0007` 会保留升级后新写入的模型和日志主体，但不会恢复 `0008` 升级前清理的数据，同时会删除 binding 及能力、adapter、调用名、来源等附加快照。不要在新应用运行时执行。MySQL DDL 非事务，失败后停止自动重试并按实际 schema 或备份处理。
- 回滚到旧镜像时仍要保留新旧完整 LLM 密钥环，直到确认没有运行实例或密文依赖待移除的 key。
- 原型 Express/SQLite 数据不进入新 MySQL 数据库，也不作为生产回滚路径。
- 新增环境配置的回滚只恢复应用与 Compose；不得自动删除已有 `linkcv` 数据库或 Redis volume。
- 日志链路回滚可恢复上一版应用与 Compose，并让 `--remove-orphans` 停止 LinkCV Promtail；不得删除日志或 positions 命名卷，也不得修改共享 Loki。重新启用采集器后可能至少一次重复投递，管理查询会按 `event_id` 去重。
- 简历导入回滚采用上一版 Web 与 FastAPI 整体镜像；不删除新简历、MinIO 原件或 Redis 幂等 key，也不静默切回未验收的旧转换服务。
- `0015 → 0014` 只移除官方现代双栏和紧凑技术型模板新增的受控 Markdown，已经从模板创建的用户简历仍保留自己的快照。MySQL DDL 非事务，Production 不自动 downgrade。
- 进入新契约后应用替换必须同时覆盖 Web、FastAPI 与 Worker，避免页面、任务状态和消费者契约错配。
- 插件发布失败不覆盖 `current.json` 时继续使用上一版本；应用镜像回滚不删除 `system/plugin-releases/` 对象。当前版本内容有误时发布更高补丁版本，不覆盖同版本 ZIP。

Promtail 配置可以复用到后续系统级日志采集：在 `deploy/observability/promtail-config.yml` 增加新的 scrape job，并在 Compose 增加最小只读 mount 即可继续推送到相同 Loki。新增宿主机 journal 或 `/var/log` 采集前必须单独评审读取权限、日志量、敏感字段和 label 基数；不能直接把整台宿主机目录授权给当前容器。
