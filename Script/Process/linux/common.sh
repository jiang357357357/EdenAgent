#!/usr/bin/env bash

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$COMMON_DIR/../../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/.monconfig"

read_monconfig_value() {
  local section="$1"
  local key="$2"

  awk -F= -v section="[$section]" -v key="$key" '
    $0 ~ /^\[/ { in_section = ($0 == section); next }
    in_section && $1 == key {
      sub(/^[[:space:]]+/, "", $2)
      sub(/[[:space:]]+$/, "", $2)
      print $2
      exit
    }
  ' "$CONFIG_FILE" 2>/dev/null || true
}

PROCESS_TAG="${MON_PROCESS_TAG:-$(read_monconfig_value process PROCESS_TAG)}"
PROCESS_TAG="${PROCESS_TAG:-monagent-main}"
SERVER_PORT="${MON_AGENT_PORT:-$(read_monconfig_value server PORT)}"
SERVER_PORT="${SERVER_PORT:-40092}"
WEB_PORT="${MON_AGENT_WEB_PORT:-$(read_monconfig_value server WEB_PORT)}"
WEB_PORT="${WEB_PORT:-40091}"
SERVER_PM2_NAME="${MON_AGENT_SERVER_PM2_NAME:-$(read_monconfig_value process SERVER_PM2_NAME)}"
SERVER_PM2_NAME="${SERVER_PM2_NAME:-MonAgent-Server}"
WEB_PM2_NAME="${MON_AGENT_WEB_PM2_NAME:-$(read_monconfig_value process WEB_PM2_NAME)}"
WEB_PM2_NAME="${WEB_PM2_NAME:-MonAgent-Web}"

ensure_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    return 0
  fi

  echo "[x] pm2 not found"
  echo "    Install: npm install -g pm2"
  return 1
}

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi

  echo "[x] bun not found"
  echo "    Install Bun before starting MonAgent"
  return 1
}

ensure_python() {
  local python_bin="${MON_AGENT_PYTHON:-python3}"
  if command -v "$python_bin" >/dev/null 2>&1; then
    return 0
  fi

  echo "[x] python not found: $python_bin"
  echo "    Install Python 3.11+ or set MON_AGENT_PYTHON."
  return 1
}

pm2_cmd() {
  local lock_file="${MON_PM2_CLI_LOCK_FILE:-/tmp/mon-pm2-cli.lock}"
  local lock_timeout="${MON_PM2_CLI_LOCK_TIMEOUT:-60}"

  if command -v flock >/dev/null 2>&1; then
    (
      flock -w "$lock_timeout" 9 || {
        echo "[x] PM2 global lock timeout: $lock_file" >&2
        exit 1
      }
      pm2 "$@"
    ) 9>"$lock_file"
    return $?
  fi

  pm2 "$@"
}

acquire_pm2_start_lock() {
  local lock_dir="${MON_PM2_START_LOCK_DIR:-/tmp/mon-pm2-start.lock.d}"
  local pid_file="$lock_dir/pid"

  while ! mkdir "$lock_dir" 2>/dev/null; do
    local owner_pid=""
    if [[ -f "$pid_file" ]]; then
      owner_pid="$(cat "$pid_file" 2>/dev/null || true)"
    fi

    if [[ -z "$owner_pid" || ! "$owner_pid" =~ ^[0-9]+$ || ! -d "/proc/$owner_pid" ]]; then
      rm -rf "$lock_dir"
      continue
    fi

    echo "[i] Waiting for another Mon PM2 start flow, PID $owner_pid..."
    sleep 1
  done

  printf '%s\n' "$$" > "$pid_file"
  MON_PM2_HELD_START_LOCK_DIR="$lock_dir"
  trap 'rm -rf "$MON_PM2_HELD_START_LOCK_DIR"' EXIT
}

pm2_app_status() {
  local app_name="$1"
  export PM2_APP_NAME="$app_name"
  pm2_cmd jlist | node -e '
    const fs = require("fs");
    const name = process.env.PM2_APP_NAME;
    const apps = JSON.parse(fs.readFileSync(0, "utf8") || "[]");
    const app = apps.find((item) => item.name === name);
    process.stdout.write(app ? app.pm2_env.status : "missing");
  '
}

pm2_process_summary() {
  local app_names_text
  app_names_text="$(printf '%s\n' "$@")"
  export PM2_APP_NAMES="$app_names_text"
  pm2_cmd jlist | node -e '
    const fs = require("fs");
    const names = (process.env.PM2_APP_NAMES || "").split(/\n/).map((item) => item.trim()).filter(Boolean);
    const apps = JSON.parse(fs.readFileSync(0, "utf8") || "[]");
    for (const name of names) {
      const app = apps.find((item) => item.name === name);
      if (!app) {
        console.log(`${name}: missing`);
        continue;
      }
      const env = app.pm2_env || {};
      const monit = app.monit || {};
      const mem = monit.memory ? `${(monit.memory / 1024 / 1024).toFixed(1)}MB` : "-";
      const cpu = Number.isFinite(monit.cpu) ? `${monit.cpu}%` : "-";
      console.log(`${name}: ${env.status || "unknown"} pid=${app.pid || env.pm_pid || "-"} cpu=${cpu} mem=${mem}`);
    }
  '
}

run_pm2_quiet() {
  local output
  if ! output="$(pm2_cmd "$@" 2>&1)"; then
    printf '%s\n' "$output"
    return 1
  fi
}

http_ready() {
  local url="$1"
  curl -fsS "$url" >/dev/null 2>&1
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-40}"
  local delay="${3:-0.5}"

  for ((index = 0; index < attempts; index += 1)); do
    if http_ready "$url"; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

export MON_PROCESS_TAG="$PROCESS_TAG"
export MON_AGENT_PORT="$SERVER_PORT"
export MON_AGENT_WEB_PORT="$WEB_PORT"
export MON_AGENT_SERVER_PM2_NAME="$SERVER_PM2_NAME"
export MON_AGENT_WEB_PM2_NAME="$WEB_PM2_NAME"
export NO_COLOR=1
export FORCE_COLOR=0
