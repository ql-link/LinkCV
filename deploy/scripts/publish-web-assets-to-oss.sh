#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <web-assets-directory> <favicon-path>" >&2
  exit 2
fi

asset_dir="$1"
favicon_path="$2"
required_commands=(cmp curl find mktemp ossutil python3)
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
if [[ ! -f "${favicon_path}" ]]; then
  echo "Web favicon does not exist: ${favicon_path}" >&2
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

fetch_headers() {
  local url="$1" origin="${2:-}"
  local curl_args=(--silent --show-error --location --head --retry 2 --connect-timeout 5 --max-time 20)
  if [[ -n "${origin}" ]]; then
    curl_args+=(--header "Origin: ${origin}")
  fi
  local response
  response="$(curl "${curl_args[@]}" --write-out $'\n%{http_code}' "${url}")" || return 1
  response_status="${response##*$'\n'}"
  response_headers="${response%$'\n'*}"
}

destination="oss://${WEB_ASSET_OSS_BUCKET}/${WEB_ASSET_OSS_PREFIX}/assets/"
uploaded_count=0
skipped_count=0
while IFS= read -r -d '' asset_path; do
  relative_path="${asset_path#${asset_dir}/}"
  if [[ ! "${relative_path}" =~ (^|/)[^/]+-[A-Za-z0-9_-]{6,}\.[^/]+$ ]]; then
    echo "Web asset does not have an immutable hashed filename: ${relative_path}" >&2
    exit 9
  fi
  encoded_path="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe="/._~-"))' "${relative_path}")"
  asset_url="${WEB_ASSET_OSS_URL}assets/${encoded_path}"
  fetch_headers "${asset_url}" "https://linkresume.cn"
  if [[ "${response_status}" == 404 ]]; then
    ossutil cp "${asset_path}" "${destination}${relative_path}" \
      --force \
      --acl default \
      --cache-control "public,max-age=31536000,immutable"
    uploaded_count=$((uploaded_count + 1))
    fetch_headers "${asset_url}" "https://linkresume.cn"
  else
    skipped_count=$((skipped_count + 1))
  fi
  if [[ "${response_status}" != 200 ]]; then
    echo "OSS asset did not return HTTP 200: ${asset_url} (${response_status})" >&2
    exit 9
  fi
  if ! grep -Eiq '^cache-control:.*max-age=31536000.*immutable' <<<"${response_headers}"; then
    echo "OSS asset is missing immutable cache headers: ${asset_url}" >&2
    exit 9
  fi
  if [[ "${relative_path}" == *.js \
    || "${relative_path}" == *.woff \
    || "${relative_path}" == *.woff2 \
    || "${relative_path}" == *.ttf \
    || "${relative_path}" == *.otf ]] && \
    ! grep -Eiq '^access-control-allow-origin:[[:space:]]*(\*|https://linkresume\.cn)[[:space:]]*$' <<<"${response_headers}"; then
    echo "OSS module or font asset does not allow the https://linkresume.cn origin: ${asset_url}" >&2
    exit 9
  fi
done < <(find "${asset_dir}" -type f -print0)
echo "Published ${uploaded_count} new Web assets; skipped ${skipped_count} existing assets"

favicon_destination="oss://${WEB_ASSET_OSS_BUCKET}/${WEB_ASSET_OSS_PREFIX}/favicon.png"
favicon_url="${WEB_ASSET_OSS_URL}favicon.png"
remote_favicon="$(mktemp)"
trap 'rm -f "${remote_favicon}"' EXIT
favicon_status="$(curl \
  --silent \
  --show-error \
  --location \
  --output "${remote_favicon}" \
  --write-out '%{http_code}' \
  --retry 2 \
  --connect-timeout 5 \
  --max-time 20 \
  "${favicon_url}")"
if [[ "${favicon_status}" == 404 ]] || \
  { [[ "${favicon_status}" == 200 ]] && ! cmp -s "${favicon_path}" "${remote_favicon}"; }; then
  echo "Uploading new or changed production favicon to ${favicon_destination}"
  ossutil cp "${favicon_path}" "${favicon_destination}" \
    --force \
    --acl default \
    --cache-control "public,max-age=3600"
else
  if [[ "${favicon_status}" != 200 ]]; then
    echo "Production favicon lookup failed: ${favicon_url} (${favicon_status})" >&2
    exit 9
  fi
  echo "Production favicon is unchanged; skipping upload"
fi
fetch_headers "${favicon_url}"
if [[ "${response_status}" != 200 ]]; then
  echo "Production favicon is not publicly available: ${favicon_url} (${response_status})" >&2
  exit 9
fi
if ! grep -Eiq '^content-type:[[:space:]]*image/png([;[:space:]]|$)' <<<"${response_headers}"; then
  echo "Production favicon does not return image/png: ${favicon_url}" >&2
  exit 9
fi
if ! grep -Eiq '^cache-control:.*max-age=3600' <<<"${response_headers}"; then
  echo "Production favicon is missing short cache headers: ${favicon_url}" >&2
  exit 9
fi

echo "Verified ${asset_count} immutable Web assets and production favicon through ${WEB_ASSET_OSS_URL}"
