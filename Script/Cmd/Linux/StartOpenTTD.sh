#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HELPER="${AGENT_ROOT}/Script/Project/openttd_launcher.mjs"
OPEN_TTD_BRIDGE="${AGENT_ROOT}/Server/connectors/openttd_bridge"
OPEN_TTD_ROOT="${MON_OPENTTD_ROOT:-${HOME}/.local/opt/openttd-15.3}"
OPEN_TTD_BIN="${MON_OPENTTD_BIN:-${OPEN_TTD_ROOT}/openttd}"
OPEN_TTD_DATA="${XDG_DATA_HOME:-${HOME}/.local/share}/openttd"
OPEN_TTD_SAVE="${MON_OPENTTD_SAVE:-${OPEN_TTD_DATA}/save/edenagent-route.sav}"
OPEN_TTD_HOST="${MON_OPENTTD_HOST:-127.0.0.1}"
OPEN_TTD_RUNTIME="${XDG_RUNTIME_DIR:-/tmp}/edenagent-openttd"
OPEN_TTD_REGISTRY="${MON_OPENTTD_INSTANCE_REGISTRY:-${OPEN_TTD_RUNTIME}/active-instance.json}"
OPEN_TTD_LOCK="${OPEN_TTD_RUNTIME}/launcher.lock"
OPEN_TTD_LOG="${OPEN_TTD_RUNTIME}/server.log"
OPEN_TTD_BASE_CONFIG="${MON_OPENTTD_CONFIG:-${HOME}/.config/openttd/openttd.cfg}"
OPEN_TTD_CONTENT_DIRS=(ai baseset content_download game newgrf save scenario screenshot social_integration)

[[ "${OPEN_TTD_HOST}" == "127.0.0.1" || "${OPEN_TTD_HOST}" == "localhost" ]] || {
  echo "MON_OPENTTD_HOST must remain loopback because the Admin Port permits password login without transport encryption." >&2
  exit 1
}

export SDL_VIDEO_X11_NET_WM_BYPASS_COMPOSITOR=0

mode="auto"
replace=""
if [[ "${1:-}" == "--replace" ]]; then replace="1"; shift; fi
if [[ "${1:-}" == "--dedicated" ]]; then mode="dedicated"; shift
elif [[ "${1:-}" == "--join" ]]; then mode="join"; shift
fi

