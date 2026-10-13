"""Turn admission for chat workflows: admit a new turn, steer, or 409.

``wait_or_steer`` is the single admission decision for the foreground and
dispatched paths, and ``steer_allowed`` the single answer to whether a
request may steer at all; ``admission_conflict_detail`` is the single wording
source for every in-generator admission 409; ``ADMISSION_CONFLICT_CODES``
is the closed set of codes ``handle_workflow_error`` treats as protocol
responses (never persisted, never mark_failed).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from fastapi import HTTPException

from src.server.services.runs.admission import (
    BUSY_STATES,
    carry_unread_steer,
    dedup_retransmit_or_raise,
)

if TYPE_CHECKING:
    from src.server.models.chat import ChatRequest
    from src.server.services.runs.executor import LocalRunExecutor


# Structured codes carried by every in-generator admission-conflict 409
# (``admission_conflict_detail`` and ``wait_or_steer``). ``handle_workflow_error``
# keys its skip-persist/skip-mark_failed path on these so a non-admission 409
# can't be mistaken for one. ``request_cancelled`` (from the cancellation
# wrapper) is included defensively though it does not currently reach this path.
# ``not_running`` (steer_only probe against a fresh thread) is likewise an
# admission outcome, not a workflow failure — nothing was admitted to persist
# or mark failed. The busy states are the thread-held conflicts, one code each.
ADMISSION_CONFLICT_CODES = {
    *BUSY_STATES,
    "not_running",
    "request_cancelled",
    # Retry-validation outcomes from ``resolve_retry_of``: protocol
    # responses raised in-generator pre-START (run_handle is None, nothing
    # was admitted). Without these codes they'd fall into the generic
    # persist + mark_failed path — and a stale retry often coexists with a
    # NEWER running turn whose tracker status mark_failed would clobber.
    "stale_retry",
    "not_retryable",
}


def admission_conflict_detail(state: str) -> dict:
    """Map an admission outcome to its 409 ``{"code", "message"}`` detail.

    The single wording source for every in-generator admission 409 (see
    ``ADMISSION_CONFLICT_CODES``): the ``stopping``/``compacting``/``running``
    conflicts and the ``steer_only`` probe's ``not_running`` refusal. Returns a
    structured dict so ``handle_workflow_error`` can tag the SSE error with the
    code and the client can recognize the state; the thread_id is deliberately
    absent from the user-facing message so it can't leak into the UI on a
    client-state desync.
    """
    if state == "stopping":
        return {
            "code": "stopping",
            "message": "The turn is stopping. Wait a moment, then retry.",
        }
    if state == "compacting":
        return {
            "code": "compacting",
            "message": "The assistant is compacting its context. Wait a moment, then retry.",
        }
    if state == "not_running":
        return {
            "code": "not_running",
            "message": "No turn is running to steer. Resubmit as a new message.",
        }
    return {
        "code": "running",
        "message": (
            "The turn is still running. Wait a moment, then retry — "
            "or use /reconnect to continue streaming, or /cancel to stop it."
        ),
    }


def steer_allowed(
    request: ChatRequest, *, dispatched: bool, steerable: bool
) -> bool:
    """Whether a running turn on the thread may take this request as a steer.

    Foreground turns steer. A dispatched flow, a retry (a /retry that finds
    another live run is a conflict, not an empty steering message into it), a
    fork (an edit or a regenerate replaces a turn, which a message added to
    the running one cannot do) and a non-steerable caller (an automation's
    instruction is a turn of its own) meet a running peer with a 409 instead.
    """
    is_fork = request.fork_from_turn is not None and bool(request.checkpoint_id)
    return (
        steerable and not dispatched and request.retry_of_run_id is None and not is_fork
    )


async def wait_or_steer(
    manager: LocalRunExecutor,
    thread_id: str,
    user_input: str,
    user_id: str,
    *,
    steer_only: bool = False,
    can_steer: bool = True,
    platform: str | None = None,
    request_key: str | None = None,
) -> tuple[bool, str | None]:
    """Admit a new turn, steer the running one, or 409.

    The single admission decision for both the foreground and dispatched
    paths. Returns ``(ready, steering_event)``: ``ready=True`` → start a new
    workflow; ``ready=False`` with a non-None ``steering_event`` → yield that
    SSE string and return. A non-admissible state raises HTTP 409 whose detail
    carries a structured ``admission_conflict_detail`` code (surfaced as an SSE
    ``error`` event once the stream has started).

    ``steer_only=True`` (gateway steer probes) forbids the fresh-admission
    fallback: the probe's SSE reader only understands ``steering_accepted``/
    ``error``, so admitting a full turn on that connection streams the whole
    response — interrupts included — into a client that ignores it. A steer
    that finds no running turn gets ``not_running`` and the gateway resubmits
    it as a normal message. A steer accepted just before the workflow's exit
    may still go unconsumed — the final drain returns it via
    ``steering_returned`` on the turn stream, not this connection.

    ``can_steer=False`` (whatever ``steer_allowed`` refuses) forbids
    steering entirely: any in-flight run is a hard conflict, never a steer.

    ``request_key`` is checked again past the admission read, which can see
    a copy of this same send that another worker started after the caller's
    duplicate probe, and claimed in the step that queues the steer, so two
    copies racing into one running turn steer once (``DuplicateRequestError``
    for the other). When another copy started a turn of its own after the
    turn steered into ended, whichever of the two checks the key second takes
    the steer back: START's check, or the one after the push here. A copy
    that meets a claim on a turn that ended without keeping the steer moves
    it into the running turn, or, on an idle thread, leaves it for its
    START to take back.

    Admission states (see ``LocalRunExecutor.wait_for_admission``):
    - ``"fresh"``     → start a new turn ``(True, None)``; with ``steer_only``,
      409 ``not_running`` instead.
    - ``"stopping"``/``"compacting"`` → 409 (never start a second checkpoint
      writer, never steer mid-summarize).
    - ``"running"``   → steer immediately (no wait); an accept that raced the
      workflow's exit is reclaimed and re-routed as "fresh"; 409 only if
      steering fails. With ``can_steer=False`` a running peer is a 409 too.
    """
    # Deferred: steering imports chat-handler modules at module level.
    from src.server.handlers.chat.steering import (
        SteerKeyTaken,
        steer_payload,
        steer_thread,
        unsteer_thread,
    )

    state, active_row = await manager.wait_for_admission(thread_id)
    # A START that committed before that read, or a steer claimed before it,
    # is visible from here on, whatever worker made it.
    await dedup_retransmit_or_raise(thread_id, request_key)
    if state == "fresh":
        if steer_only:
            raise HTTPException(
                status_code=409, detail=admission_conflict_detail("not_running")
            )
        return True, None

    # Only a genuinely-running turn on a steerable path can be steered; every
    # other non-fresh state, and every request ``steer_allowed`` refuses, is a
    # conflict. Steering mid-stopping would start a second checkpoint writer;
    # mid-compaction would corrupt the context rewrite.
    if state != "running" or not can_steer:
        raise HTTPException(
            status_code=409, detail=admission_conflict_detail(state)
        )

    # state == "running" and steerable → steer the running workflow
    # immediately, stamped with the run it targets (v4 2.4c): the consuming
    # middleware delivers only own-run payloads, so a message steered into a
    # run that then died can never leak into a later turn's context.
    from src.server.database.runs import lifecycle as tl_db

    active_run_id = (
        str(active_row["conversation_response_id"]) if active_row else None
    )

    try:
        result = await steer_thread(
            thread_id,
            user_input,
            user_id,
            run_id=active_run_id,
            platform=platform,
            request_key=request_key,
        )
    except SteerKeyTaken:
        # Another copy of this send steered between the recheck and here.
        await dedup_retransmit_or_raise(thread_id, request_key)
        current = await tl_db.get_active_run(thread_id)
        if current is None:
            # Its turn ended without keeping it. This copy starts a turn and
            # leaves the message where it is: START's own check, which a
            # client leaving cannot cut short, takes it back, or finds the
            # other copy's turn and refuses this one.
            if steer_only:
                raise HTTPException(
                    status_code=409,
                    detail=admission_conflict_detail("not_running"),
                )
            return True, None
        # Its turn ended without keeping it, and the other copy may already
        # have answered that it was accepted, so this copy moves it into the
        # running turn, message and claim in one step.
        active_run_id = str(current["conversation_response_id"])
        payload = steer_payload(
            user_input,
            user_id,
            run_id=active_run_id,
            platform=platform,
            request_key=request_key,
        )
        position = await carry_unread_steer(
            thread_id, request_key, active_run_id, payload
        )
        if position is None:
            # Nothing moved: another copy carries it, its turn kept it, or a
            # fault left it queued, and the running turn's final drain
            # returns it. The refusal rechecks the key in
            # ``handle_workflow_error``.
            raise HTTPException(
                status_code=409, detail=admission_conflict_detail("running")
            )
        result = {"position": position, "payload": payload}
    if not result:
        # Steering failed (e.g. Redis unavailable) on a running turn.
        raise HTTPException(
            status_code=409, detail=admission_conflict_detail("running")
        )

    # Close the accept-after-exit race: the admission snapshot said "running",
    # but the workflow may have exited — and run its final steering drain —
    # between that snapshot and the Redis push. If the slot has no live run
    # anymore (worker-agnostic: the ledger row, not the local registry),
    # try to reclaim the message: a successful reclaim proves nothing
    # consumed it, so route as if admission had said "fresh". Reclaim failure is
    # the best-effort branch: almost always the exit drain got there first and
    # ``steering_returned`` carried the text back on the turn stream, so report
    # accepted — but a Redis fault on the reclaim also lands here, so "accepted"
    # is the graceful default, not a hard delivery guarantee.
    current = await tl_db.get_active_run(thread_id)
    if current is None:
        reclaimed = await unsteer_thread(thread_id, result["payload"])
        if reclaimed:
            if steer_only:
                raise HTTPException(
                    status_code=409,
                    detail=admission_conflict_detail("not_running"),
                )
            return True, None
    elif request_key and str(current["conversation_response_id"]) != active_run_id:
        # The turn steered into ended and another started: a copy of this
        # send whose START checked the key before this steer was queued.
        started = await tl_db.find_run_by_request_key(request_key)
        if started is not None:
            await unsteer_thread(thread_id, result["payload"])
            raise tl_db.DuplicateRequestError(started)
    event_data = json.dumps(
        {
            "thread_id": thread_id,
            "content": user_input,
            "position": result["position"],
        }
    )
    return False, f"event: steering_accepted\ndata: {event_data}\n\n"
