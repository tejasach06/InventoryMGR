FROM rust:1.98-bookworm AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked

FROM docker.io/library/postgres:17
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --uid 1000 --create-home --shell /usr/sbin/nologin appuser && install -d -o 1000 -g 1000 /var/lib/inventorymgr/backups
WORKDIR /app
COPY --from=build /build/target/release/inventorymgr-backend /usr/local/bin/inventorymgr-backend
USER appuser
ENV HOST=0.0.0.0 PORT=8000 BACKUP_DIR=/var/lib/inventorymgr/backups
EXPOSE 8000
ENTRYPOINT ["inventorymgr-backend"]
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://127.0.0.1:8000/api/health || exit 1
