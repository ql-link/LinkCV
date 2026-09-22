# Jenkins Docker deployment

LinkResume uses separate Jenkins jobs for Development and Production. Both jobs build the application and Pi images, run the guarded Alembic runner before deployment, update the matching Compose services, and wait for `/api/health` plus `/api/agent/readiness`. The Agent readiness probe verifies the FastAPI-to-Pi-to-FastAPI authentication and current Chat model configuration without calling the model provider.

## Development

Configure the Dev job with the script path `deploy/jenkins/Jenkinsfile.development`. The job archives its checked-out commit and sends it to Primary, where `deploy/scripts/build-development-on-primary.sh` builds and deploys it.

Primary must provide `/opt/tolink/dev/linkresume/.env.development.local` with mode `600`, the external Docker network `tolink-dev-net`, and free host port `18002`. The Jenkins agent must provide `/var/jenkins_home/.ssh/primary_dev`.

The private file contains only credentials and the JWT secret. The committed
`.env.development` remains authoritative for `100.86.10.52:13306/linkresume`, Redis
DB 2, the MinIO endpoint, and bucket `linkresume`.

The guarded migration target is `development / 100.86.10.52:13306 / linkresume`; a target mismatch or a known Alembic/schema marker drift fails before any migration DDL runs.

Create a Jenkins Secret Text credential named `linkresume-dev-webhook-token`. The
pipeline declares a Generic Webhook Trigger that accepts only
`refs/heads/dev`; configure GitHub with the same token and only the push event.
Do not place the token in this repository or the Primary env file.

## Production

The Production job uses the root `Jenkinsfile`. It reuses the existing
`linkresume-dev-webhook-token` Secret Text credential and accepts only
`refs/heads/master`. The shared GitHub push webhook therefore dispatches Dev
pushes to the Development job and master pushes to the Production job without
adding another webhook or exposing the token in the repository.

After adding the trigger for the first time, run the Production job once so
Jenkins loads and registers the trigger from the updated `Jenkinsfile`.
Subsequent pull-request merges into `master` emit a push event and start the
Production job automatically.

Jenkins 只归档当前提交，并使用 `/var/jenkins_home/.ssh/cloud_prod` 上传到 Cloud；`deploy/scripts/build-production-on-cloud.sh` 在 `/opt/tolink/LinkResume` 所在的真实生产主机完成双镜像构建、OSS 静态资源发布、停止旧运行时、迁移、Compose 更新和双健康检查。迁移开始后不自动回滚到可能与新 schema 不兼容的旧镜像；必须先恢复数据库备份才能恢复旧应用。应用私密 `/opt/tolink/LinkResume/.env.production.local` 与仅供发布脚本使用的 `/opt/tolink/LinkResume/.env.oss-cdn.local` 都必须预先由部署密钥存储写入并设置为 `600`；后者沿用旧文件名以兼容现有主机配置，格式见 `deploy/oss-cdn.env.example`，不会传入 Compose。

```dotenv
MYSQL_USER=<deployment-user>
MYSQL_PASSWORD=<deployment-password>
JWT_SECRET=<at-least-32-random-characters>
COOKIE_SECURE=true
MINIO_ACCESS_KEY=<deployment-access-key>
MINIO_SECRET_KEY=<deployment-secret-key>
LLM_CREDENTIAL_ENCRYPTION_KEYS=<key-id>:<fernet-key>
LINKPARSE_API_KEY=<deployment-linkparse-key>
RABBITMQ_URL=<deployment-rabbitmq-url>
WECHAT_APPID=<wechat-appid>
WECHAT_SECRET=<wechat-app-secret>
PI_SERVICE_TOKEN=<at-least-32-random-characters>
LINKRESUME_INTERNAL_AGENT_TOKEN=<different-at-least-32-random-characters>
```

连接地址和 Bucket 由仓库中的 `.env.production` 管理。私密文件不要设置
`DATABASE_URL`、`REDIS_URL` 或 `MINIO_ENDPOINT`，否则会覆盖通过
`tolink-app-net` 使用的生产 Docker DNS 地址。

Production Cloud 需要 Docker、Docker Compose、`ossutil 2.x`、外部网络 `tolink-app-net` 和至少一个可回滚的上一版本镜像对。远端脚本按同一 `prod-<commit>-b<build>` 标签构建 `linkresume` 与 `linkresume-pi`，先从 Web 镜像提取 `/app/web/assets` 上传到 OSS 的 `LinkResume/assets/` 前缀，并把 `/app/web/favicon.png` 上传到 `LinkResume/favicon.png`；两类对象都通过 OSS 公网 HTTPS 地址验证，成功后才进入迁移和应用切换；部署时同时提供 `TAG` 与 `PI_TAG`：

```bash
export TAG=prod-<commit>-b<build>
export PI_TAG=prod-<commit>-b<build>
export LINKRESUME_ENV_FILE=/opt/tolink/LinkResume/.env.production
export LINKRESUME_SECRET_ENV_FILE=/opt/tolink/LinkResume/.env.production.local
export LINKRESUME_DOCKER_NETWORK=tolink-app-net
export LINKRESUME_HTTP_PORT=4174
docker compose -f /opt/tolink/LinkResume/deploy/docker-compose.production.yml up -d --remove-orphans
```

受保护的 Production 迁移目标是 `production / tolink-mysql:3306 / linkresume`。镜像构建不连接 MySQL；旧 LinkResume Web、Worker 和 Pi 停止后才运行 forward-only 迁移，迁移成功后才更新 Compose。发布必须同时满足 `linkresume`、`linkresume-pi` 健康，Worker/Promtail 运行，以及 `/api/health`、`/api/agent/readiness` 可用。迁移开始后失败会保持旧容器停止；只能前向修复，或先恢复数据库备份再使用备份的上一版 Compose 和成对镜像。Redis 和 MinIO 继续通过同一外部网络访问 `tolink-redis:6379` 与 `http://tolink-minio:9000`。
