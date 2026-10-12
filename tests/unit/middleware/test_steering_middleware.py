"""SteeringMiddleware delivery: peek, partition by run stamp, LREM consumed.

Review F3 (v4 2.4c): the middleware must never destructively pop payloads it
does not deliver. A payload stamped for a FOREIGN run stays in the queue
untouched (the end-of-run drain returns it to the user); only delivered (or
garbage) payloads are removed, each by exact-value LREM — so a crash between
read and remove can only re-deliver, never lose, an accepted user message.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ptc_agent.agent.middleware.steering import SteeringMiddleware
from tests.unit.server.handlers.chat.redis_fakes import FakeCache

_KEY = "workflow:steering:t-1"


def _config(run_id: str | None = "run-A") -> dict:
    cfg: dict = {"configurable": {"thread_id": "t-1"}}
    if run_id is not None:
        cfg["metadata"] = {"run_id": run_id}
    return cfg


def _payload(content: str, run_id: str | None) -> str:
    data: dict = {"content": content}
    if run_id is not None:
        data["run_id"] = run_id
    return json.dumps(data)


async def _run(cache: FakeCache, config: dict, registry=None):
    runtime = MagicMock()
    with patch(
        "src.utils.cache.redis_cache.get_cache_client", return_value=cache
    ):
        return await SteeringMiddleware(registry).abefore_model(
            {}, runtime, config=config
        )


def _registry(*reports: dict) -> MagicMock:
    registry = MagicMock()
    registry.report_inbox = AsyncMock(return_value=list(reports))
    return registry


_R1 = {
    "content": "REPORT ONE",
    "report_source": {"kind": "task", "task_id": "a"},
    "job_id": "job-1",
}
_R2 = {
    "content": "REPORT TWO",
    "report_source": {"kind": "task", "task_id": "b"},
    "job_id": "job-2",
}


@pytest.mark.asyncio
async def test_delivers_own_and_unstamped_but_leaves_foreign_queued():
    cache = FakeCache()
    cache.client.lists[_KEY] = [
        _payload("for me", "run-A"),
        _payload("legacy unstamped", None),
        _payload("for the dead run", "run-B"),
    ]

    result = await _run(cache, _config("run-A"))

    assert result is not None
    (msg,) = result["messages"]
    assert "for me" in msg.content
    assert "legacy unstamped" in msg.content
    assert "for the dead run" not in msg.content
    # The foreign payload is still queued — untouched, not popped-and-repushed.
    assert cache.client.lists[_KEY] == [_payload("for the dead run", "run-B")]


@pytest.mark.asyncio
async def test_delivered_entry_keeps_its_chat_app():
    """The label reads the platform off the delivered entry; the model reads
    only the content."""
    cache = FakeCache()
    cache.client.lists[_KEY] = [
        json.dumps({"content": "from the phone", "run_id": "run-A", "platform": "telegram"}),
        _payload("from the web", "run-A"),
    ]

    result = await _run(cache, _config("run-A"))

    (msg,) = result["messages"]
    assert "telegram" not in msg.content
    phone, web = msg.additional_kwargs["steering_delivered"]["messages"]
    assert phone["platform"] == "telegram"
    assert "platform" not in web


@pytest.mark.asyncio
async def test_all_foreign_queue_is_left_intact():
    cache = FakeCache()
    queued = [_payload("x", "run-B"), _payload("y", "run-C")]
    cache.client.lists[_KEY] = list(queued)

    result = await _run(cache, _config("run-A"))

    assert result is None
    assert cache.client.lists[_KEY] == queued


@pytest.mark.asyncio
async def test_unstamped_run_consumes_everything():
    """No own-run identity in config (legacy caller): all payloads deliver,
    matching pre-stamp behavior."""
    cache = FakeCache()
    cache.client.lists[_KEY] = [
        _payload("a", "run-B"),
        _payload("b", None),
    ]

    result = await _run(cache, _config(run_id=None))

    assert result is not None
    assert cache.client.lists.get(_KEY, []) == []


@pytest.mark.asyncio
async def test_garbage_payload_is_removed_but_not_delivered():
    cache = FakeCache()
    cache.client.lists[_KEY] = ["not json {", _payload("real", "run-A")]

    result = await _run(cache, _config("run-A"))

    assert result is not None
    (msg,) = result["messages"]
    assert "real" in msg.content
    assert cache.client.lists.get(_KEY, []) == []


@pytest.mark.asyncio
async def test_duplicate_own_payloads_all_consumed():
    """LREM count=1 per read instance: two identical payloads read = two
    removed, none stranded."""
    cache = FakeCache()
    dup = _payload("again", "run-A")
    cache.client.lists[_KEY] = [dup, dup]

    result = await _run(cache, _config("run-A"))

    assert result is not None
    assert cache.client.lists.get(_KEY, []) == []


@pytest.mark.asyncio
async def test_the_injected_steer_is_named_after_the_keyed_sends_it_carries():
    """A resend of a send whose run died before saving the step that
    injected it is answered from that run's checkpoint, by this id."""
    from ptc_agent.agent.middleware.steering import carries_steer_key

    keyed = [
        "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
        "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b",
    ]
    cache = FakeCache()
    cache.client.lists[_KEY] = [
        json.dumps({"content": "one", "run_id": "run-A", "request_key": keyed[0]}),
        _payload("keyless", "run-A"),
        json.dumps({"content": "two", "run_id": "run-A", "request_key": keyed[1]}),
    ]

    (msg,) = (await _run(cache, _config("run-A")))["messages"]

    assert [carries_steer_key(msg, k) for k in keyed] == [True, True]
    assert not carries_steer_key(msg, "0f8fad5b-d9cb-469f-a165-70867728950e")


