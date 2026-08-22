# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web-build

ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --replace-registry-host=never --registry="${NPM_REGISTRY}"
COPY apps/web/index.html \
    apps/web/tsconfig.json \
    apps/web/vite.config.mjs \
    apps/web/postcss.config.cjs \
    apps/web/tailwind.config.cjs \
    ./
COPY apps/web/public ./public
COPY apps/web/src ./src
COPY apps/web/pdf-cli ./pdf-cli
RUN npm run build

FROM node:22-bookworm-slim AS pi-build

ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app
COPY third_party/pi ./third_party/pi
COPY apps/pi-service ./apps/pi-service
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefix third_party/pi --no-audit --registry="${NPM_REGISTRY}"
RUN --network=none \
    npm --prefix third_party/pi run check:model-data && \
    npm --prefix apps/pi-service run build

FROM python:3.13-slim AS runtime

ARG UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ARG UV_VERSION=0.11.30
ENV PYTHONUNBUFFERED=1 \
    PATH="/app/apps/backend/.venv/bin:$PATH" \
    APP_ENV=production \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8000 \
    WEB_DIST_DIR=/app/web \
    PDF_RENDERER_SCRIPT=/app/pdf/render-resume-pdf.cjs \
    TZ=Asia/Shanghai

WORKDIR /app/apps/backend
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --index-url "${UV_INDEX_URL}" "uv==${UV_VERSION}"
COPY apps/backend/pyproject.toml apps/backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv export --quiet --frozen --no-dev --no-emit-project --format requirements-txt --output-file /tmp/requirements.txt && \
    uv venv .venv && \
    uv pip install --python .venv/bin/python --require-hashes --index-url "${UV_INDEX_URL}" --requirements /tmp/requirements.txt
COPY apps/backend/alembic.ini ./
COPY apps/backend/migrations ./migrations
COPY apps/backend/src ./src
COPY apps/backend/scripts/release/import_legacy_sqlite.py /app/scripts/release/import_legacy_sqlite.py
COPY scripts/db/init_mysql.py /app/scripts/db/init_mysql.py
COPY scripts/release/run_alembic.py /app/scripts/release/run_alembic.py
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --python .venv/bin/python --no-deps --index-url "${UV_INDEX_URL}" .
COPY --from=web-build /app/apps/web/dist /app/web
COPY --from=web-build /app/apps/web/dist-server /app/pdf
COPY --from=pi-build /usr/local/bin/node /usr/local/bin/node
COPY --from=pi-build /app/apps/pi-service/dist/server.js /app/pi/server.js
RUN node --version
RUN mkdir -p /app/logs

EXPOSE 8000

CMD ["sh", "-c", "python /app/scripts/release/run_alembic.py --expected-app-env \"$APP_ENV\" --expected-host \"$MYSQL_HOST\" --expected-port \"$MYSQL_PORT\" --expected-database \"$MYSQL_DATABASE\" && exec uvicorn linkcv.main:app --host 0.0.0.0 --port 8000 --no-access-log"]
