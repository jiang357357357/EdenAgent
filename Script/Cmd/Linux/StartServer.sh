#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=../../Process/linux/common.sh
source "$PROJECT_ROOT/Script/Process/linux/common.sh"

cd "$PROJECT_ROOT"
ensure_python
if command -v pm2 >/dev/null 2>&1; then
  status="$(pm2_app_status "$SERVER_PM2_NAME" 2>/dev/null || true)"
  if [[ -n "$status" && "$status" != "missing" && "$status" != "stopped" ]]; then
    echo "[i] Stopping PM2 app $SERVER_PM2_NAME before foreground start..."
    run_pm2_quiet stop "$SERVER_PM2_NAME" || true
  fi
fi
release_tcp_port "$SERVER_PORT" "MonAgent foreground server"
begin_start_log_dir
echo "[i] Log directory: $MON_LOG_START_DIR"

export PYTHONPATH="$PROJECT_ROOT/Server/src:$PROJECT_ROOT/AgentCore/src${PYTHONPATH:+:$PYTHONPATH}"
if [[ -n "${MON_AGENT_PYTHON:-}" ]]; then
  exec "$MON_AGENT_PYTHON" -m mon_agent_server
fi

SERVER_VENV_PYTHON="$PROJECT_ROOT/Server/.venv/bin/python"
if [[ -x "$SERVER_VENV_PYTHON" ]]; then
  exec "$SERVER_VENV_PYTHON" -m mon_agent_server
fi

if command -v uv >/dev/null 2>&1; then
  exec uv run --project "$PROJECT_ROOT/Server" python -m mon_agent_server
fi

exec python3 -m mon_agent_server
