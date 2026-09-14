#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <web-assets-directory>" >&2
  exit 2
fi

asset_dir="$1"
required_commands=(curl find ossutil python3)
for required_command in "${required_commands[@]}"; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 3
  fi
done

required_variables=(
  WEB_ASSET_OSS_URL
  WEB_ASSET_OSS_BUCKET
  WEB_ASSET_OSS_PREFIX
  OSS_ACCESS_KEY_ID
  OSS_ACCESS_KEY_SECRET
  OSS_REGION
)
for required_variable in "${required_variables[@]}"; do
  if [[ -z "${!required_variable:-}" ]]; then
    echo "Missing required Web asset publishing setting: ${required_variable}" >&2
    exit 4
  fi
done

if [[ ! -d "${asset_dir}" ]]; then
  echo "Web asset directory does not exist: ${asset_dir}" >&2
  exit 5
fi
if [[ "${WEB_ASSET_OSS_URL}" != https://*/ ]]; then
  echo "WEB_ASSET_OSS_URL must be an HTTPS URL ending with /" >&2
  exit 6
fi

if [[ ! "${WEB_ASSET_OSS_BUCKET}" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]]; then
  echo "WEB_ASSET_OSS_BUCKET is invalid" >&2
  exit 7
fi
if [[ ! "${WEB_ASSET_OSS_PREFIX}" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$ ]] \
  || [[ "${WEB_ASSET_OSS_PREFIX}" == /* || "${WEB_ASSET_OSS_PREFIX}" == */ ]]; then
  echo "WEB_ASSET_OSS_PREFIX must be a relative OSS prefix without a trailing slash" >&2
  exit 7
fi
expected_oss_url="https://${WEB_ASSET_OSS_BUCKET}.oss-${OSS_REGION}.aliyuncs.com/${WEB_ASSET_OSS_PREFIX}/"
if [[ "${WEB_ASSET_OSS_URL}" != "${expected_oss_url}" ]]; then
  echo "WEB_ASSET_OSS_URL must match the configured Bucket, Region, and prefix: ${expected_oss_url}" >&2
  exit 7
fi

asset_count="$(find "${asset_dir}" -type f | wc -l | tr -d ' ')"
if [[ ! "${asset_count}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Web asset directory is empty: ${asset_dir}" >&2
  exit 8
fi

destination="oss://${WEB_ASSET_OSS_BUCKET}/${WEB_ASSET_OSS_PREFIX}/assets/"
echo "Uploading ${asset_count} immutable Web assets to ${destination}"
ossutil cp -r "${asset_dir}/" "${destination}" \
  --force \
  --acl default \
  --cache-control "public,max-age=31536000,immutable"

verify_asset() {
  local local_path="$1"
  local relative_path encoded_path asset_url headers
  relative_path="${local_path#${asset_dir}/}"
  encoded_path="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe="/._~-"))' "${relative_path}")"
  asset_url="${WEB_ASSET_OSS_URL}assets/${encoded_path}"
  headers="$(curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --head \
    --header "Origin: https://linkresume.cn" \
    --retry 2 \
    --retry-all-errors \
    --connect-timeout 5 \
    --max-time 20 \
    "${asset_url}")"
  if ! grep -Eiq '^cache-control:.*max-age=31536000.*immutable' <<<"${headers}"; then
    echo "OSS asset is missing immutable cache headers: ${asset_url}" >&2
    return 1
  fi
  if [[ "${relative_path}" == *.js \
    || "${relative_path}" == *.woff \
    || "${relative_path}" == *.woff2 \
    || "${relative_path}" == *.ttf \
    || "${relative_path}" == *.otf ]] && \
    ! grep -Eiq '^access-control-allow-origin:[[:space:]]*(\*|https://linkresume\.cn)[[:space:]]*$' <<<"${headers}"; then
    echo "OSS module or font asset does not allow the https://linkresume.cn origin: ${asset_url}" >&2
    return 1
  fi
}

while IFS= read -r -d '' asset_path; do
  verify_asset "${asset_path}"
done < <(find "${asset_dir}" -type f -print0)

echo "Verified ${asset_count} immutable Web assets through ${WEB_ASSET_OSS_URL}"
