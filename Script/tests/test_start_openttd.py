from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = REPOSITORY_ROOT / "Script" / "Cmd" / "Linux" / "StartOpenTTD.sh"
CONTENT_DIRS = (
    "ai",
    "baseset",
    "content_download",
    "game",
    "newgrf",
    "save",
    "scenario",
    "screenshot",
    "social_integration",
)


class StartOpenTTDTest(unittest.TestCase):
    def _assert_join_stops_existing_managed_game(self, launcher_arguments: list[str]) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / "runtime"
            install = root / "install"
            record = root / "arguments.json"
            binary = install / "openttd"
            registry = runtime / "monagent-openttd" / "active-instance.json"

            install.mkdir(parents=True)
            binary.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import os
                    from pathlib import Path
                    import sys
                    import time
                    if "--fake-server" in sys.argv:
                        time.sleep(30)
                        raise SystemExit
                    Path(os.environ["MON_TEST_RECORD"]).write_text(json.dumps(sys.argv[1:]), encoding="utf-8")
                    """
                ),
                encoding="utf-8",
            )
            binary.chmod(0o755)
            environment = os.environ.copy()
            environment.update(
                {
                    "HOME": str(root / "home"),
                    "XDG_DATA_HOME": str(root / "data"),
                    "XDG_RUNTIME_DIR": str(runtime),
                    "MON_OPENTTD_ROOT": str(install),
                    "MON_OPENTTD_BIN": str(binary),
                    "MON_TEST_RECORD": str(record),
                }
            )
            server = subprocess.Popen([str(binary), "--fake-server"], env=environment)
            try:
                registry.parent.mkdir(parents=True)
                registry.write_text(
                    json.dumps({
                        "instance_id": "existing",
                        "host": "127.0.0.9",
                        "game_port": 43210,
                        "admin_port": 43211,
                        "pid": server.pid,
                        "mode": "dedicated",
                        "config_path": str(root / "existing.cfg"),
                    }),
                    encoding="utf-8",
                )
                completed = subprocess.run(
                    [str(LAUNCHER), *launcher_arguments],
                    env=environment,
                    text=True,
                    capture_output=True,
                    timeout=15,
                    check=False,
                )

                self.assertEqual(completed.returncode, 0, completed.stderr)
                self.assertEqual(json.loads(record.read_text(encoding="utf-8")), ["-n", "127.0.0.9:43210"])
                self.assertEqual(server.wait(timeout=5), -15)
                self.assertFalse(registry.exists())
            finally:
                if server.poll() is None:
                    server.terminate()
                    server.wait(timeout=5)

    def test_default_desktop_launch_stops_server_when_client_exits(self) -> None:
        self._assert_join_stops_existing_managed_game([])

    def test_explicit_join_stops_server_when_client_exits(self) -> None:
        self._assert_join_stops_existing_managed_game(["--join"])

    def test_dedicated_launch_stops_server_when_local_client_exits(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "home"
            data_home = root / "data"
            runtime = root / "runtime"
            install = root / "install"
            config = home / ".config" / "openttd" / "openttd.cfg"
            save = data_home / "openttd" / "save" / "monagent-route.sav"
            record = root / "client-arguments.json"
            binary = install / "openttd"

            config.parent.mkdir(parents=True)
            config.write_text("[network]\nserver_name = test\n", encoding="utf-8")
            save.parent.mkdir(parents=True)
            save.write_bytes(b"save")
            install.mkdir(parents=True)
            binary.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import os
                    from pathlib import Path
                    import signal
                    import socket
                    import sys
                    import time

                    if "-D" in sys.argv:
                        game_port = int(sys.argv[sys.argv.index("-D") + 1].rsplit(":", 1)[1])
                        config = Path(sys.argv[sys.argv.index("-c") + 1])
                        values = {}
                        section = ""
                        for raw_line in config.read_text(encoding="utf-8").splitlines():
                            line = raw_line.strip()
                            if line.startswith("[") and line.endswith("]"):
                                section = line[1:-1]
                            elif section == "network" and "=" in line:
                                key, value = line.split("=", 1)
                                values[key.strip()] = value.strip()
                        admin_port = int(values["server_admin_port"])
                        listeners = []
                        for port in (game_port, admin_port):
                            listener = socket.socket()
                            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                            listener.bind(("127.0.0.1", port))
                            listener.listen()
                            listeners.append(listener)
                        for command in sys.stdin:
                            if command.strip() == "quit":
                                raise SystemExit(0)

                    Path(os.environ["MON_TEST_RECORD"]).write_text(
                        json.dumps(sys.argv[1:]), encoding="utf-8"
                    )
                    """
                ),
                encoding="utf-8",
            )
            binary.chmod(0o755)
            environment = os.environ.copy()
            environment.update(
                {
                    "HOME": str(home),
                    "XDG_DATA_HOME": str(data_home),
                    "XDG_RUNTIME_DIR": str(runtime),
                    "MON_OPENTTD_ROOT": str(install),
                    "MON_OPENTTD_BIN": str(binary),
                    "MON_OPENTTD_CONFIG": str(config),
                    "MON_TEST_RECORD": str(record),
                }
            )

            completed = subprocess.run(
                [str(LAUNCHER), "--dedicated"],
                env=environment,
                text=True,
                capture_output=True,
                timeout=15,
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            client_arguments = json.loads(record.read_text(encoding="utf-8"))
            self.assertEqual(client_arguments[0], "-n")
            self.assertTrue(client_arguments[1].startswith("127.0.0.1:"))
            self.assertFalse((runtime / "monagent-openttd" / "active-instance.json").exists())
            self.assertEqual(list((data_home / "openttd").glob(".monagent-instance-*.cfg")), [])

    def test_runtime_configs_share_persistent_content_and_import_legacy_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "home"
            data_home = root / "data"
            runtime = root / "runtime"
            install = root / "install"
            config = home / ".config" / "openttd" / "openttd.cfg"
            record = root / "launches.jsonl"
            binary = install / "openttd"

            config.parent.mkdir(parents=True)
            config.write_text("[network]\nserver_name = test\n", encoding="utf-8")
            install.mkdir(parents=True)
            binary.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json
                    import os
                    from pathlib import Path
                    import sys

                    config = Path(sys.argv[sys.argv.index("-c") + 1])
                    profile = config.parent
                    persistent_downloads = profile / "content_download" / "newgrf"
                    existed_before = (persistent_downloads / "downloaded.tar").exists()
                    persistent_downloads.mkdir(parents=True, exist_ok=True)
                    (persistent_downloads / "downloaded.tar").write_bytes(b"persistent")
                    value = {
                        "config_path": str(config),
                        "config_dir": str(profile),
                        "download_target": str((profile / "content_download").resolve()),
                        "existed_before": existed_before,
                        "links": {
                            name: {
                                "is_symlink": (profile / name).is_symlink(),
                                "target": str((profile / name).resolve()),
                            }
                            for name in os.environ["MON_TEST_CONTENT_DIRS"].split(":")
                        },
                    }
                    with Path(os.environ["MON_TEST_RECORD"]).open("a", encoding="utf-8") as output:
                        output.write(json.dumps(value) + "\\n")
                    """
                ),
                encoding="utf-8",
            )
            binary.chmod(0o755)

            legacy_download = (
                runtime
                / "monagent-openttd"
                / "instances"
                / "legacy"
                / "content_download"
                / "newgrf"
                / "legacy.tar"
            )
            legacy_download.parent.mkdir(parents=True)
            legacy_download.write_bytes(b"legacy")
            persistent_save = data_home / "openttd" / "save" / "monagent-route.sav"
            persistent_save.parent.mkdir(parents=True)
            persistent_save.write_bytes(b"stale")
            os.utime(persistent_save, ns=(1, 1))
            legacy_save = (
                runtime
                / "monagent-openttd"
                / "instances"
                / "legacy"
                / "save"
                / "monagent-route.sav"
            )
            legacy_save.parent.mkdir(parents=True)
            legacy_save.write_bytes(b"fresh")

            environment = os.environ.copy()
            environment.update(
                {
                    "HOME": str(home),
                    "XDG_DATA_HOME": str(data_home),
                    "XDG_RUNTIME_DIR": str(runtime),
                    "MON_OPENTTD_ROOT": str(install),
                    "MON_OPENTTD_BIN": str(binary),
                    "MON_OPENTTD_CONFIG": str(config),
                    "MON_TEST_RECORD": str(record),
                    "MON_TEST_CONTENT_DIRS": ":".join(CONTENT_DIRS),
                }
            )

            for _ in range(2):
                completed = subprocess.run(
                    [str(LAUNCHER)],
                    env=environment,
                    text=True,
                    capture_output=True,
                    timeout=15,
                    check=False,
                )
                self.assertEqual(
                    completed.returncode,
                    0,
                    f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
                )

            launches = [json.loads(line) for line in record.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(launches), 2)
            self.assertNotEqual(launches[0]["config_path"], launches[1]["config_path"])
            self.assertEqual(launches[0]["config_dir"], launches[1]["config_dir"])
            self.assertFalse(launches[0]["existed_before"])
            self.assertTrue(launches[1]["existed_before"])

            persistent_root = data_home / "openttd"
            expected_download_target = str((persistent_root / "content_download").resolve())
            self.assertEqual(launches[0]["download_target"], expected_download_target)
            self.assertEqual(launches[1]["download_target"], expected_download_target)
            self.assertEqual(
                (persistent_root / "content_download" / "newgrf" / "legacy.tar").read_bytes(),
                b"legacy",
            )
            self.assertEqual(
                (persistent_root / "content_download" / "newgrf" / "downloaded.tar").read_bytes(),
                b"persistent",
            )
            self.assertEqual(persistent_save.read_bytes(), b"fresh")
            self.assertTrue((persistent_root / ".monagent-runtime-content-migrated-v1").is_file())
            generated_configs = list(persistent_root.glob(".monagent-instance-*.cfg"))
            self.assertEqual(generated_configs, [])
            self.assertFalse((runtime / "monagent-openttd" / "active-instance.json").exists())

            for launch in launches:
                for name in CONTENT_DIRS:
                    link = launch["links"][name]
                    self.assertFalse(link["is_symlink"], name)
                    self.assertEqual(link["target"], str((persistent_root / name).resolve()), name)


if __name__ == "__main__":
    unittest.main()
