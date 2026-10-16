# syntax=docker/dockerfile:1.7
# Rebuild deliberately for security updates; never replace these with floating tags.
FROM postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826 AS postgres-tools
FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ENV COREPACK_HOME=/opt/corepack NEXT_TELEMETRY_DISABLED=1
WORKDIR /work
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate && chmod -R a+rX /opt/corepack
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ packages/
RUN corepack pnpm install --frozen-lockfile
COPY apps/ apps/
COPY scripts/ scripts/
COPY tests/ tests/
COPY infra/production/ infra/production/
COPY tsconfig.base.json tsconfig.tests.json vitest.config.ts eslint.config.mjs ./
RUN corepack pnpm db:generate
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG AIA_SOURCE_SHA
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY DEPLOYMENT_ENV=local
RUN corepack pnpm build && node infra/production/build-runtime.mjs
RUN corepack pnpm --filter @aia/worker deploy --prod --legacy /worker
RUN node -e "require('fs').writeFileSync('/work/deployment/build.json',JSON.stringify({source:process.env.AIA_SOURCE_SHA,node:process.version,publicKeyHash:require('crypto').createHash('sha256').update(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||'').digest('hex')}))"

FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3100 NEXT_TELEMETRY_DISABLED=1 AIA_ENTRY_ROLE=web
WORKDIR /app
COPY --from=build --chown=node:node /work/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /work/apps/web/.next/static/ ./apps/web/.next/static/
COPY --from=build --chown=node:node /work/apps/web/public/ ./apps/web/public/
COPY --from=build --chown=node:node /work/deployment/ ./deployment/
USER node
WORKDIR /app/apps/web
ENTRYPOINT ["node", "/app/deployment/entrypoint.mjs"]
CMD ["node", "server.js"]

FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS worker
ENV NODE_ENV=production AIA_ENTRY_ROLE=worker
WORKDIR /app
COPY --from=build --chown=node:node /worker/ ./
COPY --from=build --chown=node:node /work/apps/worker/dist/ ./dist/
COPY --from=build --chown=node:node /work/deployment/ ./deployment/
USER node
ENTRYPOINT ["node", "/app/deployment/entrypoint.mjs"]
CMD ["node", "dist/main.js"]

# Privileged maintenance is a separate, manually invoked image, never a web sidecar.
# It retains the locked toolchain and native PostgreSQL 17 dump/restore utilities.
FROM postgres-tools AS tools
COPY --from=storage-admin /mc /usr/local/bin/mc
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/corepack
COPY --from=build /opt/corepack /opt/corepack
RUN ln -s /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack && useradd --uid 1000 --create-home aia
COPY --from=build --chown=aia:aia /work/node_modules /app/node_modules
COPY --from=build --chown=aia:aia /work/packages /app/packages
COPY --from=build --chown=aia:aia /work/apps/worker /app/apps/worker
COPY --from=build --chown=aia:aia /work/apps/web/src /app/apps/web/src
COPY --from=build --chown=aia:aia /work/apps/web/node_modules /app/apps/web/node_modules
COPY --from=build --chown=aia:aia /work/apps/web/package.json /app/apps/web/package.json
COPY --from=build --chown=aia:aia /work/scripts /app/scripts
COPY --from=build --chown=aia:aia /work/tests /app/tests
COPY --from=build --chown=aia:aia /work/infra/production /app/infra/production
COPY --from=build --chown=aia:aia /work/deployment /app/deployment
COPY --from=build --chown=aia:aia /work/package.json /work/pnpm-lock.yaml /work/pnpm-workspace.yaml /work/tsconfig.base.json /work/tsconfig.tests.json /work/vitest.config.ts /work/eslint.config.mjs /app/
ENV COREPACK_HOME=/opt/corepack NODE_ENV=production AIA_ENTRY_ROLE=tools
WORKDIR /app
USER aia
ENTRYPOINT ["node", "/app/deployment/entrypoint.mjs"]
CMD ["node", "node_modules/tsx/dist/cli.mjs", "scripts/migrate.ts", "--preflight"]
