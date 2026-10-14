"""A compaction's summary rides on the response that answered from it.

The summary message lives only in ``_summarization_event``, which the next
compaction overwrites, so replay reads each summary, and where in the turn it
fired, off that response.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage

from ptc_agent.agent.middleware.compaction import middleware as mw_module
from ptc_agent.agent.middleware.compaction.compact import Compaction
from ptc_agent.agent.middleware.compaction.middleware import CompactionMiddleware
from ptc_agent.agent.middleware.compaction.summarize import Summary
from ptc_agent.agent.middleware.compaction.utils import (
    build_summary_message,
    compaction_summary,
)

pytestmark = pytest.mark.asyncio


def _history() -> list:
    return [HumanMessage("go", id="h0"), *(AIMessage(f"a{i}", id=f"a{i}") for i in range(8))]


def _middleware(summary_message: HumanMessage) -> CompactionMiddleware:
    async def compact(messages, view, cutoff, **_):
        preserved = view[cutoff:]
        return Compaction(
            event={
                "summary_message": summary_message,
                "cutoff_index": cutoff,
                "anchor_message_id": preserved[0].id,
            },
            summary=Summary("condensed", "model", view[:cutoff]),
            original_count=len(view),
            preserved=preserved,
        )

    return CompactionMiddleware(
        SimpleNamespace(counter=len, compact=compact),
        token_threshold=100,
        keep_messages=2,
    )


async def _answer(mw: CompactionMiddleware, measured: int) -> AIMessage:
    answer = AIMessage("done", id="ai-done")

    async def handler(request):
        return ModelResponse(result=[answer])

    request = ModelRequest(
        model=GenericFakeChatModel(messages=iter([])),
        messages=_history(),
        system_message=None,
        tool_choice=None,
        tools=[],
        response_format=None,
        state={"messages": _history(), "_cached_input_tokens": measured},
        runtime=None,
    )
    await mw.awrap_model_call(request, handler)
    return answer


async def test_the_response_to_a_compacted_call_carries_the_signal_it_followed(
    monkeypatch,
):
    signals: list[dict] = []
    monkeypatch.setattr(mw_module, "get_stream_writer", lambda: signals.append)
    summary_message = build_summary_message("condensed", None, original_message_count=9)

    answer = await _answer(_middleware(summary_message), measured=500)

    (complete,) = [
        s for s in signals if s["action"] == "summarize" and s["signal"] == "complete"
    ]
    fields = {k: v for k, v in complete.items() if k not in ("type", "action", "signal")}
    assert compaction_summary(answer) == {
        "summary_message_id": summary_message.id,
        **fields,
    }
    assert fields == {
        "summary_length": len("condensed"),
        "original_message_count": 9,
        "summary_text": "condensed",
        "source": "model",
    }


async def test_a_call_that_did_not_compact_carries_no_summary():
    summary_message = build_summary_message("condensed", None)

    answer = await _answer(_middleware(summary_message), measured=50)

    assert compaction_summary(answer) is None
