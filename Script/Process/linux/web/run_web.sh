#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
WEB_PORT="${MON_AGENT_WEB_PORT:-40091}"
VITE_CLIENT_URL="http://127.0.0.1:${WEB_PORT}/@vite/client"

vite_is_ready() {
    local vite_client
    vite_client="$(curl --silent --show-error --fail --max-time 1 "$VITE_CLIENT_URL" 2>/dev/null)" \
        || return 1
    [[ "$vite_client" == *"createHotContext"* ]]
}

cd "$PROJECT_ROOT"

# A developer-launched desktop client may already own the shared Vite port.
# Stay alive as the MonPM-managed sentinel instead of entering a restart storm;
# if that Vite instance exits, this process takes over automatically.
if vite_is_ready; then
    echo "检测到已运行的 MonAgent Vite（${WEB_PORT}），复用现有服务并等待接管。"
    missed_checks=0
    while (( missed_checks < 3 )); do
        if vite_is_ready; then
            missed_checks=0
        else
            missed_checks=$((missed_checks + 1))
        fi
        sleep 1
    done
    echo "现有 Vite 已退出，MonPM 正在接管端口 ${WEB_PORT}。"
fi

exec npm run dev:web
