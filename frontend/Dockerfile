# syntax=docker/dockerfile:1

# ---- Builder stage ----
FROM docker.io/library/node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS builder
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
FROM docker.io/library/node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000

RUN apk upgrade --no-cache \
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
