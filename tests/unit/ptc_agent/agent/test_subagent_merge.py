"""The per-user subagent merge: which base an override applies to, what each stored field means, and the roster it yields."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from ptc_agent.agent.roles import ALL_ROLES
from ptc_agent.agent.middleware.skills.registry import build_effective_skill_registry
from ptc_agent.agent.subagents import BUILTIN_SUBAGENTS, SubagentRegistry
from ptc_agent.agent.subagents.compiler import SubagentCompiler
from ptc_agent.agent.subagents.definition import SubagentDefinition
from ptc_agent.agent.subagents.merge import (
    CODE_SECTIONS,
    DEFAULT_CUSTOM_TOOLS,
    TOOL_WORDS,
    BaseSubagent,
    ResolvedSubagents,
    add_plugin_bases,
    apply_override,
    base_subagents,
    custom_definition,
    merge_subagents,
    narrow_to_request,
    plugin_definition,
)
from ptc_agent.agent.subagents.registry import registry_for
from ptc_agent.config.agent import SubagentConfig, SubagentsConfig
from src.tools.automation import AUTOMATION_TOOLS

OFFERED = tuple(BUILTIN_SUBAGENTS)


def _bases(**yaml: SubagentConfig) -> dict[str, BaseSubagent]:
    return base_subagents(SubagentsConfig(definitions=yaml))


def _override(name: str, key: str, **fields) -> dict:
    return {"kind": "override", "name": name, "base_key": key, "fields": fields,
            "workspace_id": None}


def _custom(name: str, *, instructions: str = "Do the work.", roles=None, **fields) -> dict:
    return {"kind": "custom", "name": name, "fields": fields, "instructions": instructions,
            "roles": roles, "workspace_id": None}


def _plugin_base(plugin: str, name: str, **fields) -> BaseSubagent:
    row = {"name": name, "fields": fields, "instructions": "Package text.", "roles": None}
    return BaseSubagent(f"plugin:{plugin}/{name}", plugin_definition(row))


def _base_with(tools: list[str], **kwargs) -> SubagentDefinition:
    return SubagentDefinition(name="x", description="", tools=tools, **kwargs)


# ---------------------------------------------------------------------------
# Layering and base keys
# ---------------------------------------------------------------------------


def test_each_base_is_keyed_by_the_layer_that_defined_it():
    """The key is how an override names its base, so a YAML definition that
    takes a built-in's name must change the key, or the user's changes to the
    built-in would silently reshape the operator's replacement."""
    bases = _bases(
        research=SubagentConfig(description="desk", tools=["web_search"]),
        macro=SubagentConfig(description="macro"),
    )

    expected = {name: f"builtin:{name}" for name in BUILTIN_SUBAGENTS}
    expected |= {"research": "deployment:research", "macro": "deployment:macro"}
    assert {name: base.key for name, base in bases.items()} == expected
    # The YAML still replaces the built-in wholesale, template included.
    research = bases["research"].definition
    assert (research.tools, research.role_prompt_template, research.source) == (
        ["web_search"], None, "user",
    )


def test_plugin_bases_join_after_the_deployments_without_taking_its_names():
    deployment = _bases(macro=SubagentConfig(description="macro"))
    desk = _plugin_base("acme", "desk")
    bases, offered = add_plugin_bases(
        deployment,
        OFFERED,  # macro is defined but not offered: still the deployment's name
        [
            (desk, True),
            (_plugin_base("acme", "macro"), True),
            (_plugin_base("other", "desk"), True),
            (_plugin_base("zeta", "quiet"), False),
        ],
    )

    assert offered == (*OFFERED, "desk")
    assert bases["desk"].key == "plugin:acme/desk"
    assert bases["macro"].key == "deployment:macro"
    # A switched-off plugin's subagent stays a base, just not on the roster.
    assert bases["quiet"].key == "plugin:zeta/quiet"
    assert bases["desk"].definition.source == "plugin"


