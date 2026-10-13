"""How a catalog row reads on the page.

A row alone says what the user saved. The page also shows what its OAuth
connection grants, what its last probe found under the current configuration,
the mark its server or plugin names, and whether any tool reaches the
assistant without a sandbox. Every route that returns a row reads those here,
so two answers about the same row cannot disagree.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from src.server.database.mcp_oauth import (
    SERVABLE,
    ConnectionStatus,
    get_connection,
    list_connections,
)
from src.server.database.mcp_tool_schemas import get_user_tool_schemas
from src.server.database.plugins import list_plugins
from src.server.models.mcp_server import (
    CatalogServer,
    McpServerInput,
    catalog_row_to_response,
    isolation_warnings,
)
from src.server.services.mcp_oauth.discovery import (
    SELF_HEAL_INTERVAL_S,
    schedule_catalog_discovery,
)
from src.server.services.plugins.icons import component_mark, plugin_icon_source

logger = logging.getLogger(__name__)


async def oauth_for_server(user_id: str, name: str) -> dict | None:
    """One row's connection, for a response that is only ever about one row.

    Shaped like a row from the map below rather than handed over as the record
    it arrives as, so :func:`decorated` has one thing to read. Same swallow as
    the map too: the connection is decoration here, and losing it must not fail
    the write that just succeeded.
    """
    try:
        conn = await get_connection(user_id, name)
    except Exception:
        logger.warning(
            "[mcp_catalog] OAuth connection lookup failed for %s/%s", user_id, name,
            exc_info=True,
        )
        return None
    if conn is None:
        return None
    return {
        "status": conn.status,
        "server_url": conn.server_url,
        "granted_capabilities": conn.granted_capabilities,
    }


async def _oauth_by_server(user_id: str) -> dict[str, dict]:
    """server_name → its connection summary, for decorating catalog responses."""
    try:
        return {c["server_name"]: c for c in await list_connections(user_id)}
    except Exception:
        logger.warning(
            "[mcp_catalog] OAuth connection lookup failed for %s", user_id,
            exc_info=True,
        )
        return {}


def decorated(row: dict, conn: dict | None, **extra) -> CatalogServer:
    """A catalog response carrying what its OAuth connection knows.

    One helper for every path that has a connection in hand, because they all
    answer the same two questions about it, and a caller that reached for only
    the status is how consent stayed invisible after connecting.

    A connection that can no longer be served reports its status but not its
    capabilities. The stored keys outlive a revoke, and every reader treats a
    non-null list as the grant currently in force -- so passing them through
    drew a disconnected broker still badged as able to place live orders.
    Withholding them reads as "nothing connected here", which is the truth.

    The choice itself still travels, under its own name. Reconnecting is the
    only way to change a selection, so the dialog that opens on a needs_reauth
    or revoked row has to start from what the user last chose; seeding it from
    the grant instead meant a repair after a token expiry re-proposed every
    group they had declined. Two fields because they are two questions, and the
    reader that wanted the wrong one is how this went wrong in both directions.
    """
    if conn is None:
        return catalog_row_to_response(row, **extra)
    from src.server.services.brokerage_capabilities import (
        effective_capabilities,
        vendor_for_url,
    )

    status = ConnectionStatus(conn["status"])
    stored = conn["granted_capabilities"]
    return catalog_row_to_response(
        row,
        oauth_status=status,
        # In force rather than as stored, since every badge reads this: a group
        # whose requirement was not granted is refused, so it is not drawn.
        granted_capabilities=(
            list(effective_capabilities(vendor_for_url(conn.get("server_url")), stored))
            if status in SERVABLE and stored is not None
            else None
        ),
        remembered_capabilities=stored,
        **extra,
    )


def _has_direct_tools(row: dict, conn: dict | None, snapshot: dict | None) -> bool:
    """Whether any tool on this row binds directly, and so reaches Flash.

    Flash has no sandbox, so a row is reachable from it only through a tool on
    the direct path. Answered from the snapshot the list already holds rather
    than by asking per row, which is the observer behind every server the user
    owns that the rows deliberately do not carry.

    Read the same way ``resolve_mcp_config`` plans the row: a servable
    connection says which vendor's rules apply and what was consented to,
    while a row without one is judged by its own address, its own headers and
    consent to nothing. A revoked connection is history rather than a claim on
    the row, so it falls to that header path. A connection that needs repair
    answers no on its own; the sync binds no grant for it, so nothing it lists
    could be called.

    Intersected with what the snapshot actually published, because a plan
    carries every name the vendor's curation grants whether or not this server
    published it, while ``build_direct_entries`` can only bind a schema it
    holds. Reading ``plan.direct`` alone would offer Flash on a connection
    whose scope toggle saves cleanly and then gives Flash nothing to call.
    """
    from src.server.models.mcp_server import probe_ok
    from src.server.services.brokerage_capabilities import vendor_for_url
    from src.server.services.egress import fold_tool_name, folded
    from src.server.services.tool_binding import inputs_from_row, resolve_plan

    status = ConnectionStatus(conn["status"]) if conn is not None else None
    if status is ConnectionStatus.REVOKED:
        conn = None
    elif status is not None and status not in SERVABLE:
        return False
    # The flag has to agree with the grant the sync would write, and a header
    # row's grant hangs on this verdict alone (``grant_scope._probe_ok``): the
    # no-downgrade upsert keeps the tools and the ok status a refused probe
    # never took away.
    if conn is None and not probe_ok(snapshot):
        return False
    published = (snapshot or {}).get("tools") or []
    names = [name for t in published if (name := t.get("name"))]
    vendor_url = conn.get("server_url") if conn is not None else row.get("url")
    plan = resolve_plan(
        vendor_for_url(vendor_url),
        (conn.get("granted_capabilities") or ()) if conn is not None else (),
        inputs_from_row(row),
        candidates=names,
    )
    direct = folded(plan.direct)
    return any(fold_tool_name(n) in direct for n in names)


async def _snapshots_by_server(
    user_id: str, rows: list[dict]
) -> dict[str, dict]:
    """server_name → its snapshot under the CURRENT config, whatever its status.

    Hash-gated the way the workspace effective list is (``ToolSnapshotIndex``
    owns the rule), so a stale config's row is never read. Every status rather
    than only ``ok``: the probe's failure is a fact the page has to show, and
    it lives on the same row as the tools would. Callers that want tools check
    ``ok_snapshot`` themselves. The whole snapshot rather than one derived
    number, because the tool count, the auth verdict and the server's own
    identity are facts from the same row.

    Pure decoration: any failure degrades to no snapshots, never a 500.
    """
    from src.server.services.mcp_config import user_row_to_server_config
    from src.server.services.mcp_discovery import ToolSnapshotIndex

    try:
        schema_rows = await get_user_tool_schemas(user_id)
    except Exception:
        logger.warning(
            "[mcp_catalog] tool-schema lookup failed for %s", user_id,
            exc_info=True,
        )
        return {}
    index = ToolSnapshotIndex(user_rows=schema_rows)
    accepted: dict[str, dict] = {}
    for row in rows:
        try:
            snapshot = index.snapshot(user_row_to_server_config(row))
        except Exception:  # noqa: BLE001 - a malformed row is just omitted
            continue
        if snapshot is not None:
            accepted[row["name"]] = snapshot
    return accepted


def _kicked_recently(row: dict) -> bool:
    """Whether this row's probe clock was stamped inside the self-heal window.

    ``claim_probe_kick`` is still the guard every worker agrees on; this is the
    cheap pre-check in front of it, so a polling list does not spawn a task per
    remote row only to be told no.
    """
    stamp = row.get("probe_kicked_at")
    if not stamp:
        return False
    try:
        kicked = datetime.fromisoformat(stamp)
    except (TypeError, ValueError):
        return False
    if kicked.tzinfo is None:
        kicked = kicked.replace(tzinfo=UTC)
    return (datetime.now(UTC) - kicked).total_seconds() < SELF_HEAL_INTERVAL_S


def _kick_unprobed(user_id: str, rows: list[dict], snapshots: dict[str, dict]) -> None:
    """Self-heal: a live remote row nothing has probed under its current config
    gets its probe now.

    Rows from before host-side discovery covered them, rows whose snapshot
    predates the verdict column, rows whose kick was lost to a restart, and
    rows whose one probe never reached the server all land here. Only
    ``unreachable`` is retried: every other verdict is the server's own answer,
    and only a config or vault change earns a new one.
    """
    from src.server.models.mcp_server import snapshot_probe

    for row in rows:
        # An inert template is never dialled in the background, so a kick from
        # here would only spend a task and a throttle stamp to be told no by
        # the discovery pass. Its first probe comes from the switch.
        if not row.get("enabled") or row.get("plugin_enabled") is False:
            continue
        # The host-side probe dials streamable HTTP, so an ``sse`` row has no
        # path from here at all and keeps its in-sandbox discovery.
        if row.get("transport") != "http":
            continue
        probe = snapshot_probe(snapshots.get(row["name"]))
        unprobed = (
            row["name"] not in snapshots
            or probe is None
            or probe.verdict == "unreachable"
        )
        if unprobed and not _kicked_recently(row):
            schedule_catalog_discovery(
                user_id, row["name"], reason="self-heal", throttle=True
            )


async def _oauth_headers_warning(user_id: str, server: McpServerInput) -> str | None:
    """Warn when configured headers meet a live OAuth connection.

    The two are independently settable, but the OAuth path never sends the
    configured headers: the probe sends its own, host discovery and the relay
    send only the OAuth Authorization. Silence would read as pass-through.
    """
    if not server.headers:
        return None
    try:
        connection = await get_connection(user_id, server.name)
    except Exception:
        logger.warning(
            "[mcp_catalog] OAuth connection lookup failed for %s", user_id,
            exc_info=True,
        )
        return None
    if connection is None or connection.status == ConnectionStatus.REVOKED:
        return None
    return (
        "This server is OAuth-connected, so its configured headers are not "
        "sent: discovery and sandbox tool calls carry only the OAuth "
        "Authorization header. Disconnect OAuth to use headers instead."
    )


async def catalog_write_warnings(user_id: str, server: McpServerInput) -> list[str] | None:
    """The write-time nudges for a catalog row: isolation, then dropped headers."""
    warnings = isolation_warnings(server)
    if headers_warning := await _oauth_headers_warning(user_id, server):
        warnings.append(headers_warning)
    return warnings or None


async def _plugin_mark(
    plugins: dict[str, dict], row: dict, server_info: dict | None
) -> str | None:
    """A row's mark: what its handshake names, else what the plugin that
    installed it declares for it, else the plugin's own."""
    plugin = plugins.get(row.get("plugin_name"))
    return await component_mark(
        server_info,
        None
        if plugin is None
        else plugin_icon_source(
            plugin["manifest"], plugin.get("source_ref"), row.get("plugin_server_key")
        ),
    )


