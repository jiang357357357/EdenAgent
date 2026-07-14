#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../common.sh"
ensure_python
exec "$MONPM_MODULE" "$SERVER_MONPM_NAME" restart "$@"
