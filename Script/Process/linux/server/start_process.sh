#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "$SCRIPT_DIR/../common.sh"

PM2_APP_NAME="$SERVER_PM2_NAME"
ECOSYSTEM_FILE="$SCRIPT_DIR/ecosystem.config.cjs"

ensure_pm2
ensure_python
acquire_pm2_start_lock

echo "================================================"
echo "MonAgent Server PM2 start"
echo "================================================"
echo "Project: $PROJECT_ROOT"
echo "App:     $PM2_APP_NAME"
echo "Port:    $SERVER_PORT"
echo

status="$(pm2_app_status "$PM2_APP_NAME")"
if [[ "$status" == "online" ]]; then
  echo "[PROCESS_NAME:$PM2_APP_NAME]"
  echo "[SERVER_STATUS:ALREADY_RUNNING]"
  exit 0
fi

if [[ "$status" == "missing" ]]; then
  run_pm2_quiet start "$ECOSYSTEM_FILE" --only "$PM2_APP_NAME"
else
  run_pm2_quiet restart "$PM2_APP_NAME" --update-env
fi

if ! wait_for_http "http://127.0.0.1:$SERVER_PORT/api/tools/status" 40 0.5; then
  echo "[x] MonAgent Server did not become ready on port $SERVER_PORT"
  echo
  pm2_process_summary "$PM2_APP_NAME"
  echo
  echo "[PROCESS_NAME:$PM2_APP_NAME]"
  echo "[SERVER_STATUS:FAILED]"
  exit 1
fi

pm2_process_summary "$PM2_APP_NAME"
echo
echo "[PROCESS_NAME:$PM2_APP_NAME]"
echo "[SERVER_STATUS:STARTED]"
