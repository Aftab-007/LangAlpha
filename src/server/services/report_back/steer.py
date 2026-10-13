"""Report-backs a live turn takes in as a steer.

A report owed to a thread (a task's ``task_report_back``, an analyst's
``report_back``) waits in the outbox until its executor posts it as a turn of
its own, which it does only once the thread has no live turn. While the
thread's agent is still working, the turn takes the report in instead, before
its next model call: ``SteeredReportInbox.take`` holds every report it can
deliver and returns what the model reads and what the reader is shown, and
``SteeredReportInbox.confirm`` closes them from the model step that reads
them, by which point the message carrying them is checkpointed. A held report
its turn never confirms (the turn died first) is posted as its own turn when
that turn ends, as is a report that lands after the turn's last model call.

Whether a report is still owed is its executor's verdict
(``task_report_verdict``, ``analyst_report_verdict``), so the two paths never
disagree. What is left to the executor: a report an executor holds (its POST
may be in flight), one whose own turn was already admitted (its POST landed
before the job recorded it), an analyst's report from an automation run (the
turn carries that run's delivery stamp, which a steer cannot), and anything
whose eligibility cannot be read right now. A task report nothing is owed for
any more is closed without a word, as the executor would drop it.
"""

from __future__ import annotations

import asyncio
import logging

from ptc_agent.agent.middleware.steering import SteeredReport
from src.server.services.report_back.notify_turn import NotOwed

logger = logging.getLogger(__name__)


class SteeredReportInbox:
    """The server's report inbox for a thread's live turns. Never raises: a
    failed read or write leaves the reports to their executors."""

    async def take(self, thread_id: str, run_id: str) -> list[SteeredReport]:
        """Hold the reports owed to ``thread_id`` that its live turn can take
        in, oldest first. The turn passes their job ids back to ``confirm``."""
        from src.server.database.runs import outbox as outbox_db

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

        decisions = await asyncio.gather(*(_decide(job, thread_id) for job in jobs))
        offers = [d for d in decisions if isinstance(d, SteeredReport)]
        unowed = [
            str(job["hook_outbox_id"])
            for job, d in zip(jobs, decisions)
            if isinstance(d, NotOwed)
        ]

        # Separate failure domains: a failed close must not drop reports this
        # turn already holds, or they would sit parked until the turn ends.
        held: set[str] = set()
        try:
            held = set(
                await outbox_db.hold_steered_report_jobs(
                    [r.job_id for r in offers], run_id=run_id
                )
            )
        except Exception:
            logger.warning(
                f"[REPORT_STEER] Holding steered reports for {thread_id} failed",
                exc_info=True,
            )
        held -= await _overtaken_since_read(
            [job for job in jobs if str(job["hook_outbox_id"]) in held], run_id
        )
        closed: list[str] = []
        try:
            closed = await outbox_db.close_unowed_report_jobs(unowed)
        except Exception:
            logger.warning(
                f"[REPORT_STEER] Closing reports owed nothing on {thread_id} failed",
                exc_info=True,
            )

        reports = [r for r in offers if r.job_id in held]
        if reports or closed:
            logger.info(
                f"[REPORT_STEER] Thread {thread_id} run {run_id} took "
                f"{len(reports)} report(s) in as a steer, closed {len(closed)} "
                f"owed nothing"
            )
            # Neither reads as owed any more; the analyst's watch_clear wakes
            # its own watchers.
            from src.server.services.report_back.subagent import (
                publish_cleared_wake,
            )

            await publish_cleared_wake(thread_id)
        return reports

    async def confirm(self, run_id: str, job_ids: list[str]) -> None:
        """Close the reports ``run_id`` held, now that the model step reading
        them has begun: the graph checkpoints each step before the next
        starts, so the message carrying them is durable. A failure here
        repeats a report as its own turn when the turn ends, never loses it."""
        from src.server.database.runs import outbox as outbox_db

        try:
            closed = await outbox_db.confirm_steered_report_jobs(
                job_ids, run_id=run_id
            )
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


