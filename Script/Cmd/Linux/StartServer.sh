#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$PROJECT_ROOT"
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
