"""A turn replay cannot project falls back to its stored events, which no turn
settled since #533 has. Such a turn must still read as one replay lost, not as
an answer of nothing, and only the turns that failed may lose it.
"""

from __future__ import annotations

import logging

import pytest
from langchain_core.messages import AIMessage

from src.server.services.history.replay import (
    build_replay_page,
    build_sse_replay_items,
    read_replay_page,
)
from src.server.services.history.replay import cold
from tests.unit.server.services.history.replay_builders import (
    THREAD,
    ThreadHistory,
    _mock_reader,
    _query,
    _response,
    _turn,
    thread_rows,
)


def _unwritten(turn_index, status="completed"):
    """A row settled after its stored events stopped being written."""
    return {**_response(turn_index, status=status), "sse_events": None}


def _events(lines):
    return [(line.item()["data"].get("turn_index"), line.event) for line in lines]


def _unavailable(items):
    return [
        i
        for i in items
        if i["event"] == "error" and i["data"].get("type") == "replay_unavailable"
    ]


def test_a_settled_turn_without_stored_events_replays_as_unavailable():
    items = build_sse_replay_items(THREAD, [_query(0)], {0: _unwritten(0)})

    assert [i["event"] for i in items] == ["user_message", "error"]
    error = items[1]["data"]
    assert error["type"] == "replay_unavailable"
    # The client words an internal fault as this service's own.
    assert error["error_kind"] == "internal"
    assert (error["turn_index"], error["response_id"]) == (0, "resp-0")


def test_a_failed_turn_keeps_its_own_error_alone():
    # One failure per turn: the row's error is the one the user saw.
    items = build_sse_replay_items(
        THREAD, [_query(0)], {0: _unwritten(0, status="error")}
    )
    errors = [i for i in items if i["event"] == "error"]
    assert len(errors) == 1
    assert errors[0]["data"]["type"] == "workflow_error"


def test_stored_events_written_empty_are_a_whole_replay():
    # A turn stopped before it streamed wrote an empty list: nothing is lost.
    items = build_sse_replay_items(THREAD, [_query(0)], {0: _response(0)})
    assert not _unavailable(items)


@pytest.mark.parametrize(
    "stop",
    [
        {"status": "cancelled", "metadata": {"cancelled_by_user": True}},
        {"status": "cancelled"},
    ],
    ids=["user stop", "system cancel"],
)
def test_a_turn_ended_before_its_answer_is_not_unavailable(stop):
    # Stopped before its first checkpoint, it streamed nothing to lose: its
    # stored events are missing only because nothing writes them any more.
    items = build_sse_replay_items(THREAD, [_query(0)], {0: {**_unwritten(0), **stop}})
    assert not _unavailable(items)


def test_a_turn_paused_on_an_interrupt_is_unavailable():
    # Its interrupt came from a tool call the model made: it answered.
    items = build_sse_replay_items(
        THREAD, [_query(0)], {0: _unwritten(0, status="interrupted")}
    )
    assert len(_unavailable(items)) == 1


def test_a_turn_still_going_is_not_unavailable():
    # Its stub attaches to the live run; a retry's earlier row is not its end.
    items = build_sse_replay_items(
        THREAD, [_query(0)], {0: _unwritten(0)}, {0: "run-2"}
    )
    assert not _unavailable(items)


def _two_turns_second_fails(monkeypatch):
    _mock_reader(
        monkeypatch,
        ThreadHistory(
            thread_id=THREAD,
            turns=[
                _turn(0, [AIMessage(content="zero", id="ai-0")]),
                _turn(1, [AIMessage(content="one", id="ai-1")]),
            ],
        ),
    )
    real = cold.project_turn

    def flaky(inputs, turn_index, turn, response, lane, derive=None):
        if turn_index == 1:
            raise ValueError("a turn this build cannot project")
        return real(inputs, turn_index, turn, response, lane, derive)

    monkeypatch.setattr(cold, "project_turn", flaky)
    return [_query(0), _query(1, content="next")], {0: _unwritten(0), 1: _unwritten(1)}


@pytest.mark.asyncio
async def test_a_turn_that_cannot_project_costs_only_itself(monkeypatch, caplog):
    queries, responses = _two_turns_second_fails(monkeypatch)

    with caplog.at_level(logging.WARNING):
        page = await build_replay_page(
            thread_rows(queries, responses), turn_fallback=True
        )

    assert _events(page.lines) == [
        (0, "user_message"),
        (0, "message_chunk"),
        (1, "user_message"),
        (1, "error"),
    ]
    assert page.lines[-1].item()["data"]["type"] == "replay_unavailable"
    (record,) = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert "without their content" in record.getMessage()
    assert isinstance(record.exc_info[1], ValueError)


@pytest.mark.asyncio
async def test_a_page_that_cannot_project_logs_the_turns_it_loses(
    monkeypatch, caplog
):
    # No checkpoint turns to pair: the whole page replays from storage.
    _mock_reader(monkeypatch, ThreadHistory(thread_id=THREAD, turns=[]))
    stored = _response(
        0,
        [{"event": "message_chunk", "data": {"content": "stored", "content_type": "text"}}],
    )

    with caplog.at_level(logging.INFO):
        page, source = await read_replay_page(
            thread_rows([_query(0), _query(1)], {0: stored, 1: _unwritten(1)})
        )

    assert source == "sse"
    assert _events(page.lines) == [
        (0, "user_message"),
        (0, "message_chunk"),
        (1, "user_message"),
        (1, "error"),
    ]
    (record,) = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert "[1]" in record.getMessage()
    # The failure that sent the read to storage rides along.
    assert record.exc_info is not None and record.exc_info[1] is not None


@pytest.mark.asyncio
async def test_a_turn_that_cannot_project_while_it_runs_again_is_not_unavailable(
    monkeypatch,
):
    # Its settled attempt fails to project while a newer one streams: the
    # turn's stub attaches to that run, which has nothing lost yet.
    queries, responses = _two_turns_second_fails(monkeypatch)

    page = await build_replay_page(
        thread_rows(queries, responses, open_runs={1: "run-2"}), turn_fallback=True
    )

    assert not _unavailable([line.item() for line in page.lines])
