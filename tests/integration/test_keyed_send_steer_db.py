"""Keyed sends meeting a running turn, against real Postgres and Redis.

A send whose response was lost is sent again with the same request_key, and
the key must reach the conversation once. A send that runs as its own turn
leaves the key on its run row, where START's unique index and the duplicate
probes find it. A send that goes into a running turn as a steer writes no
run row, so the steer leaves a record of its own that a later copy finds.

The admission reads here are the ones two workers make: each copy probes the
key, then reads the thread's slot, and the other copy can commit in between.

Requires a real Redis and Postgres (``REDIS_URL`` and ``TEST_DB_*``).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi import HTTPException

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]


@pytest_asyncio.fixture(loop_scope="session")
async def redis(monkeypatch):
    """The steering queue's Redis, pointed at ``REDIS_URL``."""
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    if not redis_url.startswith("redis://"):
        pytest.skip("REDIS_URL not set to a real Redis instance")

    from src.utils.cache import redis_cache

    client = redis_cache.RedisCacheClient(url=redis_url, max_connections=10)
    try:
        await client.connect()
    except Exception as exc:
        pytest.skip(f"Redis is not reachable at REDIS_URL: {exc}")
    if not client.enabled or not client.client:
        pytest.skip("Redis client did not initialize")
    monkeypatch.setattr(redis_cache, "get_cache_client", lambda: client)
    yield client.client
    await client.disconnect()


class _Worker:
    """Admission as a worker that hosts none of the thread's runs."""

    async def wait_for_admission(self, thread_id):
        from src.server.services.runs import admission

        return await admission.wait_for_admission(
            thread_id, local_task_probe=AsyncMock(return_value=None)
        )


async def _start(thread_id, text, request_key=None):
    from src.server.database.runs.lifecycle import QuerySpec, start_run

    run_id = str(uuid.uuid4())
    await start_run(
        run_id=run_id,
        thread_id=thread_id,
        request_key=request_key or str(uuid.uuid4()),
        turn_index=None,
        query=QuerySpec(query_id=str(uuid.uuid4()), content=text, query_type="initial"),
        metadata={"msg_type": "ptc"},
    )
    return run_id


async def _end(run_id, thread_id, status="completed"):
    from src.server.database.runs.lifecycle import RunOutcome, finalize_run

    await finalize_run(
        run_id=run_id, thread_id=thread_id, outcome=RunOutcome(status=status)
    )


@pytest_asyncio.fixture(loop_scope="session")
async def thread(seed_workspace, patched_get_db_connection, redis):
    from src.server.database.conversation import create_thread

    thread_id = str(uuid.uuid4())
    await create_thread(
        conversation_thread_id=thread_id,
        workspace_id=str(seed_workspace["workspace_id"]),
        current_status="completed",
        msg_type="ptc",
    )
    key = str(uuid.uuid4())
    yield SimpleNamespace(
        id=thread_id,
        workspace_id=str(seed_workspace["workspace_id"]),
        user_id=seed_workspace["user_id"],
        key=key,
        queue=f"workflow:steering:{thread_id}",
    )
    await redis.delete(
        f"workflow:steering:{thread_id}", "{" + f"workflow:steering:{thread_id}" + "}:keys"
    )


async def _send(thread, text):
    """A copy of the keyed send, from the admission read on."""
    from src.server.handlers.chat.admission_gate import wait_or_steer

    return await wait_or_steer(
        _Worker(), thread.id, text, thread.user_id, request_key=thread.key
    )


async def _begin(thread, text):
    """The START of a copy that admission found the thread idle for."""
    from src.server.models.chat import ChatRequest
    from src.server.services.runs.admission import RunScope, begin_run

    request = ChatRequest(
        messages=[{"role": "user", "content": text}], request_key=thread.key
    )
    handle = await begin_run(
        request,
        scope=RunScope(user_id=thread.user_id, burst_slot_id=None),
        thread_id=thread.id,
        run_id=str(uuid.uuid4()),
        msg_type="ptc",
        workspace_id=thread.workspace_id,
        user_id=thread.user_id,
        is_byok=False,
        query_content=text,
        query_type="initial",
        feedback_action=None,
        query_metadata={},
        fork=None,
        is_checkpoint_replay=False,
    )
    return handle.run_id


