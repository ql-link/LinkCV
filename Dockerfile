FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    API_PORT=4174 \
    DATA_DIR=/app/data \
    TZ=Asia/Shanghai

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --registry=https://registry.npmmirror.com

COPY server ./server
COPY dist ./dist

EXPOSE 4174

CMD ["npm", "start"]
