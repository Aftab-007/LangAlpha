"""A step the retired Flash agent left waiting on the user, resumed by the Chief of Staff.

Threads Flash ran continue in Home, and so do Home threads it ran while the
all-workspaces agent was switched off. A step Flash left waiting on the user
(dispatching work, deleting a workspace) can name a tool the Chief of Staff
does not have, so it is answered as cancelled before the thread resumes.
"""

from __future__ import annotations

import logging
from collections.abc import Collection
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage

from ptc_agent.agent.state import ensure_message_ids

logger = logging.getLogger(__name__)

_CANCELLED = (
    "Not run: this chat changed agents before the user answered. Ask again if "
    "it is still wanted."
)


async def hand_over_flash_thread(
    graph: Any, thread_id: str, *, replay: bool, base: str | None = None
) -> tuple[list[ToolMessage], str | None]:
    """Cancel what Flash left waiting, then mark the thread the full agent's.

    Best effort, and in that order: a failure leaves the thread Flash's, so the
    next turn tries again, and a turn with a new message drops the waiting step
    anyway. A replay forks from an earlier checkpoint, so the latest one's
    waiting step is not this turn's to answer; a turn that starts from
    ``base`` (``turn_start_checkpoint_id``) answers the one there. Returns the
    cancelled results, which the turn streams (see ``_cancel_tool_calls``), and
    the checkpoint the turn starts from: ``base``, or the answers written on it.
    """
    from src.server.database.conversation import promote_flash_thread

    cancelled: list[ToolMessage] = []
    start = base
    try:
        if not replay:
            cancelled, start = await _cancel_tool_calls(
                graph, thread_id, _tool_names(graph), base
            )
        await promote_flash_thread(thread_id)
    except Exception:
        logger.warning(
            f"[PTC_CHAT] Flash thread handover failed: thread_id={thread_id}",
            exc_info=True,
        )
    return cancelled, start


async def cancel_tool_calls_it_lacks(graph: Any, thread_id: str) -> list[ToolMessage]:
    """Answer a waiting step the resuming agent cannot run, before a resume.

    Best effort: a failure leaves the step as it is, and the resume then
    answers the call as a tool the agent does not have. Returns the cancelled
    results, which the turn streams (see ``_cancel_tool_calls``).
    """
    try:
        cancelled, _ = await _cancel_tool_calls(graph, thread_id, _tool_names(graph))
        return cancelled
    except Exception:
        logger.warning(
            f"[CHAT] Cancelling another agent's waiting step failed: "
            f"thread_id={thread_id}",
            exc_info=True,
        )
        return []


def _tool_names(graph: Any) -> frozenset[str]:
    """Every tool the graph can run, middleware's included.

    The model may be shown fewer on a turn; this is what the tool node holds.
    """
    return frozenset(graph.nodes["tools"].bound.tools_by_name)


async def _cancel_tool_calls(
    graph: Any,
    thread_id: str,
    tool_names: Collection[str],
    base: str | None = None,
) -> tuple[list[ToolMessage], str | None]:
    """Answer every call of a step waiting at ``base``, or at the newest
    checkpoint, that the graph cannot resume.

    Returns the cancellations, which the turn streams itself: the update lands
    before its stream opens, so the graph never emits them, and a card waiting
    on one would never settle. The finished results already streamed when
    their calls returned. Also returns ``base``, or the update when it was
    written on ``base``, since it forks from there and is not the newest.
    """
    config = {"configurable": {"thread_id": thread_id}}
    if base is not None:
        # The root namespace too: a saver need not fill it in when it loads a
        # named checkpoint, and the update is saved under the loaded config.
        config["configurable"].update(checkpoint_ns="", checkpoint_id=base)
    state = await graph.aget_state(config)
    if not state.interrupts:
        return [], base
    messages = state.values.get("messages") or []
    last_ai = next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)
    if last_ai is None or not last_ai.tool_calls:
        return [], base
    # A call that finished beside the waiting one is still a pending write of
    # the step, which an update drops, so its result is carried over.
    finished = [
        message
        for task in state.tasks
        if not task.interrupts and isinstance(task.result, dict)
        for message in _as_list(task.result.get("messages"))
        if isinstance(message, ToolMessage)
    ]
    answered = {
        m.tool_call_id for m in (*messages, *finished) if isinstance(m, ToolMessage)
    }
    unanswered = [call for call in last_ai.tool_calls if call["id"] not in answered]
    # By name, as the resume runs a call: the agents share some names (a
    # question, the workspace tool), and each resumes those itself.
    if all(call["name"] in tool_names for call in unanswered):
        return [], base
    # The update ends the step, so every call still waiting in it is answered,
    # or the next model call finds one without a result.
    cancelled = [
        ToolMessage(
            content=_CANCELLED,
            tool_call_id=call["id"],
            name=call["name"],
            status="error",
        )
        for call in unanswered
    ]
    written = await graph.aupdate_state(
        config,
        {"messages": ensure_message_ids([*finished, *cancelled])},
        as_node="tools",
    )
    logger.info(
        f"[CHAT] Cancelled {len(cancelled)} tool call(s) another agent left "
        f"waiting: thread_id={thread_id}"
    )
    return cancelled, (
        None if base is None else written["configurable"]["checkpoint_id"]
    )


def _as_list(value: Any) -> list:
    if value is None:
        return []
    return list(value) if isinstance(value, (list, tuple)) else [value]