async def _queued(redis, thread):
    return [json.loads(raw) for raw in await redis.lrange(thread.queue, 0, -1)]


async def _queries(db_conn, thread):
    cur = await db_conn.execute(
        "SELECT count(*) AS n FROM conversation_queries WHERE conversation_thread_id = %s",
        (thread.id,),
    )
    return (await cur.fetchone())["n"]


async def _route_probe(thread):
    from src.server.app.threads.messaging import _reject_duplicate_request

    with pytest.raises(HTTPException) as refused:
        await _reject_duplicate_request(thread.id, thread.key, thread.user_id)
    return refused.value.detail


async def test_a_copy_whose_first_copy_started_past_its_probe_is_not_steered_into_it(
    thread, redis, db_conn
):
    """The first copy's START commits after this copy probed the key, so the
    slot this copy reads holds its own first copy."""
    from src.server.database.runs.lifecycle import DuplicateRequestError
    from src.server.services.runs.admission import dedup_retransmit_or_raise

    await dedup_retransmit_or_raise(thread.id, thread.key)
    first_copy = await _start(thread.id, "hello", request_key=thread.key)

    with pytest.raises(DuplicateRequestError) as dup:
        await _send(thread, "hello")

    assert str(dup.value.existing_run["conversation_response_id"]) == first_copy
    assert dup.value.steered is False
    assert await _queued(redis, thread) == []
    assert await _queries(db_conn, thread) == 1


async def test_a_resend_of_a_steered_send_reconnects_to_the_turn_that_took_it(
    thread, redis, db_conn, saver
):
    from src.server.database.runs.lifecycle import DuplicateRequestError
    from src.server.services.runs.admission import dedup_retransmit_or_raise

    running = await _start(thread.id, "the running turn's question")
    ready, accepted = await _send(thread, "hello")
    assert (ready, "steering_accepted" in accepted) == (False, True)

    # While the turn runs, the resend is answered at the route and again in
    # the generator, under the admission lock.
    detail = await _route_probe(thread)
    assert (
        detail["code"],
        detail["run_id"],
        detail["run_status"],
        detail["steered"],
    ) == (
        "duplicate_request",
        running,
        "in_progress",
        True,
    )
    with pytest.raises(DuplicateRequestError) as dup:
        await dedup_retransmit_or_raise(thread.id, thread.key)
    assert dup.value.steered is True
    with pytest.raises(DuplicateRequestError):
        await _send(thread, "hello")

    # The turn takes the steer and ends; the thread is idle again.
    await _turn_takes_the_steer(saver, thread, running, ends="completed")

    try:
        detail = await _route_probe(thread)
        assert (detail["run_id"], detail["run_status"], detail["steered"]) == (
            running,
            "completed",
            True,
        )
        with pytest.raises(DuplicateRequestError) as dup:
            await _send(thread, "hello")
        assert str(dup.value.existing_run["conversation_response_id"]) == running
        assert dup.value.steered is True
        assert await _queries(db_conn, thread) == 1
    finally:
        await saver.adelete_thread(thread.id)


async def test_two_copies_racing_into_a_running_turn_steer_once(thread, redis):
    from src.server.database.runs.lifecycle import DuplicateRequestError

    running = await _start(thread.id, "the running turn's question")

    outcomes = await asyncio.gather(
        _send(thread, "hello"), _send(thread, "hello"), return_exceptions=True
    )

    accepted = [o for o in outcomes if isinstance(o, tuple)]
    duplicates = [o for o in outcomes if isinstance(o, DuplicateRequestError)]
    assert (len(accepted), len(duplicates)) == (1, 1), outcomes
    assert str(duplicates[0].existing_run["conversation_response_id"]) == running
    assert [m["content"] for m in await _queued(redis, thread)] == ["hello"]


