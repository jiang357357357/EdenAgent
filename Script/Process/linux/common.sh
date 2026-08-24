#!/usr/bin/env bash

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$COMMON_DIR/../../.." && pwd)"
MON_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
SERVER_PORT="${EDEN_AGENT_PORT:-40092}"
SERVER_MONPM_NAME="agent-api"
MONPM_MODULE="$MON_ROOT/Script/launch/linux/monpm-module.sh"

[[ -x "$MONPM_MODULE" ]] || { echo "[x] MonPM launcher not found: $MONPM_MODULE" >&2; exit 1; }
