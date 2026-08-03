# 构建与部署

## 当前状态

根级 `Dockerfile` 构建 Vite 静态产物和 FastAPI Python 环境。Node 依赖默认使用 npmmirror，固定版本的 `uv` 与 Python 依赖默认使用阿里云 PyPI，避免部署节点依赖 GHCR。构建过程静默地从 `uv.lock` 导出带哈希的 requirements 后再从指定镜像安装，既保留锁定版本与制品校验，也避免锁文件里的外部下载地址绕过镜像或把完整依赖清单写入 Jenkins 日志。镜像构建只打包 `migrations/sql/`、Alembic revision 和迁移 runner，不连接数据库。容器启动时 runner 先核对 `APP_ENV`、MySQL host、port 和 database，再升级到 Alembic head；目标不一致时拒绝启动，校验成功后才由 Uvicorn 在 `8000` 端口提供 `/api` 与 Web 静态文件。

仓库提供相互独立的 Dev 与 Production Jenkins Pipeline。两者都使用不可变镜像标签，先以显式目标参数运行迁移 runner，再更新 Compose，最后等待 `/api/health`；构建镜像阶段不连接数据库。

`deploy/docker-compose.yml` 只用于本地启动 MySQL 8.4、Redis 和 MinIO。

## Dev Pipeline

Dev Jenkins Job 使用 `deploy/jenkins/Jenkinsfile.development`。Jenkins 将当前 checkout 通过 `git archive` 打包并上传 Primary `100.86.10.52`，由 `deploy/scripts/build-development-on-primary.sh` 在 `/opt/tolink/dev` 内完成构建和部署，因此远端构建内容与 Jenkins 当前 commit 一致。

- 镜像：`linkcv:dev-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/dev/linkcv`
- Compose：`deploy/docker-compose.development.yml`
- 容器：`linkcv-dev`
- 网络：外部网络 `tolink-dev-net`
- 宿主机端口：`18002`
- 配置：`.env.development` + 权限为 `600` 的 `.env.development.local`
- 迁移门禁：`APP_ENV=development`、MySQL `100.86.10.52:13306/linkcv`

Dev Jenkins 节点需预置 `/var/jenkins_home/.ssh/primary_dev`，并能以 `root` 连接 Primary。Primary 需已有 Docker、Docker Compose、`tolink-dev-net` 和私密 env 文件。LinkCV Dev 使用独立 `linkcv` MySQL 数据库、MinIO bucket 和 Redis DB 2；本地密钥文件只保存凭据，不覆盖仓库中的地址与资源名。任一前置条件、迁移或健康检查失败都会让 Job 失败。

`linkcv-dev` 的 Generic Webhook Trigger 只接受 `refs/heads/dev`。token 通过 Jenkins Secret Text 凭据 `linkcv-dev-webhook-token` 注入，仓库不保存 token；GitHub 仓库 webhook 只订阅 push 事件。

## Production Pipeline

Production Jenkins Job 使用根目录 `Jenkinsfile`，在生产 Jenkins 节点本地构建并部署：

- 镜像：`linkcv:prod-<commit>-b<build-number>`
- 部署目录：`/opt/tolink/LinkCV`
- Compose：`deploy/docker-compose.production.yml`
- 容器：`linkcv`
- 网络：外部网络 `tolink-app-net`
- 宿主机端口：`8000`
- 配置：`.env.production` + 权限为 `400` 或 `600` 的 `.env.production.local`
- 迁移门禁：`APP_ENV=production`、MySQL `tolink-mysql:3306/linkcv`

Production Pipeline 会把仓库中的非敏感 `.env.production` 和 Compose 复制到部署目录；私密覆盖必须由部署密钥存储预先提供。除 JWT、MySQL 和 MinIO 凭据外，新版本还要求私密覆盖提供有效的 `LLM_CREDENTIAL_ENCRYPTION_KEYS` 与 `LINKPARSE_API_KEY`，否则 Settings 会在启动前安全失败。LLM 密钥环用于解密 MySQL 中的模型凭据，不是供应商 API key；轮换时先发布“新 key 在首项、旧 key 仍保留”的配置，确认旧密文已经重包后才能移除旧 key。LinkParse Key 只供后端 Bearer 请求使用，不进入 Web 制品。

