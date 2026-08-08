#!/usr/bin/env bash
set -euo pipefail

OPEN_TTD_ROOT="${MON_OPENTTD_ROOT:-${HOME}/.local/opt/openttd-15.3}"
OPEN_TTD_BIN="${MON_OPENTTD_BIN:-${OPEN_TTD_ROOT}/openttd}"
OPEN_TTD_DATA="${XDG_DATA_HOME:-${HOME}/.local/share}/openttd"
OPEN_TTD_SAVE="${MON_OPENTTD_SAVE:-${OPEN_TTD_DATA}/save/monagent-route.sav}"
OPEN_TTD_HOST="${MON_OPENTTD_HOST:-127.0.0.1}"
OPEN_TTD_PORT="${MON_OPENTTD_PORT:-3979}"
OPEN_TTD_RUNTIME="${XDG_RUNTIME_DIR:-/tmp}/monagent-openttd"
OPEN_TTD_LOCK="${OPEN_TTD_RUNTIME}/launcher.lock"
OPEN_TTD_LOG="${OPEN_TTD_RUNTIME}/server.log"

mode="host"
if [[ "${1:-}" == "--dedicated" ]]; then
  mode="dedicated"
  shift
elif [[ "${1:-}" == "--join" ]]; then
  mode="join"
  shift
fi

if [[ ! -x "${OPEN_TTD_BIN}" ]]; then
  echo "OpenTTD executable not found: ${OPEN_TTD_BIN}" >&2
  exit 1
fi

mkdir -p "${OPEN_TTD_RUNTIME}"

server_ready() {
  python3 - "${OPEN_TTD_HOST}" "${OPEN_TTD_PORT}" <<'PY'
import socket
import sys

host, port = sys.argv[1], int(sys.argv[2])
try:
    with socket.create_connection((host, port), timeout=0.2):
        pass
except OSError:
    raise SystemExit(1)
PY
}

if [[ "${mode}" == "host" ]]; then
  cd "${OPEN_TTD_ROOT}"
  exec "${OPEN_TTD_BIN}" "$@"
fi

if [[ "${mode}" == "join" ]]; then
  if ! server_ready; then
    echo "No OpenTTD server is listening at ${OPEN_TTD_HOST}:${OPEN_TTD_PORT}." >&2
    exit 1
  fi
  cd "${OPEN_TTD_ROOT}"
  exec "${OPEN_TTD_BIN}" -n "${OPEN_TTD_HOST}:${OPEN_TTD_PORT}" "$@"
fi

exec 9>"${OPEN_TTD_LOCK}"
flock 9
if ! server_ready; then
  if [[ ! -f "${OPEN_TTD_SAVE}" ]]; then
    echo "OpenTTD save not found: ${OPEN_TTD_SAVE}" >&2
    exit 1
  fi
  (
    cd "${OPEN_TTD_ROOT}"
    nohup "${OPEN_TTD_BIN}" -x -D "${OPEN_TTD_HOST}:${OPEN_TTD_PORT}" -g "${OPEN_TTD_SAVE}" \
      -d script=3,net=2 >>"${OPEN_TTD_LOG}" 2>&1 &
  )
  for _attempt in $(seq 1 50); do
    server_ready && break
    sleep 0.1
  done
  if ! server_ready; then
    echo "OpenTTD server did not become ready; see ${OPEN_TTD_LOG}" >&2
    exit 1
  fi
fi

flock -u 9
cd "${OPEN_TTD_ROOT}"
exec "${OPEN_TTD_BIN}" -n "${OPEN_TTD_HOST}:${OPEN_TTD_PORT}" "$@"