async def test_a_steer_handed_back_unread_leaves_its_key_free(
    thread, redis, db_conn
):
    """The turn ended before reading the steer, and its drain returned it to
    the client: the key reached no run, so a resend of it is a new send."""
    from src.server.handlers.chat.steering import drain_pending_steerings

    running = await _start(thread.id, "the running turn's question")
    await _send(thread, "hello")
    assert (await _route_probe(thread))["run_id"] == running

    await _end(running, thread.id)
    returned = await drain_pending_steerings(thread.id)
    assert [m["content"] for m in returned] == ["hello"]

    ready, event = await _send(thread, "hello")
    assert (ready, event) == (True, None)
    resent = await _start(thread.id, "hello", request_key=thread.key)
    assert (await _route_probe(thread))["run_id"] == resent
    assert await _queries(db_conn, thread) == 2


@pytest.mark.parametrize("way", ["reclaimed", "carried"])
async def test_a_steer_carrying_half_a_surrogate_pair_is_still_found_by_its_key(
    thread, redis, way
):
    """The request's JSON parser lets half a surrogate pair through, and the
    queue's scripts find an entry by its key. A reclaim that could not would
    leave the record behind, and the copy's START would answer the send as
    read by a turn that never saw it."""
    from src.server.handlers.chat.steering import (
        steer_payload,
        steer_thread,
        unsteer_thread,
    )
    from src.server.services.runs.admission import carry_unread_steer

    running = await _start(thread.id, "the running turn's question")
    queued = await steer_thread(
        thread.id, "hello \ud83d", thread.user_id, run_id=running,
        request_key=thread.key,
    )
    await _end(running, thread.id)

    if way == "reclaimed":
        assert await unsteer_thread(thread.id, queued["payload"]) is True
        assert await _queued(redis, thread) == []
        assert await redis.hgetall("{" + thread.queue + "}:keys") == {}
        return
    nxt = await _start(thread.id, "the next turn's question")
    entry = steer_payload(
        "hello \ud83d", thread.user_id, run_id=nxt, request_key=thread.key
    )
    assert await carry_unread_steer(thread.id, thread.key, nxt, entry) == 1
    assert [m["run_id"] for m in await _queued(redis, thread)] == [nxt]
    assert await redis.hgetall("{" + thread.queue + "}:keys") == {
        thread.key.encode(): nxt.encode()
    }
    await _end(nxt, thread.id)


async def test_a_steer_its_turn_ended_without_reading_is_taken_back_by_a_resend(
    thread, redis, db_conn
):
    """The turn's worker died, or the turn made no further model call, so the
    steer sat in the queue when the turn ended. A resend is then a new send,
    not an answer naming a turn that never saw the message. Its START takes
    the steer back: admission only reads it."""
    running = await _start(thread.id, "the running turn's question")
    await _send(thread, "hello")
    await _end(running, thread.id)

    ready, event = await _send(thread, "hello")

    assert (ready, event) == (True, None)
    assert [m["content"] for m in await _queued(redis, thread)] == ["hello"]
    resent = await _begin(thread, "hello")
    assert await _queued(redis, thread) == []
    assert (await _route_probe(thread))["run_id"] == resent
    assert await _queries(db_conn, thread) == 2
    await _end(resent, thread.id)


async def test_a_copy_that_meets_a_claim_its_turn_never_read_carries_the_message(
    thread, redis, db_conn, monkeypatch
):
    """Copy A steered into a turn that had already ended, so nothing will read
    it, just before copy B's push met A's claim. A's own check after its push
    finds the thread idle and answers accepted, so B carries the message as a
    turn: refusing it would lose the message. B's admission leaves it queued,
    and B's START takes it back, which a client leaving cannot cut short."""
    from src.server.handlers.chat import steering

    running = await _start(thread.id, "another message")
    real_steer = steering.steer_thread
    other = {}

    async def other_copy_first(*args, **kwargs):
        if not other:
            await _end(running, thread.id)
            other.update(await real_steer(*args, **kwargs))
        return await real_steer(*args, **kwargs)

    monkeypatch.setattr(steering, "steer_thread", other_copy_first)

    assert await _send(thread, "hello") == (True, None)
    assert [m["content"] for m in await _queued(redis, thread)] == ["hello"]

    started = await _begin(thread, "hello")
    assert await steering.unsteer_thread(thread.id, other["payload"]) is False
    assert await _queued(redis, thread) == []
    assert (await _route_probe(thread))["run_id"] == started
    assert await _queries(db_conn, thread) == 2
    await _end(started, thread.id)


