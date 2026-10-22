"""The deployment's key line on a machine, and how each start keeps it current.

The converge script runs here against a real file, since its whole job is
leaving the account's other keys exactly as they were while it rewrites ours.
"""

import subprocess
import sys

import pytest

from ptc_agent.config.core import SSHConfig
from ptc_agent.core.sandbox.providers._ssh_authorized_key import (
    admits,
    authorized_key_line,
    converge_script,
)

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX shell")

_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl langalpha"
_OTHERS = [
    "ssh-rsa AAAAold old@host",
    'from="198.51.100.4" ssh-ed25519 AAAAmine me@laptop',
]


def _converge(home, line: str) -> str:
    run = subprocess.run(
        ["sh", "-c", converge_script(line)],
        env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        check=True,
    )
    return run.stdout.strip()


def _keys(home, *lines: str):
    path = home / ".ssh" / "authorized_keys"
    path.parent.mkdir(exist_ok=True)
    path.write_text("".join(f"{line}\n" for line in lines))
    path.chmod(0o600)
    return path


class TestConverge:
    @pytest.mark.parametrize(
        "stale",
        [[_KEY], [authorized_key_line(_KEY), authorized_key_line(_KEY, ["192.0.2.1"])]],
        ids=["bare", "two-older-lines"],
    )
    def test_our_lines_become_the_one_current_line_and_the_rest_stay(
        self, tmp_path, stale
    ):
        line = authorized_key_line(_KEY, ["203.0.113.7"])
        path = _keys(tmp_path, _OTHERS[0], *stale, _OTHERS[1])

        assert _converge(tmp_path, line) == "updated"
        assert path.read_text() == "".join(f"{x}\n" for x in [*_OTHERS, line])
        assert path.stat().st_mode & 0o777 == 0o600
        assert _converge(tmp_path, line) == "current"

    def test_a_file_grep_reads_as_binary_keeps_every_other_line(self, tmp_path):
        """A NUL byte has grep print "Binary file matches", or stop there, and
        exit 0, which once replaced every other key with that."""
        path = _keys(tmp_path, _OTHERS[0])
        path.write_bytes(
            path.read_bytes()
            + f"bad\0paste\n{authorized_key_line(_KEY)}\n{_OTHERS[1]}".encode()
        )
        line = authorized_key_line(_KEY, ["203.0.113.7"])

        assert _converge(tmp_path, line) == "updated"
        assert path.read_bytes() == (
            f"{_OTHERS[0]}\nbad\0paste\n{_OTHERS[1]}\n{line}\n".encode()
        )

    @pytest.mark.parametrize(
        "theirs",
        [
            f"no-port-forwarding,no-agent-forwarding,no-X11-forwarding {_KEY}",
            f'from="203.0.113.7",command="true",no-agent-forwarding,no-X11-forwarding {_KEY}',
            f"# {authorized_key_line(_KEY)}",
        ],
        ids=["narrowed", "options-inside-from", "commented-out"],
    )
    def test_a_line_the_owner_changed_is_theirs(self, tmp_path, theirs):
        path = _keys(tmp_path, _OTHERS[0], theirs)

        assert _converge(tmp_path, authorized_key_line(_KEY, ["203.0.113.7"])) == (
            "skipped"
        )
        assert path.read_text() == f"{_OTHERS[0]}\n{theirs}\n"

    def test_a_file_without_our_key_is_left_alone(self, tmp_path):
        """The login came by another file sshd reads, which is not ours to edit."""
        path = _keys(tmp_path, *_OTHERS)

        assert _converge(tmp_path, authorized_key_line(_KEY)) == "absent"
        assert path.read_text() == "".join(f"{x}\n" for x in _OTHERS)

    def test_a_linked_file_is_left_alone(self, tmp_path):
        """Replacing it would cut the link to whatever manages the real one."""
        real = _keys(tmp_path, _KEY)
        link = tmp_path / ".ssh" / "linked"
        real.rename(link)
        real.symlink_to(link)

        assert _converge(tmp_path, authorized_key_line(_KEY)) == "skipped"
        assert link.read_text() == f"{_KEY}\n"
        assert real.is_symlink()


class TestAdmits:
    @pytest.mark.parametrize(
        "login_from,address,admitted",
        [
            ([], "198.51.100.9", True),
            (["203.0.113.7"], "203.0.113.7", True),
            (["203.0.113.0/24"], "203.0.113.200", True),
            (["203.0.113.7"], "::ffff:203.0.113.7", True),
            (["203.0.113.7"], "127.0.0.1", True),
            (["203.0.113.7"], "::1", True),
            (["2001:db8::/32"], "2001:db8::5%eth0", True),
            (["203.0.113.7"], "203.0.113.8", False),
            (["203.0.113.7"], "", False),
        ],
        ids=[
            "unset",
            "listed",
            "in-network",
            "v4-mapped",
            "tunnel-v4",
            "tunnel-v6",
            "zoned",
            "unlisted",
            "unknown",
        ],
    )
    def test_a_line_admits_what_sshd_would(self, login_from, address, admitted):
        assert admits(login_from, address) is admitted


class TestLine:
    def test_unset_carries_only_the_forwarding_options(self):
        assert (
            authorized_key_line(_KEY) == f"no-agent-forwarding,no-X11-forwarding {_KEY}"
        )

    def test_set_admits_the_machine_itself_for_its_tunnel(self):
        assert authorized_key_line(_KEY, ["203.0.113.7"]).startswith(
            'from="203.0.113.7,127.0.0.1,::1",'
        )

    @pytest.mark.parametrize(
        "public_key,login_from",
        [
            (f"{_KEY}\nssh-rsa AAAAx", ()),
            (f'command="sh" {_KEY}', ()),
            (_KEY, ['203.0.113.7",command="sh']),
        ],
        ids=["two-lines", "options-in-the-key", "quote-in-a-source"],
    )
    def test_anything_sshd_would_read_as_more_is_refused(self, public_key, login_from):
        with pytest.raises(ValueError):
            authorized_key_line(public_key, login_from)


class TestSetting:
    def test_sources_are_normalized_as_sshd_matches_them(self):
        config = SSHConfig(
            login_from=[
                "203.0.113.7/32",
                " 203.0.113.7",
                "198.51.100.5/24",
                "2001:db8::1",
            ]
        )

        assert config.login_from == ["203.0.113.7", "198.51.100.0/24", "2001:db8::1"]

    def test_a_host_name_is_refused(self):
        """sshd does not resolve clients by name unless told to, so it would never match."""
        with pytest.raises(ValueError, match="not an IP address or network"):
            SSHConfig(login_from=["egress.example.com"])
