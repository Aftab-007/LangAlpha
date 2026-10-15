"""A package's ``agents/`` folder: one subagent per ``agents/<name>.md``.

The file is the one a user's Subagents folder shows (frontmatter between two
``---`` lines, then the instructions), so a subagent copied out of that folder
ships as is. A Claude Code agent file reads too: its tool names map onto the
tool words and its ``skills`` onto the preferred skills. What has no
counterpart here is ignored with a diagnostic rather than refusing the file,
since one option this client lacks should not cost the user the subagent.

Pure, like the rest of validation: a bad file drops that subagent only, as a
bad skill drops that skill.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, ClassVar

import yaml

from src.server.models.plugin import Diagnostic

AGENTS_DIR = "agents/"


def is_agent_file(path: str) -> bool:
    """Whether install reads ``path`` as a subagent: ``agents/<name>.md``."""
    rest = path.removeprefix(AGENTS_DIR)
    return rest != path and "/" not in rest and rest.endswith(".md")


# Claude Code's tool names, as the tool words they mean here. Its file tools
# need no word, since every subagent reads and writes files, and nor do Bash's
# companions, which reach only a shell Bash started.
_WORDLESS_TOOLS = frozenset({
    "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS",
    "NotebookRead", "NotebookEdit", "BashOutput", "KillShell", "KillBash",
})
_CLAUDE_TOOLS: dict[str, tuple[str, ...]] = {
    "Bash": ("code", "shell"),
    "WebSearch": ("web",),
    "WebFetch": ("web",),
}
_MODEL_ALIASES = frozenset({"sonnet", "opus", "haiku"})

# The subagent file's keys a package sets, besides the ones read below.
_VALUE_KEYS = (
    "effort",
    "search_provider",
    "search_depth",
    "connectors",
    "brokerages",
    "preferred_connectors",
    "preferred_skills",
    "available_to",
)
# Keys the folder's file carries that say nothing to an install.
_QUIET_KEYS = frozenset({"name", "source", "enabled"})
_NUL_REASON = "the file holds a NUL character (\\x00), which can't be saved"
_SURROGATE_REASON = "the file holds an unpaired surrogate (\\ud800 to \\udfff), which can't be saved"


@dataclass
class AgentPlan:
    """One ``agents/<name>.md``, read into a base subagent's values or skipped."""

    # How this plan reports itself (ComponentResult.of). The file name is the
    # subagent's name, so nothing renames it.
    kind: ClassVar[str] = "subagent"
    renamed: ClassVar[bool] = False

    name: str
    #: The file as shipped, which export writes back and update compares.
    text: str = ""
    #: The row's values: description, instructions, tools (words), model,
    #: effort, search_provider, search_depth, connectors, brokerages,
    #: preferred_connectors, preferred_skills, roles.
    values: dict[str, Any] = field(default_factory=dict)
    skip_code: str | None = None
    skip_reason: str | None = None
    diagnostics: list[Diagnostic] = field(default_factory=list)

    @property
    def key(self) -> str:
        return self.name


def _diag(target: str, code: str, message: str, level: str = "warning") -> Diagnostic:
    return Diagnostic(level=level, scope="subagent", target=target, code=code, message=message)


def _skip(plan: AgentPlan, code: str, reason: str) -> AgentPlan:
    plan.skip_code = code
    plan.skip_reason = reason
    plan.diagnostics.append(_diag(plan.name, code, reason))
    return plan


def _items(value: Any) -> list[str] | None:
    """A list, or Claude Code's comma-separated string, as names; None if neither."""
    if isinstance(value, str):
        value = value.split(",")
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        return None
    return list(dict.fromkeys(v.strip() for v in value if v.strip()))


def _tools(value: Any, plan: AgentPlan) -> tuple[list[str], list[str]]:
    """The tool words ``value`` binds, and the servers its ``mcp__`` names reach."""
    from ptc_agent.agent.subagents.merge import DEFAULT_CUSTOM_TOOLS, TOOL_WORDS

    if value is None:
        return list(DEFAULT_CUSTOM_TOOLS), []
    items = _items(value)
    if items is None:
        plan.diagnostics.append(_diag(
            plan.name, "tools_ignored",
            "tools must be a list of names, so it gets the Analyst tools",
        ))
        return list(DEFAULT_CUSTOM_TOOLS), []
    words: set[str] = set()
    servers: list[str] = []
    ignored: list[str] = []
    for item in items:
        if item in TOOL_WORDS:
            words.add(item)
        elif item in _CLAUDE_TOOLS:
            words.update(_CLAUDE_TOOLS[item])
        elif item.startswith("mcp__"):
            words.add("code")
            server = item.removeprefix("mcp__").split("__", 1)[0]
            if server:
                servers.append(server)
        elif item not in _WORDLESS_TOOLS:
            ignored.append(item)
    if ignored:
        plan.diagnostics.append(_diag(
            plan.name, "tools_ignored",
            f"tools with no match here were left out: {', '.join(ignored)}",
        ))
    return [w for w in TOOL_WORDS if w in words], servers


