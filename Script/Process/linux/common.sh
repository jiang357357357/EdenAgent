#!/usr/bin/env bash

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$COMMON_DIR/../../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/.monconfig"
SERVER_ROOT="$PROJECT_ROOT/Server"
SERVER_VENV_PYTHON="$SERVER_ROOT/.venv/bin/python"
LOG_ROOT="$PROJECT_ROOT/Data/Logs"
CURRENT_START_FILE="$LOG_ROOT/current_start.txt"
START_COUNTER_FILE="$LOG_ROOT/startup_counter.txt"
KEEP_START_COUNT="${MON_KEEP_START_COUNT:-10}"

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
SERVER_PM2_NAME="${SERVER_PM2_NAME:-agent-api}"
WEB_PM2_NAME="${MON_AGENT_WEB_PM2_NAME:-$(read_monconfig_value process WEB_PM2_NAME)}"
WEB_PM2_NAME="${WEB_PM2_NAME:-agent-web}"

parse_start_index() {
  local name
  name="$(basename "$1")"
  if [[ "$name" =~ ^start_([0-9]+)$ ]]; then
    printf '%s\n' "$((10#${BASH_REMATCH[1]}))"
  else
    printf '%s\n' "-1"
  fi
}

latest_start_index() {
  local latest=0
  local dir index
  shopt -s nullglob
  for dir in "$LOG_ROOT"/start_*; do
    [[ -d "$dir" ]] || continue
    index="$(parse_start_index "$dir")"
    if [[ "$index" =~ ^[0-9]+$ && "$index" -gt "$latest" ]]; then
      latest="$index"
    fi
  done
  shopt -u nullglob
  printf '%s\n' "$latest"
}

read_start_counter() {
  if [[ -f "$START_COUNTER_FILE" ]]; then
    cat "$START_COUNTER_FILE" 2>/dev/null || printf '0\n'
  else
    printf '0\n'
  fi
}

