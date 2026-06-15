# syntax=docker/dockerfile:1

# ---- Builder stage ----
FROM oven/bun:latest AS builder
ARG INVENTORYMGR_API_URL=http://backend:8000
ENV INVENTORYMGR_API_URL=${INVENTORYMGR_API_URL}

# Set work directory
WORKDIR /app

# Install dependencies (cached layer)
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile

# Copy source code
COPY frontend/ ./

# Build production assets
RUN bun run build

# ---- Runtime stage ----
FROM oven/bun:latest

WORKDIR /app

# Copy built assets and necessary files from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/postcss.config.mjs ./

EXPOSE 3000

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/ || exit 1
# Run Next.js server
CMD ["bun", "run", "start"]