def _model(value: Any, plan: AgentPlan) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        plan.diagnostics.append(_diag(
            plan.name, "model_ignored", "model must be a model id, so it uses the thread's model",
        ))
        return None
    value = value.strip()
    if value.lower() == "inherit":
        return None
    if value.lower() in _MODEL_ALIASES:
        plan.diagnostics.append(_diag(
            plan.name, "model_alias",
            f"model: {value} names a model family, not a model, so it uses the thread's model",
            level="info",
        ))
        return None
    return value


def _search_errors(provider: str | None, depth: str | None) -> tuple[str | None, str | None, list[str]]:
    """The search pair with what this deployment can't run dropped, and why."""
    from src.tools.web.manifest import CAPABILITY_SEARCH, providers_with_capability

    providers = providers_with_capability(CAPABILITY_SEARCH)
    notes: list[str] = []
    if provider is not None and provider not in providers:
        notes.append(f"search_provider {provider} isn't offered here, so it uses the user's")
        provider = None
    if depth is not None:
        if provider is not None:
            levels = {lv.name for lv in providers[provider].capability(CAPABILITY_SEARCH).levels}
        else:
            levels = {
                lv.name
                for spec in providers.values()
                for lv in spec.capability(CAPABILITY_SEARCH).levels
            }
        if depth not in levels:
            notes.append(f"search_depth {depth} isn't offered here, so it uses the user's")
            depth = None
    return provider, depth, notes


def _values(loaded: Mapping[str, Any], body: str, plan: AgentPlan) -> dict[str, Any] | None:
    """The row's values from the frontmatter and body, or None once skipped."""
    from src.llms.reasoning import REASONING_LEVELS
    from src.server.services.subagents.rules import (
        DESCRIPTION_MAX,
        INHERIT,
        INSTRUCTIONS_MAX_BYTES,
        ROLE_ORDER,
        normalize_value,
    )

    description = loaded.get("description")
    if isinstance(description, (int, float)) and not isinstance(description, bool):
        description = str(description)
    if not isinstance(description, str) or not description.strip():
        _skip(plan, "missing_description", "a subagent needs a description saying when to use it")
        return None
    description = " ".join(description.split())
    if len(description) > DESCRIPTION_MAX:
        _skip(plan, "description_too_long", f"the description is over {DESCRIPTION_MAX} characters")
        return None
    instructions = body.strip()
    if len(instructions.encode("utf-8")) > INSTRUCTIONS_MAX_BYTES:
        _skip(plan, "instructions_too_long", f"the instructions are over {INSTRUCTIONS_MAX_BYTES // 1024} KB")
        return None

    tools, servers = _tools(loaded.get("tools"), plan)
    values: dict[str, Any] = {
        "description": description,
        "instructions": instructions,
        "tools": tools,
        "model": _model(loaded.get("model"), plan),
        "effort": None,
        "search_provider": None,
        "search_depth": None,
        "connectors": True,
        "brokerages": "on",
        "preferred_connectors": [],
        "preferred_skills": [],
        "roles": list(ROLE_ORDER),
    }
    for key in _VALUE_KEYS:
        if loaded.get(key) is None:
            continue
        try:
            value = normalize_value(key, loaded[key])
        except ValueError as exc:
            plan.diagnostics.append(_diag(plan.name, f"{key}_ignored", f"{key}: {exc}"))
            continue
        if value == INHERIT:
            continue
        if key == "available_to":
            values["roles"] = value
        else:
            values[key] = value
    if values["effort"] is not None and values["effort"] not in REASONING_LEVELS:
        plan.diagnostics.append(_diag(
            plan.name, "effort_ignored", f"effort {values['effort']} isn't a level, so it uses the thread's",
        ))
        values["effort"] = None
    provider, depth, notes = _search_errors(values["search_provider"], values["search_depth"])
    values["search_provider"], values["search_depth"] = provider, depth
    plan.diagnostics += [_diag(plan.name, "search_ignored", note) for note in notes]

    # Claude Code's ``skills`` preloads each one, which is what a preferred
    # skill does here.
    skills = _items(loaded.get("skills")) if loaded.get("skills") is not None else []
    if skills is None:
        plan.diagnostics.append(_diag(plan.name, "skills_ignored", "skills must be a list of skill names"))
        skills = []
    values["preferred_skills"] = list(dict.fromkeys([*values["preferred_skills"], *skills]))
    values["preferred_connectors"] = list(dict.fromkeys([*values["preferred_connectors"], *servers]))

    ignored = [str(k) for k in loaded if k not in (*_VALUE_KEYS, *_QUIET_KEYS, "description", "tools", "model", "skills")]
    if ignored:
        plan.diagnostics.append(_diag(
            plan.name, "keys_ignored",
            f"keys with no match here were ignored: {', '.join(ignored)}",
            level="info",
        ))
    if loaded.get("enabled") is False:
        plan.diagnostics.append(_diag(
            plan.name, "enabled_ignored",
            "enabled: false is ignored; a plugin's subagents arrive on, and the user turns one off",
            level="info",
        ))
    written = loaded.get("name")
    if written is not None and written != plan.name:
        plan.diagnostics.append(_diag(
            plan.name, "name_ignored",
            f"the file is {plan.name}.md, so the subagent is named {plan.name}, not {written}",
            level="info",
        ))
    return values


