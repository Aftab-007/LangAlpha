"""Report-backs a live turn takes in as a steer.

A report owed to a thread (a task's ``task_report_back``, an analyst's
``report_back``) waits in the outbox until its executor posts it as a turn of
its own, which it does only once the thread has no live turn. While the
thread's agent is still working, the turn takes the report in instead, before
its next model call: ``claim_steered_reports`` holds every report it can
deliver and returns what the model reads and what the reader is shown, and
``confirm_steered_reports`` closes them from the model step that reads them,
by which point the message carrying them is checkpointed. A held report its
turn never confirms (the turn died first) is posted as its own turn when that
turn ends, as is a report that lands after the turn's last model call.

What is left to the executor: a report an executor holds (its POST may be in
flight), one whose own turn was already admitted (its POST landed before the
job recorded it), an analyst's report from an automation run (the turn
carries that run's delivery stamp, which a steer cannot), and anything whose
eligibility cannot be read right now. A report nothing is owed for any more
(its result already delivered, a stop that covered it) is closed without a
word, as the executor would drop it.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)


async def claim_steered_reports(thread_id: str, run_id: str | None) -> list[dict[str, Any]]:
    """Hold the reports owed to ``thread_id`` that its live turn can take in,
    and return each as ``{"content", "report_source", "job_id"}``, oldest
    first. The turn passes the job ids back to ``confirm_steered_reports``.

    Never raises: a failed read leaves the reports to their executors.
    """
    from src.server.database.runs import outbox as outbox_db

    if not run_id:
        # Nothing could confirm a hold no run owns.
        return []
    try:
        jobs = await outbox_db.list_steerable_report_jobs(thread_id)
    except Exception:
        logger.warning(
            f"[REPORT_STEER] Listing reports owed to {thread_id} failed",
            exc_info=True,
        )
        return []
    if not jobs:
        return []

    # job id -> the report to steer; silent: jobs to close without one.
    offers: dict[str, dict[str, Any]] = {}
    silent: list[str] = []
    for job in jobs:
        job_id = str(job["hook_outbox_id"])
        try:
            if job["hook_type"] == "task_report_back":
                decision = await _task_offer(job)
            else:
                decision = await _analyst_offer(job, thread_id)
        except Exception:
            logger.warning(
                f"[REPORT_STEER] Reading report job {job_id} "
                f"for {thread_id} failed; leaving it to its executor",
                exc_info=True,
            )
            continue
        if decision is _CLOSE:
            silent.append(job_id)
        elif decision is not None:
            offers[job_id] = {**decision, "job_id": job_id}
    if not offers and not silent:
        return []

    try:
        held = set(
            await outbox_db.hold_steered_report_jobs(list(offers), run_id=run_id)
        )
        closed = await outbox_db.close_steered_report_jobs(silent, run_id=run_id)
    except Exception:
        logger.warning(
            f"[REPORT_STEER] Holding steered reports for {thread_id} failed",
            exc_info=True,
        )
        return []
    reports = [report for job_id, report in offers.items() if job_id in held]
    if reports or closed:
        logger.info(
            f"[REPORT_STEER] Thread {thread_id} run {run_id} took "
            f"{len(reports)} report(s) in as a steer, closed {len(closed)} "
            f"owed nothing"
        )
        await _wake_task_watchers(thread_id)
    return reports


async def confirm_steered_reports(run_id: str, job_ids: list[str]) -> None:
    """Close the reports ``run_id`` held, now that the model step reading
    them has begun: the graph checkpoints each step before the next starts,
    so the message carrying them is durable.

    Never raises: an unconfirmed report is posted as its own turn when the
    turn ends, so a failure here repeats a report rather than losing it.
    """
    from src.server.database.runs import outbox as outbox_db

    try:
        closed = await outbox_db.close_steered_report_jobs(job_ids, run_id=run_id)
    except Exception:
        logger.warning(
            f"[REPORT_STEER] Confirming reports {job_ids} for run {run_id} failed",
            exc_info=True,
        )
        return
    if len(closed) != len(job_ids):
        logger.warning(
            f"[REPORT_STEER] Run {run_id} confirmed {len(closed)} of "
            f"{len(job_ids)} held report(s)"
        )


# An offer for a report nothing is owed for any more: closed, not steered.
# None leaves the job to its executor.
_CLOSE: Any = object()


async def _task_offer(job: dict) -> Any:
    """A task's report as a steer, ``_CLOSE`` when nothing is owed any more,
    or None for its executor to decide."""
    from src.server.database.runs import lifecycle as tl_db
    from src.server.database.runs import subagent_runs as sr_db
    from src.server.services.report_back.subagent import (
        _build_notification_message,
        _job_request_key,
        _stop_already_covered,
        _task_report,
    )

    payload = job.get("payload") or {}
    task_run_id = payload.get("task_run_id")
    if not task_run_id or not payload.get("task_id"):
        return None
    if await tl_db.find_run_by_request_key(
        _job_request_key(str(job["hook_outbox_id"]))
    ):
        # Its own turn was admitted; the executor recovers the job from there.
        return None
    run_row = await sr_db.get_task_run(str(task_run_id))
    if run_row is None:
        return None
    if run_row.get("result_delivered_at"):
        return _CLOSE
    parent_run_id = run_row.get("parent_run_id")
    if parent_run_id and _stop_already_covered(
        await tl_db.get_run(str(parent_run_id)), run_row
    ):
        return _CLOSE
    report = _task_report(payload)
    return {
        "content": _build_notification_message(
            report, payload.get("subagent_type"), steered=True
        ),
        "report_source": report.model_dump(exclude_none=True),
    }


async def _analyst_offer(job: dict, thread_id: str) -> dict[str, Any] | None:
    """An analyst's report as a steer, under the checks its executor makes
    before posting one, or None for its executor to decide."""
    from src.server.models.additional_context import DirectiveContext
    from src.server.services.report_back.flash import requested_from
    from src.server.services.report_back.flash.executor import (
        _OUTCOME_INSTRUCTIONS,
        RB_REQUEST_NS,
        _superseded,
        report_message,
    )
    from src.server.database.runs import lifecycle as tl_db
    from src.server.services.report_back.flash.keys import (
        flash_rb_run_key,
        flash_watch_key,
        ptc_origin_key,
    )
    from src.server.utils.directive_context import build_directive_reminder
    from src.utils.cache.redis_cache import get_cache_client

    payload = job.get("payload") or {}
    ptc_thread_id = payload.get("ptc_thread_id")
    final_status = payload.get("final_status") or "completed"
    if not ptc_thread_id or final_status not in _OUTCOME_INSTRUCTIONS:
        return None
    cache = get_cache_client()
    origin = await cache.get_strict(ptc_origin_key(ptc_thread_id))
    if (
        not isinstance(origin, dict)
        or origin.get("origin") != "flash"
        or not origin.get("report_back")
        or str(origin.get("flash_thread_id")) != str(thread_id)
        or not origin.get("user_id")
    ):
        return None
    if not await cache.client.sismember(flash_watch_key(thread_id), ptc_thread_id):
        return None
    if requested_from.deliveries(origin):
        return None
    request_key = str(uuid.uuid5(RB_REQUEST_NS, str(job["hook_outbox_id"])))
    # Its summary run already started (a run row, or the pointer its executor
    # claims before posting): the executor recovers the job from there.
    if await tl_db.find_run_by_request_key(request_key):
        return None
    claim = await cache.get_strict(flash_rb_run_key(str(thread_id), ptc_thread_id))
    if isinstance(claim, dict) and claim.get("request_key") == request_key:
        return None
    if await _superseded(
        cache, job.get("run_id"), ptc_thread_id, str(thread_id), request_key
    ):
        return None
    message, report_source = await report_message(ptc_thread_id, origin, final_status)
    reminder = requested_from.reminder(origin)
    if reminder:
        message += build_directive_reminder([DirectiveContext(content=reminder)]) or ""
    return {
        "content": message,
        "report_source": report_source.model_dump(exclude_none=True),
    }


async def _wake_task_watchers(thread_id: str) -> None:
    """A closed task report no longer reads as owed; tell watchers to re-read
    now, as the drainer's close hook would. An analyst's watch_clear wakes
    its own. Best-effort."""
    try:
        from src.server.services.report_back.flash import wake
        from src.utils.cache.redis_cache import get_cache_client

        await wake.publish_wake(get_cache_client(), str(thread_id), cleared=True)
    except Exception:
        logger.debug(
            f"[REPORT_STEER] Cleared wake for {thread_id} failed", exc_info=True
        )
