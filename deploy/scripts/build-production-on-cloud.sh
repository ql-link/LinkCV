#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 <build-number> <commit-short> <source-archive> <import-legacy-sqlite>" >&2
  exit 2
fi

build_number="$1"
commit_short="$2"
source_archive="$3"
import_legacy_sqlite="$4"

if [[ ! "${build_number}" =~ ^[0-9]+$ ]]; then
  echo "build-number must be numeric" >&2
  exit 3
fi
if [[ ! "${commit_short}" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "commit-short must be a hexadecimal Git revision" >&2
  exit 4
fi
if [[ ! -f "${source_archive}" ]]; then
  echo "source archive does not exist: ${source_archive}" >&2
  exit 5
fi
if [[ "${import_legacy_sqlite}" != "true" && "${import_legacy_sqlite}" != "false" ]]; then
  echo "import-legacy-sqlite must be true or false" >&2
  exit 6
fi

image="linkcv"
tag="prod-${commit_short}-b${build_number}"
prod_root="/opt/tolink/LinkCV"
deploy_dir="${prod_root}"
work_root="${prod_root}/jenkins/workspaces"
build_dir="${work_root}/linkcv-${build_number}"
base_env="${deploy_dir}/.env.production"
secret_env="${deploy_dir}/.env.production.local"
compose_file="${deploy_dir}/deploy/docker-compose.production.yml"
old_compose_file="${deploy_dir}/deploy/docker-compose.yml"
legacy_sqlite="${deploy_dir}/data/resume_app.sqlite"
backup_root="${deploy_dir}/backups/production-cutover"
docker_network="tolink-app-net"
http_port="4174"
cutover_started="false"

cleanup() {
  if [[ "${build_dir}" == "${work_root}/linkcv-${build_number}" ]]; then
    rm -rf -- "${build_dir}"
  fi
}
finish() {
  exit_status=$?
  if [[ "${exit_status}" -ne 0 && "${cutover_started}" == "true" ]] && \
    declare -F rollback_old_application >/dev/null; then
    rollback_old_application || true
  fi
  cleanup
  return "${exit_status}"
}
trap finish EXIT

if [[ ! -f "${secret_env}" ]]; then
  echo "Missing Production secret env file: ${secret_env}" >&2
  exit 10
fi
secret_mode="$(stat -c '%a' "${secret_env}")"
if [[ "${secret_mode}" != "600" ]]; then
  echo "Production secret env file must use mode 600, got ${secret_mode}" >&2
  exit 11
fi

required_secret_keys=(
  MYSQL_USER
  MYSQL_PASSWORD
  JWT_SECRET
  MINIO_ACCESS_KEY
  MINIO_SECRET_KEY
  LLM_CREDENTIAL_ENCRYPTION_KEYS
  PI_SERVICE_TOKEN
  LINKPARSE_API_KEY
  RABBITMQ_URL
  PLUGIN_RELEASE_ORIGIN
)
for required_key in "${required_secret_keys[@]}"; do
  if ! grep -Eq "^${required_key}=.+$" "${secret_env}"; then
    echo "Missing required Production secret setting: ${required_key}" >&2
    exit 12
  fi
done
for forbidden_key in DATABASE_URL REDIS_URL MINIO_ENDPOINT; do
  if grep -Eq "^${forbidden_key}=" "${secret_env}"; then
    echo "Production secret env must not override ${forbidden_key}" >&2
    exit 13
  fi
done

docker network inspect "${docker_network}" >/dev/null
port_owners="$(docker ps --filter "publish=${http_port}" --format '{{.Names}}')"
if [[ -n "${port_owners}" && "${port_owners}" != "linkcv" ]]; then
  echo "Production port ${http_port} is owned by another container" >&2
  exit 14
fi
if [[ "${import_legacy_sqlite}" == "true" && ! -f "${legacy_sqlite}" ]]; then
  echo "Legacy SQLite source is missing" >&2
  exit 15
fi

available_kb="$(df -Pk "${prod_root}" | awk 'NR == 2 {print $4}')"
if [[ ! "${available_kb}" =~ ^[0-9]+$ || "${available_kb}" -lt 2097152 ]]; then
  echo "Production host requires at least 2 GiB free disk space" >&2
  exit 16
fi

rm -rf -- "${build_dir}"
mkdir -p "${build_dir}" "${deploy_dir}/deploy/observability" "${backup_root}"
tar -xzf "${source_archive}" -C "${build_dir}"

DOCKER_BUILDKIT=1 docker build \
  --label "org.opencontainers.image.revision=${commit_short}" \
  -t "${image}:${tag}" \
  "${build_dir}"

backup_dir="${backup_root}/build-${build_number}"
mkdir -m 0700 -p "${backup_dir}"
for deployed_file in \
  "${base_env}" \
  "${compose_file}" \
  "${deploy_dir}/deploy/observability/promtail-config.yml"; do
  if [[ -f "${deployed_file}" ]]; then
    cp -p "${deployed_file}" "${backup_dir}/$(basename "${deployed_file}")"
  fi
done

old_image="$(docker inspect --format='{{.Config.Image}}' linkcv 2>/dev/null || true)"
printf '%s\n' "${old_image}" >"${backup_dir}/previous-image.txt"

rollback_old_application() {
  if [[ "${old_image}" != linkcv:* ]]; then
    echo "Automatic application rollback is unavailable" >&2
    return 1
  fi
  old_tag="${old_image#linkcv:}"
  if [[ "${old_image}" == linkcv:prod-* ]]; then
    previous_compose_file="${backup_dir}/docker-compose.production.yml"
    if [[ ! -f "${previous_compose_file}" ]]; then
      echo "Previous Production compose file is unavailable" >&2
      return 1
    fi
    TAG="${old_tag}" \
    LINKCV_ENV_FILE="${backup_dir}/.env.production" \
    LINKCV_SECRET_ENV_FILE="${secret_env}" \
    LINKCV_DOCKER_NETWORK="${docker_network}" \
    LINKCV_HTTP_PORT="${http_port}" \
      docker compose -f "${previous_compose_file}" up -d --remove-orphans
  elif [[ -f "${old_compose_file}" ]]; then
    TAG="${old_tag}" \
    LINKCV_ENV_FILE="${deploy_dir}/.env" \
      docker compose -f "${old_compose_file}" up -d --remove-orphans
  else
    echo "Legacy Production compose file is unavailable" >&2
    return 1
  fi
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${http_port}/api/health" >/dev/null; then
      echo "Previous Production application restored: ${old_image}"
      return 0
    fi
    sleep 2
  done
  echo "Previous Production application rollback health check failed" >&2
  return 1
}

install -m 0644 "${build_dir}/.env.production" "${base_env}"
install -m 0644 \
  "${build_dir}/deploy/docker-compose.production.yml" \
  "${compose_file}"
install -m 0644 \
  "${build_dir}/deploy/observability/promtail-config.yml" \
  "${deploy_dir}/deploy/observability/promtail-config.yml"

docker run --rm \
  --network "${docker_network}" \
  --env-file "${base_env}" \
  --env-file "${secret_env}" \
  -e APP_ENV=production \
  "${image}:${tag}" \
  python /app/scripts/db/init_mysql.py

docker run --rm \
  --network "${docker_network}" \
  --env-file "${base_env}" \
  --env-file "${secret_env}" \
  -e APP_ENV=production \
  "${image}:${tag}" \
  python /app/scripts/release/run_alembic.py \
    --expected-app-env production \
    --expected-host tolink-mysql \
    --expected-port 3306 \
    --expected-database linkcv

if [[ "${import_legacy_sqlite}" == "true" ]]; then
  sqlite_backup="${backup_dir}/resume_app.sqlite"
  cutover_started="true"
  docker stop linkcv >/dev/null
  if ! sqlite3 "${legacy_sqlite}" ".backup '${sqlite_backup}'"; then
    echo "Failed to create a consistent legacy SQLite backup" >&2
    exit 18
  fi
  chmod 0600 "${sqlite_backup}"
  sha256sum "${sqlite_backup}" >"${backup_dir}/resume_app.sqlite.sha256"
  for import_mode in dry-run execute; do
    import_args=(--source /legacy/resume_app.sqlite)
    if [[ "${import_mode}" == "execute" ]]; then
      import_args+=(--execute)
    fi
    if ! docker run --rm \
      --network "${docker_network}" \
      --env-file "${base_env}" \
      --env-file "${secret_env}" \
      -e APP_ENV=production \
      -v "${sqlite_backup}:/legacy/resume_app.sqlite:ro" \
      "${image}:${tag}" \
      python /app/scripts/release/import_legacy_sqlite.py "${import_args[@]}"; then
      echo "Legacy SQLite ${import_mode} failed" >&2
      exit 19
    fi
  done
fi

cutover_started="true"

TAG="${tag}" \
LINKCV_ENV_FILE="${base_env}" \
LINKCV_SECRET_ENV_FILE="${secret_env}" \
LINKCV_DOCKER_NETWORK="${docker_network}" \
LINKCV_HTTP_PORT="${http_port}" \
  docker compose -f "${compose_file}" up -d --remove-orphans

for _ in $(seq 1 30); do
  health_status="$(docker inspect --format='{{.State.Health.Status}}' linkcv 2>/dev/null || true)"
  worker_status="$(docker inspect --format='{{.State.Status}}' linkcv-worker 2>/dev/null || true)"
  pi_health_status="$(docker inspect --format='{{.State.Health.Status}}' linkcv-pi 2>/dev/null || true)"
  promtail_status="$(docker inspect --format='{{.State.Status}}' linkcv-promtail 2>/dev/null || true)"
  if [[ "${health_status}" == "healthy" ]] && \
    [[ "${worker_status}" == "running" ]] && \
    [[ "${pi_health_status}" == "healthy" ]] && \
    [[ "${promtail_status}" == "running" ]] && \
    curl -fsS "http://127.0.0.1:${http_port}/api/health" >/dev/null; then
    echo "Container health: ${health_status}"
    echo "Worker status: ${worker_status}"
    echo "Pi Service health: ${pi_health_status}"
    echo "Promtail status: ${promtail_status}"
    docker image prune -f >/dev/null
    echo "Production deployed: ${image}:${tag}"
    cutover_started="false"
    exit 0
  fi
  sleep 2
done

docker compose -f "${compose_file}" logs --tail=100 linkcv linkcv-worker linkcv-pi promtail || true
echo "Production health check timed out; restoring previous application" >&2
rollback_old_application || true
cutover_started="false"
exit 17
