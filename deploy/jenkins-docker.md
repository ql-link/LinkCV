# Jenkins Docker deployment

LinkCV uses separate Jenkins jobs for Development and Production. Both jobs build the root Dockerfile, run the guarded Alembic runner before deployment, update the matching Compose service, and wait for `/api/health`.

## Development

Configure the Dev job with the script path `deploy/jenkins/Jenkinsfile.development`. The job archives its checked-out commit and sends it to Primary, where `deploy/scripts/build-development-on-primary.sh` builds and deploys it.

Primary must provide `/opt/tolink/test/linkcv/.env.development.local` with mode `400` or `600`, the external Docker network `tolink-test-net`, and free host port `18002`. The Jenkins agent must provide `/var/jenkins_home/.ssh/primary_test`.

The guarded migration target is `development / 100.86.10.52:13306 / linkcv`; a mismatch fails before Alembic runs.

## Production

Jenkins copies the repository's non-secret `.env.production` to `/opt/tolink/LinkCV/.env.production`. Place a private `/opt/tolink/LinkCV/.env.production.local` beside it from the deployment secret store. The private file must define the MySQL and MinIO credentials plus a random JWT secret.

```dotenv
MYSQL_USER=<deployment-user>
MYSQL_PASSWORD=<deployment-password>
JWT_SECRET=<at-least-32-random-characters>
COOKIE_SECURE=true
MINIO_ENDPOINT=https://minio.example.com
MINIO_ACCESS_KEY=<deployment-access-key>
MINIO_SECRET_KEY=<deployment-secret-key>
MINIO_BUCKET=linkcv
```

The Production Jenkins agent needs Docker and Docker Compose access plus the external network `tolink-app-net`. The root `Jenkinsfile` deploys with:

```bash
cd /opt/tolink/LinkCV
export TAG=<git-sha>
export LINKCV_ENV_FILE=/opt/tolink/LinkCV/.env.production
export LINKCV_SECRET_ENV_FILE=/opt/tolink/LinkCV/.env.production.local
export LINKCV_DOCKER_NETWORK=tolink-app-net
docker compose -f deploy/docker-compose.production.yml up -d
```

The guarded Production migration target is `production / 100.86.10.52:3306 / linkcv`. The image build does not connect to MySQL. Container startup keeps the same guard as a final protection for manual or concurrent starts.
