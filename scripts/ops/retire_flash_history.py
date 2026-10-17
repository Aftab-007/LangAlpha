"""Rewrite the retired Flash agent's ``flash`` label out of conversation history.

``flash`` named the retired Flash agent. Its threads, runs and usage rows now
belong to the full agent (``ptc``), and a thread it dispatched reads as the
Chief of Staff's. Six rewrites, each counted on its own:

    thread_msg_type    conversation_threads.msg_type 'flash' -> 'ptc', llm_model cleared
    thread_origin      conversation_threads.metadata origin.agent 'flash' -> 'chief_of_staff'
    usage_msg_type     conversation_usages.msg_type 'flash' -> 'ptc'
    response_msg_type  conversation_responses.metadata msg_type 'flash' -> 'ptc'
    query_msg_type     conversation_queries.metadata msg_type 'flash' -> 'ptc'
    usage_workspace    conversation_usages.workspace_id -> its thread's, where they differ

The first is the bulk form of ``promote_flash_thread``, which every Flash
thread gets on its next turn anyway. The last is what a fold of a former flash
row into Home left behind before it moved usage rows with their threads; a row
whose thread is already deleted cannot be traced and stays. Run this once the
build that writes no new ``flash`` values is live; the later migration that
drops ``flash`` from the CHECK constraints runs the label rewrites again as a
catch-up. ``updated_at`` is never touched: thread lists order by it, and this
is not activity.

Online: each table is walked once in primary-key order, one short transaction
per batch under a lock timeout, retried with backoff when a row is busy.
Idempotent: the match predicates make a rerun rewrite nothing. Resumable:
progress lines print the last committed key per table, and ``--start-after``
continues from it (a plain rerun is also correct, it just rescans).

Usage (repo root, inside the backend container):
    uv run python scripts/ops/retire_flash_history.py                    # dry-run
    uv run python scripts/ops/retire_flash_history.py --apply
    uv run python scripts/ops/retire_flash_history.py --apply --only usage_msg_type
    uv run python scripts/ops/retire_flash_history.py --apply \\
        --start-after conversation_responses=UUID

Connects via the same DB_* env vars the app uses (``src/server/database/pool.py``).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import psycopg
from psycopg import errors

# Run as a script, sys.path[0] is scripts/ops, not the repo root the sibling
# helper is imported from.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Nothing from src: its config import runs load_dotenv() and would silently
# retarget a mutating script at whatever .env happens to be on disk.
from scripts.ops._db import build_db_uri  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("retire_flash_history")

# While a batch waits on a row a live turn holds, the rows it already rewrote
# stay locked against other turns, so it waits briefly and retries instead.
LOCK_TIMEOUT = "3s"
STATEMENT_TIMEOUT = "60s"
LOCK_ATTEMPTS = 5
PROGRESS_EVERY_S = 5.0


@dataclass(frozen=True)
class Rewrite:
    name: str
    match: str
    assign: str


@dataclass(frozen=True)
class Table:
    name: str
    pk: str
    rewrites: tuple[Rewrite, ...]


# Correlated on the outer row, which both the UPDATE and the dry run's count
# name by the table itself.
_THREAD_WORKSPACE = (
    "(SELECT ct.workspace_id FROM conversation_threads ct "
    "WHERE ct.conversation_thread_id = conversation_usages.conversation_thread_id)"
)

TABLES: tuple[Table, ...] = (
    Table(
        "conversation_threads",
        "conversation_thread_id",
        (
            # The model was picked for Flash's slot; clearing it lets the thread
            # follow the account default for the full agent, as the per-thread
            # promotion does.
            Rewrite("thread_msg_type", "msg_type = 'flash'", "msg_type = 'ptc', llm_model = NULL"),
            Rewrite(
                "thread_origin",
                "metadata->'origin'->>'agent' = 'flash'",
                "metadata = jsonb_set(metadata, '{origin,agent}', '\"chief_of_staff\"')",
            ),
        ),
    ),
    Table(
        "conversation_usages",
        "conversation_usage_id",
        (
            Rewrite("usage_msg_type", "msg_type = 'flash'", "msg_type = 'ptc'"),
            # Only a fold moves a thread, so a usage row elsewhere is one it left.
            Rewrite(
                "usage_workspace",
                f"workspace_id <> {_THREAD_WORKSPACE}",
                f"workspace_id = {_THREAD_WORKSPACE}",
            ),
        ),
    ),
    Table(
        "conversation_responses",
        "conversation_response_id",
        (
            Rewrite(
                "response_msg_type",
                "metadata->>'msg_type' = 'flash'",
                "metadata = jsonb_set(metadata, '{msg_type}', '\"ptc\"')",
            ),
        ),
    ),
    # History replay hands each turn's query metadata to the client as is.
    Table(
        "conversation_queries",
        "conversation_query_id",
        (
            Rewrite(
                "query_msg_type",
                "metadata->>'msg_type' = 'flash'",
                "metadata = jsonb_set(metadata, '{msg_type}', '\"ptc\"')",
            ),
        ),
    ),
)
TABLE_NAMES = tuple(t.name for t in TABLES)
REWRITE_NAMES = tuple(r.name for t in TABLES for r in t.rewrites)


class BatchFailed(RuntimeError):
    pass


def _range_sql(table: Table, after: str | None) -> str:
    # Two spellings rather than "%(after)s IS NULL OR ...", which a generic
    # plan cannot turn into an index range.
    if after is None:
        return f"{table.pk} <= %(upper)s"
    return f"{table.pk} > %(after)s AND {table.pk} <= %(upper)s"


async def _next_bound(
    cur: psycopg.AsyncCursor, table: Table, after: str | None, size: int
) -> tuple[str, int] | None:
    """The batch's last key and how many keys it spans, from the PK index alone.

    No max(uuid) aggregate exists, so the bound is the top of the page sorted
    the other way, which sorts ``size`` keys and nothing more.
    """
    lower = "" if after is None else f"WHERE {table.pk} > %(after)s"
    await cur.execute(
        f"""
        SELECT pk, count(*) OVER ()
        FROM (
            SELECT {table.pk} AS pk FROM {table.name} {lower}
            ORDER BY {table.pk} LIMIT %(size)s
        ) page
        ORDER BY pk DESC LIMIT 1
        """,
        {"after": after, "size": size},
    )
    row = await cur.fetchone()
    if row is None:
        return None
    return str(row[0]), int(row[1])


async def _apply_batch(
    cur: psycopg.AsyncCursor,
    table: Table,
    rewrites: tuple[Rewrite, ...],
    params: dict,
    after: str | None,
) -> list[int]:
    counts = []
    for rw in rewrites:
        await cur.execute(
            f"UPDATE {table.name} SET {rw.assign} "
            f"WHERE {_range_sql(table, after)} AND {rw.match}",
            params,
        )
        counts.append(cur.rowcount)
    return counts


async def _count_batch(
    cur: psycopg.AsyncCursor,
    table: Table,
    rewrites: tuple[Rewrite, ...],
    params: dict,
    after: str | None,
) -> list[int]:
    filters = ", ".join(f"count(*) FILTER (WHERE {rw.match})" for rw in rewrites)
    await cur.execute(
        f"SELECT {filters} FROM {table.name} WHERE {_range_sql(table, after)}",
        params,
    )
    row = await cur.fetchone()
    return [int(n) for n in row]


async def _batch(
    conn: psycopg.AsyncConnection,
    table: Table,
    rewrites: tuple[Rewrite, ...],
    after: str | None,
    size: int,
    apply: bool,
) -> tuple[str, int, list[int]] | None:
    """One batch in its own short transaction. None once the table is exhausted.

    A lock or deadlock rolls the whole batch back and retries it from the same
    key; the match predicates make the retry exact.
    """
    upper: str | None = None
    for attempt in range(1, LOCK_ATTEMPTS + 1):
        try:
            async with conn.transaction(), conn.cursor() as cur:
                if not apply:
                    await cur.execute("SET TRANSACTION READ ONLY")
                await cur.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
                await cur.execute(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
                bound = await _next_bound(cur, table, after, size)
                if bound is None:
                    return None
                upper, walked = bound
                params = {"after": after, "upper": upper}
                if apply:
                    counts = await _apply_batch(cur, table, rewrites, params, after)
                else:
                    counts = await _count_batch(cur, table, rewrites, params, after)
            return upper, walked, counts
        except (errors.LockNotAvailable, errors.DeadlockDetected) as exc:
            span = f"({after or 'start'}, {upper or '?'}]"
            if attempt == LOCK_ATTEMPTS:
                raise BatchFailed(
                    f"{table.name} keys {span}: still busy after "
                    f"{LOCK_ATTEMPTS} attempts ({type(exc).__name__})"
                ) from exc
            delay = 2 ** (attempt - 1)
            logger.warning(
                "%s keys %s busy (%s), retrying in %ds (attempt %d/%d)",
                table.name, span, type(exc).__name__, delay, attempt, LOCK_ATTEMPTS,
            )
            await asyncio.sleep(delay)
    raise AssertionError("unreachable")


async def _walk(
    conn: psycopg.AsyncConnection,
    table: Table,
    rewrites: tuple[Rewrite, ...],
    after: str | None,
    args: argparse.Namespace,
    totals: dict[str, int],
) -> None:
    verb = "rewrote" if args.apply else "would rewrite"
    walked = batches = 0
    last_report = time.monotonic()

    def progress(level: int, label: str) -> None:
        done = ", ".join(f"{rw.name} {verb} {totals[rw.name]}" for rw in rewrites)
        logger.log(
            level, "%s %s: %d rows in %d batches, last key %s; %s",
            table.name, label, walked, batches, after or "-", done,
        )

    if after is not None:
        logger.info("%s: starting after key %s", table.name, after)
    try:
        while True:
            result = await _batch(conn, table, rewrites, after, args.batch_size, args.apply)
            if result is None:
                break
            after, n, counts = result
            walked += n
            batches += 1
            for rw, count in zip(rewrites, counts, strict=True):
                totals[rw.name] += count
            progress(logging.DEBUG, "batch")
            if time.monotonic() - last_report >= PROGRESS_EVERY_S:
                progress(logging.INFO, "progress")
                last_report = time.monotonic()
            if n < args.batch_size:
                break
            if args.sleep:
                await asyncio.sleep(args.sleep)
    except BaseException:
        resume = (
            f"--start-after {table.name}={after}" if after else "a plain rerun"
        )
        logger.error("%s stopped; resume this table with %s", table.name, resume)
        raise
    progress(logging.INFO, "done")


async def _run(args: argparse.Namespace) -> int:
    selected = set(args.only or REWRITE_NAMES)
    start_after = dict(args.start_after or [])
    plan = [
        (table, tuple(rw for rw in table.rewrites if rw.name in selected))
        for table in TABLES
    ]
    plan = [(table, rws) for table, rws in plan if rws]
    walked_tables = {table.name for table, _ in plan}
    stray = sorted(set(start_after) - walked_tables)
    if stray:
        logger.error("--start-after names %s, which no selected rewrite walks", ", ".join(stray))
        return 2

    if not args.apply:
        logger.info("DRY RUN: nothing will be written. Re-run with --apply.")
    totals = dict.fromkeys(REWRITE_NAMES, 0)
    try:
        async with await psycopg.AsyncConnection.connect(
            build_db_uri(), autocommit=True
        ) as conn:
            for table, rewrites in plan:
                await _walk(conn, table, rewrites, start_after.get(table.name), args, totals)
    except (BatchFailed, psycopg.Error) as exc:
        logger.error("%s", exc)
        return 1
    finally:
        verb = "rewrote" if args.apply else "would rewrite"
        for name in REWRITE_NAMES:
            if name in selected:
                logger.info("%s: %s %d row(s)", name, verb, totals[name])
    return 0


def _start_after(value: str) -> tuple[str, str]:
    table, sep, key = value.partition("=")
    if not sep or table not in TABLE_NAMES:
        raise argparse.ArgumentTypeError(
            f"expected TABLE=UUID with TABLE one of {', '.join(TABLE_NAMES)}"
        )
    try:
        return table, str(uuid.UUID(key))
    except ValueError:
        raise argparse.ArgumentTypeError(f"{key!r} is not a UUID") from None


def _positive_int(value: str) -> int:
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return n


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Write the rewrites.")
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Count what --apply would rewrite, read-only (the default).",
    )
    parser.add_argument(
        "--batch-size",
        type=_positive_int,
        default=1000,
        help="Primary keys walked per transaction (default: 1000).",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.1,
        help="Seconds to pause between batches (default: 0.1).",
    )
    parser.add_argument(
        "--only",
        action="append",
        choices=REWRITE_NAMES,
        help="Run just this rewrite; repeat for several (default: all of them).",
    )
    parser.add_argument(
        "--start-after",
        action="append",
        type=_start_after,
        metavar="TABLE=UUID",
        help="Resume TABLE after this key, as printed by a stopped run; repeatable.",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Log every batch."
    )
    args = parser.parse_args()
    if args.verbose:
        logger.setLevel(logging.DEBUG)
    keys = [table for table, _ in args.start_after or []]
    if len(keys) != len(set(keys)):
        parser.error("--start-after given twice for one table")
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
