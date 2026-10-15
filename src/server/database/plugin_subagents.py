"""Storage for the subagents installed plugins ship (``plugin_subagents``).

One row per ``agents/<name>.md`` (see migration 072). The user's changes to
one are override rows in ``user_subagents`` keyed ``plugin:<plugin>/<name>``,
so the deletes here take that table's per-user lock and drop the overrides
in the same transaction: a pane save racing an uninstall then either lands
first and goes with the plugin, or finds the base gone.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Any

from psycopg.rows import dict_row

from src.server.database.pool import get_db_connection

logger = logging.getLogger(__name__)

#: Bounds the roster a user's plugins can add to every turn's prompt.
MAX_PLUGIN_SUBAGENTS_PER_USER = 50

_VALUE_COLUMNS = (
    "description", "instructions", "tools", "model", "effort", "search_provider",
    "search_depth", "connectors", "brokerages", "preferred_connectors",
    "preferred_skills", "roles",
)
_COLUMNS = ", ".join(
    f"s.{c}" for c in (
        "plugin_subagent_id", "user_id", "plugin_id", "name", *_VALUE_COLUMNS,
        "file_text", "created_at", "updated_at",
    )
)


def plugin_key(plugin_name: str, name: str) -> str:
    """How an override names a plugin's subagent."""
    return f"plugin:{plugin_name}/{name}"


def _row_to_dict(row: Mapping[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for key in ("plugin_subagent_id", "plugin_id"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    for key in ("created_at", "updated_at"):
        value = out.get(key)
        if value is not None and hasattr(value, "isoformat"):
            out[key] = value.isoformat()
    for key in ("tools", "preferred_connectors", "preferred_skills", "roles"):
        out[key] = list(out.get(key) or [])
    return out


async def list_user_plugin_subagents(user_id: str, *, conn=None) -> list[dict[str, Any]]:
    """Every plugin subagent the user has, with its plugin's name and switch,
    in install order: the order they join the roster."""
    async with get_db_connection(conn) as db:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"SELECT {_COLUMNS}, p.name AS plugin_name, p.enabled AS plugin_enabled "
                "FROM plugin_subagents s JOIN user_plugins p "
                "ON p.user_id = s.user_id AND p.user_plugin_id = s.plugin_id "
                "WHERE s.user_id = %s ORDER BY p.installed_at, p.name, s.name",
                (user_id,),
            )
            return [_row_to_dict(r) for r in await cur.fetchall()]


async def list_plugin_subagents(
    user_id: str, plugin_id: str, *, conn=None
) -> list[dict[str, Any]]:
    """One plugin's subagents, by name."""
    async with get_db_connection(conn) as db:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"SELECT {_COLUMNS} FROM plugin_subagents s "
                "WHERE s.user_id = %s AND s.plugin_id = %s ORDER BY s.name",
                (user_id, plugin_id),
            )
            return [_row_to_dict(r) for r in await cur.fetchall()]


async def count_plugin_subagents(user_id: str, *, conn=None) -> int:
    async with get_db_connection(conn) as db:
        async with db.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) FROM plugin_subagents WHERE user_id = %s", (user_id,)
            )
            row = await cur.fetchone()
            return int(row[0]) if row else 0


def _value_params(values: Mapping[str, Any]) -> list[Any]:
    return [values[c] for c in _VALUE_COLUMNS]


async def insert_plugin_subagent(
    user_id: str,
    plugin_id: str,
    name: str,
    values: Mapping[str, Any],
    file_text: str,
    *,
    conn=None,
) -> dict[str, Any] | None:
    """Add one; None when another row holds the name, which is left alone."""
    columns = ", ".join(_VALUE_COLUMNS)
    marks = ", ".join(["%s"] * len(_VALUE_COLUMNS))
    async with get_db_connection(conn) as db:
        async with db.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"INSERT INTO plugin_subagents AS s (user_id, plugin_id, name, {columns}, file_text) "
                f"VALUES (%s, %s, %s, {marks}, %s) "
                f"ON CONFLICT (user_id, name) DO NOTHING RETURNING {_COLUMNS}",
                (user_id, plugin_id, name, *_value_params(values), file_text),
            )
            row = await cur.fetchone()
            return _row_to_dict(row) if row else None


