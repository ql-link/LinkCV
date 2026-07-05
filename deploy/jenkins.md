# Jenkins deployment

This project is deployed as a Node service. In production, `server/index.mjs` serves both `/api/*` and the Vite `dist/` build.

## Jenkins prerequisites

- Node.js and npm are available on the Jenkins agent.
- The target server has Node.js, npm, `curl`, `tar`, and `systemd`.
- Jenkins has an SSH private key credential. The default credential ID used by `Jenkinsfile` is `linkcv-deploy-ssh`.
- The SSH user can run `sudo systemctl ...` without an interactive password, or the deploy job sets `SUDO=` and runs as root.

## Pipeline parameters

- `DEPLOY_HOST`: target server host or IP.
- `DEPLOY_USER`: SSH user, default `deploy`.
- `DEPLOY_DIR`: app directory on the target server, default `/opt/linkcv`.
- `SERVICE_NAME`: systemd service name, default `linkcv`.
- `APP_PORT`: Node service port, default `4174`.
- `SSH_CREDENTIALS_ID`: Jenkins SSH credential ID.
- `SKIP_DEPLOY`: build and archive the artifact without deploying.

## Runtime environment

The remote deploy script writes `${DEPLOY_DIR}/shared/app.env` and keeps SQLite data in `${DEPLOY_DIR}/shared/data`.

Set these as Jenkins environment variables or inject them from Jenkins credentials when needed. The pipeline copies only non-empty values into the remote systemd environment file:

- `MINIO_ENDPOINT`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`

If they are omitted, the application falls back to the defaults in `server/minio.mjs`.

## Reverse proxy

Point Nginx or another reverse proxy at the service:

```nginx
location / {
  proxy_pass http://127.0.0.1:4174;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```