本期没有管理员开通接口。发布方还需在受控流程中确保至少一个既有用户被标记为 `users.is_admin=true`；公开注册始终是普通用户。没有管理员只会使 `/api/admin/llm/**` 无法使用，不会放宽权限。

生产容器通过 `tolink-app-net` 使用 Docker DNS 连接 `tolink-mysql:3306`、`tolink-redis:6379` 和 `tolink-minio:9000`，并须能访问仓库配置的 LinkParse `100.86.10.52:18743`。私密覆盖只保存凭据，不应设置 `DATABASE_URL`、`REDIS_URL`、`MINIO_ENDPOINT` 或 `LINKPARSE_BASE_URL` 覆盖仓库中的地址。MySQL、Redis、MinIO 与 LinkParse 都不由该 Compose 创建。上线前需从目标容器核实 `/health`、`/v1/info` 和使用虚构 PDF 的授权 parse smoke；当前 HTTP 传输及服务端保留策略未确认前不得生产放量。

本次只通过现有 `pyproject.toml + uv.lock` 安装 Mammoth、nh3 和 markdownify；`Dockerfile` 不增加 PyMuPDF、PyMuPDF4LLM、Tesseract、OCR 语言包或其他系统依赖。Web 与 FastAPI 必须同版本发布，因为导入接口新增必填 `Idempotency-Key` 且没有旧客户端兼容窗口。

两条 Pipeline 都提供 `RUN_TESTS` 参数；开启后会在镜像构建前运行 `npm run setup && npm run check`。常规 PR/push 质量检查仍由 GitHub Actions 执行。

## CI

`.github/workflows/quality.yml` 在面向 `dev`、`master` 的 PR 和对应分支 push 上执行根级 `npm run check`。本地和 CI 复用同一质量入口。

## 回滚

- 应用回滚通过把 `TAG` 切回上一环境的不可变镜像标签并重新执行对应 Compose 完成；不得把 Dev 标签部署到 Production。
- Alembic revision 必须保持向前兼容上一个应用版本。`0009` 曾新增管理员操作审计日志表，`0011` 在管理端无查询入口后移除该表（down 只重建空表结构）；`0008` 执行 DDL 前会按外键依赖顺序永久清空旧调用日志和模型配置，再增加 Chat 候选字段、唯一当前 binding 和日志快照，升级完成后需要管理员重新配置并设置当前 Chat 模型。新应用会双写旧 `model_name/enabled`，因此应用回滚优先保留 `0008` 起 schema；回滚前核对最后当前候选的旧启用镜像。Production 不自动 downgrade。
- 如必须在隔离环境执行 `0011 → 0010`，先回滚应用，down 会重建空的 `admin_operation_logs`（该表已无写入路径，确认空表无残留后按需删除）；继续执行 `0009 → 0008` 前还须备份数据库，down 会删除 `admin_operation_logs` 并保留升级后新写入的模型和日志主体，但不会恢复 `0008` 升级前清理的数据，同时会删除 binding 及能力、adapter、调用名、来源等附加快照。不要在新应用运行时执行。MySQL DDL 非事务，失败后停止自动重试并按实际 schema 或备份处理。
- 回滚到旧镜像时仍要保留新旧完整 LLM 密钥环，直到确认没有运行实例或密文依赖待移除的 key。
- 原型 Express/SQLite 数据不进入新 MySQL 数据库，也不作为生产回滚路径。
- 新增环境配置的回滚只恢复应用与 Compose；不得自动删除已有 `linkcv` 数据库或 Redis volume。
- 简历导入回滚采用上一版 Web 与 FastAPI 整体镜像；不删除新简历、MinIO 原件或 Redis 幂等 key，也不静默切回未验收的旧转换服务。
