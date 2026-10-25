# syntax=docker/dockerfile:1

# ---- Base stage ----
FROM docker.io/library/python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d AS base
ENV PYTHONUNBUFFERED=1 UV_LINK_MODE=copy
WORKDIR /app

# pg_dump/pg_restore 17 must match the postgres:17 server used by compose/quadlet.
# Dearmor .asc to binary .gpg so minimal apt (gpgv only, no gpg package) verifies the repo.
ADD https://www.postgresql.org/media/keys/ACCC4CF8.asc /tmp/pgdg.asc
RUN python -c 'import base64, pathlib; s=pathlib.Path("/tmp/pgdg.asc").read_text(); b=base64.b64decode("".join(l for l in s.splitlines() if not l.startswith(("-","=")) and ":" not in l and l)); p=pathlib.Path("/usr/share/postgresql-common/pgdg"); p.mkdir(parents=True, exist_ok=True); (p/"apt.postgresql.org.gpg").write_bytes(b)' && \
    rm /tmp/pgdg.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] http://apt.postgresql.org/pub/repos/apt trixie-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends curl ca-certificates postgresql-client-17 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.24@sha256:3af4716e991d6956a41e573eab705d0ee08500cd829ed30293eb8472f372c65a /uv /uvx /usr/local/bin/

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
RUN rm -f /usr/local/bin/uv /usr/local/bin/uvx

RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin appuser && \
    install -d -o 1000 -g 1000 /var/lib/inventorymgr/backups

COPY --chown=1000:1000 . .
USER appuser

# Expose FastAPI default port
EXPOSE 8000

# Run database migrations then start the FastAPI server
CMD ["sh", "-c", ".venv/bin/alembic upgrade head && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000"]
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8000/api/health || exit 1
