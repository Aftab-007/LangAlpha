"""A computer's stop ends its MCP supervisor however that was started.

Run here against real processes, since the script's whole job is matching the
machine's process table. The generated client starts the supervisor in a
session of its own, which no exec record names, and that one outlived every
stop and delete of its computer.
"""

import os
import subprocess
import sys
import time

import pytest

from ptc_agent.core.sandbox.providers._ssh_shell import stop_script

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX shell")

# Stands in for the supervisor: an MCP server in a group of its own, in the
# supervisor's session, as the daemon spawns them.
_SUPERVISOR = """\
import subprocess, sys, time
server = subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(60)"], process_group=0
)
print(server.pid, flush=True)
time.sleep(60)
"""


def _start_supervisor(src, root) -> tuple[subprocess.Popen, int]:
    proc = subprocess.Popen(
        [sys.executable, "-m", "supervisor", str(root)],
        cwd=src,
        env={**os.environ, "PYTHONPATH": str(src)},
        stdout=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    return proc, int(proc.stdout.readline())


def _gone(pid: int, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(0.05)
    return False


def test_a_supervisor_in_its_own_session_ends_with_its_computer(tmp_path):
    src = tmp_path / "src"
    (src / "supervisor").mkdir(parents=True)
    (src / "supervisor" / "__main__.py").write_text(_SUPERVISOR)
    cdir = tmp_path / "computers" / "c1"
    cdir.mkdir(parents=True)
    root = tmp_path / "root"
    other_root = tmp_path / "root-other"

    supervisor, server = _start_supervisor(src, root)
    neighbour, neighbours_server = _start_supervisor(src, other_root)
    try:
        subprocess.run(
            [
                "bash",
                "-c",
                stop_script(str(cdir), root=False, computer_root=str(root)),
            ],
            check=True,
            timeout=30,
        )

        assert supervisor.wait(timeout=5) is not None
        assert _gone(server)
        assert neighbour.poll() is None
        assert not _gone(neighbours_server, timeout=0)
        assert (cdir / "state").read_text().strip() == "stopped"
    finally:
        for proc, child in ((supervisor, server), (neighbour, neighbours_server)):
            for pid in (child, proc.pid):
                try:
                    os.kill(pid, 9)
                except ProcessLookupError:
                    pass
            proc.wait(timeout=5)
            proc.stdout.close()
