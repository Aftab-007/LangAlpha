"""What a turn's checkpoints committed, for readers outside replay.

The secretary's ``agent_output`` reads a thread's newest turns while its own
turn waits. A turn's stored slice serves it while the slice is the turn's on
the current branch, by the rule replay applies (``slices.stored_spans``);
only a turn without one waits for its projection. Replay's stored lines would
serve the same text, but checking them reads every row of the thread, which
costs this path several times what the slice read does.

A lane whose stream outlived its checkpoints (a worker lost mid-turn, a
subagent that failed) keeps the provenance of only the tool calls whose
results were saved: what replay shows of the lane is what the checkpoints
hold, and a source no saved result came from is one nothing shown ever read.
"""

from __future__ import annotations

import logging
from collections.abc import Collection, Iterable, Mapping
from typing import Any

from langchain_core.messages import ToolMessage

from src.server.database.conversation import turn_slices as slices_db
from src.server.database.conversation.replay_rows import get_branch_pointer
from src.server.services.history import slices
from src.server.services.history.projector import (
    history_events_to_sse,
    messages_to_history_events,
)
from src.server.services.history.reader import CheckpointHistoryReader, TurnAnchor
from src.server.services.history.replay.errors import CheckpointReplayUnavailable
from src.server.utils.checkpoint_helpers import CheckpointBranchTipNotFound

logger = logging.getLogger(__name__)

# The endings that can leave a streamed result unsaved: a step stopped or
# failed after some of its tool calls finished keeps their results only as
# pending writes, which the thread's next input discards. A completed run
# saved everything it streamed, and an interrupted run's finished calls are
# committed by its resume.
UNSAVED_RESULT_ENDINGS = frozenset({"cancelled", "error"})


async def committed_texts(thread_id: str, turns: Mapping[str, Any]) -> dict[str, str]:
    """The main agent's text in each of ``turns`` (response id to turn
    index), cut from the turn's stored slice, which a turn without one has
    projected first, as its settle would have. A turn whose lanes wait on the
    thread's claims pass is read straight from its checkpoints instead: the
    pass places subagent launches, which its main lane never needs. A
    response left out has no checkpoint boundary or its read failed, so its
    stored events are the caller's to read."""
    from src.server.services.history.replay.refresh import refresh_thread

    anchors = await _anchors(thread_id, turns)
    texts = await _slice_texts(thread_id, anchors)
    missing = {rid for rid in anchors if rid not in texts}
    if missing:
        await refresh_thread(thread_id, missing, claims_pass=False)
        texts.update(
            await _slice_texts(
                thread_id, {rid: anchors[rid] for rid in missing}
            )
        )
    if unread := {rid: a for rid, a in anchors.items() if rid not in texts}:
        texts.update(await _checkpoint_texts(thread_id, unread))
    return texts


async def _anchors(
    thread_id: str, turns: Mapping[str, Any]
) -> dict[str, TurnAnchor]:
    """Each response's turn on the current branch, paired as replay pairs
    them; none when the branch cannot be read or paired."""
    from src.server.services.history.replay import pair_anchors

    try:
        pointer = await get_branch_pointer(thread_id)
        if pointer is None:
            return {}
        tip, persisted = pointer
        anchors, _ = await CheckpointHistoryReader.get_instance().aget_turn_anchors(
            thread_id, tip
        )
        paired = dict(pair_anchors(anchors, persisted))
    except (CheckpointBranchTipNotFound, CheckpointReplayUnavailable) as e:
        logger.debug("no branch to read for %s: %s", thread_id, e)
        return {}
    except Exception:
        logger.warning(
            "branch read failed for %s; using stored events", thread_id, exc_info=True
        )
        return {}
    return {rid: paired[ti] for rid, ti in turns.items() if ti in paired}


async def _slice_texts(
    thread_id: str, anchors: Mapping[str, TurnAnchor]
) -> dict[str, str]:
    """Main-lane text by response id, for the turns with a usable slice."""
    if not anchors:
        return {}
    try:
        serde = CheckpointHistoryReader.get_instance().serde
        rows = await slices_db.get_turn_slices(list(anchors))
    except Exception:
        logger.warning("turn slice read failed; using stored events", exc_info=True)
        return {}
    return _span_texts(thread_id, slices.stored_spans(serde, anchors, rows))


async def _checkpoint_texts(
    thread_id: str, anchors: Mapping[str, TurnAnchor]
) -> dict[str, str]:
    """Main-lane text by response id, cut from each turn's checkpoints."""
    try:
        turns = await CheckpointHistoryReader.get_instance().aget_turn_slices(
            thread_id, list(anchors.values())
        )
    except Exception:
        logger.warning("turn read failed; using stored events", exc_info=True)
        return {}
    return _span_texts(thread_id, dict(zip(anchors, turns)))


def _span_texts(
    thread_id: str, spans: Mapping[str, slices.SpanDelta]
) -> dict[str, str]:
    out: dict[str, str] = {}
    for response_id, span in spans.items():
        try:
            items = history_events_to_sse(
                messages_to_history_events(span.messages), thread_id=thread_id
            )
        except Exception:
            logger.warning(
                "turn slice projection failed for response %s; using stored events",
                response_id,
                exc_info=True,
            )
            continue
        out[response_id] = "".join(
            d["content"]
            for i in items
            if i.get("event") == "message_chunk"
            and isinstance(d := i.get("data"), dict)
            and d.get("content_type") == "text"
            and isinstance(d.get("content"), str)
            and d["content"]
        )
    return out


def saved_tool_calls(messages: Iterable[Any]) -> frozenset[str]:
    """The tool calls whose results ``messages`` hold."""
    return frozenset(
        m.tool_call_id
        for m in messages
        if isinstance(m, ToolMessage) and isinstance(m.tool_call_id, str)
    )


def saved_provenance(
    events: Iterable[dict[str, Any]], saved: Collection[str]
) -> list[dict[str, Any]]:
    """The ``provenance`` events of the tool calls in ``saved``."""
    kept: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, dict) or event.get("event") != "provenance":
            continue
        data = event.get("data")
        source = data if isinstance(data, dict) else event
        if source.get("tool_call_id") in saved:
            kept.append(event)
    return kept


async def run_saved_tool_calls(thread_id: str, run_id: str) -> frozenset[str]:
    """The tool calls whose results ``run_id``'s newest checkpoint holds."""
    state = await CheckpointHistoryReader.get_instance().aget_run_state(
        thread_id, run_id
    )
    if state is None:
        return frozenset()
    return saved_tool_calls((state.values or {}).get("messages") or ())


async def task_saved_tool_calls(thread_id: str, task_id: str) -> frozenset[str]:
    """The tool calls whose results the task's newest checkpoint holds."""
    history = await CheckpointHistoryReader.get_instance().aget_task_history(
        thread_id, task_id
    )
    return saved_tool_calls(history.messages)
