#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "$SCRIPT_DIR/../common.sh"

PM2_APP_NAME="$SERVER_PM2_NAME"

ensure_pm2

echo "================================================"
echo "MonAgent Server PM2 status"
echo "================================================"
echo "App:  $PM2_APP_NAME"
echo "Port: $SERVER_PORT"
echo

status="$(pm2_app_status "$PM2_APP_NAME")"
pm2_process_summary "$PM2_APP_NAME"
echo
echo "[PROCESS_NAME:$PM2_APP_NAME]"
if [[ "$status" == "online" ]] && http_ready "http://127.0.0.1:$SERVER_PORT/api/tools/status"; then
  echo "[SERVER_STATUS:RUNNING]"
elif [[ "$status" == "online" ]]; then
  echo "[SERVER_STATUS:PARTIAL]"
else
  echo "[SERVER_STATUS:NOT_RUNNING]"
fi