@pytest.mark.parametrize("breaks", ["at the move", "after the move"])
async def test_a_copy_moving_a_steer_into_the_next_turn_leaves_it_queued_once(
    thread, redis, monkeypatch, breaks
):
    """Copy A steered into a turn that ended without reading it, and the next
    turn is running when copy B meets A's claim, so B moves the message into
    that turn. Wherever Redis fails around the move, the message is queued
    once, for one turn or the other: a take-back and a push of their own
    would leave it in no queue when the push fails, and A's client already
    holds an accepted answer."""
    from src.server.handlers.chat import admission_gate, steering

    first = await _start(thread.id, "the first turn's question")
    real_steer = steering.steer_thread
    real_dedup = admission_gate.dedup_retransmit_or_raise
    real_eval = redis.eval
    other, nxt, dedups = {}, [], []
    writes_left = [0 if breaks == "at the move" else 1]

    async def other_copy_first(*args, **kwargs):
        if not other:
            other.update(await real_steer(*args, **kwargs))
            await _end(first, thread.id)
            nxt.append(await _start(thread.id, "the next turn's question"))
        return await real_steer(*args, **kwargs)

    async def failing_eval(*args):
        if not writes_left[0]:
            raise ConnectionError("Redis went away")
        writes_left[0] -= 1
        return await real_eval(*args)

    async def dedup_then_break(*args):
        await real_dedup(*args)
        dedups.append(args)
        if len(dedups) == 2:
            # B met A's claim: every Redis write from here on carries it.
            monkeypatch.setattr(redis, "eval", failing_eval)

    monkeypatch.setattr(steering, "steer_thread", other_copy_first)
    monkeypatch.setattr(admission_gate, "dedup_retransmit_or_raise", dedup_then_break)

    if breaks == "at the move":
        with pytest.raises(HTTPException):
            await _send(thread, "hello")
        holder = first
    else:
        ready, event = await _send(thread, "hello")
        assert ready is False and "steering_accepted" in event
        holder = nxt[0]
    monkeypatch.setattr(redis, "eval", real_eval)

    queued = await _queued(redis, thread)
    assert [(m["content"], m["run_id"]) for m in queued] == [("hello", holder)]
    assert await redis.hgetall("{" + thread.queue + "}:keys") == {
        thread.key.encode(): holder.encode()
    }
    await _end(nxt[0], thread.id)


async def test_a_start_cancelled_after_taking_back_its_copy_keeps_the_message(
    thread, redis, db_conn, monkeypatch
):
    """A resend's START took back the steer its turn ended without reading,
    and then the client left. START goes on to commit, so the message stays
    in the thread as a stopped turn rather than in no queue and no run."""
    from src.server.database.runs.lifecycle import find_run_by_request_key
    from src.server.services.runs import admission

    running = await _start(thread.id, "the running turn's question")
    await _send(thread, "hello")
    await _end(running, thread.id)
    assert await _send(thread, "hello") == (True, None)

    real_check = admission.refuse_copy_read_as_steer
    checked, go_on = asyncio.Event(), asyncio.Event()

    async def check_then_wait(*args):
        await real_check(*args)
        checked.set()
        await go_on.wait()

    monkeypatch.setattr(admission, "refuse_copy_read_as_steer", check_then_wait)

    request = asyncio.create_task(_begin(thread, "hello"))
    await checked.wait()
    assert await _queued(redis, thread) == []
    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    go_on.set()
    run = None
    for _ in range(300):
        run = await find_run_by_request_key(thread.key)
        if run is not None and run["status"] != "in_progress":
            break
        await asyncio.sleep(0.01)

    assert run is not None and run["status"] == "cancelled"
    assert await _queries(db_conn, thread) == 2
    assert await _queued(redis, thread) == []


