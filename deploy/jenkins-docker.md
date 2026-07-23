# Jenkins Docker deployment

Jenkins builds the root Dockerfile and deploys FastAPI plus the bundled Web application through `deploy/docker-compose.production.yml`.

Create `/opt/tolink/LinkCV/.env` outside the repository using values from the deployment secret store. It must define a MySQL connection, MinIO credentials, and a random JWT secret.

```dotenv
DATABASE_URL=mysql+pymysql://<user>:<password>@<mysql-host>:3306/linkcv?charset=utf8mb4
JWT_SECRET=<at-least-32-random-characters>
COOKIE_SECURE=true
MINIO_ENDPOINT=https://minio.example.com
MINIO_ACCESS_KEY=<deployment-access-key>
MINIO_SECRET_KEY=<deployment-secret-key>
MINIO_BUCKET=linkcv
```

The Jenkins agent needs Docker and Docker Compose access. The pipeline deploys with:

```bash
cd /opt/tolink/LinkCV
export TAG=<git-sha>
export LINKCV_ENV_FILE=/opt/tolink/LinkCV/.env
docker compose -f deploy/docker-compose.production.yml up -d
```

The container applies Alembic migrations before starting Uvicorn and exposes its health check at `/api/health` on port `8000`.
