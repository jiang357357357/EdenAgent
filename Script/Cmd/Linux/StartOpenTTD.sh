#!/usr/bin/env bash
set -euo pipefail

OPEN_TTD_ROOT="${MON_OPENTTD_ROOT:-${HOME}/.local/opt/openttd-15.3}"
OPEN_TTD_BIN="${MON_OPENTTD_BIN:-${OPEN_TTD_ROOT}/openttd}"
OPEN_TTD_DATA="${XDG_DATA_HOME:-${HOME}/.local/share}/openttd"
OPEN_TTD_SAVE="${MON_OPENTTD_SAVE:-${OPEN_TTD_DATA}/save/monagent-route.sav}"
OPEN_TTD_HOST="${MON_OPENTTD_HOST:-127.0.0.1}"
OPEN_TTD_RUNTIME="${XDG_RUNTIME_DIR:-/tmp}/monagent-openttd"
OPEN_TTD_REGISTRY="${MON_OPENTTD_INSTANCE_REGISTRY:-${OPEN_TTD_RUNTIME}/active-instance.json}"
OPEN_TTD_LOCK="${OPEN_TTD_RUNTIME}/launcher.lock"
OPEN_TTD_LOG="${OPEN_TTD_RUNTIME}/server.log"
OPEN_TTD_BASE_CONFIG="${MON_OPENTTD_CONFIG:-${HOME}/.config/openttd/openttd.cfg}"
OPEN_TTD_CONTENT_DIRS=(
  ai
  baseset
  content_download
  game
  newgrf
  save
  scenario
  screenshot
  social_integration
)

# OpenTTD uses SDL on X11. Never let it suspend KWin's compositor because
# Electron's transparent desktop-pet windows require the alpha compositor.
export SDL_VIDEO_X11_NET_WM_BYPASS_COMPOSITOR=0

mode="auto"
replace=""
if [[ "${1:-}" == "--replace" ]]; then
  replace="1"
  shift
fi
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

managed_instance_is_alive() {
  python3 - "${OPEN_TTD_REGISTRY}" <<'PY'
import json, os, sys
try:
    value = json.load(open(sys.argv[1], encoding="utf-8"))
    os.kill(int(value["pid"]), 0)
except Exception:
    raise SystemExit(1)
PY
}

server_ports_are_ready() {
  python3 - "${OPEN_TTD_HOST}" "$1" "$2" <<'PY'
import socket
import sys

host = sys.argv[1]
for port in map(int, sys.argv[2:]):
    try:
        with socket.create_connection((host, port), timeout=0.2):
            pass
    except OSError:
        raise SystemExit(1)
PY
}

