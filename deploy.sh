#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

git pull origin main

just env
podman compose up -d --build
podman compose ps
