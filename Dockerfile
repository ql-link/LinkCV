# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web-build

WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit
COPY apps/web/index.html apps/web/tsconfig.json apps/web/vite.config.mjs ./
COPY apps/web/src ./src
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.11.30 AS uv

FROM python:3.13-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PATH="/app/apps/backend/.venv/bin:$PATH" \
    APP_ENV=production \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8000 \
    WEB_DIST_DIR=/app/web \
    TZ=Asia/Shanghai

WORKDIR /app/apps/backend
COPY --from=uv /uv /uvx /usr/local/bin/
COPY apps/backend/pyproject.toml apps/backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY apps/backend/alembic.ini ./
COPY apps/backend/migrations ./migrations
COPY apps/backend/src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY --from=web-build /app/apps/web/dist /app/web

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn linkcv.main:app --host 0.0.0.0 --port 8000"]
