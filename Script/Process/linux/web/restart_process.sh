#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "$SCRIPT_DIR/../common.sh"

PM2_APP_NAME="$WEB_PM2_NAME"
ECOSYSTEM_FILE="$SCRIPT_DIR/ecosystem.config.cjs"

ensure_pm2
ensure_node

echo "================================================"
echo "MonAgent Web PM2 restart"
echo "================================================"
echo "App: $PM2_APP_NAME"
echo

status="$(pm2_app_status "$PM2_APP_NAME")"
if [[ "$status" == "missing" ]]; then
  run_pm2_quiet start "$ECOSYSTEM_FILE" --only "$PM2_APP_NAME"
else
  run_pm2_quiet restart "$PM2_APP_NAME" --update-env
fi

pm2_process_summary "$PM2_APP_NAME"
echo
echo "[PROCESS_NAME:$PM2_APP_NAME]"
echo "[SERVER_STATUS:RESTARTED]"
