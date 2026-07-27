# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim AS build

WORKDIR /app
ENV OPENEDL_PLATFORM=node

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm test

FROM node:24.18.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/openedl.sqlite

COPY --from=build --chown=node:node /app/dist/standalone/ ./
COPY --chown=node:node docker/entrypoint.mjs ./docker-entrypoint.mjs
COPY --chown=node:node scripts/openedl-cli.mjs ./openedl-cli.mjs

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "docker-entrypoint.mjs"]