@pytest.mark.asyncio
async def test_a_send_injected_again_under_its_key_is_a_message_of_its_own():
    """Once its record expired, a send under the same key can be accepted and
    injected again. The reducer replaces a message whose id it holds, so a
    shared id would overwrite the earlier steer where it stands, ahead of
    the answer that followed it."""
    from langchain_core.messages import AIMessage, HumanMessage

    from ptc_agent.agent.middleware.steering import carries_steer_key
    from ptc_agent.agent.state import messages_delta_reducer

    key = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"
    entry = json.dumps({"content": "again", "run_id": "run-A", "request_key": key})
    injected = []
    for _ in range(2):
        cache = FakeCache()
        cache.client.lists[_KEY] = [entry]
        (msg,) = (await _run(cache, _config("run-A")))["messages"]
        injected.append(msg)

    state = messages_delta_reducer([HumanMessage("question", id="q")], [[injected[0]]])
    state = messages_delta_reducer(state, [[AIMessage("answer", id="a")]])
    state = messages_delta_reducer(state, [[injected[1]]])

    assert [m.id for m in state] == ["q", injected[0].id, "a", injected[1].id]
    assert all(carries_steer_key(m, key) for m in injected)


@pytest.mark.asyncio
async def test_a_steer_with_no_keyed_send_keeps_an_ordinary_id():
    cache = FakeCache()
    cache.client.lists[_KEY] = [_payload("keyless", "run-A")]

    (msg,) = (await _run(cache, _config("run-A")))["messages"]

    assert msg.id is None


@pytest.mark.asyncio
async def test_reports_alone_inject_one_message_without_user_header():
    registry = _registry(_R1, _R2)

    result = await _run(FakeCache(), _config(), registry)

    (msg,) = result["messages"]
    assert msg.content == "REPORT ONE\n\nREPORT TWO"
    assert "[Steering from User]" not in msg.content
    assert msg.additional_kwargs["lc_source"] == "steering"
    delivered = msg.additional_kwargs["steering_delivered"]
    assert delivered["count"] == 2
    assert [(m["content"], m["report_source"]) for m in delivered["messages"]] == [
        ("", _R1["report_source"]),
        ("", _R2["report_source"]),
    ]
    registry.report_inbox.assert_awaited_once_with("t-1", "run-A")
    # The run holds them until the model call that reads them confirms them.
    assert msg.additional_kwargs["held_reports"] == {
        "run_id": "run-A",
        "job_ids": ["job-1", "job-2"],
    }


