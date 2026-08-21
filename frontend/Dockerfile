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

COPY --from=builder --chown=1000:1000 /app/.next ./.next
COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=builder --chown=1000:1000 /app/package.json ./
COPY --from=builder --chown=1000:1000 /app/next.config.mjs ./
COPY --from=builder --chown=1000:1000 /app/tsconfig.json ./
COPY --from=builder --chown=1000:1000 /app/postcss.config.mjs ./

# Install curl (needed for healthcheck and the nub installer)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://nubjs.com/install.sh | bash && chmod 755 /root && chmod -R o+rX /root/.nub
ENV PATH="/root/.nub/bin:$PATH"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/ || exit 1
# Run Next.js server
CMD ["nub", "run", "start"]
