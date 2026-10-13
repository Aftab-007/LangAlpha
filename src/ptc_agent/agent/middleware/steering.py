"""
Steering Middleware.

Before each LLM call, takes in what reached the thread while the agent works:
the user's steering messages from Redis, and the reports owed to the thread
by background work that finished meanwhile. Both are picked up before the
next model invocation instead of waiting for the turn to end.
"""

import hashlib
import logging
import time
import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any, Protocol, TypedDict

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.runtime import Runtime

from langchain.agents.middleware.types import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)
from ptc_agent.agent.middleware.background_subagent.utils import (
    config_own_run_id,
    decode_steer,
    is_foreign_steer,
    steering_queue_key,
)

logger = logging.getLogger(__name__)

_STEERING_ID_PREFIX = "steering-"

# How long a take's answer stays readable, for a retry after it was lost.
_TAKE_TTL_S = 600

# Removes each entry a turn chose (ARGV[2..]) by exact value, count 1, so an
# entry read twice is removed twice, and answers '1' per entry this take
# removed. The answer is kept under the take's own key (KEYS[2], braced into
# the queue's cluster slot), so a retry after a lost answer reads it back
# rather than removing a second, identical entry queued since.
_TAKE_LUA = """
local taken = redis.call('GET', KEYS[2])
if taken then
  return taken
end
local removed = {}
for i = 2, #ARGV do
  removed[#removed + 1] = redis.call('LREM', KEYS[1], 1, ARGV[i])
end
taken = table.concat(removed)
redis.call('SET', KEYS[2], taken, 'EX', ARGV[1])
return taken
"""


def _key_tag(request_key: str) -> str:
    return hashlib.sha256(request_key.encode()).hexdigest()[:16]


def steering_message_id(request_keys: Iterable[Any]) -> str | None:
    """The injected message's id, named after the keyed sends it carries.

    Taking a send out of the queue does not prove the model saw it: the run
    can die before the step that injected it is saved, or lose the answers to
    the removal and its retry and never inject it. The server answers a
    resend from the run's checkpoint, by the tags in this id. The random part
    keeps each injection a message of its own: the reducer replaces a message
    whose id it already holds, so a send accepted again once its record
    expired would otherwise overwrite the earlier one where it stands. None
    when no send has a key, so the message gets an ordinary one.
    """
    tags = [_key_tag(k) for k in request_keys if isinstance(k, str) and k]
    if not tags:
        return None
    return _STEERING_ID_PREFIX + "-".join([*tags, uuid.uuid4().hex])


def carries_steer_key(message: Any, request_key: str) -> bool:
    """Whether ``message`` is an injected steer carrying ``request_key``'s send."""
    message_id = getattr(message, "id", None)
    if not isinstance(message_id, str) or not message_id.startswith(
        _STEERING_ID_PREFIX
    ):
        return False
    # The random part is 32 hex digits, so it never reads as a 16-digit tag.
    tags = message_id[len(_STEERING_ID_PREFIX) :].split("-")
    return _key_tag(request_key) in tags


async def _take(client: Any, queue_key: str, values: list[Any]) -> list[bool]:
    """Remove ``values`` from the queue in one step, retried once.

    Redis can apply the removal and lose its answer. The retry runs under the
    same take key, so it reads back what the first try removed instead of
    finding the entries gone and the steer dropped. True per value this take
    removed; another reader may have taken the rest since they were read.
    """
    keys = (queue_key, f"{{{queue_key}}}:take:{uuid.uuid4().hex}")
    try:
        taken = await client.eval(_TAKE_LUA, 2, *keys, _TAKE_TTL_S, *values)
    except Exception as e:
        logger.warning(f"[Steering] Retrying the take of {queue_key}: {e}")
        taken = await client.eval(_TAKE_LUA, 2, *keys, _TAKE_TTL_S, *values)
    flags = taken.decode() if isinstance(taken, bytes) else str(taken)
    return [flag == "1" for flag in flags]


# The steering message's record of the reports its run holds, which the
# model call that reads them confirms.
_HELD_REPORTS = "held_reports"


@dataclass(frozen=True)
class SteeredReport:
    job_id: str
    content: str                    # what the model reads
    report_source: dict[str, Any]   # what the reader is shown


class ReportInbox(Protocol):
    async def take(self, thread_id: str, run_id: str) -> list[SteeredReport]: ...
    async def confirm(self, run_id: str, job_ids: list[str]) -> None: ...


class _HeldReports(TypedDict):
    run_id: str
    job_ids: list[str]


