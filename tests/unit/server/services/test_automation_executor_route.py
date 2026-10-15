"""Where an automation's turn runs: the row it names, routed as any turn's."""

from unittest.mock import AsyncMock, patch

import pytest

from src.server.database.home_workspace import get_flash_workspace_id
from src.server.services.automation_executor import AutomationExecutor, _Place, _turn_place
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
        route = turn_route(_USER, (await _turn_place(automation)).workspace)
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



# One rule for every row: the pinned thread's workspace first, then the row's.

_OTHER_WS = "33333333-3333-3333-3333-333333333333"
_OTHER = {"workspace_id": _OTHER_WS, "user_id": _USER, "status": "running"}


async def _place_by_id(automation, *, thread_meta, rows):
    """As ``_route``, with each workspace read answered by its id, and the
    thread the run continues (None starts one)."""
    with (
        patch(
            "src.server.database.conversation.get_thread_auth_meta",
            new=AsyncMock(return_value=thread_meta),
        ),
        patch(
            "src.server.database.workspace.get_workspace",
            new=AsyncMock(side_effect=lambda ws_id: rows.get(ws_id)),
        ),
    ):
        place = await _turn_place(automation)
    route = turn_route(_USER, place.workspace)
    return route.workspace_id, route.role, place.thread_id


@pytest.mark.asyncio
@pytest.mark.parametrize("stored", [_WS, _HOME], ids=["workspace", "home"])
async def test_a_pinned_thread_runs_in_its_own_workspace_not_the_stored_one(stored):
    """A turn sent elsewhere would run apart from the thread's files."""
    automation = _automation(agent_mode="ptc", workspace_id=stored)
    rows = {_WS: _PROJECT, _HOME: _FLASH_ROW, _OTHER_WS: _OTHER}
    assert await _place_by_id(
        automation,
        thread_meta={"user_id": _USER, "workspace_id": _OTHER_WS},
        rows=rows,
    ) == (_OTHER_WS, "analyst", _THREAD)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "automation, expected",
    [
        (_automation(agent_mode="flash", workspace_id=_WS), (_HOME, "chief_of_staff")),
        (_automation(agent_mode="ptc", workspace_id=_WS), (_WS, "analyst")),
        (_automation(agent_mode="ptc", workspace_id=_HOME), (_HOME, "chief_of_staff")),
    ],
    ids=["legacy-flash-row", "workspace-row", "home-row"],
)
async def test_a_pinned_thread_whose_workspace_was_deleted_starts_one_where_the_row_lives(
    automation, expected
):
    """The deleted workspace keeps its thread; the automation runs on."""
    assert await _place_by_id(
        automation,
        thread_meta={"user_id": _USER, "workspace_id": _OTHER_WS},
        rows={_WS: _PROJECT, _HOME: _FLASH_ROW},
    ) == (*expected, None)


@pytest.mark.asyncio
async def test_a_deleted_pin_beside_a_deleted_workspace_still_fails():
    automation = _automation(agent_mode="ptc", workspace_id=_WS)
    with pytest.raises(ValueError, match="may have been deleted"):
        await _place_by_id(
            automation,
            thread_meta={"user_id": _USER, "workspace_id": _OTHER_WS},
            rows={_HOME: _FLASH_ROW},
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "automation, expected",
    [
        (_automation(agent_mode="flash", workspace_id=_WS), (_HOME, "chief_of_staff")),
        (_automation(agent_mode="ptc", workspace_id=_WS), (_WS, "analyst")),
    ],
    ids=["legacy-flash-row", "workspace-row"],
)
async def test_a_pinned_thread_that_is_gone_is_made_again_where_the_row_lives(automation, expected):
    assert await _place_by_id(
        automation, thread_meta=None, rows={_WS: _PROJECT, _HOME: _FLASH_ROW}
    ) == (*expected, _THREAD)


@pytest.mark.asyncio
async def test_a_run_that_leaves_its_pin_behind_pins_the_thread_it_starts():
    """So the next run continues the new thread, not the deleted workspace's."""
    executor = AutomationExecutor()
    automation = _automation(agent_mode="ptc", workspace_id=_WS, automation_id="auto-1")
    with (
        patch("src.server.services.automation_executor.auto_db") as auto_db,
        patch.object(executor, "_precreate_titled_thread", new=AsyncMock()),
    ):
        auto_db.update_automation = AsyncMock()
        thread_id = await executor._resolve_thread(automation, _Place(_PROJECT, None), _WS)

    assert thread_id != _THREAD
    auto_db.update_automation.assert_awaited_once_with(
        "auto-1", _USER, conversation_thread_id=thread_id
    )
