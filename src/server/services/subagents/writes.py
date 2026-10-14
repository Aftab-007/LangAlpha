"""Saving and removing a user's subagents, for the pane and the agent's files alike.

Both writers send the version they read. The save checks it against a fresh
read under a per-user lock, so a pane edit racing an agent edit is a conflict
rather than a silent overwrite, and so is a base that changed underneath (a
deploy, a template edit). Validation runs before the lock: it reads keys and
plans over other connections, and a matching version proves the values it
judged are still the ones stored.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from ptc_agent.agent.subagents.merge import BaseSubagent

from .context import SubagentContext, load_context
from .rules import (
    EDITABLE_KEYS,
    INHERIT,
    INHERITABLE_KEYS,
    ROLE_ORDER,
    FieldError,
    SubagentInvalid,
    custom_text_errors,
    validate_fields,
    validate_new_name,
)
from .view import attach_titles, build_views, definition_values

logger = logging.getLogger(__name__)


class VersionConflict(Exception):
    """The subagent changed since the writer read it; read again and retry."""


class SubagentNotFound(Exception):
    """No subagent of that name."""


@dataclass(frozen=True)
class SaveResult:
    """A save's outcome, with what its report should mention.

    ``reset`` is an edit that left nothing different from the base, so the
    override row went. ``description_matches`` names the subagents whose
    description the saved one repeats (say ``description_match_note``).
    """

    view: dict[str, Any]
    created: bool = False
    reset: bool = False
    description_matches: list[str] = field(default_factory=list)


async def list_subagents(
    user_id: str, *, ctx: SubagentContext | None = None
) -> tuple[SubagentContext, list[dict[str, Any]]]:
    """Every subagent view, with problems and thread titles."""
    from src.server.database.user_subagents import list_user_subagents

    ctx = ctx or await load_context(user_id)
    views = await build_views(ctx, await list_user_subagents(user_id))
    await attach_titles(user_id, views)
    return ctx, views


def _stored_effective(key: str, value: Any) -> Any:
    """What a stored field value means, for comparing it with the base's."""
    if key in INHERITABLE_KEYS:
        return None if value in (None, INHERIT) else value
    if key == "connectors":
        return value is True or value == "on"
    return value


def _override_fields(
    base: BaseSubagent, row: Mapping[str, Any] | None, patch: Mapping[str, Any]
) -> dict[str, Any]:
    """The override's fields after ``patch``: only what differs from the base.

    A row written against another base (``base_key`` moved) is started over.
    An explicit ``inherit`` is stored as null, which the merge reads as the
    thread's value whatever the base pins.
    """
    applies = row is not None and row.get("base_key") == base.key
    fields = dict(row.get("fields") or {}) if applies else {}
    for key, value in patch.items():
        if value is None:
            fields.pop(key, None)
        else:
            fields[key] = None if value == INHERIT else value
    base_values = definition_values(base.definition, enabled=True)
    return {k: v for k, v in fields.items() if _stored_effective(k, v) != base_values[k]}


def _custom_parts(
    fields: Mapping[str, Any], instructions: str, roles: list[str], patch: Mapping[str, Any]
) -> tuple[dict[str, Any], str, list[str]]:
    """A custom subagent's row after ``patch``."""
    out = dict(fields)
    for key, value in patch.items():
        if key == "instructions":
            instructions = value or ""
        elif key == "available_to":
            roles = list(value) if value else list(ROLE_ORDER)
        elif value is None or (key in INHERITABLE_KEYS and value == INHERIT):
            out.pop(key, None)
        else:
            out[key] = value
    return out, instructions, roles


def _seed(view: Mapping[str, Any]) -> tuple[dict[str, Any], str, list[str]]:
    """A copy's starting row: every effective value of ``view``.

    The same copy ``cp`` makes in the folder, so the pane's Start from and the
    agent produce the same subagent.
    """
    fields = {
        k: view[k] for k in EDITABLE_KEYS
        if not (k in INHERITABLE_KEYS and view[k] is None)
    }
    fields["description"] = view["description"]
    return fields, view["instructions"], list(view["available_to"])


