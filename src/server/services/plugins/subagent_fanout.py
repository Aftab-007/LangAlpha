"""Fan a package's ``agents/`` files into plugin_subagents rows.

The skills' collision policy, per subagent: a name a built-in or a bundle's
subagent holds is skipped, one of the user's own is left untouched
(``exists``), and a name another plugin owns is refused for the whole install
before anything is written (``lifecycle._refuse_owned_names``).
"""

from __future__ import annotations

import logging

from src.server.database.plugin_subagents import (
    MAX_PLUGIN_SUBAGENTS_PER_USER,
    count_plugin_subagents,
    insert_plugin_subagent,
)
from src.server.database.user_subagents import list_user_subagents
from src.server.models.plugin import ComponentResult, Diagnostic, InstallReport
from src.server.services.plugins.agents import AgentPlan

logger = logging.getLogger(__name__)

SUBAGENT_EXISTS_REASON = "a subagent with this name already exists; left untouched"
_RESERVED_REASON = "a built-in subagent has this name"
_CAP_REASON = (
    f"your plugins already add {MAX_PLUGIN_SUBAGENTS_PER_USER} subagents, the "
    "per-account limit; uninstall a plugin and update this one to add the rest"
)


def reserved_subagent_names() -> frozenset[str]:
    """Names a plugin's subagent can't take: the deployment's and the bundles'."""
    from ptc_agent.agent.subagents.merge import base_subagents
    from src.server.app import setup
    from src.server.services.plugins.bundled import bundled_agent_plans

    defined = (
        set(base_subagents(setup.agent_config.subagents))
        if setup.agent_config is not None
        else set()
    )
    return frozenset(defined | {plan.name for _, plan in bundled_agent_plans()})


async def fan_out_subagents(
    user_id: str,
    plugin_id: str,
    plans: list[AgentPlan],
    report: InstallReport,
    *,
    conn,
) -> None:
    """Create a row per plan that reads, reporting every plan.

    ``conn`` is an ``overrides_locked`` transaction, so a custom subagent the
    pane creates meanwhile can't take a name between the read and the insert.
    """
    if not plans:
        return
    reserved = reserved_subagent_names()
    own = {
        r["name"]
        for r in await list_user_subagents(user_id, conn=conn)
        if r.get("kind") == "custom"
    }
    held = await count_plugin_subagents(user_id, conn=conn)

    for plan in plans:
        report.diagnostics.extend(plan.diagnostics)
        if plan.skip_code is not None:
            report.components.append(
                ComponentResult.of(plan, "skipped", reason=plan.skip_reason or "")
            )
            continue
        if plan.name in reserved:
            report.components.append(
                ComponentResult.of(plan, "skipped", reason=_RESERVED_REASON)
            )
            report.diagnostics.append(Diagnostic(
                scope="subagent", target=plan.name, code="reserved_name",
                message=_RESERVED_REASON,
            ))
            continue
        if plan.name in own:
            report.components.append(
                ComponentResult.of(plan, "exists", reason=SUBAGENT_EXISTS_REASON)
            )
            continue
        if held >= MAX_PLUGIN_SUBAGENTS_PER_USER:
            report.components.append(ComponentResult.of(plan, "error", reason=_CAP_REASON))
            report.diagnostics.append(Diagnostic(
                level="error", scope="subagent", target=plan.name,
                code="cap_reached", message=_CAP_REASON,
            ))
            continue
        row = await insert_plugin_subagent(
            user_id, plugin_id, plan.name, plan.values, plan.text, conn=conn
        )
        if row is None:
            # Taken between the refusal and this write.
            report.components.append(
                ComponentResult.of(plan, "exists", reason=SUBAGENT_EXISTS_REASON)
            )
            continue
        held += 1
        report.subagents_created += 1
        report.components.append(ComponentResult.of(plan, "created"))
