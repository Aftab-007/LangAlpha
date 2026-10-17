"""Home in an automation's file: "home" in workspace_id, both ways. A row in
Home, or one a former build stored as 'flash', reads "home"; a written "home"
is Home's id, which an analyst in a workspace never sees."""

from __future__ import annotations

from uuid import UUID

import pytest

from src.server.services.automations import lifecycle
from tests.unit.server.services.automations.file._support import (
    BRIEF,
    BRIEF_FILE,
    CREATED,
    FILE_NAME,
    HOME,
    NEW,
    NEW_PATH,
    PINNED,
    THREAD,
    WORKSPACE,
    _create,
    _refusal,
    _row,
    _shown,
    _write,
)

_IN_HOME = [
    _row(),
    _row(agent_mode="flash", workspace_id=None),
    _row(agent_mode="flash", workspace_id=UUID(WORKSPACE)),
]
_IN_HOME_IDS = ["homes-id", "former-flash", "former-flash-naming-a-workspace"]

_NOT_THE_KEYWORD = ["HOME", "Home", " home", "workspace"]


class TestRead:
    @pytest.mark.parametrize("row", _IN_HOME, ids=_IN_HOME_IDS)
    def test_a_row_in_home_reads_home(self, row):
        entry = _shown(row)

        assert entry["workspace_id"] == "home"
        assert "agent_mode" not in entry

    def test_a_row_in_a_workspace_reads_its_id(self):
        assert _shown(_row(workspace_id=UUID(WORKSPACE)))["workspace_id"] == WORKSPACE

    @pytest.mark.parametrize("stored", [None, UUID(WORKSPACE)], ids=["no-workspace", "naming-a-workspace"])
    def test_a_former_flash_row_and_the_same_row_in_home_are_one_version(self, stored):
        """A save that normalizes the row must not conflict with the agent's read."""
        _, former = BRIEF_FILE.render(_row(agent_mode="flash", workspace_id=stored))
        _, moved = BRIEF_FILE.render(_row(agent_mode="ptc", workspace_id=UUID(HOME)))

        assert former == moved


class TestCreate:
    @pytest.mark.asyncio
    async def test_home_reaches_the_lifecycle_as_homes_id(self, db, backend):
        await _create(backend, {**NEW, "workspace_id": "home"})

        data = lifecycle.create_automation.await_args.args[1]
        assert data.workspace_id == UUID(HOME)
        assert "agent_mode" not in data.model_fields_set
        row = db.rows[CREATED]
        assert (row["agent_mode"], row["workspace_id"]) == ("ptc", UUID(HOME))
        assert _shown(row)["workspace_id"] == "home"

    @pytest.mark.parametrize("written", _NOT_THE_KEYWORD)
    @pytest.mark.asyncio
    async def test_another_string_is_refused_as_no_uuid(self, db, backend, written):
        error = await _refusal(backend, db, {**NEW, "workspace_id": written}, path=NEW_PATH)

        [(path, message)] = error.problems
        assert path == "workspace_id"
        assert message.startswith("Input should be a valid UUID")


class TestUpdate:
    @pytest.mark.parametrize("row", _IN_HOME, ids=_IN_HOME_IDS)
    @pytest.mark.asyncio
    async def test_writing_back_a_home_automation_as_read_changes_nothing(self, db, backend, row):
        db.add(row)
        entry = _shown(db.list()[0])

        report = await _write(backend, entry)

        assert report.startswith("No changes")
        lifecycle.update_automation.assert_not_awaited()
        assert db.writes == []

    @pytest.mark.asyncio
    async def test_another_edit_to_a_former_flash_row_stores_it_in_home(self, db, backend):
        """The lifecycle's normalization, not a workspace change the file asked for."""
        db.add(_row(agent_mode="flash", workspace_id=None))
        entry = _shown(db.list()[0])

        await _write(backend, {**entry, "instruction": "Summarize the news."})

        assert lifecycle.update_automation.await_args.args[2] == {"instruction": "Summarize the news."}
        assert (db.rows[BRIEF]["agent_mode"], db.rows[BRIEF]["workspace_id"]) == ("ptc", UUID(HOME))

    @pytest.mark.asyncio
    async def test_home_moves_a_workspace_automation_to_home(self, db, backend):
        db.add(_row(workspace_id=UUID(WORKSPACE)))
        entry = _shown(db.list()[0])

        report = await _write(backend, {**entry, "workspace_id": "home"})

        assert lifecycle.update_automation.await_args.args[2] == {"workspace_id": UUID(HOME)}
        assert (db.rows[BRIEF]["agent_mode"], db.rows[BRIEF]["workspace_id"]) == ("ptc", UUID(HOME))
        assert ": workspace_id" in report

    @pytest.mark.parametrize("row", _IN_HOME, ids=_IN_HOME_IDS)
    @pytest.mark.asyncio
    async def test_a_workspace_id_moves_a_home_automation_there(self, db, backend, row):
        db.add(row)
        entry = _shown(db.list()[0])

        await _write(backend, {**entry, "workspace_id": WORKSPACE})

        assert (db.rows[BRIEF]["agent_mode"], db.rows[BRIEF]["workspace_id"]) == ("ptc", UUID(WORKSPACE))

    @pytest.mark.parametrize("written", _NOT_THE_KEYWORD)
    @pytest.mark.asyncio
    async def test_another_string_is_refused_as_no_uuid(self, db, backend, written):
        db.add(_row())
        entry = _shown(db.list()[0])

        error = await _refusal(backend, db, {**entry, "workspace_id": written})

        [(path, message)] = error.problems
        assert path == "workspace_id"
        assert message.startswith("Input should be a valid UUID")