class SteeringMiddleware(AgentMiddleware):
    """Takes in what reached the thread while the agent works, before each LLM call.

    Two kinds of input arrive mid-turn. When a user sends a message while
    the agent is already processing, the server queues it in Redis. When
    background work the thread is owed a report on finishes (a subagent
    task, an analyst's hand-off), the report waits in the server's outbox
    until the turn ends, unless this turn takes it in first through the
    server's ``report_inbox``: ``take`` holds each report it hands over, and
    the model call that reads them closes them (``confirm``), since the graph
    checkpoints the injected message before that step starts. A report the
    turn never takes, or never confirms, is posted as its own turn when this
    one ends. Both reach the model as one HumanMessage, reports first so the
    user's words come last.

    Placement: main_only_middleware (subagents don't consume steering messages).
    """

    def __init__(self, report_inbox: ReportInbox | None = None) -> None:
        super().__init__()
        self.report_inbox = report_inbox

    async def abefore_model(
        self, state: AgentState, runtime: Runtime, *, config: RunnableConfig
    ) -> dict[str, Any] | None:
        """Inject queued steering messages and owed reports before the model call."""
        thread_id = (config.get("configurable") or {}).get("thread_id")
        if not thread_id:
            logger.debug("[Steering] No thread_id in config, skipping")
            return None
        run_id = config_own_run_id(config)

        reports = await self._take_reports(thread_id, run_id)
        steers = await self._take_user_steering(thread_id, run_id)
        if not reports and not steers:
            return None

        message, delivered = _steering_message(reports, steers, run_id, time.time())
        logger.info(
            f"[Steering] Injecting {len(steers)} steering message(s) and "
            f"{len(reports)} report(s) for thread_id={thread_id}"
        )
        try:
            runtime.stream_writer(
                {"type": "steering_delivered", "thread_id": thread_id, **delivered}
            )
        except Exception:
            logger.debug("[Steering] stream_writer unavailable, skipping SSE event")
        return {"messages": [message]}

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        await self._confirm_reports(request.state)
        return await handler(request)

    async def _confirm_reports(self, state: Any) -> None:
        """Close the reports injected since the last model response.

        The step that injected them is checkpointed before this one starts,
        so they can no longer be lost with the turn. Retries of the same
        call confirm again, which closes nothing twice."""
        if self.report_inbox is None:
            return
        for message in reversed((state or {}).get("messages") or []):
            if isinstance(message, AIMessage):
                return
            held: _HeldReports | None = (
                getattr(message, "additional_kwargs", None) or {}
            ).get(_HELD_REPORTS)
            if held and held.get("run_id") and held.get("job_ids"):
                try:
                    await self.report_inbox.confirm(
                        held["run_id"], list(held["job_ids"])
                    )
                except Exception as e:
                    logger.warning(f"[Steering] Report confirm failed: {e}")

    async def _take_reports(
        self, thread_id: str, run_id: str | None
    ) -> list[SteeredReport]:
        """The reports the server hands this run, held until the model call
        that reads them confirms them. Holding needs a run to hold them for."""
        if self.report_inbox is None or not run_id:
            return []
        try:
            return await self.report_inbox.take(thread_id, run_id)
        except Exception as e:
            logger.warning(f"[Steering] Report inbox failed: {e}")
            return []

    async def _take_user_steering(
        self, thread_id: str, run_id: str | None
    ) -> list[dict]:
        """Take this run's messages off the thread's steering queue.

        Peek, partition, then take exactly what we consume (v4 2.4c review
        F3). Foreign-stamped payloads (a run that died without draining) are
        never touched: this run's end-of-run drain returns them to the user.
        A pop-and-requeue cycle would open a crash window per model call in
        which the only copy of an accepted user message vanishes. A failed
        read leaves the queue where it was.
        """
        # Import here to avoid circular imports
        from src.utils.cache.redis_cache import get_cache_client

        try:
            cache = get_cache_client()
            if not cache.enabled or not cache.client:
                return []
            key = steering_queue_key(thread_id)
            # Garbage is taken out of the queue with a None in its place.
            consumed: list[tuple[Any, dict | None]] = []
            for raw in await cache.client.lrange(key, 0, -1):
                try:
                    data = decode_steer(raw)
                except ValueError as e:
                    logger.warning(f"[Steering] Failed to parse steering message: {e}")
                    consumed.append((raw, None))
                    continue
                if is_foreign_steer(data, run_id):
                    continue
                consumed.append(
                    (raw, data if isinstance(data, dict) else {"content": str(data)})
                )

            if not consumed:
                return []
            taken = await _take(cache.client, key, [raw for raw, _ in consumed])
            return [
                steer
                for (_, steer), took in zip(consumed, taken)
                if took and steer is not None
            ]
        except Exception as e:
            logger.error(f"[Steering] Error checking steering queue: {e}")
            return []


def _steering_message(
    reports: list[SteeredReport],
    steers: list[dict],
    run_id: str | None,
    now: float,
) -> tuple[HumanMessage, dict[str, Any]]:
    """The message the model takes everything in through, and its
    ``steering_delivered`` payload.

    The payload rides both the live SSE event and the message's
    additional_kwargs, so checkpoint-sourced replay can re-emit
    steering_delivered without the stored SSE stream. A report's text is
    model-facing: the reader is shown what it reports on, as a report turn's
    hidden message is.
    """
    parts = [report.content for report in reports]
    if steers:
        if len(steers) == 1:
            content = steers[0].get("content", str(steers[0]))
        else:
            content = "\n".join(
                f"{i + 1}. {steer.get('content', str(steer))}"
                for i, steer in enumerate(steers)
            )
        parts.append(f"[Steering from User]\n{content}")

    delivered = {
        # The user's messages only: a chat gateway retires this many of the
        # messages it queued, oldest first, and it never queued a report.
        "count": len(steers),
        "messages": [
            {"content": "", "report_source": report.report_source, "timestamp": now}
            for report in reports
        ]
        + [
            {
                "content": steer.get("content", ""),
                "user_id": steer.get("user_id"),
                "timestamp": steer.get("timestamp"),
                **({"platform": steer["platform"]} if steer.get("platform") else {}),
            }
            for steer in steers
        ],
        "timestamp": now,
    }
    additional_kwargs: dict[str, Any] = {
        "lc_source": "steering",
        "steering_delivered": delivered,
    }
    if reports:
        additional_kwargs[_HELD_REPORTS] = _HeldReports(
            run_id=run_id, job_ids=[report.job_id for report in reports]
        )
    message = HumanMessage(
        content="\n\n".join(parts),
        id=steering_message_id(steer.get("request_key") for steer in steers),
        additional_kwargs=additional_kwargs,
    )
    return message, delivered
