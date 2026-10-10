"""Flash is never told to reply through tools it doesn't have.

Flash has no messaging tools. With a channel gateway configured, the rules a
channel sends are written for an agent that replies through them, so a Flash
turn leaves them out and keeps the surface. Without one, no agent has the
tools, and Flash carries the rules as it always has.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config import env
from src.server.handlers.chat.request_prep import PriorThread, build_turn_context
from src.server.models.chat import ChatRequest

FLASH = "src.server.handlers.chat.flash_run"
RELEASE = "src.server.dependencies.usage_limits.release_burst_slot"

RULES = "Reply with send_message; leave target out to post in this conversation."


class _Built(Exception):
    """Raised once the turn context is built, to end the run there."""


async def _turn_context(request: ChatRequest):
    """Run a Flash turn up to its turn context and return it."""
    from src.server.handlers.chat.flash_run import astream_flash_workflow

    contexts = []

    def _capture(*args, **kwargs):
        contexts.append(build_turn_context(*args, **kwargs))
        raise _Built()

    manager = MagicMock()
    manager.get_admission_lock = AsyncMock(return_value=asyncio.Lock())
    with (
        patch(f"{FLASH}.setup"),
        patch(f"{FLASH}.LocalRunExecutor") as executor,
        patch(RELEASE, new_callable=AsyncMock),
        patch(f"{FLASH}.dedup_retransmit_or_raise", new=AsyncMock()),
        patch(f"{FLASH}.wait_or_steer", new=AsyncMock(return_value=(True, None))),
        patch(
            f"{FLASH}.get_or_create_flash_workspace",
            new=AsyncMock(return_value={"workspace_id": "ws-f"}),
        ),
        patch(f"{FLASH}.ensure_thread", new=AsyncMock(return_value=PriorThread())),
        patch(f"{FLASH}.get_user_profile_for_prompt", new=AsyncMock(return_value=None)),
        patch(f"{FLASH}.build_turn_context", side_effect=_capture),
    ):
        executor.get_instance.return_value = manager
        gen = astream_flash_workflow(
            request=request,
            thread_id="t-1",
            run_id="r-1",
            user_input="hi",
            user_id="u-1",
            config=MagicMock(),
        )
        try:
            async for _ in gen:
                pass
        except Exception:
            pass
        finally:
            await gen.aclose()
    (context,) = contexts
    return context


def _slack_turn() -> ChatRequest:
    return ChatRequest(
        messages=[{"role": "user", "content": "hi"}],
        platform="slack",
        surface_rules=RULES,
    )


@pytest.mark.asyncio
async def test_with_a_gateway_flash_leaves_the_channels_rules_out(monkeypatch):
    monkeypatch.setattr(env, "CHANNEL_GATEWAY_URL", "https://gateway.example.com/api")
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "tok")

    context = await _turn_context(_slack_turn())

    assert context.surface_rules is None
    assert context.platform == "slack"


@pytest.mark.asyncio
async def test_without_a_gateway_flash_keeps_the_rules(monkeypatch):
    monkeypatch.setattr(env, "CHANNEL_GATEWAY_URL", "")
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "tok")

    context = await _turn_context(_slack_turn())

    assert (context.platform, context.surface_rules) == ("slack", RULES)
