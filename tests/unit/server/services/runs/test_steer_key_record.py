"""The steer record a keyed send leaves when it goes into a running turn.

A steer writes no run row, so this record is the only thing a later copy of
the same send can find; ``run_named_by_key`` reads it after the ledger, and
START reads it again once its row holds the thread's slot.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.unit.server.handlers.chat.redis_fakes import FakeCache

CACHE = "src.utils.cache.redis_cache.get_cache_client"
FIND_KEY = "src.server.database.runs.lifecycle.find_run_by_request_key"
GET_RUN = "src.server.database.runs.lifecycle.get_run"
GET_RUN_BRIEF = "src.server.database.runs.lifecycle.get_run_brief"
# START's own transaction connection, which its steer check reads the run on.
CONN = object()
KEY = "8c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5"
QUEUE = "workflow:steering:t-1"
OWN_RUN = {"conversation_response_id": "run-own", "status": "completed"}
STEERED_INTO = {"conversation_response_id": "run-live", "status": "in_progress"}
ENDED = {**STEERED_INTO, "status": "completed"}
FAILED = {**STEERED_INTO, "status": "error"}
READER = "src.server.services.history.reader.CheckpointHistoryReader.get_instance"
# The carrying copy's own entry, stamped with the turn it carries the steer into.
NEXT = (
    '{"content": "hello", "user_id": "u-1", "timestamp": 1.0, '
    '"run_id": "run-next", "request_key": "8c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5"}'
)


@pytest.fixture
def cache(monkeypatch):
    cache = FakeCache()
    monkeypatch.setattr(CACHE, lambda: cache)
    return cache


async def _steer():
    from src.server.handlers.chat.steering import steer_thread

    return await steer_thread("t-1", "hello", "u-1", run_id="run-live", request_key=KEY)


def _records(cache):
    from src.server.services.runs.steer_queue import steer_records_key

    return cache.client.hashes.get(steer_records_key("t-1"), {})


async def _read(cache, queued):
    """What the middleware does to a steer it takes."""
    await cache.client.lrem(QUEUE, 1, queued["payload"])


def _checkpoint(kept: bool):
    """The steered run's newest checkpoint, holding the injected steer when
    the run saved the step that injected it."""
    from langchain_core.messages import HumanMessage

    messages = [HumanMessage("question")]
    if kept:
        from ptc_agent.agent.middleware.steering import steering_message_id

        messages.append(
            HumanMessage("[Steering from User]\nhello", id=steering_message_id([KEY]))
        )
    reader = MagicMock()
    reader.aget_run_state = AsyncMock(
        return_value=SimpleNamespace(values={"messages": messages})
    )
    return reader


@pytest.mark.asyncio
async def test_one_copy_claims_a_key_with_its_message_and_both_expire_together(
    cache,
):
    from src.config.settings import get_redis_ttl_steering
    from src.server.services.runs.steer_queue import SteerKeyTaken, steer_records_key

    first = await _steer()
    with pytest.raises(SteerKeyTaken):
        await _steer()

    assert cache.client.lists[QUEUE] == [first["payload"]]
    assert _records(cache) == {KEY: "run-live"}
    assert cache.client.ttls[steer_records_key("t-1")] == get_redis_ttl_steering()
    assert cache.client.ttls[QUEUE] == get_redis_ttl_steering()


def test_the_record_and_the_queue_share_a_cluster_slot():
    from redis.crc import key_slot

    from src.server.services.runs.steer_queue import steer_records_key

    assert key_slot(steer_records_key("t-1").encode()) == key_slot(QUEUE.encode())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "own, steered, named",
    [
        (OWN_RUN, True, OWN_RUN),
        (None, True, STEERED_INTO),
        (None, False, None),
    ],
    ids=["own-turn", "steer", "nowhere"],
)
async def test_a_key_names_its_own_turn_else_the_turn_it_steered(
    cache, own, steered, named
):
    from src.server.services.runs.admission import KeyedRun, run_named_by_key

    if steered:
        await _steer()
    get_run = AsyncMock(return_value=STEERED_INTO)
    with patch(FIND_KEY, AsyncMock(return_value=own)), patch(GET_RUN, get_run):
        keyed = await run_named_by_key("t-1", KEY)
    assert keyed == (
        None if named is None else KeyedRun(named, steered=named is STEERED_INTO)
    )

    if named is STEERED_INTO:
        get_run.assert_awaited_once_with("run-live")
        assert len(cache.client.lists[QUEUE]) == 1
    else:
        get_run.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("read", [True, False], ids=["read", "never-read"])
async def test_a_steer_into_a_turn_that_ended_names_it_only_if_it_was_read(
    cache, read
):
    """The turn's worker died, or it made no model call after the steer: the
    message is still queued, so the key ran nowhere. The lookup leaves it
    there: only a copy that goes on to carry it takes it back."""
    from src.server.services.runs.admission import KeyedRun, run_named_by_key

    queued = await _steer()
    if read:
        await cache.client.lrem(QUEUE, 1, queued["payload"])
    with patch(FIND_KEY, AsyncMock(return_value=None)), patch(
        GET_RUN, AsyncMock(return_value=ENDED)
    ), patch(READER, return_value=_checkpoint(True)):
        keyed = await run_named_by_key("t-1", KEY)

    assert keyed == (KeyedRun(ENDED, steered=True) if read else None)
    assert _records(cache) == {KEY: "run-live"}
    assert cache.client.lists[QUEUE] == ([] if read else [queued["payload"]])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "run, read, taken",
    [(ENDED, False, True), (ENDED, True, False), (STEERED_INTO, False, False)],
    ids=["ended-unread", "ended-read", "live"],
)
async def test_a_copy_carries_only_a_steer_its_ended_turn_never_read(
    cache, run, read, taken
):
    """The message moves into the next turn in its place, with its claim."""
    from src.server.services.runs.admission import carry_unread_steer

    queued = await _steer()
    if read:
        await cache.client.lrem(QUEUE, 1, queued["payload"])
    with patch(GET_RUN, AsyncMock(return_value=run)), patch(
        READER, return_value=_checkpoint(True)
    ):
        position = await carry_unread_steer("t-1", KEY, "run-next", NEXT)

    if taken:
        assert position == 1
        assert (cache.client.lists[QUEUE], _records(cache)) == (
            [NEXT], {KEY: "run-next"}
        )
    else:
        assert position is None
        assert _records(cache) == {KEY: "run-live"}
        assert cache.client.lists[QUEUE] == ([] if read else [queued["payload"]])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "read, refused", [(True, True), (False, False)], ids=["read", "never-read"]
)
async def test_start_settles_a_copy_steered_after_its_admission(
    cache, read, refused
):
    from src.server.database.runs.lifecycle import DuplicateRequestError
    from src.server.services.runs.admission import refuse_copy_read_as_steer

    queued = await _steer()
    if read:
        await cache.client.lrem(QUEUE, 1, queued["payload"])

    with patch(GET_RUN_BRIEF, AsyncMock(return_value=ENDED)), patch(
        READER, return_value=_checkpoint(True)
    ):
        if refused:
            with pytest.raises(DuplicateRequestError) as dup:
                await refuse_copy_read_as_steer("t-1", KEY, CONN)
            assert (dup.value.existing_run, dup.value.steered) == (ENDED, True)
        else:
            await refuse_copy_read_as_steer("t-1", KEY, CONN)
            assert (cache.client.lists[QUEUE], _records(cache)) == ([], {})


@pytest.mark.asyncio
async def test_start_fails_when_it_cannot_read_the_record(cache):
    """Passing would deliver the message twice if a turn read its steer."""
    from src.server.services.runs.admission import refuse_copy_read_as_steer

    cache.client.eval = AsyncMock(side_effect=ConnectionError("redis down"))

    with pytest.raises(ConnectionError):
        await refuse_copy_read_as_steer("t-1", KEY, CONN)


@pytest.mark.asyncio
async def test_start_fails_when_the_record_read_stalls(cache, monkeypatch):
    """The read runs inside START's transaction, holding the thread's row
    lock, so a stalled cache fails the START instead of holding it."""
    import asyncio

    from src.server.services.runs import admission

    async def stalled(*_args):
        await asyncio.sleep(60)

    cache.client.eval = stalled
    monkeypatch.setattr(admission, "START_STEER_CHECK_TIMEOUT_S", 0.01)

    with pytest.raises(TimeoutError):
        await admission.refuse_copy_read_as_steer("t-1", KEY, CONN)


@pytest.mark.asyncio
async def test_start_reads_the_steered_run_on_its_own_connection(cache):
    """START holds the thread's locks while it checks, so the run is read on
    its own connection, never by waiting on a second pool slot."""
    from src.server.database.runs.lifecycle import DuplicateRequestError
    from src.server.services.runs.admission import refuse_copy_read_as_steer

    await _read(cache, await _steer())
    pool_read = AsyncMock(side_effect=AssertionError("waited on a second pool slot"))
    brief = AsyncMock(return_value=ENDED)
    with patch(GET_RUN, pool_read), patch(GET_RUN_BRIEF, brief), patch(
        READER, return_value=_checkpoint(True)
    ):
        with pytest.raises(DuplicateRequestError):
            await refuse_copy_read_as_steer("t-1", KEY, CONN)

    brief.assert_awaited_once_with(CONN, "run-live")
    pool_read.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("run", [FAILED, ENDED], ids=["failed", "completed"])
@pytest.mark.parametrize("kept", [True, False], ids=["kept", "lost"])
async def test_a_steer_taken_by_a_turn_that_ended_names_it_only_if_saved(
    cache, run, kept
):
    """The turn took the steer out of the queue and never saved it: it died
    before saving the step that injected it, or lost Redis's answer to the
    removal and went on to complete without it. The message ran nowhere, and
    a resend must run."""
    from src.server.services.runs.admission import KeyedRun, run_named_by_key

    await _read(cache, await _steer())
    reader = _checkpoint(kept)
    with patch(FIND_KEY, AsyncMock(return_value=None)), patch(
        GET_RUN, AsyncMock(return_value=run)
    ), patch(READER, return_value=reader):
        keyed = await run_named_by_key("t-1", KEY)

    assert keyed == (KeyedRun(run, steered=True) if kept else None)
    assert _records(cache) == {KEY: "run-live"}
    reader.aget_run_state.assert_awaited_once_with("t-1", "run-live")


@pytest.mark.asyncio
@pytest.mark.parametrize("run", [FAILED, ENDED], ids=["failed", "completed"])
@pytest.mark.parametrize("kept", [True, False], ids=["kept", "lost"])
async def test_a_copy_carries_a_steer_its_ended_turn_never_saved(cache, run, kept):
    from src.server.services.runs.admission import carry_unread_steer

    await _read(cache, await _steer())
    with patch(GET_RUN, AsyncMock(return_value=run)), patch(
        READER, return_value=_checkpoint(kept)
    ):
        position = await carry_unread_steer("t-1", KEY, "run-next", NEXT)

    assert position == (None if kept else 1)
    assert _records(cache) == ({KEY: "run-live"} if kept else {KEY: "run-next"})
    assert cache.client.lists[QUEUE] == ([] if kept else [NEXT])


@pytest.mark.asyncio
@pytest.mark.parametrize("run", [FAILED, ENDED], ids=["failed", "completed"])
@pytest.mark.parametrize("kept", [True, False], ids=["kept", "lost"])
async def test_start_carries_a_steer_its_ended_turn_never_saved(cache, run, kept):
    from src.server.database.runs.lifecycle import DuplicateRequestError
    from src.server.services.runs.admission import refuse_copy_read_as_steer

    await _read(cache, await _steer())
    with patch(GET_RUN_BRIEF, AsyncMock(return_value=run)), patch(
        READER, return_value=_checkpoint(kept)
    ):
        if kept:
            with pytest.raises(DuplicateRequestError) as dup:
                await refuse_copy_read_as_steer("t-1", KEY, CONN)
            assert (dup.value.existing_run, dup.value.steered) == (run, True)
        else:
            await refuse_copy_read_as_steer("t-1", KEY, CONN)

    assert _records(cache) == ({KEY: "run-live"} if kept else {})


@pytest.mark.asyncio
async def test_start_fails_when_the_checkpoint_read_stalls(cache, monkeypatch):
    """Passing could deliver the message twice, and the read holds START's
    row lock."""
    import asyncio

    from src.server.services.runs import admission

    async def stalled(*_args):
        await asyncio.sleep(60)

    reader = MagicMock(aget_run_state=stalled)
    monkeypatch.setattr(admission, "STEER_KEPT_CHECK_TIMEOUT_S", 0.01)
    await _read(cache, await _steer())
    with patch(GET_RUN_BRIEF, AsyncMock(return_value=FAILED)), patch(
        READER, return_value=reader
    ):
        with pytest.raises(TimeoutError):
            await admission.refuse_copy_read_as_steer("t-1", KEY, CONN)

    assert _records(cache) == {KEY: "run-live"}


@pytest.mark.asyncio
async def test_a_key_is_released_only_from_the_run_its_record_names(cache):
    from src.server.services.runs.steer_queue import release_steer_key

    await _read(cache, await _steer())

    assert await release_steer_key("t-1", KEY, "run-other") is False
    assert _records(cache) == {KEY: "run-live"}
    assert await release_steer_key("t-1", KEY, "run-live") is True
    assert _records(cache) == {}