def test_a_users_override_lands_on_a_plugin_base_by_its_plugin_key():
    bases, offered = add_plugin_bases(_bases(), OFFERED, [(_plugin_base("acme", "desk"), True)])

    resolved = merge_subagents(
        bases, offered, [_override("desk", "plugin:acme/desk", model="m-user")]
    )

    assert resolved.definitions["desk"].model == "m-user"
    assert resolved.orphaned == ()


@pytest.mark.parametrize(
    "written_against",
    [
        # The operator later replaced the built-in with a YAML definition.
        "builtin:research",
        # Another plugin now owns the name.
        "plugin:acme/research",
    ],
)
def test_an_override_whose_base_changed_hands_is_orphaned_not_applied(written_against):
    bases = _bases(research=SubagentConfig(description="desk", tools=["web_search"]))

    resolved = merge_subagents(
        bases, OFFERED, [_override("research", written_against, enabled=False, model="m-user")]
    )

    assert resolved.orphaned == ("research",)
    assert resolved.definitions["research"] == bases["research"].definition
    assert "research" in resolved.enabled


def test_an_override_whose_base_is_gone_is_orphaned():
    resolved = merge_subagents(
        _bases(), OFFERED, [_override("desk", "plugin:acme/desk", model="m-user")]
    )

    assert resolved.orphaned == ("desk",)
    assert "desk" not in resolved.definitions


# ---------------------------------------------------------------------------
# Field-level override semantics
# ---------------------------------------------------------------------------


_PINNED = SubagentConfig(
    description="desk", model="m-base", reasoning_effort="high",
    search_provider="p-base", search_depth="d-base",
)


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        # Absent keys keep the base's values, so a later change to it reaches the user.
        ({}, ("m-base", "high", "p-base", "d-base")),
        ({"brokerages": "off"}, ("m-base", "high", "p-base", "d-base")),
        # Null and "inherit" are both the user choosing Inherit over the base's pin.
        ({"model": None}, (None, "high", "p-base", "d-base")),
        ({"model": "inherit", "effort": "inherit"}, (None, None, "p-base", "d-base")),
        ({"effort": None, "search_provider": None, "search_depth": "inherit"},
         ("m-base", None, None, None)),
        ({"model": "m-user", "effort": "low"}, ("m-user", "low", "p-base", "d-base")),
    ],
)
def test_an_absent_key_keeps_the_base_and_null_or_inherit_unsets_it(fields, expected):
    bases = _bases(research=_PINNED)

    resolved = merge_subagents(bases, OFFERED, [_override("research", "deployment:research", **fields)])

    defn = resolved.definitions["research"]
    assert (defn.model, defn.reasoning_effort, defn.search_provider, defn.search_depth) == expected


@pytest.mark.parametrize(
    ("value", "expected"), [(True, True), ("on", True), (False, False), ("off", False)]
)
def test_connectors_switch(value, expected):
    assert apply_override(BUILTIN_SUBAGENTS["research"], {"connectors": value}).connectors is expected


@pytest.mark.parametrize(("value", "expected"), [("off", "off"), ("bogus", "on")])
def test_brokerages_take_only_a_known_level(value, expected):
    assert apply_override(BUILTIN_SUBAGENTS["research"], {"brokerages": value}).brokerages == expected


def test_an_override_reaches_only_the_fields_a_user_may_edit():
    """``roles`` and the role template are the base's; a row naming them, or
    a description, must not reshape it."""
    base = BUILTIN_SUBAGENTS["equity-analyst"]

    defn = apply_override(base, {
        "preferred_connectors": ["sec"],
        "preferred_skills": ["dcf"],
        "description": "mine",
        "roles": ["chief_of_staff"],
        "role_prompt_template": "roles/other.md.j2",
    })

    assert (defn.preferred_connectors, defn.preload_skills) == (["sec"], ["dcf"])
    assert (defn.description, defn.roles, defn.role_prompt_template) == (
        base.description, base.roles, base.role_prompt_template,
    )


# ---------------------------------------------------------------------------
# Tool words and the code sections they carry
# ---------------------------------------------------------------------------


