"""The sandbox-side authoritative merge must match lock.py's merge_lock_files.

The asset-sync path used to compute merge_lock_files on the host from a stale
lock snapshot and blind-upload the result; the ``install`` script mode
re-reads under the reconciler's flock instead. Its merge logic is a
deliberate inline copy of the lock.py predicates, so this test binds the two:
for any lock state, script merge == host merge — plus the one divergence the
script adds on purpose (a racing agent/linked claim on an authoritative name
keeps the claim and reports it, rather than being overwritten). Nothing is
staged here, so the install is the merge alone; the command the host builds
runs for real in a subprocess.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
from types import SimpleNamespace

import pytest

from ptc_agent.agent.middleware.skills.lock import (
    LOCK_FILE_VERSION,
    merge_lock_files,
)
from ptc_agent.core.sandbox import skill_sync


class _ShellSandbox:
    """Runs the command the host builds, on this machine's own filesystem."""

    def __init__(self) -> None:
        self.runtime = self

    async def exec(self, command: str, *args, **kwargs):
        proc = subprocess.run(
            command, shell=True, capture_output=True, text=True, check=False
        )
        return SimpleNamespace(
            stdout=proc.stdout, stderr=proc.stderr, exit_code=proc.returncode
        )

    async def _runtime_call(self, fn, *args, retry_policy=None, **kwargs):
        return await fn(*args, **kwargs)


def _run_merge(tmp_path, entries: dict, auth: dict) -> tuple[dict, dict]:
    """Run an install with nothing staged against a real lock file in
    tmp_path; returns (result, lock_file_on_disk)."""
    lock_path = tmp_path / "skills-lock.json"
    lock_path.write_text(
        json.dumps({"version": LOCK_FILE_VERSION, "skills": entries})
    )
    merged, skipped = asyncio.run(
        skill_sync.install_staged_skills(
            _ShellSandbox(),
            str(tmp_path / ".staging" / "sync-test"),
            [],
            auth,
            base=str(tmp_path),
        )
    )
    payload = {"skills": merged["skills"], "skipped": skipped}
    return payload, json.loads(lock_path.read_text())


_AGENT = {"owner": "user", "sourceType": "agent"}
_LINKED = {
    "owner": "user",
    "sourceType": "langalpha-user",
    "sync": {"linkedSkillId": "abc"},
}
_PLATFORM_OLD = {"owner": "platform", "sourceType": "langalpha"}
_PLATFORM_NEW = {"owner": "platform", "sourceType": "langalpha", "v": 2}
_MANAGED = {"owner": "user", "sourceType": "langalpha-user"}


def test_script_merge_matches_host_merge(tmp_path):
    entries = {
        "agent-skill": _AGENT,
        "linked-skill": _LINKED,
        "stale-platform": _PLATFORM_OLD,
        "managed-old": _MANAGED,
    }
    auth = {"fresh-platform": _PLATFORM_NEW, "managed-old": _MANAGED}

    payload, on_disk = _run_merge(tmp_path, entries, auth)
    host = merge_lock_files(auth, entries)

    assert payload["skills"] == host["skills"]
    assert on_disk == {"version": LOCK_FILE_VERSION, "skills": host["skills"]}
    assert payload["skipped"] == []
    # Stale platform + managed entries purged, protected owners preserved.
    assert set(payload["skills"]) == {
        "agent-skill",
        "linked-skill",
        "fresh-platform",
        "managed-old",
    }


def test_racing_protected_claim_keeps_the_claim_and_reports_it(tmp_path):
    # The one deliberate divergence from merge_lock_files: an agent/linked
    # entry that appeared under an authoritative name since the caller's
    # snapshot wins the lock entry; the reconciler arbitrates the bytes.
    entries = {"contested": _AGENT}
    auth = {"contested": _PLATFORM_NEW, "other": _PLATFORM_NEW}

    payload, on_disk = _run_merge(tmp_path, entries, auth)

    assert payload["skipped"] == ["contested"]
    assert payload["skills"]["contested"] == _AGENT
    assert payload["skills"]["other"] == _PLATFORM_NEW
    assert on_disk["skills"] == payload["skills"]


def test_empty_authoritative_set_purges_only_unprotected(tmp_path):
    entries = {"agent-skill": _AGENT, "stale-platform": _PLATFORM_OLD}
    payload, _ = _run_merge(tmp_path, entries, {})
    assert set(payload["skills"]) == {"agent-skill"}


@pytest.mark.parametrize("occupant", ["symlink", "file"])
def test_install_over_a_non_dir_name_leaves_no_trash(tmp_path, occupant):
    """A link or file an agent left at a skill's name is replaced, not kept as trash."""
    if occupant == "symlink":
        (tmp_path / "elsewhere").mkdir()
        (tmp_path / "pdf").symlink_to(tmp_path / "elsewhere")
    else:
        (tmp_path / "pdf").write_text("not a skill")
    staged = tmp_path / ".staging" / "sync-test" / "pdf"
    staged.mkdir(parents=True)
    (staged / "SKILL.md").write_text("new")
    asyncio.run(
        skill_sync.install_staged_skills(
            _ShellSandbox(),
            str(tmp_path / ".staging" / "sync-test"),
            ["pdf"],
            {"pdf": _PLATFORM_NEW},
            base=str(tmp_path),
        )
    )
    assert not (tmp_path / "pdf").is_symlink()
    assert (tmp_path / "pdf" / "SKILL.md").read_text() == "new"
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".trash-")]
