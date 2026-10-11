"""Snapshot ``DeltaChannel`` state where a run branches off a checkpoint's pending writes.

A ``DeltaChannel`` checkpoint stores no value; a load replays the writes pending
on each ancestor. That assumes every checkpoint's pending writes went into its
child, which holds only for a run that continues from the head. A run started
at a checkpoint by id (a regenerate, a retry) or with new input drops them and
runs those tasks again, yet the new branch's loads still replay the dropped
writes beside the new ones. A rerun tool mints a new message id, so the reducer
keeps both copies: a regenerate of a turn resumed from a question, or a retry
of a step with a finished parallel tool, stores that tool's result twice, which
providers refuse on every later call.

A state update written on such a checkpoint (a compaction or offload of a
failed turn, a stop's flush) is a branch too: the update keeps none of the
pending writes, yet its checkpoint's loads replay them, and a retry from it
reruns their tasks on top.

langgraph 1.2.13 fixes both by snapshotting each such channel in the branch's
first checkpoint (``delta_channels_with_pending_writes``), so no load walks
past it. This backports that rule for the releases before it and stands down
once the installed release has its own. Upstream also seals the loaded writes
a resume from the head does not hand back, and moves an update of a superseded
checkpoint's writes off it; no run here resumes that way, and every update
here addresses its namespace's latest checkpoint.
"""

from __future__ import annotations

import functools
from collections.abc import Iterable, Mapping
from contextvars import ContextVar
from typing import Any

from langgraph._internal._config import ensure_config
from langgraph._internal._constants import (
    CONF,
    CONFIG_KEY_CHECKPOINT_NS,
    CONFIG_KEY_CHECKPOINTER,
    CONFIG_KEY_RESUMING,
)
from langgraph._internal._typing import MISSING
from langgraph.channels import DeltaChannel
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.pregel import _checkpoint
from langgraph.pregel import main as pregel_main
from langgraph.pregel._loop import PregelLoop
from langgraph.types import Command


def upstream_snapshots_new_branches() -> bool:
    return hasattr(_checkpoint, "delta_channels_with_pending_writes")


def _delta_channels_written(specs: Mapping[str, Any], pending_writes: Iterable) -> set[str]:
    return {
        channel
        for _, channel, _ in pending_writes or ()
        if isinstance(specs.get(channel), DeltaChannel)
    }


def _resumes_from_head(loop: PregelLoop) -> bool:
    """Whether the run hands the loaded writes back to the tasks that made them.

    Mirrors how ``PregelLoop._first`` decides it is resuming; addressing a
    checkpoint by id replays it, which reruns every task instead.
    """
    if loop.is_replaying or not loop.checkpoint["channel_versions"]:
        return False
    configurable = loop.config.get(CONF, {})
    return bool(
        configurable.get(
            CONFIG_KEY_RESUMING,
            loop.input is None
            or isinstance(loop.input, Command)
            or (
                not loop.is_nested
                and loop.config.get("metadata", {}).get("run_id")
                == loop.checkpoint_metadata.get("run_id", MISSING)
            ),
        )
    )


def snapshot_delta_channels_on_new_branch() -> None:
    if upstream_snapshots_new_branches():
        return
    original = PregelLoop._first
    if getattr(original, "_snapshots_new_branch", False):
        return

    @functools.wraps(original)
    def _first(self, *, input_keys, updated_channels):
        touched = _delta_channels_written(self.specs, self.checkpoint_pending_writes)
        if touched and not _resumes_from_head(self):
            versions = self.checkpoint["channel_versions"]
            # The saver stores a blob only under a channel version, and a
            # thread's first input reaches ``messages`` after its root.
            for channel in touched - versions.keys():
                versions[channel] = self.checkpointer_get_next_version(None, None)
            # The set the loop already snapshots after an Overwrite.
            self._delta_channels_with_overwrite.update(touched)
        return original(self, input_keys=input_keys, updated_channels=updated_channels)

    _first._snapshots_new_branch = True
    PregelLoop._first = _first


# The channels the running update's first checkpoint snapshots; the plan below
# takes them once, as upstream applies them to the first superstep alone.
_update_base_writes: ContextVar[set[str] | None] = ContextVar(
    "delta_branch_update_base_writes", default=None
)


def _update_base_saver(graph: Any, config: Any) -> BaseCheckpointSaver | None:
    """The saver the update reads its base from, or None when this graph only
    hands the update to a subgraph, whose own call reads it."""
    configurable = ensure_config(config)[CONF]
    if configurable.get(CONFIG_KEY_CHECKPOINT_NS) and CONFIG_KEY_CHECKPOINTER not in configurable:
        return None
    saver = configurable.get(CONFIG_KEY_CHECKPOINTER, graph.checkpointer)
    if not isinstance(saver, BaseCheckpointSaver):
        return None
    return graph._apply_checkpointer_allowlist(saver)


def snapshot_delta_channels_on_update() -> None:
    if upstream_snapshots_new_branches():
        return
    Pregel = pregel_main.Pregel
    if getattr(Pregel.abulk_update_state, "_snapshots_update_base", False):
        return
    plan = pregel_main.create_checkpoint_plan_for_update_state_api
    original_async = Pregel.abulk_update_state
    original_sync = Pregel.bulk_update_state

    @functools.wraps(plan)
    def _plan(channels, updated_channels, **kwargs):
        to_snapshot, metadata = plan(channels, updated_channels, **kwargs)
        base_writes = _update_base_writes.get()
        if not base_writes:
            return to_snapshot, metadata
        added = base_writes - to_snapshot
        base_writes.clear()
        counters = metadata.get("counters_since_delta_snapshot")
        if counters:
            for channel in added:
                counters.pop(channel, None)
            if not counters:
                del metadata["counters_since_delta_snapshot"]
        return to_snapshot | added, metadata

    # One read of the base more than upstream makes: the superstep reads it
    # inside, out of reach.
    @functools.wraps(original_async)
    async def abulk_update_state(self, config, supersteps):
        saver = _update_base_saver(self, config)
        base = await saver.aget_tuple(ensure_config(self.config, config)) if saver else None
        token = _update_base_writes.set(
            _delta_channels_written(self.channels, base.pending_writes) if base else None
        )
        try:
            return await original_async(self, config, supersteps)
        finally:
            _update_base_writes.reset(token)

    @functools.wraps(original_sync)
    def bulk_update_state(self, config, supersteps):
        saver = _update_base_saver(self, config)
        base = saver.get_tuple(ensure_config(self.config, config)) if saver else None
        token = _update_base_writes.set(
            _delta_channels_written(self.channels, base.pending_writes) if base else None
        )
        try:
            return original_sync(self, config, supersteps)
        finally:
            _update_base_writes.reset(token)

    abulk_update_state._snapshots_update_base = True
    bulk_update_state._snapshots_update_base = True
    pregel_main.create_checkpoint_plan_for_update_state_api = _plan
    Pregel.abulk_update_state = abulk_update_state
    Pregel.bulk_update_state = bulk_update_state
