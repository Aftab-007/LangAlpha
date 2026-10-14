"""One user's subagents for one turn: their rows merged, and what can be served.

The merge is pure (``ptc_agent.agent.subagents.merge``). What lives here needs
the turn: the user's rows, their plan and keys, and, once the clients exist,
which pinned models got one. A pinned model the turn cannot serve becomes
Inherit for this turn only; the saved value is never touched, because a model
absent here may be back on the next deploy.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from ptc_agent.agent.subagents.merge import (
    BaseSubagent,
    ResolvedSubagents,
    base_subagents,
    merge_subagents,
    narrow_to_request,
)
from ptc_agent.config.agent import SubagentsConfig

from . import logger, user_models
from .availability import model_resolves
from .capabilities import TierPermits, gate_search


@dataclass
class TurnSubagents:
    """One request's merged roster, kept for every resolve in that request.

    ``resolve_turn_config`` resolves a turn a second time, on the default
    model, when the thread's own cannot run. Nothing the merge reads depends
    on the model, so the second resolve reuses the first answer instead of
    reading the rows again. Created per request and never shared.
    """

    result: ResolvedSubagents | None = None


async def resolve_user_subagents(
    user_id: str,
    subagents: SubagentsConfig,
    *,
    model_pref: dict,
    permits: TierPermits,
    is_byok: bool,
    search_api: str,
    search_depth: str,
    requested: list[str] | None = None,
    conn=None,
) -> ResolvedSubagents:
    """The roster this user's turn compiles, before any client is built.

    ``search_api`` and ``search_depth`` are the user's own pair, already
    gated, which a subagent's search settings inherit and fall back to.

    A failed read of the rows raises rather than resolving without them: a
    user's off-switch is a restriction, and a turn that silently drops it
    would run a subagent they turned off.
    """
    from src.server.database.user_subagents import list_user_subagents

    rows = await list_user_subagents(user_id, conn=conn)
    bases = base_subagents(subagents)
    resolved = merge_subagents(bases, subagents.enabled, rows)
    if resolved.orphaned:
        logger.info(
            f"[CHAT] Ignoring subagent overrides whose base is gone for user={user_id}: "
            f"{list(resolved.orphaned)}"
        )
    if resolved.shadowed:
        logger.info(
            f"[CHAT] User {user_id}'s own subagents hide the base of the same name: "
            f"{list(resolved.shadowed)}"
        )
    resolved, dropped = narrow_to_request(resolved, requested)
    if dropped:
        logger.info(
            f"[CHAT] Dropping requested subagents not on user={user_id}'s roster: {dropped}"
        )
    resolved = await _demote_unservable(
        user_id, resolved, bases, model_pref=model_pref, permits=permits, is_byok=is_byok,
    )
    return await _gate_search(
        user_id, resolved, search_api=search_api, search_depth=search_depth, permits=permits,
    )


async def _gate_search(
    user_id: str,
    resolved: ResolvedSubagents,
    *,
    search_api: str,
    search_depth: str,
    permits: TierPermits,
) -> ResolvedSubagents:
    """Each searching subagent's provider and depth, as this turn can run them.

    The pair is written only where it differs from the user's own, so a
    subagent that inherits, or names the pair the user already runs, shares
    the main agent's search tool and its build is unchanged. A subagent
    without web keeps its saved values, unused.
    """
    same = await gate_search(
        None, None, effective_provider=search_api, effective_depth=search_depth, permits=None,
    )
    inherited = (same.provider, same.depth)
    definitions = dict(resolved.definitions)
    changed = False
    for name in resolved.enabled:
        defn = definitions[name]
        if "web_search" not in defn.tools or (
            defn.search_provider is None and defn.search_depth is None
        ):
            continue
        gate = await gate_search(
            defn.search_provider, defn.search_depth,
            effective_provider=search_api, effective_depth=search_depth, permits=permits,
        )
        if gate.provider_fallback or gate.depth_fallback:
            logger.info(
                f"[CHAT] Subagent {name!r} searches with {gate.provider}/{gate.depth} "
                f"for user={user_id}: provider {gate.provider_fallback or 'kept'}, "
                f"depth {gate.depth_fallback or 'kept'}"
            )
        pair = (gate.provider, gate.depth)
        provider, depth = (None, None) if pair == inherited else pair
        if (provider, depth) != (defn.search_provider, defn.search_depth):
            definitions[name] = replace(defn, search_provider=provider, search_depth=depth)
            changed = True
    if not changed:
        return resolved
    return replace(resolved, definitions=definitions)


async def _demote_unservable(
    user_id: str,
    resolved: ResolvedSubagents,
    bases: dict[str, BaseSubagent],
    *,
    model_pref: dict,
    permits: TierPermits,
    is_byok: bool,
) -> ResolvedSubagents:
    """Pinned models this turn cannot run, as Inherit.

    By name for every pin, since a name the manifest lacks fails the build.
    By plan only for a model the user chose: a deployment's own pin is the
    operator's call, and gating it would change the turn of a user who never
    touched their subagents.
    """
    definitions = dict(resolved.definitions)
    unavailable = dict(resolved.unavailable)
    byok_cache: dict[str, dict | None] = {}
    changed = False
    for name in resolved.enabled:
        defn = definitions[name]
        if not defn.model:
            continue
        base = bases.get(name)
        user_set = (
            defn.source == "custom"
            or base is None
            or base.definition.model != defn.model
        )
        if model_resolves(model_pref, defn.model) and (
            not user_set
            or await _on_plan(
                user_id, defn.model, model_pref=model_pref, permits=permits,
                is_byok=is_byok, byok_cache=byok_cache,
            )
        ):
            continue
        logger.info(
            f"[CHAT] Subagent {name!r} runs on the turn's model: {defn.model!r} "
            f"is not available to user={user_id}"
        )
        unavailable[name] = defn.model
        definitions[name] = replace(defn, model=None)
        changed = True
    if not changed:
        return resolved
    return replace(resolved, definitions=definitions, unavailable=unavailable)


async def _on_plan(
    user_id: str,
    model: str,
    *,
    model_pref: dict,
    permits: TierPermits,
    is_byok: bool,
    byok_cache: dict[str, dict | None],
) -> bool:
    """Whether the user may run ``model``, in the model list's order.

    A provider the user holds a key or a subscription for is never gated by
    plan, so a free-plan user who pins a model to their own key keeps it. A
    model with no tier is one no plan includes, which the list offers only to
    such a user.
    """
    from src.config.settings import HOST_MODE

    if HOST_MODE != "platform":
        return True
    source, entry = await user_models.classify_model(user_id, model, _pref_cache=model_pref)
    if source != user_models.ModelSource.SYSTEM:
        # A custom model runs on the user's own key or not at all, which the
        # pass after the clients are built settles.
        return True
    tier = entry.get("tier")
    if isinstance(tier, int) and await permits(tier):
        return True

    from src.llms.llm import LLM as LLMFactory

    from .clients import _walk_byok_candidates

    provider = entry.get("provider")
    if not provider:
        return False
    mc = LLMFactory.get_model_config()
    if mc.get_provider_info(provider).get("access_type") == "oauth":
        # Served on the user's subscription or not at all; with none, the
        # role gets no client and the pass after the clients demotes it.
        return True
    if not is_byok:
        return False
    found, _ = await _walk_byok_candidates(user_id, provider, mc, _byok_cache=byok_cache)
    return found is not None


def demote_clientless(config: Any, on_main: set[str]) -> None:
    """After the clients are built, a pinned model the turn did not run is Inherit.

    That is a role that got no client (a custom model whose last key was
    removed, a provider with no key on this deployment) or one that fell back
    to the main model. The first pass checks names and plans, not keys, so it
    cannot see either. A clientless role also loses the prompt guidance
    ``resolve_clients`` stamped from its pinned model, since the subagent now
    runs the turn's; a fallen-back one was already given the main model's.
    """
    resolved = config.subagents.resolved
    if resolved is None:
        return
    definitions = dict(resolved.definitions)
    unavailable = dict(resolved.unavailable)
    changed = False
    for name in resolved.enabled:
        defn = definitions[name]
        key = f"subagent:{name}"
        has_client = key in config.subsidiary_llm_clients
        if not defn.model or (has_client and key not in on_main):
            continue
        if not has_client:
            config.role_prompt_guidance.pop(key, None)
        unavailable[name] = defn.model
        definitions[name] = replace(defn, model=None)
        changed = True
    if changed:
        config.subagents.resolved = replace(
            resolved, definitions=definitions, unavailable=unavailable
        )