def read_agent(name: str, raw: bytes) -> AgentPlan:
    """One file as a plan; ``name`` is its file name without ``.md``."""
    from src.server.services.subagents.frontmatter import (
        StrictLoader,
        split_frontmatter,
        unsavable_char,
    )
    from src.server.services.subagents.rules import NAME_RE, RESERVED_NAMES

    plan = AgentPlan(name=name)
    if not NAME_RE.fullmatch(name):
        return _skip(
            plan, "invalid_name",
            "a subagent's file name is its name: 1 to 48 lowercase letters, digits or -, "
            "starting with a letter or digit",
        )
    if name in RESERVED_NAMES:
        return _skip(plan, "reserved_name", f"{name} is reserved for the agent itself")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return _skip(plan, "unreadable", "the file is not UTF-8 text")
    # Refused here, as a file: stored, it would fail the insert after the
    # plugin's other components had landed, and every update after it.
    if "\x00" in text:
        return _skip(plan, "unreadable", _NUL_REASON)
    plan.text = text
    parts = split_frontmatter(plan.text)
    if parts is None:
        return _skip(
            plan, "parse_error",
            "a subagent file starts with its frontmatter between two --- lines, then its instructions",
        )
    front, body, first_line = parts
    try:
        loaded = yaml.load(front, Loader=StrictLoader)  # noqa: S506 - a SafeLoader subclass
    except (yaml.YAMLError, RecursionError, ValueError) as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" (line {mark.line + first_line})" if mark is not None else ""
        problem = getattr(exc, "problem", None) or str(exc)
        return _skip(plan, "parse_error", f"the frontmatter is not valid YAML{where}: {problem}")
    if loaded is None:
        loaded = {}
    if not isinstance(loaded, dict):
        return _skip(plan, "parse_error", "the frontmatter must be key: value lines")
    unsavable = unsavable_char(loaded)
    if unsavable is not None:
        return _skip(plan, "unreadable", _NUL_REASON if unsavable == "\x00" else _SURROGATE_REASON)
    values = _values(loaded, body, plan)
    if values is not None:
        plan.values = values
    return plan


def collect_agents(files: Mapping[str, bytes]) -> tuple[list[AgentPlan], list[Diagnostic]]:
    """Every ``agents/<name>.md`` as a plan, by name.

    Only files directly under ``agents/`` are subagents; anything else there
    is reported and left out.
    """
    diagnostics: list[Diagnostic] = []
    plans: list[AgentPlan] = []
    for path in sorted(files):
        if not path.startswith(AGENTS_DIR):
            continue
        if not is_agent_file(path):
            diagnostics.append(_diag(
                path, "loose_file", "only agents/<name>.md files are subagents, so this one was left out",
            ))
            continue
        plans.append(read_agent(path.removeprefix(AGENTS_DIR).removesuffix(".md"), files[path]))
    return plans, diagnostics


def link_connectors(plans: Iterable[AgentPlan], names: Mapping[str, str], plugin: str) -> None:
    """Point preferred connectors that name a package server at its installed name.

    A package names its servers by their ``mcp.json`` key, and install may
    store one under another name. Claude Code names a plugin's own server
    ``plugin_<plugin>_<server>`` in its tool names, which an agent's
    ``tools`` uses.
    """
    own = f"plugin_{plugin}_"

    def linked(connector: str) -> str:
        if connector in names:
            return names[connector]
        server = connector.removeprefix(own)
        return names.get(server, connector) if connector.startswith(own) else connector

    for plan in plans:
        if plan.values:
            plan.values["preferred_connectors"] = list(dict.fromkeys(
                linked(c) for c in plan.values["preferred_connectors"]
            ))
