#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

cd "$PROJECT_ROOT"
PYTHON_BIN="${MON_AGENT_PYTHON:-python3}"
export PYTHONPATH="$PROJECT_ROOT/Server/src:$PROJECT_ROOT/AgentCore/src${PYTHONPATH:+:$PYTHONPATH}"
exec "$PYTHON_BIN" -m mon_agent_server
