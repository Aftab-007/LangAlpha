"""Utility helpers for background subagent middleware."""

import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

#: Who sent the steers waiting, empty when none: truthy is "wake up".
MessageChecker = Callable[[], Awaitable[list[str]]]


def config_own_run_id(config: dict | None) -> str | None:
    """The run stamped into this invocation's config metadata (v4 2.4c) —
    the same identity SteeringMiddleware filters deliveries by."""
    return ((config or {}).get("metadata") or {}).get("run_id")


async def build_message_checker(
    thread_id: str | None, own_run_id: str | None = None
) -> MessageChecker | None:
    """An async closure: who sent the steers waiting that this run would take
    in, empty when none.

    Mirrors what SteeringMiddleware takes (``pending_steer_senders`` shares its
    predicate): counting a steer this run cannot take would wake a wait or
    re-invoke the agent for a message that never arrives. A failed read
    counts as nothing waiting. None without a thread, so callers skip it.
    """
    if not thread_id:
        return None

    async def checker() -> list[str]:
        from src.server.database.runs import outbox as outbox_db

        try:
            return await outbox_db.pending_steer_senders(thread_id, own_run_id)
        except Exception:
            logger.warning(
                f"[Steering] Checking {thread_id} for steers failed", exc_info=True
            )
            return []

    return checker
