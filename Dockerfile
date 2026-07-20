# syntax=docker/dockerfile:1

# Transitional production image for the legacy Express API. The target FastAPI
# service is developed independently under apps/backend and is not bundled here.

FROM node:22-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
  sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null || true; \
  apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    python3 \
  && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.npm \
  npm ci --prefer-offline --no-audit --registry=https://registry.npmmirror.com
RUN --mount=type=cache,target=/root/.npm \
  npm ci --prefix apps/web --prefer-offline --no-audit --registry=https://registry.npmmirror.com

COPY apps/web/index.html apps/web/tsconfig.json apps/web/vite.config.mjs ./apps/web/
COPY apps/web/src ./apps/web/src
COPY server ./server
RUN npm run build:web
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    API_PORT=4174 \
    DATA_DIR=/app/data \
    TZ=Asia/Shanghai

WORKDIR /app

RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
  sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null || true; \
  apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/apps/web/dist ./dist

EXPOSE 4174

CMD ["npm", "run", "start:legacy"]
