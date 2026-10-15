"""The subagents a user's plugins ship, as bases for the merge.

Installed plugins' rows (``plugin_subagents``) and the bundles' ``agents/``
files, read per call as the rest of a plugin's components are, so installing,
updating, switching or removing a plugin leaves nothing cached to go stale.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ptc_agent.agent.subagents.merge import BaseSubagent, plugin_definition

_FIELDS = (
    "description", "tools", "model", "effort", "search_provider", "search_depth",
    "connectors", "brokerages", "preferred_connectors", "preferred_skills",
)


def _base(plugin: str, name: str, values: Mapping[str, Any]) -> BaseSubagent:
    from src.server.database.plugin_subagents import plugin_key

    definition = plugin_definition({
        "name": name,
        "fields": {k: values[k] for k in _FIELDS},
        "instructions": values["instructions"],
        "roles": values["roles"],
    })
    return BaseSubagent(plugin_key(plugin, name), definition)


async def plugin_bases(user_id: str, *, conn=None) -> list[tuple[BaseSubagent, bool]]:
    """Each plugin subagent with whether its plugin is on: bundles first, in
    bundle order, then installed plugins in install order."""
    from src.server.database.plugin_subagents import list_user_plugin_subagents
    from src.server.services.plugins.bundled import bundled_agent_plans

    out: list[tuple[BaseSubagent, bool]] = []
    bundled = bundled_agent_plans()
    if bundled:
        from src.server.database.account_disables import list_account_disables

        # On the caller's connection: a caller passing one is holding it, and a
        # second checkout beside it can wait out the pool timeout.
        off = (await list_account_disables(user_id, conn=conn)).bundles
        out += [(_base(bundle, plan.name, plan.values), bundle not in off) for bundle, plan in bundled]
    out += [
        (_base(row["plugin_name"], row["name"], row), bool(row["plugin_enabled"]))
        for row in await list_user_plugin_subagents(user_id, conn=conn)
    ]
    return out
