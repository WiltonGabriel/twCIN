# syntax=docker/dockerfile:1

FROM node:26-alpine AS builder
WORKDIR /build

COPY package.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/

RUN npm --prefix backend ci && npm --prefix frontend ci

COPY backend ./backend
COPY frontend ./frontend

RUN npm run build && npm --prefix backend prune --omit=dev

FROM node:26-alpine AS runtime
WORKDIR /app

ARG APP_VERSION=1.0.0

LABEL org.opencontainers.image.title="twCIN" \
  org.opencontainers.image.description="Sistema offline-first de controle de equipamentos, movimentações e empréstimos de TI" \
  org.opencontainers.image.version="${APP_VERSION}" \
  org.opencontainers.image.source="https://github.com/WiltonGabriel/twCIN" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
  PORT=3333 \
  HOST=0.0.0.0 \
  SERVE_FRONTEND=true \
  DATA_DIR=/data

RUN mkdir -p /data /data/backups && chown -R node:node /app /data

COPY --from=builder --chown=node:node /build/package.json ./package.json
COPY --from=builder --chown=node:node /build/backend/package.json ./backend/package.json
COPY --from=builder --chown=node:node /build/backend/dist ./backend/dist
COPY --from=builder --chown=node:node /build/backend/node_modules ./backend/node_modules
COPY --from=builder --chown=node:node /build/frontend/dist ./frontend/dist

USER node
EXPOSE 3333
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3333) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "backend/dist/server.js"]