def test_the_four_tool_words_bind_these_tool_sets():
    assert TOOL_WORDS == {
        "web": "web_search",
        "market_data": "finance",
        "code": "execute_code",
        "shell": "bash",
    }


@pytest.mark.parametrize(
    ("base_tools", "words", "expected"),
    [
        # Naming what the base already binds hands its list back unchanged.
        (["web_search", "filesystem"], ["web"], ["web_search", "filesystem"]),
        # A newly bound set goes after the base's own.
        (["web_search", "filesystem"], ["web", "code"], ["web_search", "filesystem", "execute_code"]),
        (
            ["execute_code", "filesystem", "bash", "finance", "web_search"],
            ["web"],
            ["filesystem", "web_search"],
        ),
        # Sets no word switches stay whatever the words say.
        (["think", "execute_code", "todo"], [], ["think", "todo"]),
        # A stale word is skipped rather than taking the turn down.
        (["execute_code", "filesystem"], ["shell", "bogus"], ["filesystem", "bash"]),
    ],
)
def test_a_users_tools_replace_only_the_switchable_sets(base_tools, words, expected):
    assert apply_override(_base_with(base_tools), {"tools": words}).tools == expected


def test_a_non_list_tools_value_keeps_the_bases_tools():
    base = BUILTIN_SUBAGENTS["data-prep"]
    assert apply_override(base, {"tools": None}).tools == base.tools


@pytest.mark.parametrize(
    ("name", "words", "code_on"),
    [
        ("research", ["web", "code"], True),
        ("general-purpose", ["web", "shell", "market_data"], False),
    ],
)
def test_turning_code_on_or_off_moves_every_code_section_with_it(name, words, code_on):
    base = BUILTIN_SUBAGENTS[name]

    sections = apply_override(base, {"tools": words}).sections

    assert {s: sections[s] for s in CODE_SECTIONS} == dict.fromkeys(CODE_SECTIONS, code_on)


def test_tools_that_keep_code_leave_the_bases_own_sections():
    """data-prep runs code but keeps its visualizations section off; dropping
    a different tool must not switch it back on."""
    base = BUILTIN_SUBAGENTS["data-prep"]

    assert apply_override(base, {"tools": ["code", "shell"]}).sections == base.sections


NARROWED = "Your tools here are narrower than this role was written for"


def _prompt(defn: SubagentDefinition) -> str:
    compiler = SubagentCompiler(skill_registry=build_effective_skill_registry(None))
    return compiler._resolve_prompt(defn, compiler._compute_sections(defn))


@pytest.mark.parametrize(
    ("defn", "narrowed"),
    [
        (BUILTIN_SUBAGENTS["research"], False),
        # Web off: its role prompt still names WebSearch.
        (apply_override(BUILTIN_SUBAGENTS["research"], {"tools": []}), True),
        # Adding a tool takes nothing away.
        (apply_override(BUILTIN_SUBAGENTS["research"], {"tools": ["web", "code"]}), False),
        # Shell off: its role prompt still runs scripts through Bash.
        (apply_override(BUILTIN_SUBAGENTS["data-prep"], {"tools": ["code"]}), True),
        (custom_definition(_custom("macro-desk")), False),
        # The shared tool guide is written for the default set.
        (custom_definition(_custom("macro-desk", tools=["web", "market_data", "code"])), True),
        # A package's instructions are written for the tools its file names.
        (_plugin_base("toolkit", "reader", tools=["web"]).definition, False),
        (apply_override(_plugin_base("toolkit", "reader", tools=["web"]).definition, {"tools": []}), True),
    ],
)
def test_a_prompt_says_a_tool_may_be_missing_only_when_settings_took_one_away(defn, narrowed):
    assert (NARROWED in _prompt(defn)) is narrowed


# ---------------------------------------------------------------------------
# A user's own subagent
# ---------------------------------------------------------------------------


