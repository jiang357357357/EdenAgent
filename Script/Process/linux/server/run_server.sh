#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$PROJECT_ROOT"
export EDEN_AGENT_RUNTIME_ORIGIN="${EDEN_AGENT_RUNTIME_ORIGIN:-mon}"
exec node Script/Project/start_server.mjs
