#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
python -m uvicorn server.main:app --host 127.0.0.1 --port 8000
