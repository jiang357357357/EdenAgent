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

RUNTIME_ORIGIN="${EDEN_AGENT_RUNTIME_ORIGIN:-mon}"
if [[ "$RUNTIME_ORIGIN" != "mon" && "$RUNTIME_ORIGIN" != "local" ]]; then
  echo "[x] EDEN_AGENT_RUNTIME_ORIGIN must be mon or local" >&2
  exit 1
fi
REALM_ROOT="$PROJECT_ROOT/Data/realms/$RUNTIME_ORIGIN"
mkdir -p "$REALM_ROOT"

# Preserve the legacy runtime in place and seed each realm only once.
if [[ ! -e "$REALM_ROOT/eden-agent.db" && -e "$PROJECT_ROOT/Data/eden-agent.db" ]]; then
  cp -a "$PROJECT_ROOT/Data/eden-agent.db" "$REALM_ROOT/eden-agent.db"
  [[ ! -e "$PROJECT_ROOT/Data/eden-agent.db-wal" ]] || cp -a "$PROJECT_ROOT/Data/eden-agent.db-wal" "$REALM_ROOT/eden-agent.db-wal"
  [[ ! -e "$PROJECT_ROOT/Data/eden-agent.db-shm" ]] || cp -a "$PROJECT_ROOT/Data/eden-agent.db-shm" "$REALM_ROOT/eden-agent.db-shm"
fi
for directory in blobs plugins skills connectors agents; do
  if [[ ! -e "$REALM_ROOT/$directory" && -e "$PROJECT_ROOT/Data/$directory" ]]; then
    cp -a "$PROJECT_ROOT/Data/$directory" "$REALM_ROOT/$directory"
  fi
done
if [[ "$RUNTIME_ORIGIN" == "local" && ! -e "$REALM_ROOT/local-runtime.json" && -e "$PROJECT_ROOT/Data/local-runtime.json" ]]; then
  cp -a "$PROJECT_ROOT/Data/local-runtime.json" "$REALM_ROOT/local-runtime.json"
fi
if [[ -e "$PROJECT_ROOT/Data/eden-agent.db" && ! -e "$REALM_ROOT/.realm-migration-complete" ]]; then
  printf '%s\n' "$RUNTIME_ORIGIN" > "$REALM_ROOT/.realm-migration-pending"
  chmod 600 "$REALM_ROOT/.realm-migration-pending"
fi

export EDEN_AGENT_RUNTIME_ORIGIN="$RUNTIME_ORIGIN"
if [[ "$RUNTIME_ORIGIN" == "local" ]]; then
  DEFAULT_REALM_PORT=40093
else
  DEFAULT_REALM_PORT=40092
fi
export EDEN_AGENT_BIND="${EDEN_AGENT_BIND:-127.0.0.1:${EDEN_AGENT_PORT:-$DEFAULT_REALM_PORT}}"
export EDEN_AGENT_DATABASE="$REALM_ROOT/eden-agent.db"
export EDEN_AGENT_BLOB_ROOT="$REALM_ROOT/blobs"
export EDEN_AGENT_LOG_DIRECTORY="$REALM_ROOT/logs"
export EDEN_AGENT_PLUGIN_ROOT="$REALM_ROOT/plugins"
export EDEN_AGENT_SKILL_INSTALL_ROOT="$REALM_ROOT/skills"
export EDEN_AGENT_CONNECTOR_PACKAGE_ROOT="$REALM_ROOT/connectors/packages"
export EDEN_AGENT_CONNECTOR_DATA_ROOT="$REALM_ROOT/connectors/runtime"
export EDEN_AGENT_USER_AGENT_ROOT="$REALM_ROOT/agents"
export EDEN_AGENT_TOKEN_FILE="$REALM_ROOT/capability.token"
export EDEN_AGENT_REALM_MIGRATION_MARKER="$REALM_ROOT/.realm-migration-pending"

# The desktop configuration page persists the local provider and model in
# Data/local-runtime.json.  Only the local realm may receive those values.
RUNTIME_ENV_LOADER="$PROJECT_ROOT/Script/Project/local_runtime_environment.cjs"
if [[ "$RUNTIME_ORIGIN" == "local" ]]; then
  RUNTIME_EXPORTS="$(node "$RUNTIME_ENV_LOADER" --shell "$PROJECT_ROOT")"
  eval "$RUNTIME_EXPORTS"
  unset RUNTIME_EXPORTS MON_CORE_BASE_URL MON_CORE_TOKEN
  export EDEN_AGENT_LEGACY_CORE_DATABASE="$REALM_ROOT/no-legacy-core.db"
else
  while IFS= read -r runtime_key; do
    [[ -z "$runtime_key" ]] || unset "$runtime_key"
  done < <(node "$RUNTIME_ENV_LOADER" --keys "$PROJECT_ROOT")
  unset OPENAI_API_KEY OPENAI_BASE_URL
fi

exec cargo run -p eden-agent-server
