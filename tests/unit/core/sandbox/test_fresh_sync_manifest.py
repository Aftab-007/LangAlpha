"""A new sandbox's first sync diffs against what setup recorded.

Setup uploads the MCP server files, the shared packages and the token while the
registry connects, and its manifest records exactly those. The first sync then
sends only what is missing (the tool overlay, the skills), and a sync that does
not write the token file keeps its entry, so the next freshness check judges
the token actually on disk.
"""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ptc_agent.config.core import (
    CoreConfig,
    DaytonaConfig,
    FilesystemConfig,
    LoggingConfig,
    MCPConfig,
    SandboxConfig,
    SecurityConfig,
)
from ptc_agent.core.project_context import ProjectContext
from ptc_agent.core.sandbox.assets import token_manifest_entry
from ptc_agent.core.sandbox.migration import CURRENT_LAYOUT_VERSION
from ptc_agent.core.sandbox.runtime import SandboxRuntime

WORK_DIR = "/home/workspace"
PROJECT = ProjectContext("ws-1", "acme-ab12")
TOKENS = {
    "access_token": "gxsa_a",
    "refresh_token": "gxsr_r",
    "client_id": "c1",
    "expires_in": 3600,
}


async def _write_token(tokens, *, user_id=None, workspace_id=None) -> dict:
    return token_manifest_entry(tokens, user_id, workspace_id)


def _make_sandbox():
    from ptc_agent.core.sandbox.ptc_sandbox import PTCSandbox

    config = CoreConfig(
        sandbox=SandboxConfig(daytona=DaytonaConfig(api_key="test-key")),
        security=SecurityConfig(),
        mcp=MCPConfig(servers=[]),
        logging=LoggingConfig(),
        filesystem=FilesystemConfig(),
    )
    with patch("ptc_agent.core.sandbox.ptc_sandbox.create_provider"):
        sandbox = PTCSandbox(config=config)
    sandbox._work_dir = WORK_DIR
    sandbox.mcp_registry = MagicMock()
    sandbox._compute_tool_schema_hash = MagicMock(return_value="schema")
    runtime = AsyncMock(spec=SandboxRuntime)
    runtime.working_dir = WORK_DIR
    sandbox.runtime = runtime
    sandbox._wait_ready = AsyncMock()
    sandbox.ensure_sandbox_ready = AsyncMock()
    sandbox._prune_disabled_tool_modules = AsyncMock()
    sandbox._install_tool_modules = AsyncMock()
    sandbox._start_internal_mcp_servers = AsyncMock()
    sandbox._write_unified_manifest = AsyncMock()
    sandbox._cleanup_legacy_manifests = AsyncMock()
    sandbox._upload_mcp_server_files_impl = AsyncMock()
    sandbox._upload_internal_packages = AsyncMock()
    sandbox.upload_token_file = AsyncMock(side_effect=_write_token)
    sandbox._download_skills_lock = AsyncMock(return_value=None)
    sandbox._prune_remote_skills = AsyncMock()
    sandbox._upload_skills = AsyncMock(return_value=({}, set()))
    return sandbox


def _skill_dirs(tmp_path):
    skill = tmp_path / "skills" / "charting"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: charting\n---\nDraw.\n")
    return [(str(tmp_path / "skills"), f"{WORK_DIR}/.agents/skills")]


async def _setup_manifest(sandbox, *, token_written: bool = True) -> dict:
    if not token_written:
        sandbox.upload_token_file = AsyncMock(return_value=None)
    await sandbox.setup_tools_and_mcp(tokens=TOKENS, user_id="u1", workspace_id="ws-1")
    return sandbox._write_unified_manifest.await_args.args[0]


def _written(sandbox) -> dict:
    return sandbox._write_unified_manifest.await_args.args[0]


class TestSetupRecordsWhatIsOnDisk:
    @pytest.mark.asyncio
    async def test_setup_records_its_uploads_and_not_the_overlay(self):
        manifest = await _setup_manifest(_make_sandbox())

        modules = manifest["modules"]
        assert set(modules) == {"mcp_servers", "internal_packages", "tokens"}
        assert modules["tokens"]["user_id"] == "u1"
        assert modules["tokens"]["workspace_id"] == "ws-1"

    @pytest.mark.asyncio
    async def test_a_token_that_failed_to_upload_is_not_recorded(self):
        manifest = await _setup_manifest(_make_sandbox(), token_written=False)

        assert "tokens" not in manifest["modules"]


