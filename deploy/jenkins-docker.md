# Jenkins legacy Docker deployment

The Jenkins pipeline temporarily keeps the existing Express application deployable while API capabilities move to FastAPI. Local development uses `deploy/docker-compose.yml`; Jenkins uses `deploy/docker-compose.legacy.yml`.

## Server layout

```bash
sudo mkdir -p /opt/tolink/LinkCV/deploy /opt/tolink/LinkCV/data
sudo chown -R jenkins:jenkins /opt/tolink/LinkCV
```

Create `/opt/tolink/LinkCV/.env` outside the repository. Use real values from the deployment secret store; do not commit them.

```dotenv
MINIO_ENDPOINT=https://minio.example.com
MINIO_ACCESS_KEY=<deployment-access-key>
MINIO_SECRET_KEY=<deployment-secret-key>
MINIO_BUCKET=linkcv
```

SQLite remains mounted at `/opt/tolink/LinkCV/data` only for the legacy service. Its prototype data is not migrated to MySQL.

## Jenkins job

- Repository: `https://github.com/ql-link/LinkCV.git`
- Script Path: `Jenkinsfile`
- The Jenkins agent needs Docker and Docker Compose access.

The pipeline builds the transitional root `Dockerfile` and runs:

```bash
cd /opt/tolink/LinkCV
export TAG=<git-sha>
export LINKCV_ENV_FILE=/opt/tolink/LinkCV/.env
docker compose -f deploy/docker-compose.legacy.yml up -d
```

This topology should be removed only after authentication, resumes, and asset APIs have moved to FastAPI and the production cutover has been verified.
