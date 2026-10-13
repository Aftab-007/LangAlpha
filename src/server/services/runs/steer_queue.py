"""A thread's steer queue, and the record of each keyed steer in it.

A message sent while a turn is running waits in the queue until that turn's
SteeringMiddleware reads it before its next model call. A steer writes no run
row, so START's unique index never sees its key; a keyed steer also records
the run its key went into, which is what a later copy of the same send finds
instead. Every script here moves an entry and its record together, so a
record with its entry means queued and unread, a record without one means a
run took it out of the queue, and neither means it ran nowhere. Taken out is
not yet kept: a run can die between taking a steer and saving the step that
injected it, which only that run's checkpoint shows.

Redis errors propagate; callers choose whether a fault fails soft.
"""

import json

from src.config.settings import get_redis_ttl_steering


def _queue_key(thread_id: str) -> str:
    return f"workflow:steering:{thread_id}"


def steer_records_key(thread_id: str) -> str:
    """The thread's steer records: each keyed steer's request_key, mapped to
    the run it went into.

    It lives exactly as long as the queue (every push refreshes both). The
    braces put it in the queue key's cluster slot, so one script may take
    both.
    """
    return f"{{{_queue_key(thread_id)}}}:keys"


class SteerKeyTaken(Exception):
    """Another copy of this send already went into the thread as a steer."""


# Claim the key and queue the message in one step: a claim with no message
# behind it would answer every later copy as delivered, and a message with no
# claim would let a second copy steer too.
_STEER_LUA = """
if ARGV[3] ~= '' and redis.call('HSETNX', KEYS[2], ARGV[3], ARGV[4]) == 0 then
  return -1
end
local position = redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[2])
return position
"""

_UNSTEER_LUA = """
local removed = redis.call('LREM', KEYS[1], 1, ARGV[1])
if removed > 0 then
  local ok, message = pcall(cjson.decode, ARGV[1])
  if ok and type(message) == 'table' and type(message.request_key) == 'string' then
    redis.call('HDEL', KEYS[2], message.request_key)
  end
end
return removed
"""

_DRAIN_LUA = """
local entries = redis.call('LRANGE', KEYS[1], 0, -1)
redis.call('DEL', KEYS[1])
for _, raw in ipairs(entries) do
  local ok, message = pcall(cjson.decode, raw)
  if ok and type(message) == 'table' and type(message.request_key) == 'string' then
    redis.call('HDEL', KEYS[2], message.request_key)
  end
end
return entries
"""

# Returns {0, record} when no record names ARGV[2] (any run when empty), {1,
# run} when the message left the queue, which only a run reading it does, and
# {2, run} when it is still queued. ARGV[3] is what to take: '0' nothing, '1'
# a queued message with its record, '2' that or else the record alone.
_TAKE_BACK_LUA = """
local run_id = redis.call('HGET', KEYS[2], ARGV[1])
if not run_id or (ARGV[2] ~= '' and run_id ~= ARGV[2]) then
  return {0, run_id or ''}
end
for _, raw in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  local ok, message = pcall(cjson.decode, raw)
  if ok and type(message) == 'table' and message.request_key == ARGV[1] then
    if ARGV[3] ~= '0' then
      redis.call('LREM', KEYS[1], 1, raw)
      redis.call('HDEL', KEYS[2], ARGV[1])
    end
    return {2, run_id}
  end
end
if ARGV[3] == '2' then
  redis.call('HDEL', KEYS[2], ARGV[1])
end
return {1, run_id}
"""

# Moves a key's steer from run ARGV[2], which ended without keeping it, into
# run ARGV[3]: the record is re-pointed and the queued entry replaced in its
# place by ARGV[4], or, with ARGV[5] '1' (the old run took the entry out and
# never kept it), ARGV[4] is queued. Returns {1, position} when moved, {0,
# record} when the record no longer names ARGV[2], and {2, ''} when the entry
# left the queue and ARGV[5] is '0'.
_CARRY_LUA = """
local run_id = redis.call('HGET', KEYS[2], ARGV[1])
if run_id ~= ARGV[2] then
  return {0, run_id or ''}
end
local position = false
for i, raw in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  local ok, message = pcall(cjson.decode, raw)
  if ok and type(message) == 'table' and message.request_key == ARGV[1] then
    redis.call('LSET', KEYS[1], i - 1, ARGV[4])
    position = i
    break
  end
end
if not position then
  if ARGV[5] ~= '1' then
    return {2, ''}
  end
  position = redis.call('RPUSH', KEYS[1], ARGV[4])
end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[6])
redis.call('EXPIRE', KEYS[2], ARGV[6])
return {1, position}
"""


def _client():
    from src.utils.cache.redis_cache import get_cache_client

    cache = get_cache_client()
    return cache.client if cache.enabled and cache.client else None


def _text(raw) -> str:
    return raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)


