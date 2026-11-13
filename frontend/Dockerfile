# syntax=docker/dockerfile:1

# ---- Builder stage ----
FROM docker.io/library/node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS builder
ARG INVENTORYMGR_API_URL=http://backend:8000
ENV INVENTORYMGR_API_URL=${INVENTORYMGR_API_URL}

# Set work directory
WORKDIR /app

# Install the repository-pinned package manager and frozen dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack pnpm install --frozen-lockfile --strict-peer-dependencies

# Copy source code
COPY . ./

# Build production assets
RUN corepack pnpm run build

# ---- Runtime stage ----
FROM docker.io/library/node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000

RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static
COPY --chown=1000:1000 healthcheck.cjs ./healthcheck.cjs
USER 1000:1000

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD ["node", "/app/healthcheck.cjs"]
CMD ["node", "server.js"]
