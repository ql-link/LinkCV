#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <build-number> <commit-short> <source-archive>" >&2
  exit 2
fi

build_number="$1"
commit_short="$2"
source_archive="$3"

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

image="linkcv"
tag="test-dev-${commit_short}-b${build_number}"
test_root="/opt/tolink/test"
deploy_dir="${test_root}/linkcv"
work_root="${test_root}/jenkins/workspaces"
build_dir="${work_root}/linkcv-${build_number}"
base_env="${deploy_dir}/.env.development"
secret_env="${deploy_dir}/.env.development.local"
compose_file="${deploy_dir}/deploy/docker-compose.development.yml"
docker_network="tolink-test-net"
http_port="18002"

cleanup() {
  if [[ "${build_dir}" == "${work_root}/linkcv-${build_number}" ]]; then
    rm -rf -- "${build_dir}"
  fi
}
trap cleanup EXIT

rm -rf -- "${build_dir}"
mkdir -p "${build_dir}" "${deploy_dir}/deploy"
tar -xzf "${source_archive}" -C "${build_dir}"

DOCKER_BUILDKIT=1 docker build \
  --label "org.opencontainers.image.revision=${commit_short}" \
  -t "${image}:${tag}" \
  "${build_dir}"

install -m 0644 "${build_dir}/.env.development" "${base_env}"
install -m 0644 \
  "${build_dir}/deploy/docker-compose.development.yml" \
  "${compose_file}"

if [[ ! -f "${secret_env}" ]]; then
  echo "Missing Development secret env file: ${secret_env}" >&2
  exit 10
fi
secret_mode="$(stat -c '%a' "${secret_env}")"
if [[ "${secret_mode}" != "400" && "${secret_mode}" != "600" ]]; then
  echo "Development secret env file must use mode 400 or 600, got ${secret_mode}" >&2
  exit 11
fi
docker network inspect "${docker_network}" >/dev/null

docker run --rm \
  --network "${docker_network}" \
  --env-file "${base_env}" \
  --env-file "${secret_env}" \
  -e APP_ENV=development \
  "${image}:${tag}" \
  python /app/scripts/release/run_alembic.py \
    --expected-app-env development \
    --expected-host 100.86.10.52 \
    --expected-port 13306 \
    --expected-database linkcv

TAG="${tag}" \
LINKCV_ENV_FILE="${base_env}" \
LINKCV_SECRET_ENV_FILE="${secret_env}" \
LINKCV_DOCKER_NETWORK="${docker_network}" \
LINKCV_DEV_HTTP_PORT="${http_port}" \
  docker compose -f "${compose_file}" up -d --remove-orphans

for _ in $(seq 1 30); do
  health_status="$(docker inspect --format='{{.State.Health.Status}}' linkcv-dev 2>/dev/null || true)"
  if [[ "${health_status}" == "healthy" ]] && \
    curl -fsS "http://127.0.0.1:${http_port}/api/health" >/dev/null; then
    echo "Container health: ${health_status}"
    docker image prune -f >/dev/null
    echo "Development deployed: ${image}:${tag}"
    exit 0
  fi
  sleep 2
done

docker compose -f "${compose_file}" logs --tail=100 linkcv
echo "Development health check timed out." >&2
exit 12