class TestMoveUnpinsTheThread:
    """A pinned thread decides where each run happens, so a move that names
    no thread unpins it (``lifecycle.update_automation``)."""

    @pytest.mark.asyncio
    async def test_a_moved_automation_continuing_a_conversation_reports_the_thread(self, db, backend):
        db.add(_row(workspace_id=UUID(WORKSPACE), thread_strategy="continue", conversation_thread_id=UUID(PINNED)))
        entry = _shown(db.list()[0])
        assert entry["thread"] == PINNED

        report = await _write(backend, {**entry, "workspace_id": "home"})

        assert db.rows[BRIEF]["conversation_thread_id"] is None
        assert ": workspace_id, thread" in report
        assert _shown(db.list()[0])["thread"] == "persistent"

    @pytest.mark.asyncio
    async def test_a_moved_automation_in_its_own_thread_still_reads_persistent(self, db, backend):
        db.add(_row(thread_strategy="continue", conversation_thread_id=UUID(PINNED), owns_thread=True))
        entry = _shown(db.list()[0])
        assert entry["thread"] == "persistent"

        report = await _write(backend, {**entry, "workspace_id": WORKSPACE})

        assert db.rows[BRIEF]["conversation_thread_id"] is None
        assert report.startswith(f'Saved {FILE_NAME}: updated "Morning brief": workspace_id;')

    @pytest.mark.asyncio
    async def test_another_edit_keeps_the_pin(self, db, backend):
        db.add(_row(thread_strategy="continue", conversation_thread_id=UUID(PINNED)))
        entry = _shown(db.list()[0])

        await _write(backend, {**entry, "instruction": "Summarize the news."})

        assert db.rows[BRIEF]["conversation_thread_id"] == UUID(PINNED)


class TestAPinIsWhereItRuns:
    """Runs continue in a pinned thread, so a pin outside the automation's
    workspace is refused (``lifecycle.create_automation``)."""

    @pytest.mark.asyncio
    async def test_home_with_this_conversation_from_a_workspace_is_refused(self, db, backend):
        error = await _refusal(backend, db, {**NEW, "workspace_id": "home", "thread": "current"}, path=NEW_PATH)

        assert error.problems == [
            (
                "thread",
                f"thread {THREAD} is in workspace {WORKSPACE}, but the automation runs in the user's Home: "
                f"pin a thread from the user's Home, or run the automation in workspace {WORKSPACE}",
            )
        ]

    @pytest.mark.asyncio
    async def test_a_move_that_pins_a_thread_it_leaves_is_refused(self, db, backend):
        db.add(_row())
        entry = _shown(db.list()[0])

        error = await _refusal(backend, db, {**entry, "workspace_id": WORKSPACE, "thread": PINNED})

        assert [field for field, _ in error.problems] == ["thread"]

    @pytest.mark.asyncio
    async def test_a_row_stored_with_its_pin_elsewhere_stays_editable(self, db, backend):
        db.add(_row(workspace_id=UUID(WORKSPACE), thread_strategy="continue", conversation_thread_id=UUID(PINNED)))
        entry = _shown(db.list()[0])

        await _write(backend, {**entry, "instruction": "Summarize the news."})

        assert db.rows[BRIEF]["instruction"] == "Summarize the news."
        assert db.rows[BRIEF]["conversation_thread_id"] == UUID(PINNED)
