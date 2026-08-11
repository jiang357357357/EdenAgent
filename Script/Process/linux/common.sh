#!/usr/bin/env bash

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$COMMON_DIR/../../.." && pwd)"
MON_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
SERVER_ROOT="$PROJECT_ROOT/Server"
SERVER_VENV_PYTHON="$SERVER_ROOT/.venv/bin/python"
SERVER_PORT="${MON_AGENT_PORT:-40092}"
SERVER_MONPM_NAME="agent-api"
MONPM_MODULE="$MON_ROOT/Script/launch/linux/monpm-module.sh"

[[ -x "$MONPM_MODULE" ]] || { echo "[x] MonPM launcher not found: $MONPM_MODULE" >&2; exit 1; }

ensure_python() {
  [[ -n "${MON_AGENT_PYTHON:-}" ]] && command -v "$MON_AGENT_PYTHON" >/dev/null 2>&1 && return 0
  [[ -x "$SERVER_VENV_PYTHON" ]] && return 0
  command -v uv >/dev/null 2>&1 && return 0
  command -v python3 >/dev/null 2>&1 && return 0
  echo "[x] Agent Server Python environment not found." >&2
  return 1
}