@pytest.mark.asyncio
async def test_reports_come_before_user_steering():
    cache = FakeCache()
    cache.client.lists[_KEY] = [_payload("do it differently", "run-A")]

    result = await _run(cache, _config(), _registry(_R1))

    (msg,) = result["messages"]
    assert msg.content.index("REPORT ONE") < msg.content.index("[Steering from User]")
    assert msg.content.endswith("do it differently")
    delivered = msg.additional_kwargs["steering_delivered"]
    assert delivered["count"] == 2
    report, user = delivered["messages"]
    assert report["report_source"] == _R1["report_source"]
    assert user["content"] == "do it differently"


@pytest.mark.asyncio
@pytest.mark.parametrize("registry", [None, object()])
async def test_without_a_report_inbox_only_user_steering_is_delivered(registry):
    cache = FakeCache()
    cache.client.lists[_KEY] = [_payload("just me", "run-A")]

    result = await _run(cache, _config(), registry)

    (msg,) = result["messages"]
    assert msg.content == "[Steering from User]\njust me"
    assert msg.additional_kwargs["steering_delivered"]["count"] == 1


@pytest.mark.asyncio
async def test_failing_report_inbox_still_delivers_user_steering():
    registry = MagicMock()
    registry.report_inbox = AsyncMock(side_effect=RuntimeError("db down"))
    cache = FakeCache()
    cache.client.lists[_KEY] = [_payload("just me", "run-A")]

    result = await _run(cache, _config(), registry)

    (msg,) = result["messages"]
    assert msg.content == "[Steering from User]\njust me"


@pytest.mark.asyncio
async def test_failing_user_steering_read_still_injects_handed_over_reports():
    cache = FakeCache()
    cache.client.lrange = AsyncMock(side_effect=RuntimeError("redis down"))

    result = await _run(cache, _config(), _registry(_R1))

    (msg,) = result["messages"]
    assert msg.content == "REPORT ONE"
    assert msg.additional_kwargs["steering_delivered"]["count"] == 1



# ---------------------------------------------------------------------------
# The model call confirms the reports injected since the last model response
# ---------------------------------------------------------------------------


async def _model_call(messages, registry):
    from langchain_core.messages import AIMessage

    request = MagicMock()
    request.state = {"messages": messages}
    handler = AsyncMock(return_value=AIMessage(content="ok"))
    response = await SteeringMiddleware(registry).awrap_model_call(request, handler)
    handler.assert_awaited_once_with(request)
    return response


def _held(*job_ids: str, run_id: str = "run-A"):
    from langchain_core.messages import HumanMessage

    return HumanMessage(
        content="REPORT",
        additional_kwargs={"held_reports": {"run_id": run_id, "job_ids": list(job_ids)}},
    )


@pytest.mark.asyncio
async def test_model_call_confirms_reports_injected_since_the_last_response():
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

    registry = MagicMock()
    registry.report_confirm = AsyncMock()
    messages = [
        HumanMessage(content="go"),
        _held("job-old"),
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "t", "args": {}}]),
        ToolMessage(content="r", tool_call_id="c1"),
        _held("job-1", "job-2"),
    ]

    await _model_call(messages, registry)

    registry.report_confirm.assert_awaited_once_with("run-A", ["job-1", "job-2"])


@pytest.mark.asyncio
async def test_model_call_without_held_reports_confirms_nothing():
    from langchain_core.messages import AIMessage, HumanMessage

    registry = MagicMock()
    registry.report_confirm = AsyncMock()

    await _model_call([_held("job-old"), AIMessage(content="x"), HumanMessage("hi")], registry)

    registry.report_confirm.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_confirm_still_makes_the_model_call():
    registry = MagicMock()
    registry.report_confirm = AsyncMock(side_effect=RuntimeError("db down"))

    response = await _model_call([_held("job-1")], registry)

    assert response.content == "ok"