async def _overtaken_since_read(held: list[dict], run_id: str) -> set[str]:
    """The held analyst reports to give back because a newer run on the
    analyst's thread started between the offer's read and the hold: that run
    reports back when it ends, and its executor drops this one without
    tearing the pair down. Read once the hold is in, so a run starting later
    starts after delivery. A read that fails leaves the report to its
    executor, as ``_decide`` does; a failed release leaves it held for no
    message, which the run's finalize releases."""
    from src.server.database.runs import outbox as outbox_db
    from src.server.services.report_back.flash.executor import overtaking_run

    async def overtaken(job: dict) -> bool:
        try:
            ptc_thread_id = (job.get("payload") or {})["ptc_thread_id"]
            return await overtaking_run(job.get("run_id"), ptc_thread_id) is not None
        except Exception:
            logger.warning(
                f"[REPORT_STEER] Re-reading report job {job['hook_outbox_id']} "
                f"failed; leaving it to its executor",
                exc_info=True,
            )
            return True

    analyst = [job for job in held if job["hook_type"] == "report_back"]
    flags = await asyncio.gather(*(overtaken(job) for job in analyst))
    given_back = [
        str(job["hook_outbox_id"]) for job, flag in zip(analyst, flags) if flag
    ]
    if given_back:
        try:
            await outbox_db.release_steered_report_jobs(given_back, run_id=run_id)
        except Exception:
            logger.warning(
                f"[REPORT_STEER] Releasing overtaken reports {given_back} failed",
                exc_info=True,
            )
    return set(given_back)


async def _decide(job: dict, thread_id: str) -> SteeredReport | NotOwed | None:
    """The report to steer, ``NotOwed`` to close it, or None to leave it to
    its executor (as is any job whose read fails)."""
    try:
        if job["hook_type"] == "task_report_back":
            return await _task_offer(job)
        return await _analyst_offer(job, thread_id)
    except Exception:
        logger.warning(
            f"[REPORT_STEER] Reading report job {job['hook_outbox_id']} "
            f"for {thread_id} failed; leaving it to its executor",
            exc_info=True,
        )
        return None


async def _task_offer(job: dict) -> SteeredReport | NotOwed | None:
    from src.server.database.runs import lifecycle as tl_db
    from src.server.services.report_back.subagent import (
        task_report_verdict,
        task_request_key,
    )

    job_id = str(job["hook_outbox_id"])
    payload = job.get("payload") or {}
    if not payload.get("task_run_id") or not payload.get("task_id"):
        return None
    if await tl_db.find_run_by_request_key(task_request_key(job_id)):
        # Its own turn was admitted; the executor recovers the job from there.
        return None
    verdict = await task_report_verdict(job)
    if isinstance(verdict, NotOwed):
        return verdict
    return SteeredReport(
        job_id=job_id,
        content=verdict.message(steered=True),
        report_source=verdict.report.model_dump(exclude_none=True),
    )


async def _analyst_offer(job: dict, thread_id: str) -> SteeredReport | None:
    from src.server.services.report_back.flash.executor import (
        analyst_report_verdict,
        analyst_request_key,
        overtaking_run,
        report_message,
        summary_started,
    )
    from src.utils.cache.redis_cache import get_cache_client

    job_id = str(job["hook_outbox_id"])
    cache = get_cache_client()
    owed = await analyst_report_verdict(cache, job)
    # Nothing owed is the executor's to drop too: its drop owns the pair's
    # teardown.
    if isinstance(owed, NotOwed) or not owed.steerable_into(thread_id):
        return None
    # Its summary run already started (the executor recovers the job from
    # there), or a newer run took the report over (the executor drops it).
    if await summary_started(
        cache, owed.flash_thread_id, owed.ptc_thread_id, analyst_request_key(job_id)
    ):
        return None
    if await overtaking_run(job.get("run_id"), owed.ptc_thread_id):
        return None
    content, report_source = await report_message(
        owed.ptc_thread_id, owed.origin, owed.final_status, steered=True
    )
    return SteeredReport(
        job_id=job_id,
        content=content,
        report_source=report_source.model_dump(exclude_none=True),
    )
