#!/usr/bin/env python3
"""Kept thinking pass: does the thinking a compaction keeps pass the API's check?

The doc's own recipe (compaction-thinking-blocks, "Check that the kept thinking
held"): compact the older turns while keeping one that holds a thinking block,
then send the next request with ``thinking.block_binding.prefix_mismatch_behavior``
set to ``"error"``. A 200 whose ``input_transformations`` is empty means every
kept block held; a 400 saying a block is bound to a different conversation
names the first one that did not.

Two phases, both live against the Anthropic API:

  sdk    The recipe as the doc writes it, with the SDK alone. Proves the
         account and model run the check and that a well-formed keep-tail
         compaction passes it.
  stack  The same check through the agent's own request path: a real
         ``create_agent`` graph with the compaction middleware, the reasoning
         compatibility and resilience middleware, on the project's client for
         the model, every request sent with ``"error"``. Turns run until the
         middleware has sent a compaction request and two requests after it.
         Each request's body is recorded on the way out and checked with the
         unit harness's prefix rules too, so a failure names the part that
         changed.

``--behavior`` picks what a failing block does. ``error`` (the recipe) refuses
the request; ``drop_block`` (what the manifest sends) drops it and lists it;
``unset`` sends the beta without ``block_binding``, which on an account the API
does not enforce by default lists each failing block as
``thinking_mismatch_allowed`` and changes nothing the model receives, the
doc's way to watch for edits without opting in.

Exit status 0 only when no request was refused and every answer listed no
dropped or flagged block.

The stack phase binds a Read tool, as the main agent does, so a request
setting that only a bound tool brings on goes out on the compaction request
too. Each answer's cache reads and writes are printed beside its list.

Usage:
  ANTHROPIC_API_KEY=... uv run python scripts/e2e/kept_thinking_pass.py \
      [--model claude-haiku-5-5] [--phase sdk,stack] [--behavior error] [--max-turns 14] \
      [--threshold 6000]

The key is read from the environment and never printed. ``ANTHROPIC_BASE_URL``
and ``ANTHROPIC_AUTH_TOKEN`` are ignored, so the run always reaches the API itself.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
os.environ.setdefault("HOST_MODE", "oss")
for _name in ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"):
    os.environ.pop(_name, None)

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO_ROOT), str(REPO_ROOT / "src")]

BETAS = ["compact-2026-09-04", "thinking-binding-controls-2026-08-01"]


def _thinking(base: dict, behavior: str) -> dict:
    thinking = {k: v for k, v in base.items() if k != "block_binding"}
    if behavior != "unset":
        thinking["block_binding"] = {"prefix_mismatch_behavior": behavior}
    return thinking


def _key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY is not set")
    return key


def _model_id(name: str) -> str:
    from src.llms.llm import LLM

    entry = LLM.get_model_config().llm_config.get(name) or {}
    return entry.get("model_id") or name


def sdk_phase(model: str, behavior: str) -> bool:
    """The doc's recipe, step for step."""
    import anthropic

    client = anthropic.Anthropic(api_key=_key())
    system = "You help plan a recipe app's release. Keep answers short."
    thinking = _thinking({"type": "adaptive"}, behavior)
    history: list[dict] = [{"role": "user", "content": "What are the main entities in the app's data model?"}]

    def send(**extra):
        return client.beta.messages.create(
            model=model, max_tokens=8192, system=system, betas=BETAS, thinking=thinking, messages=history, **extra
        )

    first = send()
    history += [
        {"role": "assistant", "content": first.content},
        {
            "role": "user",
            "content": "Testing starts on Tuesday, March 3, 2026, takes 10 weekdays, and pauses on "
            "March 9 and March 16. On which date does it end?",
        },
    ]
    second = send()
    history.append({"role": "assistant", "content": second.content})
    kept = sum(block.type == "thinking" for block in second.content)
    print(f"[sdk] thinking blocks in the kept turn: {kept}")
    if not kept:
        print("[sdk] the kept turn holds no thinking, so nothing was checked")
        return False

    summarized, kept_turns = history[:2], history[2:]
    history = summarized
    # anthropic 0.120 has no ``compaction`` parameter, so it rides the body.
    summary = send(extra_body={"compaction": {"type": "summarize"}})
    if summary.stop_reason != "compaction":
        print(f"[sdk] no summary: stop_reason={summary.stop_reason}")
        return False
    history = [
        {"role": "assistant", "content": summary.content},
        *kept_turns,
        {"role": "user", "content": "Which day should the release go out?"},
    ]
    try:
        third = send()
    except anthropic.BadRequestError as e:
        print(f"[sdk] refused: {e.message}")
        return False
    listed = getattr(third, "input_transformations", None) or []
    print(f"[sdk] input_transformations after the swap: {json.dumps(listed)}")
    for name, answer in (("first", first), ("second", second), ("summary", summary), ("third", third)):
        print(f"[sdk] usage {name}: {answer.usage.model_dump_json(exclude_none=True)}")
    return not listed


