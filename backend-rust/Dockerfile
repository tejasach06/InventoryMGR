FROM docker.io/library/rust:1.98.1-trixie@sha256:a8a5f0a1e5fe7dfe1d352591e4a1c7dd2c08fd70475cae872cf3458ba0df0546 AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked --jobs 1

FROM docker.io/library/debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends postgresql-client-17 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home --shell /usr/sbin/nologin appuser \
    && install -d -o 1000 -g 1000 /var/lib/inventorymgr/backups
WORKDIR /app
COPY --from=build /build/target/release/inventorymgr-backend /usr/local/bin/inventorymgr-backend
USER appuser
ENV HOST=0.0.0.0 PORT=8000 BACKUP_DIR=/var/lib/inventorymgr/backups PG_BIN_DIR=/usr/lib/postgresql/17/bin
EXPOSE 8000
ENTRYPOINT ["inventorymgr-backend"]
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://127.0.0.1:8000/api/health || exit 1
