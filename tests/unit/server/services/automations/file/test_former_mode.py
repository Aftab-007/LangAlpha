"""The former agent_mode a file may still carry from older notes: "flash" reads
as workspace_id "home" whatever workspace_id says, as the lifecycle reads a
'flash' row, so it reaches the lifecycle as Home's id with no mode; "ptc"
changes nothing. It is read, but not offered among the fields."""

from __future__ import annotations

from uuid import UUID

import pytest

from src.server.services.automations import file, lifecycle
from tests.unit.server.services.automations.file._support import (
    BRIEF,
    CREATED,
    HOME,
    NEW,
    WORKSPACE,
    _create,
    _row,
    _shown,
    _write,
)


def test_the_former_mode_is_not_offered_among_the_fields():
    assert "agent_mode" not in file._ALLOWED.split(", ")


class TestFormerModeOnCreate:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "written",
        [
            {"agent_mode": "flash"},
            {"agent_mode": "flash", "workspace_id": None},
            {"agent_mode": "flash", "workspace_id": WORKSPACE},
        ],
        ids=["flash", "with-a-null-workspace", "beside-a-workspace"],
    )
    async def test_the_former_home_mode_reaches_the_lifecycle_as_homes_id(self, db, backend, written):
        await _create(backend, {**NEW, **written})

        data = lifecycle.create_automation.await_args.args[1]
        assert data.workspace_id == UUID(HOME)
        assert "agent_mode" not in data.model_fields_set
        row = db.rows[CREATED]
        assert (row["agent_mode"], row["workspace_id"]) == ("ptc", UUID(HOME))

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("written", "stored"),
        [
            ({"agent_mode": "ptc"}, WORKSPACE),
            ({"agent_mode": "ptc", "workspace_id": "home"}, HOME),
            ({"workspace_id": HOME}, HOME),
        ],
        ids=["ptc-changes-nothing", "ptc-with-home", "homes-id"],
    )
    async def test_a_written_workspace_or_the_callers_is_stored(self, db, backend, written, stored):
        await _create(backend, {**NEW, **written})

        row = db.rows[CREATED]
        assert (row["agent_mode"], row["workspace_id"]) == ("ptc", UUID(stored))


class TestFormerModeOnUpdate:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "written",
        [
            {"agent_mode": "flash", "workspace_id": None},
            # An agent adds the mode to the file it read, workspace_id and all.
            {"agent_mode": "flash"},
        ],
        ids=["with-a-null-workspace", "beside-the-shown-workspace"],
    )
    async def test_the_former_home_mode_moves_a_workspace_automation_to_home(self, db, backend, written):
        db.add(_row(workspace_id=UUID(WORKSPACE)))
        entry = _shown(db.list()[0])
        assert entry["workspace_id"] == WORKSPACE

        report = await _write(backend, {**entry, **written})

        assert lifecycle.update_automation.await_args.args[2] == {"workspace_id": UUID(HOME)}
        assert (db.rows[BRIEF]["agent_mode"], db.rows[BRIEF]["workspace_id"]) == ("ptc", UUID(HOME))
        assert ": workspace_id" in report

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "written",
        [{"agent_mode": "flash"}, {"agent_mode": "flash", "workspace_id": None}],
        ids=["beside-home", "with-a-null-workspace"],
    )
    async def test_the_former_home_mode_on_an_automation_in_home_changes_nothing(self, db, backend, written):
        db.add(_row())
        entry = _shown(db.list()[0])

        await _write(backend, {**entry, **written})

        lifecycle.update_automation.assert_not_awaited()