async def stack_phase(model_name: str, behavior: str, max_turns: int, threshold: int) -> bool:
    """The recipe through the agent's own request path."""
    import anthropic
    from langchain.agents import create_agent
    from langchain_anthropic import ChatAnthropic
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage, HumanMessage
    from langchain_core.tools import tool
    from langgraph.checkpoint.memory import InMemorySaver

    from ptc_agent.agent.middleware.compaction.compact import Summarizer
    from ptc_agent.agent.middleware.compaction.middleware import CompactionMiddleware
    from ptc_agent.agent.middleware.model_resilience import ModelResilienceMiddleware
    from ptc_agent.agent.middleware.reasoning_compat import ReasoningCompatibilityMiddleware
    from src.llms.llm import create_llm
    from tests.unit.ptc_agent.agent.prefix_stability import (
        Wire,
        is_compaction_request,
        kept_breaks,
        thinking_prefixes,
    )

    sent = Wire()
    acreate = ChatAnthropic._acreate

    async def recording(model, payload):
        sent.payloads.append(json.loads(json.dumps(payload, default=str)))
        return await acreate(model, payload)

    ChatAnthropic._acreate = recording

    # A refusal the resilience middleware answers by stripping the reasoning
    # never reaches the caller, so the strip itself is what fails the pass.
    strips: list[int] = []
    escalate = ModelResilienceMiddleware._escalate_reasoning

    def recording_strip(request):
        strips.append(len(sent.payloads))
        return escalate(request)

    ModelResilienceMiddleware._escalate_reasoning = staticmethod(recording_strip)

    @tool("Read")
    def read(file_path: str) -> str:
        """Read a file from the workspace."""
        return f"{file_path} is empty."

    system = " ".join("You help plan a recipe app's release. Keep each answer to about a hundred words." for _ in range(60))
    saver = InMemorySaver()
    cfg = {"configurable": {"thread_id": "kept-thinking-pass", "user_id": "kept-thinking-pass"}}
    questions = [
        "What are the main entities in the app's data model?",
        "Suggest field names for Recipe.",
        "And for Ingredient?",
        "How should units be stored?",
        "Which indexes does the recipe search need?",
        "What should the first release leave out?",
        "Testing starts on Tuesday, March 3, 2026, takes 10 weekdays, and pauses on March 9 and March 16. "
        "On which date does it end?",
        "Which day should the release go out?",
        "Write the release note's first sentence.",
        "What is the riskiest part of the plan?",
        "How would you test the unit conversion?",
        "Summarize the plan in three bullets.",
        "What would you cut if the date slipped a week?",
        "Anything else before the release?",
    ]
    refused = None
    for turn, question in enumerate(questions[:max_turns], 1):
        model = create_llm(model_name, api_key=_key())
        model.thinking = _thinking(model.thinking or {}, behavior)
        agent = create_agent(
            model=model,
            tools=[read],
            system_prompt=system,
            middleware=[
                CompactionMiddleware(
                    Summarizer(GenericFakeChatModel(messages=iter([])), limit=100_000),
                    token_threshold=threshold,
                    keep_tokens=threshold // 3,
                    claude_keep_tokens=threshold // 3,
                ),
                ModelResilienceMiddleware(primary_name=model_name, primary_client=model, max_retries=1),
                ReasoningCompatibilityMiddleware(),
            ],
            checkpointer=saver,
        )
        try:
            state = await agent.ainvoke({"messages": [HumanMessage(question)]}, cfg)
        except anthropic.BadRequestError as e:
            refused = e.message
            print(f"[stack] turn {turn} refused: {refused}")
            break
        answers = [m for m in state["messages"] if isinstance(m, AIMessage)]
        last = answers[-1]
        listed = (last.response_metadata or {}).get("input_transformations")
        kinds = [is_compaction_request(p) for p in sent.payloads]
        print(
            f"[stack] turn {turn}: {len(sent.payloads)} requests, "
            f"{sum(kinds)} compaction, input_tokens={(last.usage_metadata or {}).get('input_tokens')}, "
            f"input_transformations={json.dumps(listed)} "
            f"cache={json.dumps((last.usage_metadata or {}).get('input_token_details'))}"
        )
        if True in kinds and len(kinds) - kinds.index(True) > 2:
            break

    if not any(is_compaction_request(p) for p in sent.payloads):
        print("[stack] no compaction request was sent; raise --max-turns or lower the threshold")
        return False
    listed = [
        (m.response_metadata or {}).get("input_transformations")
        for m in state["messages"]
        if isinstance(m, AIMessage)
    ]
    flagged = [entries for entries in listed if entries]
    print(f"[stack] answers listing a dropped or flagged block: {len(flagged)}")
    # A block answered the last request before the one that first sent it
    # back that asked for an answer: a compaction request in between answers
    # with its block alone, and leaves out the turns it keeps.
    first_sent: dict[str, int] = {}
    for n, payload in enumerate(sent.payloads):
        for signature in thinking_prefixes(payload):
            first_sent.setdefault(signature, n)
    answered = [n for n, payload in enumerate(sent.payloads) if not is_compaction_request(payload)]
    sent.produced = [
        (max(a for a in answered if a < n), signature)
        for signature, n in first_sent.items()
        if any(a < n for a in answered)
    ]
    print(f"[stack] harness prefix check: {kept_breaks(sent) or 'no break'}")
    if strips:
        print(f"[stack] reasoning stripped after a 400 on request(s) {strips}; the log line above has the text")
    return refused is None and not flagged and not strips


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--model", default="claude-haiku-5-5", help="manifest model name")
    parser.add_argument("--phase", default="sdk,stack")
    parser.add_argument("--behavior", choices=("error", "drop_block", "unset"), default="error")
    parser.add_argument("--max-turns", type=int, default=14)
    parser.add_argument("--threshold", type=int, default=6_000, help="the stack's summary threshold, in tokens")
    args = parser.parse_args()
    _key()
    phases = {p.strip() for p in args.phase.split(",") if p.strip()}
    ok = True
    if "sdk" in phases:
        ok = sdk_phase(_model_id(args.model), args.behavior) and ok
    if "stack" in phases:
        ok = asyncio.run(stack_phase(args.model, args.behavior, args.max_turns, args.threshold)) and ok
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