def test_a_custom_rows_instructions_are_its_role_prompt_as_text():
    """Passed as a value under the shared frame, never a template, so nothing
    a user or the agent writes is rendered."""
    text = "Check {{ config }} and {% raw %} literally."

    defn = custom_definition(_custom("macro-desk", instructions=text, description="Macro"))

    assert defn.role_prompt == text
    assert (defn.role_prompt_template, defn.custom_prompt, defn.custom_prompt_template) == (
        None, None, None,
    )
    assert (defn.name, defn.description, defn.mode, defn.source, defn.stateful) == (
        "macro-desk", "Macro", "ptc", "custom", True,
    )


def test_a_custom_row_saved_without_tools_gets_the_default_preset():
    defn = custom_definition(_custom("macro-desk"))

    assert set(defn.tools) == {TOOL_WORDS[w] for w in DEFAULT_CUSTOM_TOOLS} | {"filesystem"}
    # Every word on is general-purpose's tool list, in its order.
    assert defn.tools == BUILTIN_SUBAGENTS["general-purpose"].tools
    assert defn.sections == dict.fromkeys(CODE_SECTIONS, True)


@pytest.mark.parametrize(
    ("words", "tools", "code_on"),
    [
        # An explicit empty list is "nothing switchable", not the preset.
        ([], ["filesystem"], False),
        (["web"], ["filesystem", "web_search"], False),
        (["code", "shell"], ["execute_code", "filesystem", "bash"], True),
    ],
)
def test_a_custom_rows_tools_always_bind_the_filesystem(words, tools, code_on):
    defn = custom_definition(_custom("macro-desk", tools=words))

    assert defn.tools == tools
    assert defn.sections == dict.fromkeys(CODE_SECTIONS, code_on)


def test_a_custom_row_takes_the_same_editable_fields_as_an_override():
    defn = custom_definition(_custom(
        "macro-desk", model="m-user", effort="inherit", connectors=False, brokerages="off",
    ))

    assert (defn.model, defn.reasoning_effort, defn.connectors, defn.brokerages) == (
        "m-user", None, False, "off",
    )


@pytest.mark.parametrize(
    ("roles", "expected"),
    [
        (["chief_of_staff"], frozenset({"chief_of_staff"})),
        (["analyst", "chief_of_staff"], ALL_ROLES),
        (None, ALL_ROLES),
        ([], ALL_ROLES),
        (["analyst", "bogus"], frozenset({"analyst"})),
    ],
)
def test_available_to_becomes_the_definitions_roles(roles, expected):
    assert custom_definition(_custom("macro-desk", roles=roles)).roles == expected


def test_a_role_the_subagent_is_not_available_to_leaves_it_out_of_that_roster():
    resolved = merge_subagents(_bases(), ("research",), [_custom("macro-desk", roles=["analyst"])])
    registry = SubagentRegistry.from_definitions(resolved.definitions)

    def roster(role):
        return [d.name for d in registry.get_enabled(list(resolved.enabled), role=role)]

    assert roster("analyst") == ["research", "macro-desk"]
    assert roster("chief_of_staff") == ["research"]


# ---------------------------------------------------------------------------
# The roster
# ---------------------------------------------------------------------------


def test_the_roster_is_the_offered_bases_in_order_then_the_users_own():
    resolved = merge_subagents(
        _bases(), ("data-prep", "research"), [_custom("zeta"), _custom("alpha")]
    )

    assert resolved.enabled == ("data-prep", "research", "zeta", "alpha")
    # A base the operator did not offer is in neither the roster nor the definitions.
    assert "general-purpose" not in resolved.definitions


@pytest.mark.parametrize(
    "row",
    [
        _override("research", "builtin:research", enabled=False),
        _custom("macro-desk", enabled=False),
    ],
)
def test_enabled_false_drops_the_subagent_but_keeps_its_definition(row):
    resolved = merge_subagents(_bases(), OFFERED, [row])

    assert row["name"] in resolved.definitions
    assert row["name"] not in resolved.enabled


def test_a_custom_subagent_hides_a_base_of_the_same_name():
    resolved = merge_subagents(_bases(), OFFERED, [_custom("research")])

    assert resolved.definitions["research"].source == "custom"
    assert resolved.shadowed == ("research",)
    assert resolved.enabled.count("research") == 1


