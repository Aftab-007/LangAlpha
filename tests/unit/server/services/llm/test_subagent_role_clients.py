"""A subagent's model and effort as an LLM role: which model at which level, and on whose key, each turn builds for it."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from ptc_agent.agent.subagents.definition import SubagentDefinition
from ptc_agent.config.agent import AgentConfig, CredentialSource, LLMConfig
from src.server.services.llm import clients
from src.server.services.llm.clients import LLMRole, ResolvedClient, role_registry
from src.server.services.llm.user_models import ModelSource

MAIN = "main-model"
OWN_KEY = (CredentialSource.BYOK, CredentialSource.OAUTH)
NO_OWN_KEY = (CredentialSource.PLATFORM, CredentialSource.NONE)


# ---------------------------------------------------------------------------
# The role list
# ---------------------------------------------------------------------------


def _config() -> AgentConfig:
    cfg = AgentConfig.create(llm=MagicMock(name="placeholder-llm"))
    cfg.llm = LLMConfig(name=MAIN)
    return cfg


# Both models carry a saved level of their own, which a set effort must beat
# and an unset one must not reach past.
_PREF = {"profiles": {"sub-model": {"reasoning_effort": "low"}, MAIN: {"reasoning_effort": "max"}}}


@pytest.mark.parametrize(
    ("model", "effort", "turn_model", "expected"),
    [
        # A set effort is the subagent's, and beats the model's saved one.
        ("sub-model", "high", MAIN, ("sub-model", "high", "high")),
        # Unset: the pinned model at its own saved level.
        ("sub-model", None, MAIN, ("sub-model", "low", None)),
        # Inherit model + set effort: the turn's model at the set effort.
        (None, "high", MAIN, (MAIN, "high", "high")),
        # Inherit both: no role of its own, so the subagent shares the turn's client.
        (None, None, MAIN, None),
        (None, "high", None, None),
    ],
)
def test_a_subagent_gets_a_role_for_its_model_or_its_effort(model, effort, turn_model, expected):
    defn = SubagentDefinition(name="desk", description="", model=model, reasoning_effort=effort)

    roles = [
        (r.model, r.reasoning_effort, r.set_effort)
        for r in role_registry(_config(), ["desk"], {"desk": defn}, _PREF, turn_model)
        if r.key == "subagent:desk"
    ]

    assert roles == ([expected] if expected else [])


# ---------------------------------------------------------------------------
# The client each role gets
# ---------------------------------------------------------------------------


class _Client:
    def __init__(self, model: str, effort: str | None, credential: CredentialSource):
        self.model, self.effort, self.credential = model, effort, credential
        self.copied_from = None

    def model_copy(self):
        copy = _Client(self.model, self.effort, self.credential)
        copy.copied_from = self
        return copy


@pytest.fixture
def ladder(monkeypatch):
    """``resolve_model_client`` over a fixed table of which models the user
    holds a key for. The platform builds a client only when it is allowed to
    and the model is not in ``no_platform``."""
    state = SimpleNamespace(own={}, no_platform=set(), calls=[])

    async def _resolve(user_id, model_name, *, is_byok, cache_key=None, reasoning_effort=None,
                       service_tier=None, allow_platform_fallback=False, _pref_cache=None,
                       _byok_cache=None):
        state.calls.append((model_name, reasoning_effort, allow_platform_fallback))
        credential = state.own.get(model_name)
        if credential is None and allow_platform_fallback and model_name not in state.no_platform:
            credential = CredentialSource.PLATFORM
        if credential is None:
            return ResolvedClient(None, ModelSource.SYSTEM, CredentialSource.NONE)
        return ResolvedClient(
            _Client(model_name, reasoning_effort, credential), ModelSource.SYSTEM, credential,
        )

    monkeypatch.setattr(clients, "resolve_model_client", _resolve)
    monkeypatch.setattr(clients, "_stamp", lambda *_a, **_k: None)
    monkeypatch.setattr(clients.user_models, "guidance_for", lambda _pref, model: f"guidance:{model}")
    return state


def _turn(credential: CredentialSource) -> SimpleNamespace:
    main = _Client(MAIN, None, credential) if credential in OWN_KEY else None
    return SimpleNamespace(
        credential_source=credential, llm_client=main, prompt_guidance=f"guidance:{MAIN}",
        subsidiary_llm_clients={}, role_prompt_guidance={},
    )


async def _resolve_roles(config, *roles: LLMRole) -> set[str]:
    return await clients._resolve_role_clients(
        config, "user-1", list(roles), {}, {}, is_byok=True, cache_key="t-1", main_model=MAIN,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("credential", OWN_KEY)
@pytest.mark.parametrize(
    ("set_effort", "expected_effort"),
    [("high", "high"), (None, None)],
)
async def test_an_own_key_turn_runs_a_keyless_subagent_on_the_main_model_never_the_platform(
    ladder, credential, set_effort, expected_effort
):
    """The user's own key paid for the turn, so a subagent pinned to a model
    they hold no key for runs the main model on that key: at the set effort
    when there is one, else as a copy of the main client."""
    ladder.own = {MAIN: credential}
    config = _turn(credential)
    role = LLMRole("subagent:desk", "sub-model", reasoning_effort=set_effort or "low",
                   set_effort=set_effort)

    on_main = await _resolve_roles(config, role)

    client = config.subsidiary_llm_clients["subagent:desk"]
    assert (client.model, client.effort, client.credential) == (MAIN, expected_effort, credential)
    assert (client.copied_from is config.llm_client) is (set_effort is None)
    assert on_main == {"subagent:desk"}
    assert not any(platform for _, _, platform in ladder.calls)
    assert config.role_prompt_guidance["subagent:desk"] == f"guidance:{MAIN}"


@pytest.mark.asyncio
@pytest.mark.parametrize("credential", OWN_KEY)
async def test_inherit_with_a_set_effort_is_the_turns_model_at_that_effort(ladder, credential):
    ladder.own = {MAIN: credential}
    config = _turn(credential)

    on_main = await _resolve_roles(
        config, LLMRole("subagent:desk", MAIN, reasoning_effort="high", set_effort="high"),
    )

    client = config.subsidiary_llm_clients["subagent:desk"]
    assert (client.model, client.effort, client.credential) == (MAIN, "high", credential)
    assert client.copied_from is None
    # Its own model is the main one, so nothing fell back.
    assert on_main == set()


@pytest.mark.asyncio
@pytest.mark.parametrize("credential", NO_OWN_KEY)
async def test_every_subagent_role_gets_its_own_client_for_platform_and_keyless_users(
    ladder, credential
):
    """A subagent's bare model name never reaches the manifest's providers, so
    it is built here even untuned; an untuned non-subagent role keeps the
    cheap name path."""
    config = _turn(credential)

    on_main = await _resolve_roles(
        config,
        LLMRole("fetch", "fetch-model"),
        LLMRole("subagent:plain", "sub-model"),
        LLMRole("subagent:tuned", "sub-model", reasoning_effort="high", set_effort="high"),
    )

    assert set(config.subsidiary_llm_clients) == {"subagent:plain", "subagent:tuned"}
    built = {
        key: (c.model, c.effort, c.credential) for key, c in config.subsidiary_llm_clients.items()
    }
    assert built == {
        "subagent:plain": ("sub-model", None, CredentialSource.PLATFORM),
        "subagent:tuned": ("sub-model", "high", CredentialSource.PLATFORM),
    }
    assert ("fetch-model", None, False) in ladder.calls
    assert on_main == set()


@pytest.mark.asyncio
@pytest.mark.parametrize("credential", NO_OWN_KEY)
async def test_a_set_effort_follows_the_subagent_onto_the_main_model(ladder, credential):
    """Its pinned model got no client at all, so the set effort is kept on the
    model the turn runs rather than dropped."""
    ladder.no_platform = {"sub-model"}
    config = _turn(credential)

    on_main = await _resolve_roles(
        config,
        LLMRole("subagent:desk", "sub-model", reasoning_effort="high", set_effort="high"),
        LLMRole("subagent:untuned", "sub-model"),
    )

    client = config.subsidiary_llm_clients["subagent:desk"]
    assert (client.model, client.effort) == (MAIN, "high")
    # No set effort and no own key: no copy of a main client to hand it.
    assert "subagent:untuned" not in config.subsidiary_llm_clients
    assert on_main == {"subagent:desk"}
