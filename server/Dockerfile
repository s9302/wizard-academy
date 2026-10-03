# Game server. Node 24 runs the TypeScript directly (type stripping), so there
# is no compile step: we only install runtime dependencies and copy the source.
# Build context is the repo root (see docker-compose.yml).

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --omit=dev --include-workspace-root=false && npm cache clean --force

COPY shared/src shared/src
COPY server/src server/src
COPY server/migrations server/migrations

USER node
EXPOSE 3000
CMD ["node", "server/src/index.ts"]
