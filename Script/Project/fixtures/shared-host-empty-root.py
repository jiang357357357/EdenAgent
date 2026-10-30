"""A disposable base Linux filesystem: POSIX shell/OS libraries, no application runtimes."""
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import signal
import time

operation, location, node_for_libraries = sys.argv[1:]
root = Path(location).resolve()
if not re.fullmatch(r"/tmp/eden-shared-empty-[a-f0-9-]{36}", str(root)):
    raise RuntimeError("Invalid disposable root")

if operation == "remove":
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        for entry in Path('/proc').iterdir():
            if not entry.name.isdecimal():
                continue
            try:
                if os.readlink(entry / 'root') == str(root):
                    os.kill(int(entry.name), sig)
            except (FileNotFoundError, PermissionError, ProcessLookupError):
                pass
        time.sleep(0.2)
    # Never recursively remove a live proc mount, even if cleanup is interrupted.
    for name in ["proc", "dev/null"]:
        if subprocess.run(["mountpoint", "-q", str(root / name)]).returncode == 0:
            subprocess.run(["umount", str(root / name)], check=True)
        if subprocess.run(["mountpoint", "-q", str(root / name)]).returncode == 0:
            raise RuntimeError("Refusing to remove a live fixture mount")
    if root.exists():
        shutil.rmtree(root)
    sys.exit(0)

if operation != "create" or root.exists():
    raise RuntimeError("Disposable root already exists")
root.mkdir(mode=0o700)
for name in ["bin", "usr/bin", "root", "etc", "dev", "tmp", "proc"]:
    (root / name).mkdir(parents=True, exist_ok=True)
os.chmod(root / "root", 0o700)
os.chmod(root / "tmp", 0o1777)

def copy_file(source):
    destination = root / source.lstrip("/")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination, follow_symlinks=True)

for binary in ["/bin/sh", "/usr/bin/uname", node_for_libraries]:
    if binary != node_for_libraries:
        copy_file(binary)
    output = subprocess.check_output(["ldd", binary], text=True)
    for line in output.splitlines():
        for value in line.split():
            if value.startswith("/"):
                if binary == node_for_libraries and ('libstdc++' in value or 'libgcc_s' in value):
                    continue
                copy_file(value)

(root / "etc/passwd").write_text("root:x:0:0:root:/root:/bin/sh\n")
(root / "etc/group").write_text("root:x:0:\n")
os.mknod(root / "dev/null", stat.S_IFCHR | 0o666, os.makedev(1, 3))
subprocess.run(["mount", "--bind", "/dev/null", str(root / "dev/null")], check=True)
subprocess.run(["mount", "--bind", "/proc", str(root / "proc")], check=True)
subprocess.run(["mount", "-o", "remount,bind,ro", str(root / "proc")], check=True)
for name in ["node", "nodejs", "monpm", "curl", "wget", "tar", "gzip", "go", "python3"]:
    if (root / "usr/bin" / name).exists() or (root / "bin" / name).exists():
        raise RuntimeError("Fixture unexpectedly contains application tools")
print("Created base Linux filesystem without Node, MonPM or download tools")