current_start_log_dir() {
  local current candidate
  current=""
  if [[ -f "$CURRENT_START_FILE" ]]; then
    current="$(cat "$CURRENT_START_FILE" 2>/dev/null || true)"
  fi
  if [[ -n "$current" ]]; then
    candidate="$current"
    if [[ "$candidate" != /* ]]; then
      candidate="$LOG_ROOT/$candidate"
    fi
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi
  return 1
}

prune_old_start_dirs() {
  shopt -s nullglob
  mapfile -t dirs < <(printf '%s\n' "$LOG_ROOT"/start_* | sort)
  shopt -u nullglob
  local remove_count=$(( ${#dirs[@]} - KEEP_START_COUNT ))
  if [[ "$remove_count" -le 0 ]]; then
    return 0
  fi
  local i
  for ((i = 0; i < remove_count; i++)); do
    rm -rf "${dirs[$i]}"
  done
}

begin_start_log_dir() {
  mkdir -p "$LOG_ROOT"
  local counter latest next index start_dir
  counter="$(read_start_counter)"
  [[ "$counter" =~ ^[0-9]+$ ]] || counter=0
  latest="$(latest_start_index)"
  next=$(( counter > latest ? counter + 1 : latest + 1 ))

  for ((index = next; index < next + 1000; index++)); do
    start_dir="$LOG_ROOT/start_$(printf '%06d' "$index")"
    if mkdir "$start_dir" 2>/dev/null; then
      mkdir -p "$start_dir/Process" "$start_dir/Text/MonAgent" "$start_dir/Render"
      printf '%s\n' "$index" > "$START_COUNTER_FILE"
      basename "$start_dir" > "$CURRENT_START_FILE"
      export MON_LOG_START_DIR="$start_dir"
      publish_active_log_env
      prune_old_start_dirs
      return 0
    fi
  done

  echo "[x] Unable to create a new MonAgent start log directory" >&2
  return 1
}

use_current_or_begin_start_log_dir() {
  local current
  if current="$(current_start_log_dir)"; then
    mkdir -p "$current/Process" "$current/Text/MonAgent" "$current/Render"
    export MON_LOG_START_DIR="$current"
    publish_active_log_env
    return 0
  fi
  begin_start_log_dir
}

active_start_log_dir() {
  if [[ -n "${MON_LOG_START_DIR:-}" ]]; then
    printf '%s\n' "$MON_LOG_START_DIR"
    return 0
  fi
  current_start_log_dir
}

publish_active_log_env() {
  local active_dir
  active_dir="$(active_start_log_dir 2>/dev/null || true)"
  if [[ -z "$active_dir" ]]; then
    return 0
  fi
  export MON_AGENT_SERVER_LOG_FILE="$active_dir/Text/MonAgent/MonAgent.log"
  export MON_AGENT_SERVER_PLAIN_LOG_FILE="$active_dir/Text/MonAgent/MonAgent_plain.log"
  export MON_AGENT_RENDER_LOG_DIR="$active_dir/Render"
  export MON_AGENT_RENDER_LOG_FILE="$active_dir/Render/render.log"
  export MON_AGENT_RENDER_PLAIN_LOG_FILE="$active_dir/Render/render_plain.log"
  export MON_AGENT_RENDER_PANELS_FILE="$active_dir/Render/panels.json"
  SERVER_LOG_FILE="$MON_AGENT_SERVER_LOG_FILE"
  SERVER_PLAIN_LOG_FILE="$MON_AGENT_SERVER_PLAIN_LOG_FILE"
}

resolve_agent_log_file() {
  local env_value="$1"
  local relative_path="$2"
  local active_dir
  if [[ -n "$env_value" ]]; then
    if [[ "$env_value" == /* ]]; then
      printf '%s\n' "$env_value"
    else
      printf '%s\n' "$PROJECT_ROOT/$env_value"
    fi
    return 0
  fi
  if active_dir="$(active_start_log_dir)"; then
    printf '%s\n' "$active_dir/$relative_path"
  else
    printf '%s\n' "$PROJECT_ROOT/Data/Logs/$relative_path"
  fi
}

SERVER_LOG_FILE="$(resolve_agent_log_file "${MON_AGENT_SERVER_LOG_FILE:-}" "Text/MonAgent/MonAgent.log")"
SERVER_PLAIN_LOG_FILE="$(resolve_agent_log_file "${MON_AGENT_SERVER_PLAIN_LOG_FILE:-}" "Text/MonAgent/MonAgent_plain.log")"

ensure_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    return 0
  fi

  echo "[x] pm2 not found"
  echo "    Install: npm install -g pm2"
  return 1
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  echo "[x] node/npm not found"
  echo "    Install Node.js 22+ before starting MonAgent Web."
  return 1
}

ensure_python() {
  if [[ -n "${MON_AGENT_PYTHON:-}" ]] && command -v "$MON_AGENT_PYTHON" >/dev/null 2>&1; then
    return 0
  fi

  if [[ -x "$SERVER_VENV_PYTHON" ]]; then
    return 0
  fi

  if command -v uv >/dev/null 2>&1; then
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    return 0
  fi

  echo "[x] Agent Server Python env not found"
  echo "    Install: bash Server/Script/EnvTools/linux/install_env.sh"
  echo "    Or install uv / python3, or set MON_AGENT_PYTHON."
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

pm2_app_pid() {
  local app_name="$1"
  export PM2_APP_NAME="$app_name"
  pm2_cmd jlist | node -e '
    const fs = require("fs");
    const name = process.env.PM2_APP_NAME;
    const apps = JSON.parse(fs.readFileSync(0, "utf8") || "[]");
    const app = apps.find((item) => item.name === name);
    if (!app) process.exit(0);
    const pid = app.pid || app.pm2_env?.pm_pid || "";
    if (pid) process.stdout.write(String(pid));
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
    const rows = names.map((name) => {
      const app = apps.find((item) => item.name === name);
      if (!app) return { id: "-", name, status: "missing", pid: "-", cpu: "-", mem: "-" };
      const env = app.pm2_env || {};
      const monit = app.monit || {};
      const mem = monit.memory ? `${(monit.memory / 1024 / 1024).toFixed(1)}MB` : "-";
      const cpu = Number.isFinite(monit.cpu) ? `${monit.cpu}%` : "-";
      return {
        id: String(app.pm_id ?? env.pm_id ?? "-"),
        name,
        status: env.status || "unknown",
        pid: String(app.pid || env.pm_pid || "-"),
        cpu,
        mem,
      };
    });
    const fields = [["id", "id"], ["name", "name"], ["status", "status"], ["pid", "pid"], ["cpu", "cpu"], ["mem", "mem"]];
    const widths = {
      field: Math.max("field".length, ...fields.map(([, label]) => label.length)),
      value: Math.max("value".length, ...rows.flatMap((row) => fields.map(([key]) => String(row[key]).length))),
    };
    const border = (left, middle, right) =>
      left + ["field", "value"].map((key) => "─".repeat(widths[key] + 2)).join(middle) + right;
    const line = (field, value) =>
      `│ ${String(field).padEnd(widths.field)} │ ${String(value).padEnd(widths.value)} │`;
    console.log(border("┌", "┬", "┐"));
    console.log(line("field", "value"));
    console.log(border("├", "┼", "┤"));
    rows.forEach((row, index) => {
      if (index > 0) console.log(border("├", "┼", "┤"));
      fields.forEach(([key, label]) => console.log(line(label, row[key])));
    });
    console.log(border("└", "┴", "┘"));
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

tcp_listen_pids() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN -P -n 2>/dev/null | sort -nu
    return 0
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :$port )" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' \
      | cut -d= -f2 \
      | sort -nu
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null \
      | tr ' ' '\n' \
      | awk '/^[0-9]+$/ { print }' \
      | sort -nu
    return 0
  fi

  return 0
}

process_cmdline() {
  local pid="$1"
  if [[ -r "/proc/$pid/cmdline" ]]; then
    tr '\0' ' ' <"/proc/$pid/cmdline" | sed 's/[[:space:]]*$//'
    return 0
  fi
  ps -p "$pid" -o command= 2>/dev/null || true
}

pid_is_alive() {
  local pid="$1"
  [[ -n "$pid" && "$pid" =~ ^[0-9]+$ && -d "/proc/$pid" ]]
}

pid_parent() {
  local pid="$1"
  awk '/^PPid:/ { print $2; exit }' "/proc/$pid/status" 2>/dev/null || true
}

pid_is_in_tree() {
  local pid="$1"
  local root_pid="$2"
  local current="$pid"

  [[ -n "$root_pid" && "$root_pid" =~ ^[0-9]+$ ]] || return 1
  while pid_is_alive "$current"; do
    if [[ "$current" == "$root_pid" ]]; then
      return 0
    fi
    current="$(pid_parent "$current")"
    if [[ -z "$current" || "$current" == "0" || ! "$current" =~ ^[0-9]+$ ]]; then
      break
    fi
  done

  return 1
}

wait_pid_exit() {
  local pid="$1"
  local attempts="${2:-25}"
  local delay="${3:-0.2}"

  for ((index = 0; index < attempts; index += 1)); do
    if ! pid_is_alive "$pid"; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

release_tcp_port() {
  local port="$1"
  local label="${2:-service}"
  local pids
  mapfile -t pids < <(tcp_listen_pids "$port")

  if [[ "${#pids[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "[i] Port $port is occupied; releasing before starting $label..."
  for pid in "${pids[@]}"; do
    if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]]; then
      continue
    fi
    if [[ "$pid" == "$$" ]]; then
      continue
    fi
    local cmdline
    cmdline="$(process_cmdline "$pid")"
    echo "    - PID $pid${cmdline:+: $cmdline}"
    kill "$pid" 2>/dev/null || true
  done

  for pid in "${pids[@]}"; do
    if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ || "$pid" == "$$" ]]; then
      continue
    fi
    if wait_pid_exit "$pid" 25 0.2; then
      continue
    fi
    echo "    - PID $pid did not exit after SIGTERM; sending SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
  done

  mapfile -t pids < <(tcp_listen_pids "$port")
  if [[ "${#pids[@]}" -gt 0 ]]; then
    echo "[x] Port $port is still occupied after cleanup: ${pids[*]}"
    return 1
  fi

  echo "[i] Port $port released."
}

port_owned_by_pid_tree() {
  local port="$1"
  local root_pid="$2"
  local pid

  [[ -n "$root_pid" && "$root_pid" =~ ^[0-9]+$ ]] || return 1
  while IFS= read -r pid; do
    if pid_is_in_tree "$pid" "$root_pid"; then
      return 0
    fi
  done < <(tcp_listen_pids "$port")

  return 1
}

export MON_PROCESS_TAG="$PROCESS_TAG"
export MON_AGENT_PORT="$SERVER_PORT"
export MON_AGENT_WEB_PORT="$WEB_PORT"
export MON_AGENT_SERVER_PM2_NAME="$SERVER_PM2_NAME"
export MON_AGENT_WEB_PM2_NAME="$WEB_PM2_NAME"
export MON_AGENT_SERVER_LOG_FILE="$SERVER_LOG_FILE"
export MON_AGENT_SERVER_PLAIN_LOG_FILE="$SERVER_PLAIN_LOG_FILE"
if [[ -z "${MON_LOG_START_DIR:-}" ]]; then
  if current="$(current_start_log_dir 2>/dev/null)"; then
    export MON_LOG_START_DIR="$current"
  fi
fi
publish_active_log_env
export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1
export NO_COLOR=1
export FORCE_COLOR=0
