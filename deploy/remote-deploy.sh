#!/usr/bin/env bash
set -euo pipefail

: "${APP_TARBALL:?APP_TARBALL is required}"
: "${DEPLOY_DIR:?DEPLOY_DIR is required}"
: "${RELEASE_ID:?RELEASE_ID is required}"

SERVICE_NAME="${SERVICE_NAME:-linkcv}"
APP_PORT="${APP_PORT:-4174}"
RUN_USER="${RUN_USER:-$(id -un)}"
SUDO="${SUDO:-sudo}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

releases_dir="${DEPLOY_DIR}/releases"
release_dir="${releases_dir}/${RELEASE_ID}"
shared_dir="${DEPLOY_DIR}/shared"
env_file="${shared_dir}/app.env"

mkdir -p "${release_dir}" "${shared_dir}/data"
tar -xzf "${APP_TARBALL}" -C "${release_dir}"

cd "${release_dir}"
npm ci --omit=dev

cat > "${env_file}" <<ENV
NODE_ENV=production
API_PORT=${APP_PORT}
DATA_DIR=${shared_dir}/data
ENV

if [ -n "${RUNTIME_ENV_FILE:-}" ] && [ -f "${RUNTIME_ENV_FILE}" ]; then
  cat "${RUNTIME_ENV_FILE}" >> "${env_file}"
fi

ln -sfn "${release_dir}" "${DEPLOY_DIR}/current"

service_file="/etc/systemd/system/${SERVICE_NAME}.service"
tmp_service="$(mktemp)"
cat > "${tmp_service}" <<SERVICE
[Unit]
Description=LinkCV resume service
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${DEPLOY_DIR}/current
EnvironmentFile=${env_file}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

${SUDO} install -m 0644 "${tmp_service}" "${service_file}"
rm -f "${tmp_service}"
${SUDO} systemctl daemon-reload
${SUDO} systemctl enable "${SERVICE_NAME}"
${SUDO} systemctl restart "${SERVICE_NAME}"

for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null; then
    break
  fi

  if [ "${attempt}" -eq 20 ]; then
    ${SUDO} systemctl status "${SERVICE_NAME}" --no-pager || true
    exit 1
  fi

  sleep 1
done

find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d \
  | sort -r \
  | tail -n "+$((KEEP_RELEASES + 1))" \
  | xargs -r rm -rf
