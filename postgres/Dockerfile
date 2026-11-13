# Official PostgreSQL 17 image with gosu rebuilt from its pinned 1.20 release
# commit using a supported Go toolchain. The base image ships gosu 1.19 with
# moby/sys/user 0.1.0 (GO-2026-6686); upstream 1.20 fixes that module but is
# still built with Go 1.24.6. Everything else in the base image is unchanged.
FROM docker.io/library/golang:1.26.11-trixie@sha256:fa340cb59ebeb1d53ac1cccfc334201d938fe5f3458003cccb767096d8e032b8 AS gosu
# tianon/gosu tag 1.20
ARG GOSU_COMMIT=29b939aa5bd4dc588af765b8248f6e39150d2565
WORKDIR /src
# Build flags follow upstream's Dockerfile; go.sum and the Go checksum database
# verify module contents. x/sys 0.44.0 fixes CVE-2026-39824 (upstream pins 0.1.0).
RUN git init -q . \
    && git fetch -q --depth 1 https://github.com/tianon/gosu.git "$GOSU_COMMIT" \
    && git checkout -q FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "$GOSU_COMMIT" \
    && go get golang.org/x/sys@v0.44.0 \
    && go mod verify \
    && CGO_ENABLED=0 go build -trimpath -ldflags '-d -w' -o /gosu . \
    && /gosu --version \
    && /gosu nobody id

FROM docker.io/library/postgres:17-alpine@sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065
COPY --from=gosu /gosu /usr/local/bin/gosu
ENV GOSU_VERSION=1.20
