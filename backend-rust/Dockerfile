FROM docker.io/library/rust:1.98.1-alpine@sha256:6d9066cf04ed2cc9d1a406016f4c9b2574bafda23f9e88bcad8e5d24fa6aec8e AS build
WORKDIR /build
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY vendor ./vendor
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked --jobs 1

FROM docker.io/library/alpine:3.24@sha256:0f49f331d9212aff11b932863be4eb01cdf962969aa86dab7d1ee21ac6f5f52b
RUN apk upgrade --no-cache \
    && apk add --no-cache postgresql17-client curl ca-certificates \
    && adduser -D -u 1000 -s /sbin/nologin appuser \
    && install -d -o 1000 -g 1000 /var/lib/inventorymgr/backups
WORKDIR /app
COPY --from=build /build/target/release/inventorymgr-backend /usr/local/bin/inventorymgr-backend
USER appuser
ENV HOST=0.0.0.0 PORT=8000 BACKUP_DIR=/var/lib/inventorymgr/backups PG_BIN_DIR=/usr/libexec/postgresql17
EXPOSE 8000
ENTRYPOINT ["inventorymgr-backend"]
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://127.0.0.1:8000/api/health || exit 1
