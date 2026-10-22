# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# API: tenant plane, operator plane and the background job worker, plus the
# migration runner and the operator CLI (same image, different command).
#   docker build -f infra/docker/api.Dockerfile -t open-hrms-api .
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @open-hrms/api...
COPY tsconfig.base.json ./
COPY db db
COPY apps/api apps/api
RUN pnpm --filter @open-hrms/api build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production TZ=UTC PORT=8080 \
    MIGRATIONS_DIR=/app/db/migrations DATA_DIR=/tmp/data
WORKDIR /app
# tini reaps zombies and forwards SIGTERM so the server drains and the queue worker stops cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Self-contained bundles: index.js (server), migrate.js, cli.js. No node_modules at runtime.
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
# PDF fonts (OFL) are read from ../assets relative to the bundle.
COPY --from=build --chown=node:node /repo/apps/api/src/assets ./assets
# pdfkit reads its standard-font metrics (Helvetica.afm, ...) from data/ beside its own
# source; bundled, that is dist/data.
COPY --from=build --chown=node:node /repo/apps/api/node_modules/pdfkit/js/data ./dist/data
COPY --from=build --chown=node:node /repo/db/migrations ./db/migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