async def test_a_slow_start_whose_copy_a_turn_read_meanwhile_is_refused(
    thread, redis, db_conn, saver
):
    """Copy A found the thread idle, and copy B went into another turn as a
    steer before A's START. That turn read it, so A's START is a duplicate."""
    from src.server.database.runs.lifecycle import DuplicateRequestError

    assert await _send(thread, "hello") == (True, None)
    running = await _start(thread.id, "another message")
    await _send(thread, "hello")
    await _turn_takes_the_steer(saver, thread, running, ends="completed")

    try:
        with pytest.raises(DuplicateRequestError) as dup:
            await _begin(thread, "hello")

        assert str(dup.value.existing_run["conversation_response_id"]) == running
        assert dup.value.steered is True
        assert await _queries(db_conn, thread) == 1
    finally:
        await saver.adelete_thread(thread.id)


async def test_a_slow_start_takes_back_its_copy_a_turn_never_read(
    thread, redis, db_conn
):
    from src.server.database.runs.lifecycle import get_run

    assert await _send(thread, "hello") == (True, None)
    running = await _start(thread.id, "another message")
    await _send(thread, "hello")
    await _end(running, thread.id)

    started = await _begin(thread, "hello")

    assert str((await get_run(started))["request_key"]) == thread.key
    assert await _queued(redis, thread) == []
    assert await _queries(db_conn, thread) == 2
    await _end(started, thread.id)


async def test_a_steer_queued_after_its_copy_started_is_taken_back(
    thread, redis, db_conn, monkeypatch
):
    """Copy B read the thread as running and was slow to push: the turn ended
    and copy A started as a turn of its own, past START's check, before B's
    steer went in."""
    from src.server.database.runs.lifecycle import DuplicateRequestError
    from src.server.handlers.chat import steering

    running = await _start(thread.id, "another message")
    real_steer = steering.steer_thread
    started = []

    async def slow_steer(*args, **kwargs):
        await _end(running, thread.id)
        started.append(await _begin(thread, "hello"))
        return await real_steer(*args, **kwargs)

    monkeypatch.setattr(steering, "steer_thread", slow_steer)

    with pytest.raises(DuplicateRequestError) as dup:
        await _send(thread, "hello")

    assert str(dup.value.existing_run["conversation_response_id"]) == started[0]
    assert dup.value.steered is False
    assert await _queued(redis, thread) == []
    await _end(started[0], thread.id)


@pytest_asyncio.fixture(loop_scope="session")
async def saver(test_db_pool, monkeypatch):
    """The checkpointer the turn writes and admission reads back."""
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    from src.server.services.history.reader import CheckpointHistoryReader

    saver = AsyncPostgresSaver(test_db_pool)
    reader = CheckpointHistoryReader(saver)
    monkeypatch.setattr(
        CheckpointHistoryReader, "get_instance", classmethod(lambda cls: reader)
    )
    return saver


@contextlib.contextmanager
def _answers_lost(queue, times=1, then=None):
    """Redis applies the next ``times`` commands that remove from ``queue``,
    and their answers never reach the client, which raises as on a dropped
    connection. ``then`` runs as each answer is lost."""
    from redis.asyncio.connection import AbstractConnection
    from redis.exceptions import ConnectionError as RedisConnectionError

    send = AbstractConnection.send_packed_command
    read = AbstractConnection.read_response
    removing: set[int] = set()
    lost: list = []

    async def send_packed_command(self, command, check_health=True):
        if isinstance(command, (bytes, str)):
            command = [command]
        command = [c.encode() if isinstance(c, str) else c for c in command]
        await send(self, command, check_health)
        packet = b"".join(bytes(c) for c in command)
        removes = queue.encode() in packet and b"LREM" in packet
        if removes and len(lost) + len(removing) < times:
            removing.add(id(self))

    async def read_response(self, *args, **kwargs):
        answer = await read(self, *args, **kwargs)
        if id(self) not in removing:
            return answer
        removing.discard(id(self))
        lost.append(answer)
        if then is not None:
            await then()
        raise RedisConnectionError("the answer to the removal was lost")

    with (
        patch.object(AbstractConnection, "send_packed_command", send_packed_command),
        patch.object(AbstractConnection, "read_response", read_response),
    ):
        yield lost