def test_per_workspace_rows_are_not_merged_yet():
    rows = [
        {**_override("research", "builtin:research", enabled=False), "workspace_id": "ws-1"},
        {**_custom("macro-desk"), "workspace_id": "ws-1"},
    ]

    resolved = merge_subagents(_bases(), OFFERED, rows)

    assert resolved.enabled == OFFERED
    assert resolved.orphaned == ()


@pytest.mark.parametrize(
    ("requested", "enabled", "dropped"),
    [
        (None, ("research", "data-prep", "macro-desk"), []),
        ([], ("research", "data-prep", "macro-desk"), []),
        # The request keeps its own order; names off the roster are dropped, not fatal.
        (["macro-desk", "gone", "research", "macro-desk"], ("macro-desk", "research"), ["gone"]),
        # Nor can a request bring back a subagent the user switched off.
        (["report-builder"], (), ["report-builder"]),
    ],
)
def test_a_request_narrows_the_roster_to_the_names_it_shares(requested, enabled, dropped):
    resolved = merge_subagents(
        _bases(), ("research", "data-prep", "report-builder"),
        [_custom("macro-desk"), _override("report-builder", "builtin:report-builder", enabled=False)],
    )

    narrowed, missing = narrow_to_request(resolved, requested)

    assert (narrowed.enabled, missing) == (enabled, dropped)


# ---------------------------------------------------------------------------
# The registry a build reads
# ---------------------------------------------------------------------------


def test_a_registry_over_finished_definitions_layers_nothing_again():
    """The merge already applied the built-ins and the YAML; adding them back
    would resurrect a base the operator never offered."""
    mine = custom_definition(_custom("macro-desk"))

    registry = SubagentRegistry.from_definitions({"macro-desk": mine})

    assert registry.list_all() == {"macro-desk": mine}


def test_a_resolved_roster_supersedes_the_deployments_layering():
    deployment = SubagentsConfig(
        enabled=["research"],
        definitions={"research": SubagentConfig(description="desk", tools=["web_search"])},
    )
    resolved = ResolvedSubagents(
        definitions={"macro-desk": custom_definition(_custom("macro-desk"))}, enabled=(),
    )
    per_turn = deployment.model_copy(update={"resolved": resolved})

    assert registry_for(deployment).get("research").source == "user"
    assert set(registry_for(per_turn).list_all()) == {"macro-desk"}
    # A user who turned everything off compiles nothing, not the deployment's list,
    # and a request cannot widen a roster that already folded it in.
    assert per_turn.roster() == []
    assert per_turn.roster(["research"]) == []
    assert deployment.roster() == ["research"]


def _bound(defn: SubagentDefinition) -> set[str]:
    """The tools a definition compiles with, by name."""
    sets = {k: [SimpleNamespace(name=k)] for k in ("execute_code", "bash", "filesystem", "web_search", "finance")}
    compiler = SubagentCompiler(tool_sets=sets, skill_registry=build_effective_skill_registry(None))
    return {tool.name for tool in compiler._resolve_tools(defn)}


@pytest.mark.parametrize(
    "defn",
    [
        apply_override(BUILTIN_SUBAGENTS["research"], {"tools": [], "preferred_skills": ["automation"]}),
        custom_definition({"name": "mine", "fields": {"tools": [], "preferred_skills": ["automation"]}}),
        plugin_definition({"name": "pkg", "fields": {"tools": [], "preferred_skills": ["automation"]}}),
    ],
    ids=["override", "custom", "plugin"],
)
def test_a_preferred_skill_binds_none_of_its_tools(defn):
    assert defn.preload_skills == ["automation"]
    assert _bound(defn) == {"filesystem"}


def test_a_deployment_preload_keeps_its_tools_through_a_preferred_edit():
    ops = SubagentRegistry(
        user_definitions={"ops": SubagentConfig(description="d", tools=["filesystem"], preload_skills=["automation"])}
    ).list_all()["ops"]
    automation = {tool.name for tool in AUTOMATION_TOOLS}

    assert automation <= _bound(ops)
    assert automation <= _bound(apply_override(ops, {"preferred_skills": []}))
