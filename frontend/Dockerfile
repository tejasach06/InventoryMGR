# syntax=docker/dockerfile:1

# ---- Builder stage ----
FROM node:22-bookworm-slim AS builder
ARG INVENTORYMGR_API_URL=http://backend:8000
ENV INVENTORYMGR_API_URL=${INVENTORYMGR_API_URL}

# Set work directory
WORKDIR /app

# Install dependencies (cached layer)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN curl -fsSL https://nubjs.com/install.sh | bash
ENV PATH="/root/.nub/bin:$PATH"
RUN nub ci

# Copy source code
COPY . ./

# Build production assets
RUN nub run build

# ---- Runtime stage ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/ || exit 1
CMD ["node", "server.js"]
