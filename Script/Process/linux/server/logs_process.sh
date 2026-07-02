#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common.sh
source "$SCRIPT_DIR/../common.sh"

ensure_pm2
if [[ -f "$SERVER_LOG_FILE" ]]; then
  tail -n "${MON_AGENT_LOG_LINES:-200}" -f "$SERVER_LOG_FILE"
else
  pm2_cmd logs "$SERVER_PM2_NAME"
fi