async def _turn_takes_the_steer(saver, thread, running, *, ends):
    """The running turn's middleware takes the steer out of the queue, and the
    turn ends: its worker dies before the step that injected it is saved
    (``died-unsaved``) or after (``died-saved``), Redis applies the take and
    loses its answer, then the retry reads it back (``completed-retried``) or
    loses its answer too, so the turn completes without the steer
    (``completed-unread``), or the turn completes with it (``completed``)."""
    from langchain.agents import create_agent
    from langchain.agents.middleware import AgentMiddleware
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage, HumanMessage
    from langsmith import tracing_context

    from ptc_agent.agent.main_state import MainAgentState
    from ptc_agent.agent.middleware.steering import SteeringMiddleware

    class DiesTaking(SteeringMiddleware):
        async def abefore_model(self, state, runtime, *, config):
            await super().abefore_model(state, runtime, config=config)
            raise RuntimeError("worker lost")

    class DiesAfter(AgentMiddleware):
        async def abefore_model(self, state, runtime):
            raise RuntimeError("worker lost")

    def answers_lost(times):
        class AnswersLost(SteeringMiddleware):
            async def abefore_model(self, state, runtime, *, config):
                with _answers_lost(thread.queue, times=times):
                    return await super().abefore_model(state, runtime, config=config)

        return AnswersLost()

    middleware = {
        "died-unsaved": [DiesTaking()],
        "died-saved": [SteeringMiddleware(), DiesAfter()],
        "completed-retried": [answers_lost(1)],
        "completed-unread": [answers_lost(2)],
        "completed": [SteeringMiddleware()],
    }[ends]
    agent = create_agent(
        GenericFakeChatModel(messages=iter([AIMessage("a")])),
        tools=[],
        middleware=middleware,
        checkpointer=saver,
        state_schema=MainAgentState,
    )
    config = {"configurable": {"thread_id": thread.id}, "metadata": {"run_id": running}}
    question = {"messages": [HumanMessage("the turn's question")]}
    with tracing_context(enabled=False):
        if ends.startswith("died"):
            with pytest.raises(RuntimeError):
                await agent.ainvoke(question, config)
        else:
            await agent.ainvoke(question, config)
    await _end(running, thread.id, status="error" if ends.startswith("died") else "completed")


@pytest.mark.parametrize(
    "ends",
    ["died-unsaved", "died-saved", "completed-retried", "completed-unread", "completed"],
)
async def test_a_steer_a_turn_took_out_counts_only_once_saved(
    thread, redis, db_conn, saver, ends
):
    """Taken out of the queue is not yet seen: a worker that dies before
    saving the step that injected the steer, or a turn that lost Redis's
    answers to the take and its retry and completed without it, leaves the
    message in no run, so a resend runs it. Once saved, the steer is in the
    thread, and a resend is the steered duplicate it was."""
    from src.server.app.threads.messaging import _reject_duplicate_request
    from src.server.database.runs.lifecycle import DuplicateRequestError
    from src.server.services.runs.steer_queue import steered_run_id

    saved = ends in ("died-saved", "completed-retried", "completed")
    running = await _start(thread.id, "the turn's question")
    await _send(thread, "hello")
    await _turn_takes_the_steer(saver, thread, running, ends=ends)
    assert await _queued(redis, thread) == []
    assert await steered_run_id(thread.id, thread.key) == running

    try:
        if saved:
            detail = await _route_probe(thread)
            assert (detail["run_id"], detail["steered"]) == (running, True)
            with pytest.raises(DuplicateRequestError) as dup:
                await _send(thread, "hello")
            assert dup.value.steered is True
            with pytest.raises(DuplicateRequestError):
                await _begin(thread, "hello")
            assert await steered_run_id(thread.id, thread.key) == running
            assert await _queries(db_conn, thread) == 1
        else:
            await _reject_duplicate_request(thread.id, thread.key, thread.user_id)
            assert await _send(thread, "hello") == (True, None)
            started = await _begin(thread, "hello")
            assert await steered_run_id(thread.id, thread.key) is None
            assert (await _route_probe(thread))["run_id"] == started
            assert await _queries(db_conn, thread) == 2
            await _end(started, thread.id)
    finally:
        await saver.adelete_thread(thread.id)


