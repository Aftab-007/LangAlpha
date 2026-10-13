"""park_while_thread_busy: the one park both report-back executors take while
the thread they report to is live or interrupted."""

from __future__ import annotations

import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.server.services.report_back.notify_turn import park_while_thread_busy


@contextlib.contextmanager
def _env(statuses, *, parked="pending"):
    latest = AsyncMock(
        side_effect=[{"status": s} if s else None for s in statuses]
    )
    defer = AsyncMock(return_value=parked)
    release = AsyncMock(return_value=1)
    drainer = MagicMock()
    with (
        patch("src.server.database.runs.lifecycle.get_latest_attempt", new=latest),
        patch("src.server.database.runs.outbox.defer_claimed_job", new=defer),
        patch(
            "src.server.database.runs.outbox.release_deferred_report_backs",
            new=release,
        ),
        patch("src.server.database.pool.get_db_connection"),
        patch(
            "src.server.services.hook_outbox.HookOutboxDrainer.get_instance",
            return_value=drainer,
        ),
    ):
        yield latest, defer, release, drainer


async def _park() -> bool:
    return await park_while_thread_busy(
        "job-1", 2, "t-1", log_prefix="[TEST]", subject="task Task-1"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [None, "completed", "error", "cancelled"])
async def test_an_idle_thread_lets_the_caller_post(status):
    with _env([status]) as (_, defer, release, _):
        assert await _park() is False
    defer.assert_not_awaited()
    release.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["in_progress", "interrupted"])
async def test_a_busy_thread_parks_the_job(status):
    with _env([status, status]) as (_, defer, release, drainer):
        assert await _park() is True
    defer.assert_awaited_once_with("job-1", attempts=2, max_attempts=5)
    release.assert_not_awaited()
    drainer.nudge.assert_not_called()


@pytest.mark.asyncio
async def test_a_finalize_between_the_read_and_the_park_is_caught():
    """That finalize's release pass ran before the job was parked, so it saw
    nothing to release; the re-read releases the job itself and wakes the
    drainer, else it waits at infinity for a turn that may never come."""
    with _env(["in_progress", "completed"]) as (_, defer, release, drainer):
        assert await _park() is True
    defer.assert_awaited_once()
    release.assert_awaited_once()
    assert release.await_args.args[1] == "t-1"
    drainer.nudge.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("parked", ["dead", None])
async def test_a_job_not_parked_pending_is_not_released(parked):
    """Dead at the attempts ceiling, or the fence lost: either way the caller
    stops and there is no parked row of its own to release."""
    with _env(["in_progress"], parked=parked) as (latest, _, release, _):
        assert await _park() is True
    assert latest.await_count == 1
    release.assert_not_awaited()