class TestTheFirstSyncDiffs:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("project", [PROJECT, None], ids=["folder", "root"])
    async def test_the_first_sync_sends_only_what_setup_did_not(self, tmp_path, project):
        sandbox = _make_sandbox()
        remote = await _setup_manifest(sandbox)
        sandbox._read_unified_manifest = AsyncMock(return_value=remote)
        for done_by_setup in (
            sandbox._write_unified_manifest,
            sandbox._upload_mcp_server_files_impl,
            sandbox._upload_internal_packages,
        ):
            done_by_setup.reset_mock()

        result = await sandbox.sync_sandbox_assets(
            reusing_sandbox=False, project=project, skill_dirs=_skill_dirs(tmp_path)
        )

        assert sorted(result.refreshed_modules) == ["skills", "tool_modules"]
        sandbox._upload_mcp_server_files_impl.assert_not_awaited()
        sandbox._upload_internal_packages.assert_not_awaited()
        sandbox._install_tool_modules.assert_awaited_once()
        sandbox._start_internal_mcp_servers.assert_awaited_once()
        sandbox._upload_skills.assert_awaited_once()
        # The entry setup wrote survives, so phase 2's check can skip the token.
        assert _written(sandbox)["modules"]["tokens"] == remote["modules"]["tokens"]

    @pytest.mark.asyncio
    async def test_an_unreadable_manifest_still_sends_everything(self, tmp_path):
        sandbox = _make_sandbox()
        sandbox._read_unified_manifest = AsyncMock(return_value=None)

        with patch(
            "ptc_agent.core.sandbox.assets.run_layout_migrations",
            AsyncMock(return_value=CURRENT_LAYOUT_VERSION),
        ):
            result = await sandbox.sync_sandbox_assets(
                reusing_sandbox=False, project=PROJECT, skill_dirs=_skill_dirs(tmp_path)
            )

        assert set(result.refreshed_modules) == {
            "mcp_servers",
            "internal_packages",
            "skills",
            "tool_modules",
        }


class TestTheTokenEntryDescribesTheFile:
    @staticmethod
    async def _remote(sandbox, *, minted_at: float) -> dict:
        manifest = await sandbox._compute_sandbox_manifest()
        manifest["modules"]["tokens"] = {
            **token_manifest_entry(TOKENS, "u1", "ws-1"),
            "minted_at": minted_at,
        }
        return manifest

    @pytest.mark.asyncio
    async def test_a_fresh_token_is_neither_uploaded_nor_restamped(self):
        sandbox = _make_sandbox()
        minted = time.time() - 60
        sandbox._read_unified_manifest = AsyncMock(
            return_value=await self._remote(sandbox, minted_at=minted)
        )

        result = await sandbox.sync_sandbox_assets(
            reusing_sandbox=True, project=PROJECT, tokens=TOKENS, user_id="u1"
        )

        sandbox.upload_token_file.assert_not_awaited()
        assert "tokens" not in result.refreshed_modules
        # Restamping would make the old token on disk look new.
        assert _written(sandbox)["modules"]["tokens"]["minted_at"] == minted

    @pytest.mark.asyncio
    async def test_a_failed_upload_drops_the_entry(self):
        sandbox = _make_sandbox()
        sandbox._read_unified_manifest = AsyncMock(
            return_value=await self._remote(sandbox, minted_at=0)
        )
        sandbox.upload_token_file = AsyncMock(return_value=None)

        result = await sandbox.sync_sandbox_assets(
            reusing_sandbox=True, project=PROJECT, tokens=TOKENS, user_id="u1"
        )

        sandbox.upload_token_file.assert_awaited_once()
        assert "tokens" not in result.refreshed_modules
        assert "tokens" not in _written(sandbox)["modules"]

    @pytest.mark.asyncio
    async def test_a_written_token_is_stamped_now(self):
        sandbox = _make_sandbox()
        sandbox._read_unified_manifest = AsyncMock(
            return_value=await self._remote(sandbox, minted_at=0)
        )

        result = await sandbox.sync_sandbox_assets(
            reusing_sandbox=True, project=PROJECT, tokens=TOKENS, user_id="u1"
        )

        assert "tokens" in result.refreshed_modules
        assert _written(sandbox)["modules"]["tokens"]["minted_at"] > time.time() - 60
