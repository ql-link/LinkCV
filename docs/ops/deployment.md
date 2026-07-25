# 构建与部署

## 当前状态

根级 `Dockerfile` 构建 Vite 静态产物和 FastAPI Python 环境。Node 依赖默认使用 npmmirror，固定版本的 `uv` 与 Python 依赖默认使用阿里云 PyPI，避免部署节点依赖 GHCR。构建过程从 `uv.lock` 导出带哈希的 requirements 后再从指定镜像安装，既保留锁定版本与制品校验，也避免锁文件里的外部下载地址绕过镜像。镜像构建只打包 `migrations/sql/`、Alembic revision 和迁移 runner，不连接数据库。容器启动时 runner 先核对 `APP_ENV`、MySQL host、port 和 database，再升级到 Alembic head；目标不一致时拒绝启动，校验成功后才由 Uvicorn 在 `8000` 端口提供 `/api` 与 Web 静态文件。

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

Production Pipeline 会把仓库中的非敏感 `.env.production` 和 Compose 复制到部署目录；私密覆盖必须由部署密钥存储预先提供。生产容器通过 `tolink-app-net` 使用 Docker DNS 连接 `tolink-mysql:3306`、`tolink-redis:6379` 和 `tolink-minio:9000`，不依赖尚未发布的 Cloud 宿主机端口。私密覆盖只保存凭据，不应设置 `DATABASE_URL`、`REDIS_URL` 或 `MINIO_ENDPOINT` 覆盖仓库中的生产地址。MySQL、Redis 与 MinIO 的生产实例不由该 Compose 创建。

两条 Pipeline 都提供 `RUN_TESTS` 参数；开启后会在镜像构建前运行 `npm run setup && npm run check`。常规 PR/push 质量检查仍由 GitHub Actions 执行。

## CI

`.github/workflows/quality.yml` 在面向 `dev`、`master` 的 PR 和对应分支 push 上执行根级 `npm run check`。本地和 CI 复用同一质量入口。

## 回滚

- 应用回滚通过把 `TAG` 切回上一环境的不可变镜像标签并重新执行对应 Compose 完成；不得把 Dev 标签部署到 Production。
- Alembic revision 必须保持向前兼容上一个应用版本；需要破坏性 Schema 变更时使用“扩展—迁移—收缩”步骤，不能依赖自动 downgrade。
- 原型 Express/SQLite 数据不进入新 MySQL 数据库，也不作为生产回滚路径。
- 新增环境配置的回滚只恢复应用与 Compose；不得自动删除已有 `linkcv` 数据库或 Redis volume。