@pytest_asyncio.fixture(loop_scope="session")
async def queue(redis):
    """A thread's steer queue alone: the middleware's take reads nothing else."""
    name = f"workflow:steering:{uuid.uuid4()}"
    yield name
    takes = [k async for k in redis.scan_iter(match="{" + name + "}:take:*")]
    await redis.delete(name, *takes)


def _entry(content):
    return json.dumps(
        {"content": content, "user_id": "u-1", "timestamp": 1.0, "run_id": "run-A"}
    )


async def _model_call(queue):
    """One model call's SteeringMiddleware step on ``queue``'s thread: what it
    injected, and the ``steering_delivered`` events it sent."""
    from ptc_agent.agent.middleware.steering import SteeringMiddleware

    runtime = MagicMock()
    config = {
        "configurable": {"thread_id": queue.rpartition(":")[2]},
        "metadata": {"run_id": "run-A"},
    }
    out = await SteeringMiddleware().abefore_model({}, runtime, config=config)
    sent = [call.args[0] for call in runtime.stream_writer.call_args_list]
    return [m.content for m in (out or {}).get("messages", [])], sent


async def test_a_take_whose_answer_is_lost_is_read_back_and_injected_once(
    redis, queue
):
    """Redis applies the take and its answer is lost. The retry finds the
    entry gone, and reads back what the first try removed, so the steer is
    injected once rather than dropped."""
    await redis.rpush(queue, _entry("hello"))

    with _answers_lost(queue) as lost:
        injected, sent = await _model_call(queue)

    assert len(lost) == 1
    assert injected == ["[Steering from User]\nhello"]
    assert [event["count"] for event in sent] == [1]
    assert await redis.lrange(queue, 0, -1) == []


async def test_a_retried_take_leaves_an_identical_entry_queued_since(redis, queue):
    """A second entry, equal byte for byte to the one taken, is queued while
    the take's answer is lost. The retry must not remove it too: it is a send
    of its own, and this take delivers only the first."""
    entry = _entry("again")
    await redis.rpush(queue, entry)

    async def queued_again():
        await redis.rpush(queue, entry)

    with _answers_lost(queue, then=queued_again):
        injected, _ = await _model_call(queue)

    assert injected == ["[Steering from User]\nagain"]
    assert await redis.lrange(queue, 0, -1) == [entry.encode()]


async def test_an_entry_another_reader_took_first_is_not_injected(
    redis, queue, monkeypatch
):
    """Between the middleware's read and its take, the post-push check
    reclaims an entry whose turn it found ended. The user gets that one back
    from there, so this turn must not inject it too."""
    from src.server.services.runs.steer_queue import reclaim

    kept, reclaimed = _entry("mine"), _entry("reclaimed")
    await redis.rpush(queue, kept, reclaimed)
    lrange = redis.lrange

    async def read_then_reclaimed(*args):
        entries = await lrange(*args)
        assert await reclaim(queue.rpartition(":")[2], reclaimed)
        return entries

    monkeypatch.setattr(redis, "lrange", read_then_reclaimed)
    injected, sent = await _model_call(queue)

    assert injected == ["[Steering from User]\nmine"]
    assert [event["count"] for event in sent] == [1]
    assert await lrange(queue, 0, -1) == []
