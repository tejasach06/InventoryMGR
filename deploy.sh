#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

git pull origin main
git clean -fdX

cd backend
uv sync --frozen --no-dev
cd ../frontend
nub ci
nub run build
cd ..

pm2 restart all
pm2 save