stop_managed_instance() {
  local expected_id="$1"
  local expected_pid="$2"
  local expected_config="$3"
  local control_fd="${4:-}"
  local save_name="${5:-}"
  python3 - "${OPEN_TTD_REGISTRY}" "${expected_id}" "${expected_pid}" \
    "${expected_config}" "${OPEN_TTD_DATA}" "${OPEN_TTD_BIN}" \
    "${control_fd}" "${save_name}" <<'PY'
import json
import os
from pathlib import Path
import signal
import sys
import time

(
    registry, expected_id, expected_pid, config, data_root, expected_binary,
    control_fd, save_name,
) = sys.argv[1:]
expected_pid = int(expected_pid)
try:
    data = json.load(open(registry, encoding="utf-8"))
except (FileNotFoundError, json.JSONDecodeError, OSError):
    raise SystemExit(0)
if data.get("instance_id") != expected_id or int(data.get("pid") or 0) != expected_pid:
    raise SystemExit(0)

def process_state() -> str:
    try:
        return Path(f"/proc/{expected_pid}/stat").read_text().split(") ", 1)[1][0]
    except (FileNotFoundError, IndexError, OSError):
        return ""


state = process_state()
if state and state != "Z":
    try:
        command = Path(f"/proc/{expected_pid}/cmdline").read_bytes().split(b"\0")
    except OSError:
        command = []
    expected_binary = os.path.realpath(expected_binary)
    resolved_arguments = {
        os.path.realpath(value.decode(errors="ignore"))
        for value in command[:2]
        if value
    }
    if expected_binary not in resolved_arguments:
        raise SystemExit("受管 OpenTTD PID 的可执行文件不匹配，拒绝停止。")

if state and state != "Z" and control_fd:
    if not save_name or not all(character.isalnum() or character in "._-" for character in save_name):
        raise SystemExit("OpenTTD 自动保存名称无效，拒绝向控制台写入。")
    os.write(int(control_fd), f"save {save_name}\nquit\n".encode())
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = process_state()
        if not state or state == "Z":
            break
        time.sleep(0.1)

state = process_state()
if state and state != "Z":
    try:
        os.kill(expected_pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    state = process_state()
    if not state or state == "Z":
        break
    time.sleep(0.1)
else:
    raise SystemExit("受管 OpenTTD 在 5 秒内没有退出。")

try:
    current = json.load(open(registry, encoding="utf-8"))
    if current.get("instance_id") == expected_id and int(current.get("pid") or 0) == expected_pid:
        os.unlink(registry)
except (FileNotFoundError, json.JSONDecodeError, OSError, ValueError):
    pass

config_name = os.path.basename(config)
if (
    os.path.abspath(os.path.dirname(config)) == os.path.abspath(data_root)
    and config_name.startswith(".monagent-instance-")
    and config_name.endswith(".cfg")
):
    try:
        os.unlink(config)
    except FileNotFoundError:
        pass
PY
}

# The desktop menu invokes the launcher without arguments. If MonAgent already
# owns a dedicated game, opening OpenTTD should join that game instead of
# failing because a second host would replace it. Explicit --replace keeps the
# original force-replacement behavior.
if [[ "${mode}" == "auto" ]]; then
  if [[ -z "${replace}" ]] && managed_instance_is_alive; then
    mode="join"
  else
    mode="host"
  fi
fi

if [[ "${mode}" == "join" ]]; then
  readarray -t instance < <(python3 - "${OPEN_TTD_REGISTRY}" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    value = json.load(open(path, encoding="utf-8"))
    os.kill(int(value["pid"]), 0)
    print(value["host"])
    print(int(value["game_port"]))
    print(value["instance_id"])
    print(int(value["pid"]))
    print(value.get("config_path") or "")
    print(value.get("mode") or "")
except Exception as error:
    raise SystemExit(f"No active MonAgent OpenTTD instance: {error}")
PY
  )
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

# A new host replaces the previous launcher-managed instance. This is scoped
# to the exact PID recorded by MonAgent and never searches/kills arbitrary
# OpenTTD processes.
if [[ -f "${OPEN_TTD_REGISTRY}" ]]; then
  old_pid="$(python3 - "${OPEN_TTD_REGISTRY}" <<'PY'
import json, sys
try: print(int(json.load(open(sys.argv[1], encoding="utf-8"))["pid"]))
except Exception: print("")
PY
  )"
  if [[ "${old_pid}" =~ ^[0-9]+$ ]] && kill -0 "${old_pid}" 2>/dev/null; then
    if [[ -z "${replace}" ]]; then
      echo "已有受管 OpenTTD 实例在运行（PID ${old_pid}）。为避免丢失未保存进度，需显式传入 --replace 才会替换。" >&2
      exit 1
    fi
    kill -TERM "${old_pid}"
    for _attempt in $(seq 1 50); do
      kill -0 "${old_pid}" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "${old_pid}" 2>/dev/null; then
      echo "Previous managed OpenTTD instance did not stop: PID ${old_pid}" >&2
      exit 1
    fi
  fi
  rm -f -- "${OPEN_TTD_REGISTRY}"
fi

if [[ ! -f "${OPEN_TTD_BASE_CONFIG}" ]]; then
  echo "OpenTTD base config not found: ${OPEN_TTD_BASE_CONFIG}" >&2
  exit 1
fi

instance_id="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
instance_config="${OPEN_TTD_DATA}/.monagent-instance-${instance_id}.cfg"
instance_control=""

# Passing an explicit -c path makes OpenTTD treat the config's directory as
# its personal-data directory. Keep the uniquely named instance config in the
# stable XDG OpenTTD data root: ports remain isolated per launch while content
# downloads, saves, scripts and screenshots all use the normal persistent
# location. Import content left by older runtime-local configs once.
python3 - "${OPEN_TTD_RUNTIME}/instances" "${OPEN_TTD_DATA}" \
  "${OPEN_TTD_DATA}/.monagent-runtime-content-migrated-v1" \
  "${OPEN_TTD_CONTENT_DIRS[@]}" <<'PY'
import os
from pathlib import Path
import shutil
import sys
import tempfile

legacy_root = Path(sys.argv[1])
data_root = Path(sys.argv[2])
marker = Path(sys.argv[3])
content_dirs = sys.argv[4:]
data_root.mkdir(parents=True, exist_ok=True)

