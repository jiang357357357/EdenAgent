#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

cd "$PROJECT_ROOT"

# Local connector/model credentials live in the ignored project .env file.
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

# The desktop configuration page persists the selected provider and model in
# Data/local-runtime.json. MonPM starts this script outside Electron, so load
# that file explicitly before the Rust process reads its environment.
RUNTIME_ENV_LOADER="$PROJECT_ROOT/Script/Project/local_runtime_environment.cjs"
RUNTIME_EXPORTS="$(node "$RUNTIME_ENV_LOADER" --shell "$PROJECT_ROOT")"
eval "$RUNTIME_EXPORTS"
unset RUNTIME_EXPORTS

exec cargo run -p mon-agent-server