async def _runnable_seed(ctx: SubagentContext, view: Mapping[str, Any]) -> tuple[dict[str, Any], str, list[str]]:
    """``_seed`` less a model pin the copy would not run where ``view`` does.

    A deployment base runs its own pin whatever the plan, but a copy is the
    user's own subagent and held to the plan like any model they pick, so it
    follows the thread instead, which is what the turn would run. The effort
    stays, as the turn keeps it on that fallback.
    """
    fields, instructions, roles = _seed(view)
    model = fields.get("model")
    runs = not any(p["code"] == "model_unavailable" for p in view["problems"])
    if model and runs and not await ctx.model_on_plan(model):
        del fields["model"]
    return fields, instructions, roles


def _blank_custom(name: str) -> dict[str, Any]:
    from ptc_agent.agent.subagents.merge import custom_definition

    return definition_values(custom_definition({"name": name, "fields": {}}), enabled=True)


async def _lock(conn, user_id: str) -> None:
    """One writer at a time per user: versions, the custom cap and renames all read-then-write."""
    from src.server.database.sql_fences import advisory_key

    await conn.execute(
        "SELECT pg_advisory_xact_lock(%s)", (advisory_key("user_subagents", user_id),)
    )


async def save_subagent(
    user_id: str,
    name: str,
    fields: Mapping[str, Any],
    *,
    version: str | None,
    start_from: str | None = None,
    updated_by: str = "user",
    thread_id: str | None = None,
) -> SaveResult:
    """Create a custom subagent, or change one the user has, base or custom.

    ``version`` is the one the writer read, required for an existing subagent;
    None creates a custom one, optionally copied from ``start_from``. On a base,
    only differences from it are stored and null clears a key back to it.

    Raises ``SubagentInvalid`` (field errors), ``VersionConflict`` and
    ``SubagentsUnavailable``.
    """
    from src.server.database.pool import get_db_connection
    from src.server.database.user_subagents import (
        delete_user_subagent,
        get_user_subagent,
        list_user_subagents,
        upsert_user_subagent,
    )

    ctx = await load_context(user_id)
    views = {
        v["name"]: v
        for v in await build_views(ctx, await list_user_subagents(user_id), problems=False)
    }
    target = views.get(name)
    creating = version is None
    if creating and target is not None:
        if target["kind"] == "base" and target["base"] is not None:
            raise SubagentInvalid([
                FieldError("name", f"{name} is a built-in subagent. Pick another name.")
            ])
        raise VersionConflict()
    if not creating and (target is None or target["version"] != version):
        raise VersionConflict()
    if not creating and start_from is not None:
        raise SubagentInvalid([FieldError("start_from", "Only when creating a subagent.")])
    if target is not None and target["kind"] == "base" and target["base"] is None:
        raise SubagentInvalid([FieldError(
            "name", "Its built-in subagent was removed, so its settings can only be deleted."
        )])

    errors: list[FieldError] = []
    seed: tuple[dict[str, Any], str, list[str]] | None = None
    if creating:
        errors += validate_new_name(
            name,
            base_names=ctx.bases,
            custom_count=sum(1 for v in views.values() if v["kind"] == "custom"),
        )
        if start_from is not None:
            source = views.get(start_from)
            if source is None or (source["kind"] == "base" and source["base"] is None):
                raise SubagentInvalid(errors + [FieldError(
                    "start_from", f"No subagent named {start_from} to start from.",
                    [n for n, v in views.items() if v["kind"] == "custom" or v["base"] is not None],
                )])
            seed = await _runnable_seed(ctx, source)
            current = {**seed[0], "instructions": seed[1], "available_to": seed[2]}
        else:
            current = {**_blank_custom(name), "description": "", "instructions": "",
                       "available_to": list(ROLE_ORDER)}
        kind, base_values = "custom", None
    else:
        current = dict(target)
        kind = "custom" if target["kind"] == "custom" else "override"
        base_values = target["base"]

    try:
        patch = await validate_fields(ctx, fields, kind=kind, current=current, base=base_values)
    except SubagentInvalid as exc:
        errors += exc.errors
        patch = {}
    if kind == "custom":
        final = {
            key: (patch[key] or "") if key in patch else current.get(key)
            for key in ("description", "instructions")
        }
        refused = {e.field for e in errors}
        errors += [
            e for e in custom_text_errors(final, fields) if e.field not in refused
        ]
    if errors:
        raise SubagentInvalid(errors)

    reset = False
    async with get_db_connection() as conn:
        async with conn.transaction():
            await _lock(conn, user_id)
            rows = await list_user_subagents(user_id, conn=conn)
            locked = {
                v["name"]: v for v in await build_views(ctx, rows, problems=False)
            }.get(name)
            row = await get_user_subagent(user_id, name, conn=conn, for_update=True)
            if creating:
                if locked is not None or row is not None:
                    raise VersionConflict()
                errors = validate_new_name(
                    name,
                    base_names=ctx.bases,
                    custom_count=sum(1 for r in rows if r.get("kind") == "custom"),
                )
                if errors:
                    raise SubagentInvalid(errors)
                start = seed or ({}, "", list(ROLE_ORDER))
                new_fields, instructions, roles = _custom_parts(*start, patch)
                await upsert_user_subagent(
                    user_id, name, kind="custom", fields=new_fields,
                    instructions=instructions, roles=roles,
                    updated_by=updated_by, updated_thread_id=thread_id, conn=conn,
                )
            elif locked is None or locked["version"] != version or row is None and kind == "custom":
                raise VersionConflict()
            elif kind == "custom":
                new_fields, instructions, roles = _custom_parts(
                    row.get("fields") or {}, row.get("instructions") or "",
                    row.get("roles") or list(ROLE_ORDER), patch,
                )
                await upsert_user_subagent(
                    user_id, name, kind="custom", fields=new_fields,
                    instructions=instructions, roles=roles,
                    updated_by=updated_by, updated_thread_id=thread_id, conn=conn,
                )
            else:
                base = ctx.bases[name]
                new_fields = _override_fields(base, row, patch)
                if new_fields:
                    await upsert_user_subagent(
                        user_id, name, kind="override", base_key=base.key,
                        fields=new_fields, updated_by=updated_by,
                        updated_thread_id=thread_id, conn=conn,
                    )
                else:
                    # Nothing left that differs from the base: a row would
                    # only mark it edited, so the save is a reset.
                    if row is not None:
                        await delete_user_subagent(user_id, name, conn=conn)
                    reset = True

    _, after = await list_subagents(user_id, ctx=ctx)
    view = next(v for v in after if v["name"] == name)
    return SaveResult(
        view=view,
        created=creating,
        reset=reset,
        description_matches=[
            p["detail"] for p in view["problems"] if p["code"] == "description_matches"
        ],
    )


async def delete_subagent(user_id: str, name: str, *, version: str | None) -> bool:
    """Delete a custom subagent, or reset a base by removing the user's override.

    False when there was nothing to remove (a base never edited). ``version``
    None skips the check, for a writer that settled it under its own read.
    Raises ``SubagentNotFound`` and ``VersionConflict``.
    """
    from src.server.database.pool import get_db_connection
    from src.server.database.user_subagents import (
        delete_user_subagent,
        get_user_subagent,
        list_user_subagents,
    )

    ctx = await load_context(user_id)
    async with get_db_connection() as conn:
        async with conn.transaction():
            await _lock(conn, user_id)
            rows = await list_user_subagents(user_id, conn=conn)
            target = {
                v["name"]: v for v in await build_views(ctx, rows, problems=False)
            }.get(name)
            if target is None:
                raise SubagentNotFound(name)
            if version is not None and target["version"] != version:
                raise VersionConflict()
            if await get_user_subagent(user_id, name, conn=conn, for_update=True) is None:
                return False
            return await delete_user_subagent(user_id, name, conn=conn)
