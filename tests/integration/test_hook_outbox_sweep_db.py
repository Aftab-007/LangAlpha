"""The drainer's legacy sweep against real Postgres.

A deferred report-back parks with ``next_retry_at = 'infinity'``, which no
Python datetime holds, and the sweep gates every claim. Only a real database
loads the row, so only it shows a parked report-back no longer stops the drainer.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]


@pytest_asyncio.fixture(loop_scope="session")
async def open_run(seed_workspace, patched_get_db_connection):
    from src.server.database.conversation import create_thread
    from src.server.database.runs.lifecycle import start_run

    thread_id = str(uuid.uuid4())
    await create_thread(
        conversation_thread_id=thread_id,
        workspace_id=str(seed_workspace["workspace_id"]),
        current_status="in_progress",
        msg_type="ptc",
    )
    run_id = str(uuid.uuid4())
    await start_run(
        run_id=run_id,
        thread_id=thread_id,
        request_key=str(uuid.uuid4()),
        metadata={"msg_type": "ptc", "user_id": seed_workspace["user_id"]},
    )
    return thread_id, run_id


async def test_the_sweep_reads_a_deferred_report_back(open_run, db_conn):
    from src.server.database.runs import outbox

    thread_id, run_id = open_run
    await outbox.enqueue_compensation_job(
        run_id=run_id,
        thread_id=thread_id,
        hook_type="report_back",
        payload={"ptc_thread_id": thread_id},
        ordering_key=thread_id,
        idempotency_key=f"report_back:{run_id}",
        defer=True,
    )
    cur = await db_conn.execute(
        "SELECT next_retry_at = 'infinity' AS parked FROM hook_outbox WHERE run_id = %s",
        (run_id,),
    )
    assert (await cur.fetchone())["parked"]

    rows = await outbox.list_pending_jobs("report_back")

    assert [(r["ordering_key"], r["payload"]) for r in rows] == [
        (thread_id, {"ptc_thread_id": thread_id})
    ]
