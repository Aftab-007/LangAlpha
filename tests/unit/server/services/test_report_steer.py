"""claim_steered_reports: which owed reports a live turn takes in, the hold
that makes the taking exclusive, and the confirm that closes them once the
message carrying them is checkpointed."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.server.services.report_back import steer

_OUTBOX = "src.server.database.runs.outbox"
_BY_KEY = "src.server.database.runs.lifecycle.find_run_by_request_key"


@pytest.fixture(autouse=True)
def _no_admitted_turn():
    with patch(_BY_KEY, new=AsyncMock(return_value=None)) as by_key:
        yield by_key


def _job(n: int, hook_type: str = "task_report_back") -> dict:
    return {"hook_outbox_id": f"job-{n}", "hook_type": hook_type, "payload": {}}


def _report(tag: str) -> dict:
    return {"content": tag, "report_source": {"kind": "task", "task_id": tag}}


async def _claim(jobs, offers, held, *, closed=(), hold=None, run_id="run-A"):
    """Run the claim with per-job offers (keyed by call order), the ids the
    hold reports as won, and the ids the silent close reports as won."""
    hold = hold or AsyncMock(return_value=held)
    close = AsyncMock(return_value=list(closed))
    with (
        patch(f"{_OUTBOX}.list_steerable_report_jobs", new=AsyncMock(return_value=jobs)),
        patch(f"{_OUTBOX}.hold_steered_report_jobs", new=hold),
        patch(f"{_OUTBOX}.close_steered_report_jobs", new=close),
        patch.object(steer, "_task_offer", new=AsyncMock(side_effect=offers)),
        patch.object(steer, "_analyst_offer", new=AsyncMock(side_effect=offers)),
        patch.object(steer, "_wake_task_watchers", new=AsyncMock()),
    ):
        return await steer.claim_steered_reports("t-1", run_id), hold, close


@pytest.mark.asyncio
async def test_holds_reports_it_hands_over_and_closes_silent_jobs():
    jobs = [_job(1), _job(2), _job(3), _job(4)]
    offers = [_report("one"), steer._CLOSE, None, _report("four")]

    reports, hold, close = await _claim(jobs, offers, held=["job-1"], closed=["job-2"])

    # job-3 (decision None) is never offered; job-4 was lost to its executor.
    hold.assert_awaited_once_with(["job-1", "job-4"], run_id="run-A")
    close.assert_awaited_once_with(["job-2"], run_id="run-A")
    assert reports == [{**_report("one"), "job_id": "job-1"}]


@pytest.mark.asyncio
async def test_held_reports_keep_oldest_first_order():
    jobs = [_job(1), _job(2)]

    reports, _, _ = await _claim(
        jobs, [_report("one"), _report("two")], held=["job-2", "job-1"]
    )

    assert [r["job_id"] for r in reports] == ["job-1", "job-2"]


@pytest.mark.asyncio
async def test_offer_that_raises_is_left_out_and_the_rest_go_through():
    jobs = [_job(1), _job(2)]

    reports, hold, _ = await _claim(
        jobs, [RuntimeError("boom"), _report("two")], held=["job-2"]
    )

    hold.assert_awaited_once_with(["job-2"], run_id="run-A")
    assert reports == [{**_report("two"), "job_id": "job-2"}]


@pytest.mark.asyncio
async def test_listing_failure_returns_empty():
    with patch(
        f"{_OUTBOX}.list_steerable_report_jobs",
        new=AsyncMock(side_effect=RuntimeError("db down")),
    ):
        assert await steer.claim_steered_reports("t-1", "run-A") == []


@pytest.mark.asyncio
async def test_hold_failure_returns_empty():
    hold = AsyncMock(side_effect=RuntimeError("db down"))

    reports, _, _ = await _claim([_job(1)], [_report("one")], held=[], hold=hold)

    assert reports == []


@pytest.mark.asyncio
async def test_a_turn_without_a_run_takes_nothing():
    listing = AsyncMock(return_value=[_job(1)])
    with patch(f"{_OUTBOX}.list_steerable_report_jobs", new=listing):
        assert await steer.claim_steered_reports("t-1", None) == []
    listing.assert_not_awaited()


@pytest.mark.asyncio
async def test_confirm_closes_the_runs_held_reports_and_never_raises():
    close = AsyncMock(return_value=["job-1"])
    with patch(f"{_OUTBOX}.close_steered_report_jobs", new=close):
        await steer.confirm_steered_reports("run-A", ["job-1"])
    close.assert_awaited_once_with(["job-1"], run_id="run-A")

    with patch(
        f"{_OUTBOX}.close_steered_report_jobs",
        new=AsyncMock(side_effect=RuntimeError("db down")),
    ):
        await steer.confirm_steered_reports("run-A", ["job-1"])


# ---------------------------------------------------------------------------
# _task_offer
# ---------------------------------------------------------------------------

_SR = "src.server.database.runs.subagent_runs.get_task_run"
_TL = "src.server.database.runs.lifecycle.get_run"


def _task_job(**payload) -> dict:
    base = {"task_run_id": "tr-1", "task_id": "abc123", "display_id": "Task-abc123"}
    base.update(payload)
    return {"hook_outbox_id": "job-1", "hook_type": "task_report_back", "payload": base}


@pytest.mark.asyncio
async def test_task_offer_closes_a_report_already_delivered():
    run_row = {"result_delivered_at": "2026-01-01T00:00:00Z"}
    with patch(_SR, new=AsyncMock(return_value=run_row)):
        assert await steer._task_offer(_task_job()) is steer._CLOSE


@pytest.mark.asyncio
async def test_task_offer_leaves_unreadable_jobs_to_the_executor():
    with patch(_SR, new=AsyncMock(return_value=None)):
        assert await steer._task_offer(_task_job()) is None
    assert await steer._task_offer(_task_job(task_run_id=None)) is None


@pytest.mark.asyncio
async def test_task_offer_leaves_a_report_whose_turn_was_admitted(_no_admitted_turn):
    _no_admitted_turn.return_value = {"conversation_response_id": "run-R"}
    task_run = AsyncMock()
    with patch(_SR, new=task_run):
        assert await steer._task_offer(_task_job()) is None
    task_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_task_offer_steers_an_owed_report():
    run_row = {"result_delivered_at": None, "parent_run_id": None}
    with patch(_SR, new=AsyncMock(return_value=run_row)):
        offer = await steer._task_offer(_task_job())

    assert "Task-abc123" in offer["content"]
    assert offer["report_source"]["kind"] == "task"


# ---------------------------------------------------------------------------
# _analyst_offer
# ---------------------------------------------------------------------------


def _analyst_cache(origin: dict) -> MagicMock:
    cache = MagicMock()
    cache.get_strict = AsyncMock(return_value=origin)
    cache.client.sismember = AsyncMock(return_value=True)
    return cache


def _analyst_job() -> dict:
    return {
        "hook_outbox_id": "job-1",
        "hook_type": "report_back",
        "payload": {"ptc_thread_id": "ptc-1", "final_status": "completed"},
    }


def _origin(**over) -> dict:
    base = {
        "origin": "flash",
        "report_back": True,
        "flash_thread_id": "t-1",
        "user_id": "u-1",
    }
    base.update(over)
    return base


@pytest.mark.asyncio
async def test_analyst_offer_leaves_automation_reports_to_the_executor():
    cache = _analyst_cache(_origin())
    with (
        patch("src.utils.cache.redis_cache.get_cache_client", return_value=cache),
        patch(
            "src.server.services.report_back.flash.requested_from.deliveries",
            return_value=[object()],
        ),
    ):
        assert await steer._analyst_offer(_analyst_job(), "t-1") is None


@pytest.mark.asyncio
async def test_analyst_offer_ignores_a_report_owed_to_another_thread():
    cache = _analyst_cache(_origin(flash_thread_id="t-other"))
    with patch("src.utils.cache.redis_cache.get_cache_client", return_value=cache):
        assert await steer._analyst_offer(_analyst_job(), "t-1") is None


@pytest.mark.asyncio
async def test_analyst_offer_leaves_a_report_whose_summary_run_started(_no_admitted_turn):
    cache = _analyst_cache(_origin())
    _no_admitted_turn.return_value = {"conversation_response_id": "run-R"}
    with (
        patch("src.utils.cache.redis_cache.get_cache_client", return_value=cache),
        patch(
            "src.server.services.report_back.flash.requested_from.deliveries",
            return_value=[],
        ),
    ):
        assert await steer._analyst_offer(_analyst_job(), "t-1") is None


@pytest.mark.asyncio
async def test_analyst_offer_leaves_a_report_its_executor_is_posting():
    import uuid

    from src.server.services.report_back.flash.executor import RB_REQUEST_NS

    request_key = str(uuid.uuid5(RB_REQUEST_NS, "job-1"))
    cache = _analyst_cache(_origin())
    cache.get_strict = AsyncMock(
        side_effect=lambda key: (
            {"request_key": request_key} if key.startswith("flash_rb_run:") else _origin()
        )
    )
    with (
        patch("src.utils.cache.redis_cache.get_cache_client", return_value=cache),
        patch(
            "src.server.services.report_back.flash.requested_from.deliveries",
            return_value=[],
        ),
    ):
        assert await steer._analyst_offer(_analyst_job(), "t-1") is None