async def snapshot_of(user_id: str, row: dict) -> dict | None:
    """``row``'s snapshot under its current config, whatever its status."""
    return (await _snapshots_by_server(user_id, [row])).get(row["name"])


async def decorate_row(user_id: str, row: dict) -> CatalogServer:
    """One row as the page reads it, for a route that answers about one row."""
    return decorated(
        row,
        await oauth_for_server(user_id, row["name"]),
        snapshot=await snapshot_of(user_id, row),
    )


async def decorate_rows(user_id: str, rows: list[dict]) -> list[CatalogServer]:
    """The catalog as the page lists it.

    Not a pure read: a remote row with no verdict gets its probe kicked here
    (stamping ``probe_kicked_at``), throttled per row, so a listing is what
    heals a row whose probe was lost.
    """
    oauth = await _oauth_by_server(user_id)
    snapshots = await _snapshots_by_server(user_id, rows)
    _kick_unprobed(user_id, rows, snapshots)
    plugins = (
        {p["name"]: p for p in await list_plugins(user_id)}
        if any(r.get("plugin_name") for r in rows)
        else {}
    )
    servers = []
    for r in rows:
        snapshot = snapshots.get(r["name"])
        meta = (snapshot or {}).get("observed_meta") or {}
        servers.append(
            decorated(
                r,
                oauth.get(r["name"]),
                icon_url=await _plugin_mark(plugins, r, meta.get("server_info")),
                has_direct_tools=_has_direct_tools(r, oauth.get(r["name"]), snapshot),
                snapshot=snapshot,
            )
        )
    return servers