async def push(
    thread_id: str, message: str, request_key: str | None, run_id: str | None
) -> int | None:
    """Queue ``message`` and claim ``request_key`` for ``run_id`` in one step.

    Returns the queue position, or None without a cache. Raises
    ``SteerKeyTaken`` when another copy of the send holds the claim.
    """
    client = _client()
    if client is None:
        return None
    position = await client.eval(
        _STEER_LUA,
        2,
        _queue_key(thread_id),
        steer_records_key(thread_id),
        message,
        get_redis_ttl_steering(),
        request_key or "",
        run_id or "",
    )
    if position == -1:
        raise SteerKeyTaken(request_key)
    return position


async def reclaim(thread_id: str, message: str) -> bool:
    """Remove the exact queued ``message``, with its key's record, in one
    step: a cancel landing between the two would leave a record of a message
    in no queue. True when it was still queued."""
    client = _client()
    if client is None:
        return False
    removed = await client.eval(
        _UNSTEER_LUA,
        2,
        _queue_key(thread_id),
        steer_records_key(thread_id),
        message,
    )
    return bool(removed)


async def drain(thread_id: str) -> list[dict]:
    """Empty the queue, returning the messages no run read.

    One script, so the read and the delete can never interleave with a
    concurrent ``reclaim``: a message is returned here or reclaimed there,
    never both, never lost. No run took these, so their keys' records go in
    the same step: each ran nowhere.
    """
    client = _client()
    if client is None:
        return []
    raw_messages = await client.eval(
        _DRAIN_LUA, 2, _queue_key(thread_id), steer_records_key(thread_id)
    )
    messages = []
    for raw in raw_messages or []:
        try:
            messages.append(json.loads(_text(raw)))
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
    return messages


async def steered_run_id(thread_id: str, request_key: str) -> str | None:
    """The run this key's message went into as a steer, from its record."""
    client = _client()
    if client is None:
        return None
    raw = await client.hget(steer_records_key(thread_id), request_key)
    return (_text(raw) or None) if raw is not None else None


async def _settle(
    thread_id: str, request_key: str, run_id: str | None, take: str
) -> tuple[int, str | None]:
    client = _client()
    if client is None:
        return 0, None
    status, run = await client.eval(
        _TAKE_BACK_LUA,
        2,
        _queue_key(thread_id),
        steer_records_key(thread_id),
        request_key,
        run_id or "",
        take,
    )
    return int(status), (_text(run) or None) if int(status) else None


async def steer_state(
    thread_id: str, request_key: str, run_id: str | None = None
) -> tuple[str, str | None]:
    """Where a keyed steer is, without moving it: ``("queued", run)`` while
    no run read it, ``("read", run)`` once it left the queue, which only a
    run reading it does, and ``("none", None)`` when no record names
    ``run_id`` (any run when None)."""
    status, run = await _settle(thread_id, request_key, run_id, "0")
    return ("none", "read", "queued")[status], run


async def take_back_steer(
    thread_id: str, request_key: str, run_id: str | None = None
) -> tuple[str, str | None]:
    """Remove a keyed steer its run never read, with its record.

    Only for a steer whose run has ended, so nothing can read it from here
    on, and only by a path that goes on to carry the message. Returns
    ``("taken", run)`` when the message was still queued and is removed,
    else what ``steer_state`` answers.
    """
    status, run = await _settle(thread_id, request_key, run_id, "1")
    return ("none", "read", "taken")[status], run


async def release_steer_key(thread_id: str, request_key: str, run_id: str) -> bool:
    """Free a key whose steer ``run_id`` took out of the queue but never kept.

    Only once that run's checkpoint shows the message missing, and only by a
    path that goes on to carry it. One script, so the record goes only while
    it still names ``run_id``, and a message back in the queue goes with it.
    True when the key is now the caller's.
    """
    status, _ = await _settle(thread_id, request_key, run_id, "2")
    return status != 0


async def carry(
    thread_id: str,
    request_key: str,
    from_run: str,
    to_run: str,
    message: str,
    *,
    requeue: bool = False,
) -> tuple[str, int | None]:
    """Move this key's steer from ``from_run``, which ended without keeping
    it, into ``to_run`` as ``message``.

    One script, so the message is queued throughout: for ``from_run`` until
    the step, for ``to_run`` after it. ``message`` takes the entry's place,
    since the middleware delivers only entries stamped with its own run, and
    keeps the queue's order. ``requeue`` once ``from_run`` is known to have
    taken the entry out and never kept it: ``message`` is then queued anew.
    Returns ``("moved", position)``, ``("read", None)`` when the entry left
    the queue and ``requeue`` is off, or ``("none", None)`` when the record
    no longer names ``from_run``.
    """
    client = _client()
    if client is None:
        return "none", None
    status, position = await client.eval(
        _CARRY_LUA,
        2,
        _queue_key(thread_id),
        steer_records_key(thread_id),
        request_key,
        from_run,
        to_run,
        message,
        "1" if requeue else "0",
        get_redis_ttl_steering(),
    )
    status = int(status)
    if status == 1:
        return "moved", int(position)
    return ("none", None) if status == 0 else ("read", None)