async def replace_plugin_subagent(
    user_id: str,
    plugin_id: str,
    name: str,
    values: Mapping[str, Any],
    file_text: str,
    *,
    conn=None,
) -> bool:
    """Replace one with a new version of its file. False when the plugin no longer has it.

    Run it inside ``overrides_locked``: a pane save diffs the user's override
    against the base under that lock, and a base replaced past it would have
    the save drop a key the user set to the old base's value.
    """
    assignments = ", ".join(f"{c} = %s" for c in _VALUE_COLUMNS)
    async with get_db_connection(conn) as db:
        async with db.cursor() as cur:
            await cur.execute(
                f"UPDATE plugin_subagents SET {assignments}, file_text = %s "
                "WHERE user_id = %s AND plugin_id = %s AND name = %s",
                (*_value_params(values), file_text, user_id, plugin_id, name),
            )
            return cur.rowcount > 0


async def _lock_overrides(cur, user_id: str) -> None:
    from src.server.database.sql_fences import advisory_key

    await cur.execute(
        "SELECT pg_advisory_xact_lock(%s)", (advisory_key("user_subagents", user_id),)
    )


@asynccontextmanager
async def overrides_locked(user_id: str) -> AsyncIterator[Any]:
    """A connection in a transaction holding the user's override lock, the
    one ``save_subagent`` takes, for writes that change a plugin's bases."""
    async with get_db_connection() as db:
        async with db.transaction():
            async with db.cursor() as cur:
                await _lock_overrides(cur, user_id)
            yield db


async def clear_plugin_overrides(user_id: str, plugin_name: str, *, conn) -> int:
    """Delete the user's overrides of ``plugin_name``'s subagents; inside
    ``overrides_locked``. Returns how many went."""
    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM user_subagents WHERE user_id = %s AND kind = 'override' "
            "AND starts_with(base_key, %s)",
            (user_id, plugin_key(plugin_name, "")),
        )
        cleared = cur.rowcount
    if cleared:
        logger.info(
            f"[plugin_subagents] cleared stale overrides user_id={user_id} "
            f"plugin={plugin_name} overrides={cleared}"
        )
    return cleared


async def delete_plugin_subagents(
    user_id: str,
    plugin_id: str,
    plugin_name: str,
    *,
    names: list[str] | None = None,
    conn=None,
) -> list[str]:
    """Delete the plugin's subagents (all, or ``names``) and the user's
    overrides of them. Returns the names deleted.

    Runs in the caller's transaction when given one, else in its own: the
    override lock is transaction-scoped, so the deletes must share one.
    """
    async with get_db_connection(conn) as db:
        async with db.transaction():
            async with db.cursor() as cur:
                await _lock_overrides(cur, user_id)
                if names is None:
                    await cur.execute(
                        "DELETE FROM plugin_subagents WHERE user_id = %s AND plugin_id = %s "
                        "RETURNING name",
                        (user_id, plugin_id),
                    )
                else:
                    await cur.execute(
                        "DELETE FROM plugin_subagents WHERE user_id = %s AND plugin_id = %s "
                        "AND name = ANY(%s) RETURNING name",
                        (user_id, plugin_id, names),
                    )
                deleted = sorted(r[0] for r in await cur.fetchall())
                # By plugin name, not by the rows just deleted: an override
                # written while the plugin lacked that subagent is its too.
                prefix = plugin_key(plugin_name, "")
                if names is None:
                    await cur.execute(
                        "DELETE FROM user_subagents WHERE user_id = %s AND kind = 'override' "
                        "AND starts_with(base_key, %s)",
                        (user_id, prefix),
                    )
                else:
                    await cur.execute(
                        "DELETE FROM user_subagents WHERE user_id = %s AND kind = 'override' "
                        "AND base_key = ANY(%s)",
                        (user_id, [plugin_key(plugin_name, n) for n in names]),
                    )
                overrides = cur.rowcount
    if deleted or overrides:
        logger.info(
            f"[plugin_subagents] delete user_id={user_id} plugin={plugin_name} "
            f"subagents={deleted} overrides={overrides}"
        )
    return deleted
