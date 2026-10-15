"""Each of the user's subagents as one markdown file, and a save of it as a row change.

Serves ``SubagentsBackend`` (`.agents/user/agents/<name>.md`). A file is YAML
frontmatter, one key per line in a fixed order, then the instructions. It
shows effective values whatever the row stores, so a save that keeps only
differences from a base still reads back as written. ``main.md`` shows what
the agent itself runs on and takes no save.

A save sends only the keys that differ from the file as it stands to the
``save_subagent`` the pane's REST route uses, which checks the version again
under its own lock, so the route holds no transaction (as the channels route
holds none). The file's own rules live here: the file name names the
subagent, read-only keys are ignored with a note rather than refused, and a
base's body is refused.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Literal

import yaml

from ptc_agent.agent.backends.db_json_route import (
    DbJsonFile,
    Plan,
    StaleVersion,
    UserDataValidationError,
)
from ptc_agent.core.paths import SUBAGENT_FILE_NAME
from ptc_agent.core.sandbox.livefs_mount import CallContext

from .context import list_connectors, load_main_values
from .rules import (
    DESCRIPTION_MAX,
    EDITABLE_KEYS,
    INHERIT,
    INHERITABLE_KEYS,
    MAX_CUSTOM,
    WRITABLE_KEYS,
    SubagentInvalid,
    changed_fields,
    description_match_note,
    normalize_value,
)
from .writes import (
    SubagentNotFound,
    VersionConflict,
    delete_subagent,
    file_values,
    rename_subagent,
    save_subagent,
)

logger = logging.getLogger(__name__)

MAIN_FILE = "main.md"

#: The frontmatter's keys, in the order a file shows them.
FILE_KEYS = (
    "name",
    "source",
    "description",
    "model",
    "effort",
    "tools",
    "search_provider",
    "search_depth",
    "connectors",
    "brokerages",
    "preferred_connectors",
    "preferred_skills",
    "available_to",
    "enabled",
)
_KEPT_KEYS = ("name", "source")
_BASE_READ_ONLY = ("description", "available_to")

NAME_RULE = (
    "a subagent's file name is its name plus .md, and a name is 1 to 48 lowercase letters, "
    "digits or -, starting with a letter or digit (credit-analyst.md)"
)

_FILE_RE = re.compile(SUBAGENT_FILE_NAME)
_PLAIN_ITEM = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.\-]*")
_COPY_HINT = (
    "Copy this file to a new name to write your own; the frontmatter keys the README lists "
    "can be changed here."
)
_NEXT_TURN = "Applies from your next turn."
_LISTED_OPTIONS = 15


def file_named(name: str) -> SubagentFile | MainFile | None:
    """The file ``name`` would be, whether or not the user has it."""
    if name == MAIN_FILE:
        return MainFile()
    if _FILE_RE.fullmatch(name):
        return SubagentFile(name.removesuffix(".md"))
    return None


def _orphan(view: dict[str, Any]) -> bool:
    """Settings of a base that is gone, which have no file: only the pane deletes them."""
    return view["kind"] == "base" and view["base"] is None


def _has_file(view: dict[str, Any]) -> bool:
    return view["file"] is not None and not _orphan(view)


async def file_names(user_id: str) -> list[str]:
    names = [f"{v['name']}.md" for v in await file_values(user_id) if _has_file(v)]
    return sorted([*names, MAIN_FILE])


async def _main_values(user_id: str) -> dict[str, Any] | None:
    try:
        return await load_main_values(user_id)
    except Exception:
        # The subagents' files still serve; main.md is only missing.
        logger.exception("subagents main.md values failed")
        return None


async def rendered_files(user_id: str) -> dict[str, tuple[str, str]]:
    views, main = await asyncio.gather(file_values(user_id), _main_values(user_id))
    out = {f"{v['name']}.md": (render_subagent(v), v["version"]) for v in views if _has_file(v)}
    if main is not None:
        out[MAIN_FILE] = render_main(main)
    return out


# =============================================================================
# Rendering
# =============================================================================


def _scalar(value: str) -> str:
    """A string as YAML: plain where it reads back as itself, else in JSON's
    double quotes, which YAML reads as the same string."""
    if value and value.strip() == value and "\n" not in value:
        try:
            if yaml.safe_load(f"k: {value}") == {"k": value}:
                return value
        except yaml.YAMLError:
            pass
    return json.dumps(value, ensure_ascii=False)


def _item(value: str) -> str:
    try:
        if _PLAIN_ITEM.fullmatch(value) and yaml.safe_load(value) == value:
            return value
    except yaml.YAMLError:
        pass
    return json.dumps(value, ensure_ascii=False)


def _value(key: str, value: Any) -> str:
    if key in INHERITABLE_KEYS:
        return INHERIT if value is None else _scalar(str(value))
    if key == "connectors":
        return "on" if value else "off"
    if key == "enabled":
        return "true" if value else "false"
    if key == "brokerages":
        # Off or on, shown bare as the README spells them.
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(_item(str(v)) for v in value) + "]"
    return _scalar(str(value or ""))


def render_subagent(view: dict[str, Any]) -> str:
    lines = ["---", *(f"{key}: {_value(key, view[key])}" for key in FILE_KEYS), "---"]
    body = (view["instructions"] or "").strip()
    return "\n".join(lines) + "\n" + (f"{body}\n" if body else "")


def render_main(values: dict[str, Any]) -> tuple[str, str]:
    lines = ["---"]
    for key in ("model", "effort", "search_provider", "search_depth"):
        if values.get(key):
            lines.append(f"{key}: {_scalar(str(values[key]))}")
    lines += [
        "---",
        "This is you, the main agent, and it is read-only: the user sets your default model, "
        "effort and search in Settings, and a thread's model and effort in its composer.",
    ]
    content = "\n".join(lines) + "\n"
    return content, hashlib.sha256(content.encode()).hexdigest()[:32]


# =============================================================================
# Parsing
# =============================================================================


class _Loader(yaml.SafeLoader):
    """Safe YAML that refuses a key given twice, where plain YAML keeps the last."""


def _mapping(loader: _Loader, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    seen: set[Any] = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=True)
        try:
            duplicate = key in seen
        except TypeError:
            continue  # construct_mapping refuses an unhashable key
        if duplicate:
            raise yaml.constructor.ConstructorError(
                None, None, f"{key} is given twice", key_node.start_mark
            )
        seen.add(key)
    return loader.construct_mapping(node, deep=deep)


_Loader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping)


@dataclass(frozen=True)
class Written:
    """A saved file as written: its frontmatter keys besides ``name`` and
    ``source``, its body, and those two as given (None when absent)."""

    values: dict[str, Any]
    body: str
    name: Any = None
    source: Any = None


def _split(content: str) -> tuple[str, str, int] | None:
    """(frontmatter, body, line the frontmatter starts on), or None without fences."""
    lines = content.removeprefix("﻿").replace("\r\n", "\n").split("\n")
    start = 0
    while start < len(lines) and not lines[start].strip():
        start += 1
    if start == len(lines) or lines[start].rstrip() != "---":
        return None
    for end in range(start + 1, len(lines)):
        if lines[end].rstrip() == "---":
            return "\n".join(lines[start + 1:end]), "\n".join(lines[end + 1:]), start + 2
    return None


def _text_key(key: str, value: Any) -> Any:
    """A number YAML read where the key holds a name or text, as the text written."""
    if key in (*INHERITABLE_KEYS, "description") and isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return value


def _collapse(text: str) -> str:
    return " ".join((text or "").split())


def _same(key: str, written: Any, current: Any) -> bool:
    try:
        return normalize_value(key, written) == current
    except ValueError:
        return False


def _option_text(options: list[str] | None) -> str:
    if not options:
        return ""
    shown = ", ".join(options[:_LISTED_OPTIONS])
    if len(options) > _LISTED_OPTIONS:
        shown += f" and {len(options) - _LISTED_OPTIONS} more"
    return f" Options: {shown}."


@dataclass
class Change:
    """What one save or delete of a subagent's file does."""

    action: Literal["none", "save", "delete"] = "none"
    fields: dict[str, Any] = field(default_factory=dict)
    # The version the route checked; None creates.
    version: str | None = None
    start_from: str | None = None
    thread_id: str | None = None
    kind: str = "custom"
    notes: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.action != "none"


