"""Where an automation's turn runs: the row it names, routed as any turn's."""

from unittest.mock import AsyncMock, patch

import pytest

from src.server.database.home_workspace import get_flash_workspace_id
from src.server.services.automation_executor import _turn_workspace
from src.server.services.turn_runtime import turn_route

_USER = "user-1"
_WS = "11111111-1111-1111-1111-111111111111"
_THREAD = "22222222-2222-2222-2222-222222222222"
_HOME = get_flash_workspace_id(_USER)
_PROJECT = {"workspace_id": _WS, "user_id": _USER, "status": "running"}
_FLASH_ROW = {"workspace_id": _HOME, "user_id": _USER, "status": "flash"}


def _automation(**overrides):
    return {
        "user_id": _USER,
        "agent_mode": "flash",
        "workspace_id": None,
        "thread_strategy": "continue",
        "conversation_thread_id": _THREAD,
        **overrides,
    }


async def _route(automation, *, thread_meta=None, workspace=None):
    with (
        patch(
            "src.server.database.conversation.get_thread_auth_meta",
            new=AsyncMock(return_value=thread_meta),
        ),
        patch(
            "src.server.database.workspace.get_workspace",
            new=AsyncMock(return_value=workspace),
        ),
    ):
        route = turn_route(_USER, await _turn_workspace(automation))
    return route.workspace_id, route.role


@pytest.mark.asyncio
async def test_continuing_a_workspace_thread_runs_that_workspaces_analyst():
    assert await _route(
        _automation(),
        thread_meta={"user_id": _USER, "workspace_id": _WS},
        workspace=_PROJECT,
    ) == (_WS, "analyst")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "automation, thread_meta",
    [
        (_automation(), {"user_id": _USER, "workspace_id": _HOME}),
        (_automation(conversation_thread_id=None), None),
        (_automation(thread_strategy="new"), {"user_id": _USER, "workspace_id": _WS}),
    ],
    ids=["home-thread", "not-pinned-yet", "new-thread-each-run"],
)
async def test_any_other_flash_firing_runs_in_home(automation, thread_meta):
    assert await _route(
        automation, thread_meta=thread_meta, workspace=_FLASH_ROW
    ) == (_HOME, "chief_of_staff")


@pytest.mark.asyncio
async def test_a_thread_another_account_holds_fails_the_firing():
    """The turn would run on that thread wherever it was routed."""
    with pytest.raises(ValueError, match="another account"):
        await _route(
            _automation(),
            thread_meta={"user_id": "someone-else", "workspace_id": _WS},
            workspace=_PROJECT,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "workspace, expected",
    [(_PROJECT, (_WS, "analyst")), (_FLASH_ROW, (_HOME, "chief_of_staff"))],
    ids=["workspace", "chief-of-staff-home"],
)
async def test_a_ptc_firing_runs_in_its_stored_workspace(workspace, expected):
    automation = _automation(
        agent_mode="ptc", workspace_id=workspace["workspace_id"]
    )
    assert await _route(automation, workspace=workspace) == expected


@pytest.mark.asyncio
async def test_a_ptc_firing_whose_workspace_is_gone_fails_before_any_thread():
    with pytest.raises(ValueError, match="may have been deleted"):
        await _route(_automation(agent_mode="ptc", workspace_id=_WS), workspace=None)
