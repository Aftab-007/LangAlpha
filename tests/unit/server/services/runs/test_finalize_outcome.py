"""A finalize hands the CAS the turn's provenance and no copy of its stream.

Replay projects a settled turn from its checkpoint, so what the run streamed
has no reader on a new row; only its provenance and replay facts are kept
apart for it.
"""

import pytest
from langchain_core.messages import AIMessage

from src.server.services.runs.finalization import assemble_finalize_artifacts
from src.server.services.runs.sse_producer import RunSSEProducer

_KEY = ("t-outcome", "r-outcome")

_SOURCE = {
    "type": "provenance",
    "record_id": "rec-1",
    "source_type": "web",
    "identifier": "https://example.com/a",
    "tool_call_id": "call-1",
    "agent": None,
}


class _ScriptedGraph:
    def __init__(self, script):
        self._script = script

    def astream(self, _input_state, **_kwargs):
        async def _gen():
            for step in self._script:
                yield step

        return _gen()


async def _streamed():
    handler = RunSSEProducer(thread_id=_KEY[0], run_id=_KEY[1])
    script = [
        ((), "custom", dict(_SOURCE)),
        ((), "updates", {"model": {"messages": [AIMessage("done", id="ai-1")]}}),
    ]
    async for _ in handler.stream_workflow(
        _ScriptedGraph(script), input_state={}, config={}
    ):
        pass
    return handler


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "cancelled_by_user"),
    [("completed", False), ("cancelled", True)],
    ids=["completed", "user_stop"],
)
async def test_the_outcome_carries_provenance_and_no_events(status, cancelled_by_user):
    handler = await _streamed()
    outcome = await assemble_finalize_artifacts(
        _KEY,
        metadata={"handler": handler},
        status=status,
        phase="completion",
        interrupt_reason=None,
        pause_message=None,
        error=None,
        handler=handler,
        cancelled_by_user=cancelled_by_user,
        workspace_id=None,
        user_id=None,
    )

    assert getattr(outcome, "sse_events", None) is None
    [record] = outcome.record.provenance
    assert record["event"] == "provenance"
    assert record["data"]["identifier"] == "https://example.com/a"
    assert record["data"]["agent"] == "main"