[[ -x "${OPEN_TTD_BIN}" ]] || { echo "OpenTTD executable not found: ${OPEN_TTD_BIN}" >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 22+ is required by the OpenTTD launcher." >&2; exit 1; }
mkdir -p "${OPEN_TTD_RUNTIME}" "${OPEN_TTD_DATA}"

managed_instance_is_alive() { node "${HELPER}" alive "${OPEN_TTD_REGISTRY}" >/dev/null 2>&1; }
server_ports_are_ready() {
  node -e 'const net=require("node:net"); const [host,...ports]=process.argv.slice(1); Promise.all(ports.map(port=>new Promise((ok,no)=>{const s=net.connect({host,port:Number(port)}); s.setTimeout(200); s.once("connect",()=>{s.destroy();ok()}); s.once("timeout",()=>{s.destroy();no()}); s.once("error",no)}))).catch(()=>process.exit(1))' "${OPEN_TTD_HOST}" "$1" "$2"
}

stop_managed_instance() {
  local expected_id="$1" expected_pid="$2" expected_config="$3" control_fd="${4:-}" save_name="${5:-}"
  local current_output
  local -a current
  current_output="$(node "${HELPER}" fields "${OPEN_TTD_REGISTRY}")" || return 0
  readarray -t current <<<"${current_output}"
  [[ "${current[2]:-}" == "${expected_id}" && "${current[3]:-}" == "${expected_pid}" ]] || return 0
  [[ "${current[6]:-}" == "$(readlink -f "${OPEN_TTD_BIN}")" ]] || { echo "受管 OpenTTD 的启动目标不匹配，拒绝停止。" >&2; return 1; }
  if [[ "${control_fd}" =~ ^[0-9]+$ && "${save_name}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf 'save %s\nquit\n' "${save_name}" >&"${control_fd}"
    for _attempt in $(seq 1 50); do kill -0 "${expected_pid}" 2>/dev/null || break; sleep 0.1; done
  fi
  if kill -0 "${expected_pid}" 2>/dev/null; then
    kill -TERM "${expected_pid}"
    for _attempt in $(seq 1 50); do kill -0 "${expected_pid}" 2>/dev/null || break; sleep 0.1; done
  fi
  kill -0 "${expected_pid}" 2>/dev/null && { echo "受管 OpenTTD 在 5 秒内没有退出。" >&2; return 1; }
  node "${HELPER}" remove-if-matches "${OPEN_TTD_REGISTRY}" "${expected_id}" "${expected_pid}"
  local config_name
  config_name="$(basename -- "${expected_config}")"
  if [[ "$(dirname -- "${expected_config}")" == "${OPEN_TTD_DATA}" && "${config_name}" == .edenagent-instance-*.cfg ]]; then rm -f -- "${expected_config}"; fi
}

if [[ "${mode}" == "auto" ]]; then
  if [[ -z "${replace}" ]] && managed_instance_is_alive; then mode="join"; else mode="host"; fi
fi

if [[ "${mode}" == "join" ]]; then
  instance_output="$(node "${HELPER}" fields "${OPEN_TTD_REGISTRY}")" || { echo "没有可加入的有效受管 OpenTTD 实例。" >&2; exit 1; }
  readarray -t instance <<<"${instance_output}"
  cd "${OPEN_TTD_ROOT}"
  if [[ "${instance[5]}" == "dedicated" ]]; then
    client_status=0
    "${OPEN_TTD_BIN}" -n "${instance[0]}:${instance[1]}" "$@" || client_status=$?
    stop_managed_instance "${instance[2]}" "${instance[3]}" "${instance[4]}"
    exit "${client_status}"
  fi
  exec "${OPEN_TTD_BIN}" -n "${instance[0]}:${instance[1]}" "$@"
fi

exec 9>"${OPEN_TTD_LOCK}"
flock 9
if [[ -f "${OPEN_TTD_REGISTRY}" ]]; then
  if managed_instance_is_alive; then
    readarray -t old_instance < <(node "${HELPER}" fields "${OPEN_TTD_REGISTRY}")
    [[ -n "${replace}" ]] || { echo "已有受管 OpenTTD 实例在运行（PID ${old_instance[3]}）；传入 --replace 才会替换。" >&2; exit 1; }
    stop_managed_instance "${old_instance[2]}" "${old_instance[3]}" "${old_instance[4]}"
  else
    rm -f -- "${OPEN_TTD_REGISTRY}"
  fi
fi

[[ -f "${OPEN_TTD_BASE_CONFIG}" ]] || { echo "OpenTTD base config not found: ${OPEN_TTD_BASE_CONFIG}" >&2; exit 1; }
instance_id="$(node "${HELPER}" uuid)"
instance_config="${OPEN_TTD_DATA}/.edenagent-instance-${instance_id}.cfg"
instance_control=""
child_pid=""
registered=""

cleanup() {
  if [[ -n "${child_pid}" && -z "${registered}" ]] && kill -0 "${child_pid}" 2>/dev/null; then
    kill -TERM "${child_pid}" 2>/dev/null || true
    for _attempt in $(seq 1 50); do kill -0 "${child_pid}" 2>/dev/null || break; sleep 0.1; done
  fi
  if [[ -z "${child_pid}" ]] || ! kill -0 "${child_pid}" 2>/dev/null; then
    [[ -z "${child_pid}" ]] || node "${HELPER}" remove-if-matches "${OPEN_TTD_REGISTRY}" "${instance_id}" "${child_pid}"
    rm -f -- "${instance_config}"
  fi
  [[ -z "${instance_control:-}" ]] || rm -f -- "${instance_control}"
}
trap cleanup EXIT

for name in "${OPEN_TTD_CONTENT_DIRS[@]}"; do mkdir -p "${OPEN_TTD_DATA}/${name}"; done
migration_marker="${OPEN_TTD_DATA}/.edenagent-runtime-content-migrated-v1"
if [[ ! -f "${migration_marker}" && -d "${OPEN_TTD_RUNTIME}/instances" ]]; then
  for name in "${OPEN_TTD_CONTENT_DIRS[@]}"; do
    while IFS= read -r -d '' source; do
      relative="${source#*/${name}/}"
      target="${OPEN_TTD_DATA}/${name}/${relative}"
      mkdir -p "$(dirname -- "${target}")"
      cp -u -- "${source}" "${target}"
    done < <(find "${OPEN_TTD_RUNTIME}/instances" -path "*/${name}/*" -type f -print0)
  done
fi
touch "${migration_marker}"
node "${HELPER}" install-bridge "${OPEN_TTD_BRIDGE}" "${OPEN_TTD_DATA}" >/dev/null

base_config_dir="$(dirname "${OPEN_TTD_BASE_CONFIG}")"
instance_config_dir="$(dirname "${instance_config}")"
for companion in private.cfg secrets.cfg; do
  if [[ -f "${base_config_dir}/${companion}" && "${base_config_dir}" != "${instance_config_dir}" ]]; then cp -- "${base_config_dir}/${companion}" "${instance_config_dir}/${companion}"; fi
done
instance_secrets="${instance_config_dir}/secrets.cfg"
admin_password="${MON_CONNECTOR_OPENTTD_RIOU:-}"
if [[ -z "${admin_password}" ]]; then admin_password="$(node "${HELPER}" password "${OPEN_TTD_BASE_CONFIG}")"; fi
if [[ -z "${admin_password}" && -f "${base_config_dir}/secrets.cfg" ]]; then
  admin_password="$(node "${HELPER}" password "${base_config_dir}/secrets.cfg")"
fi
[[ -n "${admin_password}" ]] || { echo "OpenTTD admin password is not configured (MON_CONNECTOR_OPENTTD_RIOU)." >&2; exit 1; }
readarray -t ports < <(node "${HELPER}" ports)
game_port="${ports[0]}"
admin_port="${ports[1]}"
printf '%s' "${admin_password}" | node "${HELPER}" configure "${OPEN_TTD_BASE_CONFIG}" "${instance_config}" "${instance_secrets}" "${game_port}" "${admin_port}"
unset admin_password

cd "${OPEN_TTD_ROOT}"
if [[ "${mode}" == "dedicated" ]]; then
  [[ -f "${OPEN_TTD_SAVE}" ]] || { echo "OpenTTD save not found: ${OPEN_TTD_SAVE}" >&2; exit 1; }
  save_name="$(basename -- "${OPEN_TTD_SAVE}")"
  save_name="${save_name%.sav}"
  [[ "${save_name}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Unsafe OpenTTD save name: ${save_name}" >&2; exit 1; }
  instance_control="${OPEN_TTD_RUNTIME}/control-${instance_id}.fifo"
  mkfifo -m 600 "${instance_control}"
  exec {server_input_fd}<>"${instance_control}"
  setsid "${OPEN_TTD_BIN}" -D "${OPEN_TTD_HOST}:${game_port}" -c "${instance_config}" -g "${OPEN_TTD_SAVE}" -d script=3,net=2 <&${server_input_fd} >>"${OPEN_TTD_LOG}" 2>&1 9>&- &
  child_pid=$!
  server_ready=""
  for _attempt in $(seq 1 50); do
    if server_ports_are_ready "${game_port}" "${admin_port}"; then server_ready="1"; break; fi
    kill -0 "${child_pid}" 2>/dev/null || break
    sleep 0.1
  done
  if [[ -z "${server_ready}" ]]; then
    kill -TERM "${child_pid}" 2>/dev/null || true
    wait "${child_pid}" || true
    exec {server_input_fd}>&-
    rm -f -- "${instance_control}"
    echo "OpenTTD dedicated server did not become ready; see ${OPEN_TTD_LOG}" >&2
    exit 1
  fi
else
  "${OPEN_TTD_BIN}" -c "${instance_config}" "$@" 9>&- &
  child_pid=$!
fi

node "${HELPER}" write-registry "${OPEN_TTD_REGISTRY}" "${instance_id}" "${OPEN_TTD_HOST}" "${game_port}" "${admin_port}" "${child_pid}" "${mode}" "${instance_config}" "${OPEN_TTD_BIN}"
registered="1"
flock -u 9
if [[ "${mode}" == "dedicated" ]]; then
  client_status=0
  "${OPEN_TTD_BIN}" -n "${OPEN_TTD_HOST}:${game_port}" "$@" || client_status=$?
  stop_managed_instance "${instance_id}" "${child_pid}" "${instance_config}" "${server_input_fd}" "${save_name}"
  wait "${child_pid}" || true
  exec {server_input_fd}>&-
  exit "${client_status}"
fi
child_status=0
wait "${child_pid}" || child_status=$?
exit "${child_status}"
