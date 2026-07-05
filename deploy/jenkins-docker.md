# Jenkins Docker deployment

This project follows the same deployment shape as `LinkRag-Web`: Jenkins builds the app, builds a local Docker image, then restarts the app from a fixed deployment directory with Docker Compose.

## Server layout

Prepare these directories on the Jenkins/deploy server:

```bash
sudo mkdir -p /opt/tolink/LinkCV/deploy /opt/tolink/LinkCV/data
sudo chown -R jenkins:jenkins /opt/tolink/LinkCV
```

Jenkins copies `deploy/docker-compose.yml` into `/opt/tolink/LinkCV/deploy/docker-compose.yml` on each deployment.

Create one runtime env file:

```text
/opt/tolink/LinkCV/.env
```

Example:

```dotenv
MINIO_ENDPOINT=http://103.205.254.30:39000
MINIO_ACCESS_KEY=root
MINIO_SECRET_KEY=ql354210
MINIO_BUCKET=linkcv
```

`/opt/tolink/LinkCV/data` is mounted into the container as `/app/data`, where SQLite stores `resume_app.sqlite`.

## Jenkins job

Use `Pipeline script from SCM`:

- Repository: `https://github.com/ql-link/LinkCV.git`
- Branch: `*/master`
- Script Path: `Jenkinsfile`

The Jenkins agent must have Docker and Docker Compose available, and the Jenkins user must be allowed to run Docker.

## Deploy command used by Jenkins

```bash
cd /opt/tolink/LinkCV
export TAG=<git-sha>
export LINKCV_ENV_FILE=/opt/tolink/LinkCV/.env
docker compose -f deploy/docker-compose.yml up -d
```

## Useful checks

```bash
docker ps | grep linkcv
docker logs -f linkcv
curl -fsS http://127.0.0.1:4174/api/health
```
