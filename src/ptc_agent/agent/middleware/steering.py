"""
Steering Middleware.

Checks Redis for steering messages from the user before each LLM call and injects
them into the conversation state. This enables users to send messages while the
agent is processing, which get picked up before the next model invocation.
"""

import hashlib
import json
import logging
import time
import uuid
from typing import Any, Iterable

from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.runtime import Runtime

from langchain.agents.middleware.types import AgentMiddleware, AgentState

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


class SteeringMiddleware(AgentMiddleware):
    """Checks Redis for steering messages from the user before each LLM call.

    When a user sends a message while the agent is already processing,
    the server queues it in Redis. This middleware picks up those steering
    messages before the next LLM invocation and injects them as a
    HumanMessage into the conversation state.

    Placement: main_only_middleware (subagents don't consume steering messages).
    """

    async def abefore_model(
        self, state: AgentState, runtime: Runtime, *, config: RunnableConfig
    ) -> dict[str, Any] | None:
        """Check Redis for steering messages and inject them before model call."""
        try:
            thread_id = config.get("configurable", {}).get("thread_id")
            if not thread_id:
                logger.debug("[Steering] No thread_id in config, skipping")
                return None

            # Import here to avoid circular imports
            from src.utils.cache.redis_cache import get_cache_client

            cache = get_cache_client()
            if not cache.enabled or not cache.client:
                return None

            key = f"workflow:steering:{thread_id}"

            # Peek, partition, then take exactly what we consume (v4 2.4c
            # review F3). Foreign-stamped payloads (a run that died without
            # draining) are never touched — this run's end-of-run drain
            # returns them to the user. A pop-and-requeue cycle would open
            # a crash window per model call in which the only copy of an
            # accepted user message vanishes.
            raw_messages = await cache.client.lrange(key, 0, -1)
            if not raw_messages:
                return None

            own_run_id = (config.get("metadata") or {}).get("run_id")

            # Parse steering messages (handle both str and dict payloads);
            # garbage is taken out of the queue with a None in its place.
            consumed: list[tuple[Any, dict | None]] = []
            for raw in raw_messages:
                try:
                    text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
                    data = json.loads(text)
                except (json.JSONDecodeError, UnicodeDecodeError) as e:
                    logger.warning(f"[Steering] Failed to parse steering message: {e}")
                    consumed.append((raw, None))
                    continue
                if (
                    isinstance(data, dict)
                    and own_run_id
                    and data.get("run_id") not in (None, own_run_id)
                ):
                    continue
                if isinstance(data, str):
                    consumed.append((raw, {"content": data}))
                elif isinstance(data, dict):
                    consumed.append((raw, data))
                else:
                    consumed.append((raw, {"content": str(data)}))

            if not consumed:
                return None
            taken = await _take(cache.client, key, [raw for raw, _ in consumed])
            parsed = [
                entry
                for (_, entry), took in zip(consumed, taken)
                if took and entry is not None
            ]
            if not parsed:
                return None

            # Build combined message content
            if len(parsed) == 1:
                content = parsed[0].get("content", str(parsed[0]))
            else:
                lines = [
                    f"{i + 1}. {msg.get('content', str(msg))}"
                    for i, msg in enumerate(parsed)
                ]
                content = "\n".join(lines)

            # Delivered payload rides both the live SSE event and the injected
            # message's additional_kwargs, so checkpoint-sourced replay can
            # re-emit steering_delivered without the stored SSE stream.
            delivered = {
                "count": len(parsed),
                "messages": [
                    {
                        "content": q.get("content", ""),
                        "user_id": q.get("user_id"),
                        "timestamp": q.get("timestamp"),
                        **({"platform": q["platform"]} if q.get("platform") else {}),
                    }
                    for q in parsed
                ],
                "timestamp": time.time(),
            }
            human_msg = HumanMessage(
                content=f"[Steering from User]\n{content}",
                id=steering_message_id(q.get("request_key") for q in parsed),
                additional_kwargs={
                    "lc_source": "steering",
                    "steering_delivered": delivered,
                },
            )

            logger.info(
                f"[Steering] Injecting {len(parsed)} steering message(s) "
                f"for thread_id={thread_id}"
            )

            # Emit SSE custom event so frontend knows the message was delivered
            try:
                runtime.stream_writer(
                    {
                        "type": "steering_delivered",
                        "thread_id": thread_id,
                        **delivered,
                    }
                )
            except Exception:
                # Stream writer may not be available in all contexts
                logger.debug("[Steering] stream_writer unavailable, skipping SSE event")

            return {"messages": [human_msg]}

        except Exception as e:
            logger.error(f"[Steering] Error checking steering queue: {e}")
            return None