for name in content_dirs:
    (data_root / name).mkdir(parents=True, exist_ok=True)

if not marker.exists() and legacy_root.is_dir():
    migrated = 0
    for instance_dir in sorted(legacy_root.iterdir()):
        if not instance_dir.is_dir() or instance_dir.is_symlink():
            continue
        for name in content_dirs:
            source_root = instance_dir / name
            if not source_root.is_dir() or source_root.is_symlink():
                continue
            target_root = data_root / name
            for source in source_root.rglob("*"):
                if source.is_symlink():
                    continue
                target = target_root / source.relative_to(source_root)
                if source.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                elif source.is_file():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    should_copy = not target.exists()
                    if target.is_file() and source.stat().st_mtime_ns > target.stat().st_mtime_ns:
                        should_copy = True
                    if should_copy:
                        shutil.copy2(source, target)
                        migrated += 1
    if migrated:
        print(f"Migrated {migrated} OpenTTD content file(s) into {data_root}")

marker.parent.mkdir(parents=True, exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix=f".{marker.name}-", dir=marker.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write("1\n")
    os.replace(temporary, marker)
except BaseException:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    raise
PY

# OpenTTD resolves private.cfg and secrets.cfg next to an explicitly selected
# main config. Keep credentials out of the generated JSON registry while
# making the isolated instance configuration self-contained.
base_config_dir="$(dirname "${OPEN_TTD_BASE_CONFIG}")"
instance_config_dir="$(dirname "${instance_config}")"
for companion in private.cfg secrets.cfg; do
  if [[ -f "${base_config_dir}/${companion}" ]]; then
    if [[ "${base_config_dir}/${companion}" != "${instance_config_dir}/${companion}" ]]; then
      cp -- "${base_config_dir}/${companion}" "${instance_config_dir}/${companion}"
    fi
    chmod 600 "${instance_config_dir}/${companion}"
  fi
done

# OpenTTD 15.x only reads the admin password from secrets.cfg (the
# admin_password key in openttd.cfg is ignored). The copied secrets.cfg may
# carry an empty admin_password, which would leave the admin port closed and
# the MonAgent connector unable to attach. Resolve the password from the
# connector env var first, then from the base openttd.cfg, and force it into
# the instance secrets.cfg before the game starts.
instance_secrets="${instance_config_dir}/secrets.cfg"
admin_password="${MON_CONNECTOR_OPENTTD_RIOU:-}"
if [[ -z "${admin_password}" ]]; then
  admin_password="$(python3 - "${OPEN_TTD_BASE_CONFIG}" <<'PY'
import configparser
import sys
config = configparser.RawConfigParser(strict=False, interpolation=None)
config.optionxform = str
config.read(sys.argv[1], encoding="utf-8")
print(config.get("network", "admin_password", fallback="").strip())
PY
  )"
fi
if [[ -z "${admin_password}" ]]; then
  echo "OpenTTD admin password is not configured (set MON_CONNECTOR_OPENTTD_RIOU or [network] admin_password in openttd.cfg)." >&2
  exit 1
fi
python3 - "${instance_secrets}" "${admin_password}" <<'PY'
import configparser
import sys
path, password = sys.argv[1:]
config = configparser.RawConfigParser(strict=False, interpolation=None)
config.optionxform = str
config.read(path, encoding="utf-8")
if not config.has_section("network"):
    config.add_section("network")
config.set("network", "admin_password", password)
with open(path, "w", encoding="utf-8") as output:
    config.write(output, space_around_delimiters=True)
PY
chmod 600 "${instance_secrets}"

readarray -t ports < <(python3 - <<'PY'
import socket
sockets=[]
try:
    for _ in range(2):
        sock=socket.socket()
        sock.bind(("127.0.0.1", 0))
        sockets.append(sock)
    for sock in sockets: print(sock.getsockname()[1])
finally:
    for sock in sockets: sock.close()
PY
)
game_port="${ports[0]}"
admin_port="${ports[1]}"

python3 - "${OPEN_TTD_BASE_CONFIG}" "${instance_config}" "${game_port}" "${admin_port}" <<'PY'
import configparser, sys
source, target, game_port, admin_port = sys.argv[1:]
config = configparser.RawConfigParser(strict=False, interpolation=None)
config.optionxform = str
config.read(source, encoding="utf-8")
if not config.has_section("network"): config.add_section("network")
if not config.has_section("gui"): config.add_section("gui")
config.set("network", "server_port", game_port)
config.set("network", "server_admin_port", admin_port)
config.set("network", "server_admin_chat", "true")
config.set("network", "allow_insecure_admin_login", "true")
config.set("gui", "autosave_on_exit", "true")
with open(target, "w", encoding="utf-8") as output: config.write(output, space_around_delimiters=True)
PY