_Views = dict[str, dict[str, Any]]


class SubagentFile(DbJsonFile[_Views, Written, Change]):
    """The subagent named ``name``, or the custom one a save there makes."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.file = f"{name}.md"
        self.unchanged = f"No changes: {self.file} already matches the saved subagent."

    def _refuse(self, error_type: Any, hint: str, file: str | None = None) -> UserDataValidationError:
        return UserDataValidationError(error_type=error_type, file=file or self.file, field_path="", hint=hint)

    def _invalid(self, exc: SubagentInvalid, file: str | None = None) -> UserDataValidationError:
        problems = [(e.field, e.message + _option_text(e.options)) for e in exc.errors]
        return UserDataValidationError(
            error_type="schema_error",
            file=file or self.file,
            field_path=problems[0][0],
            hint=problems[0][1],
            problems=problems,
        )

    async def fetch(self, user_id: str, conn: Any = None) -> _Views:
        return {v["name"]: v for v in await file_values(user_id)}

    def render(self, views: _Views) -> tuple[str, str] | None:
        view = views.get(self.name)
        if view is None or not _has_file(view):
            return None
        return render_subagent(view), view["version"]

    async def lock(self, user_id: str, conn: Any) -> None:
        # ``save_subagent`` takes the user's lock and checks the version under it.
        return None

    async def parse(self, user_id: str, call: CallContext, content: str, served: str | None) -> Written:
        parts = _split(content)
        if parts is None:
            raise self._refuse(
                "parse_error",
                "a subagent file starts with its frontmatter between two --- lines, then its "
                "instructions.",
            )
        front, body, first_line = parts
        try:
            loaded = yaml.load(front, Loader=_Loader)  # noqa: S506 - a SafeLoader subclass
        except yaml.YAMLError as exc:
            mark = getattr(exc, "problem_mark", None)
            where = f" (line {mark.line + first_line})" if mark is not None else ""
            problem = getattr(exc, "problem", None) or str(exc)
            quote = "" if isinstance(exc, yaml.constructor.ConstructorError) else (
                " Quote a value that holds ': ' or ' #'."
            )
            raise self._refuse(
                "parse_error", f"the frontmatter is not valid YAML{where}: {problem}.{quote}"
            ) from None
        if loaded is None:
            loaded = {}
        if not isinstance(loaded, dict):
            raise self._refuse("parse_error", "the frontmatter must be key: value lines.")
        unknown = [str(k) for k in loaded if k not in FILE_KEYS]
        if unknown:
            allowed = ", ".join(FILE_KEYS)
            problems = [(k, f"not a key a subagent file has. The keys are {allowed}.") for k in unknown]
            raise UserDataValidationError(
                error_type="schema_error",
                file=self.file,
                field_path=problems[0][0],
                hint=problems[0][1],
                problems=problems,
            )
        values = {k: _text_key(k, v) for k, v in loaded.items() if k not in _KEPT_KEYS}
        return Written(values, body.strip(), loaded.get("name"), loaded.get("source"))

    def _orphan_taken(self, name: str, file: str | None = None) -> UserDataValidationError:
        return self._refuse(
            "constraint_error",
            f"{name} holds the settings of a built-in subagent that was removed; the user can "
            "delete them in the Subagents pane. Pick another name.",
            file,
        )

    def plan(self, call: CallContext, written: Written, views: _Views) -> Plan[Change]:
        current = views.get(self.name)
        if current is not None and _orphan(current):
            raise self._orphan_taken(self.name)
        if current is None:
            return Plan(self._plan_create(call, written, views))

        notes: list[str] = []
        custom = current["kind"] == "custom"
        if written.name is not None and written.name != self.name:
            notes.append("name is the file name, so it was ignored. To rename a subagent of your own, mv its file.")
        if written.source is not None and written.source != current["source"]:
            notes.append("source is kept by the server, so it was ignored.")
        if custom:
            keys = tuple(k for k in WRITABLE_KEYS if k != "instructions")
        else:
            if _collapse(written.body) != _collapse(current["instructions"]):
                raise self._refuse(
                    "constraint_error", f"the instructions of a built-in subagent can't be edited. {_COPY_HINT}"
                )
            keys = EDITABLE_KEYS
            ignored = [
                k for k in _BASE_READ_ONLY
                if k in written.values and not _same(k, written.values[k], current[k])
            ]
            if ignored:
                notes.append(
                    f"{' and '.join(ignored)} {'is' if len(ignored) == 1 else 'are'} read-only on a "
                    "built-in subagent, so your change was ignored. Copy the file to a new name to "
                    "write your own."
                )
        fields = changed_fields(
            {k: current[k] for k in keys},
            {k: v for k, v in written.values.items() if k in keys},
        )
        if custom and written.body != (current["instructions"] or "").strip():
            fields["instructions"] = written.body
        if not fields:
            return Plan(Change(notes=notes))
        return Plan(Change(
            "save", fields, version=current["version"], thread_id=call.thread_id,
            kind=current["kind"], notes=notes,
        ))

    def _plan_create(self, call: CallContext, written: Written, views: _Views) -> Change:
        """A new custom subagent. A ``name`` naming another subagent makes it a
        copy of that one (what ``cp`` writes), carrying every key the file
        leaves as it was; any other ``name`` is ignored."""
        notes: list[str] = []
        named = written.name if isinstance(written.name, str) and written.name != self.name else None
        source = views.get(named) if named else None
        if source is not None and _orphan(source):
            source = None
        if source is not None:
            keys = tuple(k for k in WRITABLE_KEYS if k != "instructions")
            fields = changed_fields(
                {k: source[k] for k in keys},
                {k: v for k, v in written.values.items() if k in keys},
            )
            if written.body != (source["instructions"] or "").strip():
                fields["instructions"] = written.body
            return Change(
                "save", fields, start_from=source["name"], thread_id=call.thread_id, notes=notes
            )
        if named is not None:
            notes.append(f"name is the file name, {self.name}, so name: {named} was ignored.")
        fields = dict(written.values)
        if written.body:
            fields["instructions"] = written.body
        return Change("save", fields, thread_id=call.thread_id, notes=notes)

    def plan_delete(self, views: _Views) -> Plan[Change]:
        current = views[self.name]
        if current["kind"] == "custom":
            return Plan(Change("delete", version=current["version"]))
        stale = any(p["code"] == "base_removed" for p in current["problems"])
        if current["edited"] or stale:
            return Plan(Change("delete", version=current["version"], kind="base"))
        raise self._refuse(
            "constraint_error",
            f"{self.name} is a built-in subagent with none of your changes, so there is nothing to "
            "delete or reset. To take it out of your roster, set enabled: false in it.",
        )

    async def commit(self, user_id: str, change: Change, conn: Any) -> str | None:
        if not change:
            return "\n".join([self.unchanged, *(f"Note: {n}" for n in change.notes)])
        if change.action == "delete":
            return await self._delete(user_id, change)
        try:
            result = await save_subagent(
                user_id,
                self.name,
                change.fields,
                version=change.version,
                start_from=change.start_from,
                updated_by="agent",
                thread_id=change.thread_id,
            )
        except VersionConflict:
            if change.version is None:
                raise self._refuse(
                    "exists", f"another writer created {self.file} meanwhile. Read it, then write it again."
                ) from None
            raise StaleVersion() from None
        except SubagentInvalid as exc:
            raise self._invalid(exc) from None
        return self._report(change, result)

    def _report(self, change: Change, result: Any) -> str:
        view = result.view
        if result.created:
            copy = f", a copy of {change.start_from}" if change.start_from else ""
            head = (
                f"Saved: new subagent {self.name}{copy} "
                f"({_value('model', view['model'])}, {_value('effort', view['effort'])})."
            )
            tail = (
                "Available from your next turn." if view["enabled"]
                else "It stays out of your roster until you set enabled: true."
            )
        else:
            # The description is the agent's own sentence, so it is named rather
            # than echoed, like the instructions.
            changed = [
                f"{k} updated" if k == "description" else f"{k}: {_value(k, view[k])}"
                for k in FILE_KEYS if k in change.fields
            ]
            if "instructions" in change.fields:
                changed.append("instructions updated")
            head = f"Saved: {self.name}: {', '.join(changed)}."
            if result.reset:
                head += " It now matches its built-in settings."
            tail = _NEXT_TURN
        notes = [
            *change.notes,
            *(f"{description_match_note(other)}." for other in result.description_matches),
        ]
        return "\n".join([f"{head} {tail}", *(f"Note: {n}" for n in notes)])

    async def _delete(self, user_id: str, change: Change) -> str | None:
        try:
            await delete_subagent(user_id, self.name, version=change.version)
        except VersionConflict:
            raise StaleVersion() from None
        except SubagentNotFound:
            return None
        if change.kind == "custom":
            return f"Deleted subagent {self.name}. It leaves your roster from your next turn."
        return (
            f"Reset {self.name} to its built-in settings, clearing your changes to it. {_NEXT_TURN}"
        )

    async def rename(self, user_id: str, to: str, conn: Any, call: CallContext) -> str | None:
        views = await self.fetch(user_id)
        current = views.get(self.name)
        if current is None or _orphan(current):
            return None
        if current["kind"] != "custom":
            raise self._refuse(
                "constraint_error",
                f"{self.file} is a built-in subagent's file, so it keeps its name. To make your "
                "own version, copy it to a new name.",
            )
        new_name = to.removesuffix(".md")
        target = views.get(new_name)
        if target is not None and _orphan(target):
            raise self._orphan_taken(new_name, to)
        try:
            moved = await rename_subagent(
                user_id, self.name, new_name, updated_by="agent", thread_id=call.thread_id
            )
        except SubagentNotFound:
            return None
        except SubagentInvalid as exc:
            raise self._invalid(exc, file=to) from None
        if not moved:
            return None
        return f"Renamed subagent {self.name} to {new_name}. {_NEXT_TURN}"


class MainFile(DbJsonFile[dict[str, Any] | None, None, None]):
    """What the agent itself runs on, which no save here changes."""

    async def fetch(self, user_id: str, conn: Any = None) -> dict[str, Any] | None:
        return await load_main_values(user_id)

    def render(self, values: dict[str, Any] | None) -> tuple[str, str] | None:
        return render_main(values) if values is not None else None


# =============================================================================
# README
# =============================================================================


def _codes(names: Any) -> str:
    return ", ".join(f"`{n}`" for n in names)


def _search_lines() -> tuple[str, str, str]:
    """The search providers, each with its levels, and every level there is."""
    from src.tools.web.manifest import CAPABILITY_SEARCH, providers_with_capability

    providers = providers_with_capability(CAPABILITY_SEARCH)
    pairs = [
        f"`{name}` ({_codes(lv.name for lv in spec.capability(CAPABILITY_SEARCH).levels)})"
        for name, spec in providers.items()
    ]
    levels = dict.fromkeys(
        lv.name for spec in providers.values() for lv in spec.capability(CAPABILITY_SEARCH).levels
    )
    return _codes(providers), ", ".join(pairs), _codes(levels)


async def _connector_line(user_id: str) -> str:
    try:
        connectors = await list_connectors(user_id)
    except Exception:
        logger.exception("subagents README connector list failed")
        return "the names of the user's connectors"
    if not connectors:
        return "the user has none yet"
    return _codes(dict.fromkeys(c.name for c in connectors))


async def readme(user_id: str) -> str:
    """The folder's README, with this deployment's search choices and the
    user's connector names, which the keys may hold."""
    from src.llms.reasoning import REASONING_LEVELS

    providers, pairs, levels = _search_lines()
    connectors = await _connector_line(user_id)
    return f"""\
# Subagents

Each subagent you can hand work to is one markdown file here: frontmatter
between two `---` lines, then its instructions. The files are the user's live
settings, not a copy. A save is checked, then applied whole; if anything is
refused, nothing is saved. Every change applies from your next turn, not this
one.

Confirm with the user before you create or delete a subagent or change its
model, and change only what they asked for.

- `main.md` is you. It is read-only: the user sets it in Settings.
- A built-in subagent (`source: builtin` or `deployment`): its frontmatter
  keys below are editable; its instructions, `description` and `available_to`
  are not. To change those, copy the file to a new name.
- One of your own (`source: custom`): every key and the instructions.

## Changing them

- **Create:** write `<name>.md`, where the name is 1 to 48 lowercase letters,
  digits or `-`, starting with a letter or digit. The file name is the name.
  Give a `description` that says when to hand work to it and how it differs
  from the others. At most {MAX_CUSTOM} of your own.
- **Copy:** `cp equity-analyst.md my-analyst.md` makes one of your own with
  every key and the instructions of the file copied, then edit the copy.
- **Update:** edit the file. A key you leave out keeps its value.
- **On / off:** `enabled: false` takes it out of your roster; `true` puts it back.
- **Delete:** `rm` one of your own. `rm` on a built-in resets it to its
  built-in settings. Within the same command the file then reads as missing;
  it is back on the next command.
- **Rename:** `mv` one of your own. A built-in's file keeps its name.

## Keys

| Key | Values |
|---|---|
| `name`, `source` | Kept by the server. |
| `description` | When to use it, at most {DESCRIPTION_MAX} characters. Quote it if it holds `: ` or ` #`. |
| `model` | A model id from the user's model list, or `inherit` (the thread's model). |
| `effort` | {_codes(REASONING_LEVELS)}, as the model offers them, or `inherit`. |
| `tools` | Any of `web` (search and fetch), `market_data`, `code` (running Python), `shell` (bash). |
| `search_provider` | {providers}, or `inherit` (the user's own). Used only with `web`. |
| `search_depth` | One of the provider's levels: {pairs}. With the provider on `inherit`, any of {levels}. Or `inherit`. |
| `connectors` | `on` or `off`. |
| `brokerages` | `off` or `on`. |
| `preferred_connectors` | Connectors to reach for first: {connectors}. |
| `preferred_skills` | Skills whose SKILL.md is put into its prompt, by skill name. |
| `available_to` | `analyst` (the agent in a workspace), `chief_of_staff` (the agent in Home), or both. |
| `enabled` | `true` or `false`. |

Presets for `tools`: Research `[web]`, Analyst `[web, market_data, code, shell]`,
Data `[market_data, code, shell]`, Writer `[code, shell]`.

`connectors: off` keeps the subagent's code from every connector: built-in
data, plugins and the user's own. Connectors are reached from code, so it
matters only with `code`. `brokerages: off` keeps it from every brokerage
connection; `on` lets it use each within the permissions the user set for that
connection in Brokerages. Order tools stay with the main agent at either
setting.

The preferred lists change what a subagent reaches for first, never what it
can use.
"""
