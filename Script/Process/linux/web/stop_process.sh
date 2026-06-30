#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "$SCRIPT_DIR/../common.sh"

PM2_APP_NAME="$WEB_PM2_NAME"

ensure_pm2

echo "================================================"
echo "MonAgent Web PM2 stop"
echo "================================================"
echo "App: $PM2_APP_NAME"
echo

status="$(pm2_app_status "$PM2_APP_NAME")"
if [[ "$status" == "missing" ]]; then
  echo "[PROCESS_NAME:$PM2_APP_NAME]"
  echo "[SERVER_STATUS:NOT_RUNNING]"
  exit 0
fi

run_pm2_quiet stop "$PM2_APP_NAME"
pm2_process_summary "$PM2_APP_NAME"
echo
echo "[PROCESS_NAME:$PM2_APP_NAME]"
echo "[SERVER_STATUS:STOPPED]"
