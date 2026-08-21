#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$PROJECT_ROOT/Script/Process/linux/common.sh"

"$MONPM_MODULE" "$SERVER_MONPM_NAME" stop
exec "$PROJECT_ROOT/Script/Process/linux/server/run_server.sh"
