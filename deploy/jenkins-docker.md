# Jenkins Docker deployment

LinkCV uses separate Jenkins jobs for Development and Production. Both jobs build the application and Pi images, run the guarded Alembic runner before deployment, update the matching Compose services, and wait for `/api/health` plus `/api/agent/readiness`. The Agent readiness probe verifies the FastAPI-to-Pi-to-FastAPI authentication and current Chat model configuration without calling the model provider.

## Development

Configure the Dev job with the script path `deploy/jenkins/Jenkinsfile.development`. The job archives its checked-out commit and sends it to Primary, where `deploy/scripts/build-development-on-primary.sh` builds and deploys it.

Primary must provide `/opt/tolink/dev/linkcv/.env.development.local` with mode `600`, the external Docker network `tolink-dev-net`, and free host port `18002`. The Jenkins agent must provide `/var/jenkins_home/.ssh/primary_dev`.

The private file contains only credentials and the JWT secret. The committed
`.env.development` remains authoritative for `100.86.10.52:13306/linkcv`, Redis
DB 2, the MinIO endpoint, and bucket `linkcv`.

The guarded migration target is `development / 100.86.10.52:13306 / linkcv`; a target mismatch or a known Alembic/schema marker drift fails before any migration DDL runs.

Create a Jenkins Secret Text credential named `linkcv-dev-webhook-token`. The
pipeline declares a Generic Webhook Trigger that accepts only
`refs/heads/dev`; configure GitHub with the same token and only the push event.
Do not place the token in this repository or the Primary env file.

## Production

The Production job uses the root `Jenkinsfile`. It reuses the existing
`linkcv-dev-webhook-token` Secret Text credential and accepts only
`refs/heads/master`. The shared GitHub push webhook therefore dispatches Dev
pushes to the Development job and master pushes to the Production job without
adding another webhook or exposing the token in the repository.

After adding the trigger for the first time, run the Production job once so
Jenkins loads and registers the trigger from the updated `Jenkinsfile`.
Subsequent pull-request merges into `master` emit a push event and start the
Production job automatically.

Jenkins 只归档当前提交，并使用 `/var/jenkins_home/.ssh/cloud_prod` 上传到 Cloud；`deploy/scripts/build-production-on-cloud.sh` 在 `/opt/tolink/LinkCV` 所在的真实生产主机完成双镜像构建、迁移、Compose 更新、双健康检查和成对回滚。私密 `/opt/tolink/LinkCV/.env.production.local` 必须预先由部署密钥存储写入并设置为 `600`。

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
LINKCV_INTERNAL_AGENT_TOKEN=<different-at-least-32-random-characters>
PLUGIN_RELEASE_ORIGIN=https://linkresume.cn
```

连接地址和 Bucket 由仓库中的 `.env.production` 管理。私密文件不要设置
`DATABASE_URL`、`REDIS_URL` 或 `MINIO_ENDPOINT`，否则会覆盖通过
`tolink-app-net` 使用的生产 Docker DNS 地址。

Production Cloud 需要 Docker、Docker Compose、外部网络 `tolink-app-net` 和至少一个可回滚的上一版本镜像对。远端脚本按同一 `prod-<commit>-b<build>` 标签构建 `linkcv` 与 `linkcv-pi`，部署时同时提供 `TAG` 与 `PI_TAG`：

```bash
export TAG=prod-<commit>-b<build>
export PI_TAG=prod-<commit>-b<build>
export LINKCV_ENV_FILE=/opt/tolink/LinkCV/.env.production
export LINKCV_SECRET_ENV_FILE=/opt/tolink/LinkCV/.env.production.local
export LINKCV_DOCKER_NETWORK=tolink-app-net
export LINKCV_HTTP_PORT=4174
docker compose -f /opt/tolink/LinkCV/deploy/docker-compose.production.yml up -d --remove-orphans
```

受保护的 Production 迁移目标是 `production / tolink-mysql:3306 / linkcv`。镜像构建不连接 MySQL；迁移成功后才更新 Compose。发布必须同时满足 `linkcv`、`linkcv-pi` 健康，Worker/Promtail 运行，以及 `/api/health`、`/api/agent/readiness` 可用。失败时脚本使用备份的上一版 Compose 和上一对镜像标签回滚；若上一版尚未包含 Pi，则使用其原 Compose 回滚，不能拿新 Compose 拼接旧单镜像。Redis 和 MinIO 继续通过同一外部网络访问 `tolink-redis:6379` 与 `http://tolink-minio:9000`。
