#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "$SCRIPT_DIR/../common.sh"

ensure_pm2
if [[ -f "$SERVER_PLAIN_LOG_FILE" ]]; then
  echo "[i] Following MonAgent plain log: $SERVER_PLAIN_LOG_FILE"
  tail -n "${MON_AGENT_LOG_LINES:-200}" -F "$SERVER_PLAIN_LOG_FILE"
elif [[ -f "$SERVER_LOG_FILE" ]]; then
  echo "[i] Following MonAgent log: $SERVER_LOG_FILE"
  tail -n "${MON_AGENT_LOG_LINES:-200}" -F "$SERVER_LOG_FILE"
else
  pm2_cmd logs "$SERVER_PM2_NAME"
fi
