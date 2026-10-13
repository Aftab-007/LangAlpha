"""The finalize captures the sandbox images the turn's saved messages still
name, which the model-time capture left as paths.

The streamed text always carries the sandbox path; the saved message carries
it only when the capture at model time failed, and that copy is the one
replay shows.
"""

from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage
from langgraph.types import Overwrite

from src.server.services.runs.finalization import assemble_finalize_artifacts
from src.server.services.runs.sse_producer import RunSSEProducer

_KEY = ("t-images", "r-images")


class _ScriptedGraph:
    def __init__(self, script):
        self._script = script

    def astream(self, _input_state, **_kwargs):
        async def _gen():
            for step in self._script:
                yield step

        return _gen()


def _saved(node, message_id, text, namespace=()):
    return (namespace, "updates", {node: {"messages": [AIMessage(text, id=message_id)]}})


async def _streamed(*script):
    handler = RunSSEProducer(thread_id=_KEY[0], run_id=_KEY[1])
    async for _ in handler.stream_workflow(
        _ScriptedGraph(script), input_state={}, config={}
    ):
        pass
    return handler


async def _finalize(handler, status):
    hook = AsyncMock()
    await assemble_finalize_artifacts(
        _KEY,
        metadata={"artifact_hook": hook},
        status=status,
        phase="completion",
        interrupt_reason=None,
        pause_message=None,
        error=None,
        handler=handler,
        cancelled_by_user=False,
        workspace_id=None,
        user_id=None,
    )
    return hook


@pytest.mark.asyncio
async def test_the_hook_gets_the_paths_the_saved_messages_still_name():
    handler = await _streamed(
        _saved("model", "ai-1", "kept ![a](charts/a.png)"),
        _saved("model", "ai-2", "captured ![b](charts/b.png)"),
        # A later write of the same message replaces what it named.
        _saved("model", "ai-2", "captured ![b](https://cdn.example/b.png)"),
        # A subagent's messages are its lane's to capture.
        _saved("model", "ai-3", "![c](charts/c.png)", namespace=("task:k1",)),
        # The window trim restates earlier turns' messages, settled by theirs.
        (
            (),
            "updates",
            {
                "window": {
                    "messages": Overwrite([AIMessage("![d](charts/d.png)", id="ai-0")])
                }
            },
        ),
    )

    assert handler.saved_image_paths == {"charts/a.png"}
    hook = await _finalize(handler, "completed")
    hook.assert_awaited_once_with({"charts/a.png"})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("script", "status"),
    [
        ((_saved("model", "ai-1", "![a](https://cdn.example/a.png)"),), "completed"),
        ((_saved("model", "ai-1", "![a](charts/a.png)"),), "cancelled"),
    ],
    ids=["nothing_left_as_a_path", "not_completed"],
)
async def test_no_capture_runs_without_a_saved_path_on_a_completed_turn(script, status):
    hook = await _finalize(await _streamed(*script), status)

    hook.assert_not_awaited()
