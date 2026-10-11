"""
Checkpoint Handler — Business logic for checkpoint history and thread turn operations.

Provides endpoints for:
- Listing turn-boundary checkpoints (for edit/regenerate/retry)
- Naming the turn an edit/regenerate replaces, from the checkpoint it forks at
- Retrying failed/interrupted threads from the appropriate checkpoint
"""

import logging
from typing import NamedTuple

from fastapi import HTTPException

from src.server.database.conversation import queries as queries_db
from src.server.database.conversation import threads_read
from src.server.services.history.reader import pair_turns, turn_anchors
from src.server.utils.checkpoint_helpers import (
    build_checkpoint_config,
    get_checkpointer,
    walk_current_branch_boundaries,
)
from src.server.models.workflow import (
    TurnCheckpointInfo,
    ThreadTurnsResponse,
)

logger = logging.getLogger(__name__)


async def get_thread_turns(
    thread_id: str, branch_tip_checkpoint_id: str | None = None
) -> ThreadTurnsResponse:
    """Turn boundaries on the thread's current branch, for edit/regenerate.

    Edit/regenerate fork the checkpoint graph, so only ancestors of the branch
    tip count (tip: ``branch_tip_checkpoint_id`` when on the graph, else the
    newest checkpoint). Each turn is named by its persisted ``turn_index``
    (``pair_turns``), the number its rows and replayed bubbles carry; a turn
    with no persisted turn to name is left out.
    """
    try:
        boundaries, tip_id = await walk_current_branch_boundaries(
            get_checkpointer(), thread_id, branch_tip_checkpoint_id
        )
        persisted = (
            await queries_db.get_query_turn_indexes(thread_id) if boundaries else []
        )
    except Exception as e:
        logger.error(f"[CHECKPOINT] Failed to list checkpoints for thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve checkpoint history")

    anchors = turn_anchors(boundaries, tip_id) if tip_id else []
    turns = [
        TurnCheckpointInfo(
            turn_index=turn_index,
            edit_checkpoint_id=None if anchor.is_resume else anchor.parent_checkpoint_id,
            regenerate_checkpoint_id=anchor.regenerate_checkpoint_id,
        )
        for anchor, turn_index in zip(anchors, pair_turns(anchors, persisted))
        if turn_index is not None
    ]

    return ThreadTurnsResponse(
        thread_id=thread_id,
        turns=turns,
        retry_checkpoint_id=tip_id,
    )


def stale_fork_detail() -> dict:
    """The 409 detail for a fork whose branch is no longer the thread's.

    One wording for both refusals: the route's, when the checkpoint forks no
    turn of the current branch, and START's, when another worker moved the
    branch after that check.
    """
    return {
        "code": "stale_fork",
        "message": "That message is no longer on this thread's current "
        "branch. Reload the thread and try again.",
    }


class ForkPoint(NamedTuple):
    """The turn a fork replaces, the branch tip it was read off, and the
    newest run's ``run_seq`` read with that tip."""

    turn_index: int
    branch_tip: str | None
    run_horizon: int | None = None


async def resolve_fork_turn(
    thread_id: str,
    checkpoint_id: str,
    *,
    regenerate: bool,
    requested: int | None = None,
) -> ForkPoint:
    """The turn an edit or regenerate at ``checkpoint_id`` replaces.

    The fork deletes rows from this turn onward, so the turn is read off the
    current branch by the checkpoint it forks at (an edit at the parent of the
    turn's input checkpoint, a regenerate at its ``regenerate_checkpoint_id``),
    not taken from the client's count. An edit keeps the client's
    ``requested`` turn only when nothing but turns that never checkpointed lie
    between it and the forked one, so rewriting a failed message works and no
    kept turn is deleted. A checkpoint that forks no turn of the current
    branch is refused: the client read a branch that has since been replaced.

    The answer holds only while the branch does, and this runs outside the
    transaction that admits the fork, so the tip it read travels with it, and
    the run horizon read with it: START refuses the fork once a run started
    after this read or the fork's checkpoint left the thread's branch.
    """
    branch = await threads_read.get_thread_branch_read(thread_id)
    branch_tip, horizon = branch.checkpoint_id, branch.run_horizon
    turns = await get_thread_turns(thread_id, branch_tip_checkpoint_id=branch_tip)
    kept: int | None = None
    for turn in turns.turns:
        forks_at = (
            turn.regenerate_checkpoint_id if regenerate else turn.edit_checkpoint_id
        )
        if forks_at == checkpoint_id:
            if (
                not regenerate
                and requested is not None
                and (kept is None or requested > kept)
                and requested <= turn.turn_index
            ):
                return ForkPoint(requested, branch_tip, horizon)
            return ForkPoint(turn.turn_index, branch_tip, horizon)
        kept = turn.turn_index if kept is None else max(kept, turn.turn_index)
    raise HTTPException(status_code=409, detail=stale_fork_detail())


async def get_retry_checkpoint(thread_id: str, checkpoint_id: str | None = None) -> str:
    """
    Determine the appropriate checkpoint ID for retrying a failed/interrupted thread.

    If checkpoint_id is provided, validates it exists and returns it.
    Otherwise, auto-detects the latest checkpoint.

    Args:
        thread_id: Thread identifier
        checkpoint_id: Optional explicit checkpoint ID

    Returns:
        The checkpoint ID to retry from

    Raises:
        HTTPException: If no checkpoint is found
    """
    checkpointer = get_checkpointer()

    if checkpoint_id:
        # Validate the provided checkpoint exists
        config = build_checkpoint_config(thread_id, checkpoint_id)
        cp_tuple = await checkpointer.aget_tuple(config)
        if not cp_tuple:
            raise HTTPException(
                status_code=404,
                detail=f"Checkpoint {checkpoint_id} not found for thread {thread_id}",
            )
        return checkpoint_id

    # Auto-detect: get the latest checkpoint
    config = build_checkpoint_config(thread_id)
    cp_tuple = await checkpointer.aget_tuple(config)
    if not cp_tuple:
        raise HTTPException(
            status_code=404,
            detail=f"No checkpoints found for thread {thread_id}",
        )

    return cp_tuple.config["configurable"]["checkpoint_id"]
