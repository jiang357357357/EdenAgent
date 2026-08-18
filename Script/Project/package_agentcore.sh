#!/usr/bin/env sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
export PROFILE=release
export OUTPUT_ROOT="$root/Server/bin"
sh "$root/AgentCore/scripts/package.sh" "${1:-}"
