# syntax=docker/dockerfile:1

# ---- Base stage ----
FROM python:3.12-slim AS base

# Set environment variables for Python
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install build dependencies needed for psycopg (postgres driver)
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
RUN pip install --no-cache-dir uv

# Copy only the dependency definition files first for caching
COPY backend/pyproject.toml backend/uv.lock ./

# Install runtime dependencies (no dev deps)
RUN uv sync --frozen --no-dev

# Copy the rest of the backend source code
COPY backend/ .
# Copy sample data for seeding
#COPY sample-vms.csv .

# Expose FastAPI default port
EXPOSE 8000

# Run database migrations then start the FastAPI server
CMD ["sh", "-c", ".venv/bin/alembic upgrade head && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000"]
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8000/api/health || exit 1