cd "${OPEN_TTD_ROOT}"
if [[ "${mode}" == "dedicated" ]]; then
  if [[ ! -f "${OPEN_TTD_SAVE}" ]]; then
    echo "OpenTTD save not found: ${OPEN_TTD_SAVE}" >&2
    exit 1
  fi
  save_name="$(basename -- "${OPEN_TTD_SAVE}")"
  save_name="${save_name%.sav}"
  if [[ ! "${save_name}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "OpenTTD save name is not safe for the dedicated console: ${save_name}" >&2
    exit 1
  fi
  instance_control="${OPEN_TTD_RUNTIME}/control-${instance_id}.fifo"
  mkfifo -m 600 "${instance_control}"
  exec {server_input_fd}<>"${instance_control}"
  # Keep the dedicated console on a private pipe so client shutdown can save
  # and quit cleanly. Passing `-f` would fork away from this supervision.
  setsid "${OPEN_TTD_BIN}" -D "${OPEN_TTD_HOST}:${game_port}" -c "${instance_config}" -g "${OPEN_TTD_SAVE}" \
    -d script=3,net=2 <&${server_input_fd} >>"${OPEN_TTD_LOG}" 2>&1 9>&- &
  child_pid=$!
  server_ready=""
  for _attempt in $(seq 1 50); do
    if server_ports_are_ready "${game_port}" "${admin_port}"; then
      server_ready="1"
      break
    fi
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

python3 - "${OPEN_TTD_REGISTRY}" "${instance_id}" "${OPEN_TTD_HOST}" "${game_port}" "${admin_port}" "${child_pid}" "${mode}" "${instance_config}" <<'PY'
import datetime, json, os, sys, tempfile
path, instance_id, host, game_port, admin_port, pid, mode, config = sys.argv[1:]
value = {
    "instance_id": instance_id, "host": host, "game_port": int(game_port),
    "admin_port": int(admin_port), "pid": int(pid), "mode": mode,
    "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "config_path": config,
}
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix=".active-instance-", dir=os.path.dirname(path), text=True)
with os.fdopen(fd, "w", encoding="utf-8") as output: json.dump(value, output, ensure_ascii=False, indent=2)
os.replace(temporary, path)
PY
flock -u 9

cleanup() {
  python3 - "${OPEN_TTD_REGISTRY}" "${instance_id}" "${child_pid}" "${instance_config}" "${OPEN_TTD_DATA}" <<'PY'
import json, os, sys
path, expected, pid, config, data_root = sys.argv[1:]
# Only remove the registry when the recorded server PID is no longer alive.
# The launcher shell may be torn down (e.g. the tool session ends) while the
# dedicated server keeps running; deleting the registry then would orphan the
# live server from the connector.
try:
    data = json.load(open(path, encoding="utf-8"))
    if data.get("instance_id") != expected:
        raise SystemExit
    try:
        os.kill(int(pid), 0)
        alive = True
    except Exception:
        alive = False
    if not alive:
        os.unlink(path)
        config_name = os.path.basename(config)
        if (
            os.path.abspath(os.path.dirname(config)) == os.path.abspath(data_root)
            and config_name.startswith(".monagent-instance-")
            and config_name.endswith(".cfg")
        ):
            try:
                os.unlink(config)
            except FileNotFoundError:
                pass
except (FileNotFoundError, OSError, ValueError, SystemExit):
    pass
PY
  if [[ -n "${instance_control:-}" ]]; then
    rm -f -- "${instance_control}"
  fi
}
trap cleanup EXIT
if [[ "${mode}" == "dedicated" ]]; then
  client_status=0
  "${OPEN_TTD_BIN}" -n "${OPEN_TTD_HOST}:${game_port}" "$@" || client_status=$?
  stop_managed_instance "${instance_id}" "${child_pid}" "${instance_config}" \
    "${server_input_fd}" "${save_name}"
  wait "${child_pid}" || true
  exec {server_input_fd}>&-
  exit "${client_status}"
else
  child_status=0
  wait "${child_pid}" || child_status=$?
  exit "${child_status}"
fi
