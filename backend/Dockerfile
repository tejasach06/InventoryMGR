# syntax=docker/dockerfile:1

# ---- Base stage ----
FROM python:3.13-slim-bookworm AS base

# Set environment variables for Python
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install build dependencies needed for psycopg (postgres driver)
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential libpq-dev curl ca-certificates gnupg && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Copy only the dependency definition files first for caching
COPY pyproject.toml uv.lock ./

# Install runtime dependencies (no dev deps)
RUN uv sync --frozen --no-dev

# Copy the rest of the backend source code
COPY . .

# Expose FastAPI default port
EXPOSE 8000

# Run database migrations then start the FastAPI server
CMD ["sh", "-c", ".venv/bin/alembic upgrade head && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000"]
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8000/api/health || exit 1
