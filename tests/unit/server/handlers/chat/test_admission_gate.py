"""
Tests for src/server/handlers/chat/admission_gate.py.

Covers:
- wait_or_steer: ready, steered, reclaimed, and 409 cases
- admission_conflict_detail: the single wording source for admission 409s
"""

import asyncio
import contextlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest


# ---------------------------------------------------------------------------
# wait_or_steer
# ---------------------------------------------------------------------------


_LIVE_ROW = {"conversation_response_id": "run-live", "cancel_requested_at": None}
_STOPPING_ROW = {
    "conversation_response_id": "run-live",
    "cancel_requested_at": "2026-07-14T00:00:00+00:00",
}


class TestWaitOrSteer:
    @pytest.fixture(autouse=True)
    def ledger_slot(self):
        """The ledger slot read behind wait_or_steer's accept-after-exit
        reclaim (v4 2.4c — worker-agnostic, replaces the local task check).
        Defaults to a live row (no reclaim); exit-race tests set it None."""
        with patch(
            "src.server.database.runs.lifecycle.get_active_run",
            new_callable=AsyncMock,
            return_value=_LIVE_ROW,
        ) as slot:
            yield slot

    @pytest.mark.asyncio
    async def test_fresh_returns_true(self):
        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("fresh", None))

        ready, event = await wait_or_steer(manager, "t-1", "hello", "u-1")
        assert ready is True
        assert event is None

    @pytest.mark.asyncio
    async def test_steer_only_fresh_raises_409_not_running(self):
        """A steer_only probe must never be admitted as a fresh turn — the
        probe's SSE reader ignores turn events, so a turn admitted on that
        connection streams its output (interrupts included) into a void.
        409 'not_running' routes the gateway to its resubmit path instead."""
        from fastapi import HTTPException

        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("fresh", None))

        with pytest.raises(HTTPException) as exc_info:
            await wait_or_steer(
                manager, "t-1", "hello", "u-1", steer_only=True
            )

        assert exc_info.value.status_code == 409
        detail = exc_info.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "not_running"
        assert "t-1" not in detail["message"]

    @pytest.mark.asyncio
    async def test_steer_only_still_steers_running(self):
        """steer_only forbids only the fresh-admission fallback; a
        genuinely-running turn steers exactly as before."""
        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("running", _LIVE_ROW))
        # Live slot (fixture default) → no accept-after-exit reclaim.

        with patch(
            "src.server.handlers.chat.steering.steer_thread",
            new_callable=AsyncMock,
            return_value={"position": 2, "payload": "QUEUED_JSON"},
        ):
            ready, event = await wait_or_steer(
                manager, "t-1", "hello", "u-1", steer_only=True
            )

        assert ready is False
        assert "steering_accepted" in event

    @pytest.mark.asyncio
    async def test_steer_accept_racing_exit_reclaims_and_admits_fresh(self, ledger_slot):
        """The admission snapshot said "running" but the workflow exited before
        the Redis push landed: the message must be reclaimed and the POST
        routed as a fresh turn — never a false steering_accepted for a
        message nothing will consume."""
        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("running", _LIVE_ROW))
        ledger_slot.return_value = None  # slot emptied between snapshot and push

        with (
            patch(
                "src.server.handlers.chat.steering.steer_thread",
                new_callable=AsyncMock,
                return_value={"position": 1, "payload": "QUEUED_JSON"},
            ),
            patch(
                "src.server.handlers.chat.steering.unsteer_thread",
                new_callable=AsyncMock,
                return_value=True,
            ) as mock_unsteer,
        ):
            ready, event = await wait_or_steer(manager, "t-1", "hello", "u-1")

        assert ready is True
        assert event is None
        mock_unsteer.assert_awaited_once_with("t-1", "QUEUED_JSON")

    @pytest.mark.asyncio
    async def test_steer_accept_racing_exit_steer_only_raises_not_running(
        self, ledger_slot
    ):
        """Same race under steer_only: a reclaimed accept surfaces as
        not_running so the gateway resubmits — not as a fresh admission."""
        from fastapi import HTTPException

        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("running", _LIVE_ROW))
        ledger_slot.return_value = None

        with (
            patch(
                "src.server.handlers.chat.steering.steer_thread",
                new_callable=AsyncMock,
                return_value={"position": 1, "payload": "QUEUED_JSON"},
            ),
            patch(
                "src.server.handlers.chat.steering.unsteer_thread",
                new_callable=AsyncMock,
                return_value=True,
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await wait_or_steer(
                    manager, "t-1", "hello", "u-1", steer_only=True
                )

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "not_running"

    @pytest.mark.asyncio
    async def test_steer_accept_drained_by_exit_still_reports_accepted(
        self, ledger_slot
    ):
        """If the reclaim misses, the exiting workflow's final drain got the
        message first and steering_returned already carried it back on the
        turn stream — the POST keeps the queue contract and reports
        accepted."""
        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("running", _LIVE_ROW))
        ledger_slot.return_value = None

        with (
            patch(
                "src.server.handlers.chat.steering.steer_thread",
                new_callable=AsyncMock,
                return_value={"position": 1, "payload": "QUEUED_JSON"},
            ),
            patch(
                "src.server.handlers.chat.steering.unsteer_thread",
                new_callable=AsyncMock,
                return_value=False,
            ),
        ):
            ready, event = await wait_or_steer(manager, "t-1", "hello", "u-1")

        assert ready is False
        assert "steering_accepted" in event

    @pytest.mark.asyncio
    async def test_running_steers_immediately_with_no_wait(self):
        """CRITICAL regression: a genuinely-running turn is steered immediately
        — admission returns "running" and steer_thread is called without any
        wait on the running task."""
        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("running", _LIVE_ROW))
        # Live slot (fixture default) → no accept-after-exit reclaim.

        with patch(
            "src.server.handlers.chat.steering.steer_thread",
            new_callable=AsyncMock,
            return_value={"position": 1, "payload": "QUEUED_JSON"},
        ) as mock_steer:
            ready, event = await wait_or_steer(
                manager, "t-1", "hello", "u-1", platform="telegram"
            )

        assert ready is False
        assert event is not None
        assert "steering_accepted" in event
        assert '"position": 1' in event
        # Stamped with the live run so the middleware's own-run filter
        # delivers it (v4 2.4c), and with the chat app its label names.
        mock_steer.assert_awaited_once_with(
            "t-1",
            "hello",
            "u-1",
            run_id="run-live",
            platform="telegram",
            request_key=None,
        )
        # No wait helper exists anymore — admission decided immediately.
        manager.wait_for_admission.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_stopping_raises_409_without_steering(self):
        """An explicitly-cancelled turn still winding down → 409 'stopping',
        never steered (a second checkpoint writer would corrupt state)."""
        from fastapi import HTTPException

        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("stopping", _STOPPING_ROW))

        with (
            patch(
                "src.server.handlers.chat.steering.steer_thread",
                new_callable=AsyncMock,
            ) as mock_steer,
            pytest.raises(HTTPException) as exc_info,
        ):
            await wait_or_steer(manager, "t-1", "hello", "u-1")

        assert exc_info.value.status_code == 409
        # Structured detail so handle_workflow_error can tag the SSE error code.
        detail = exc_info.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "stopping"
        assert "t-1" not in detail["message"]
        mock_steer.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_raises_409_when_steering_fails(self):
        from fastapi import HTTPException

        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("running", _LIVE_ROW))

        with (
            patch(
                "src.server.handlers.chat.steering.steer_thread",
                new_callable=AsyncMock,
                return_value=None,
            ),
            pytest.raises(HTTPException) as exc_info,
        ):
            await wait_or_steer(manager, "t-1", "hello", "u-1")

        assert exc_info.value.status_code == 409
        detail = exc_info.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "running"
        assert "t-1" not in detail["message"]

    @pytest.mark.asyncio
    async def test_compacting_raises_409_without_steering(self):
        """A thread mid-compaction whose wait timed out → 409 'compacting',
        never steered (steering mid-summarize corrupts the context rewrite)."""
        from fastapi import HTTPException

        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("compacting", None))

        with (
            patch(
                "src.server.handlers.chat.steering.steer_thread",
                new_callable=AsyncMock,
            ) as mock_steer,
            pytest.raises(HTTPException) as exc_info,
        ):
            await wait_or_steer(manager, "t-1", "hello", "u-1")

        assert exc_info.value.status_code == 409
        # Structured detail so the client can recognize the transient state and
        # re-queue; no thread_id leaked into the user-facing message.
        detail = exc_info.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "compacting"
        assert "t-1" not in detail["message"]
        mock_steer.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_cannot_steer_running_is_a_conflict(self):
        """Dispatched flows (can_steer=False) never steer: a running peer is a
        409, not a steering_accepted — a second astream on a thread-keyed
        checkpointer would collide."""
        from fastapi import HTTPException

        from src.server.handlers.chat.admission_gate import wait_or_steer

        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("running", _LIVE_ROW))

        with (
            patch(
                "src.server.handlers.chat.steering.steer_thread",
                new_callable=AsyncMock,
            ) as mock_steer,
            pytest.raises(HTTPException) as exc_info,
        ):
            await wait_or_steer(manager, "t-1", "hi", "u-1", can_steer=False)

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "running"
        mock_steer.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "messages",
        [[{"role": "user", "content": "the edited question"}], []],
        ids=["edit", "regenerate"],
    )
    async def test_a_fork_meeting_a_running_turn_is_a_conflict(self, messages):
        """An edit or a regenerate replaces a turn; steered into the running
        one it would add a message instead and truncate nothing."""
        from fastapi import HTTPException

        from src.server.handlers.chat.admission_gate import (
            steer_allowed,
            wait_or_steer,
        )
        from src.server.models.chat import ChatRequest

        request = ChatRequest(messages=messages, checkpoint_id="cp-3", fork_from_turn=3)
        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(return_value=("running", _LIVE_ROW))

        with (
            patch(
                "src.server.handlers.chat.steering.steer_thread",
                new_callable=AsyncMock,
            ) as mock_steer,
            pytest.raises(HTTPException) as exc_info,
        ):
            await wait_or_steer(
                manager,
                "t-1",
                "the edited question",
                "u-1",
                can_steer=steer_allowed(request, dispatched=False, steerable=True),
            )

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "running"
        mock_steer.assert_not_awaited()


_KEY = "8c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5"
_FIND_KEY = "src.server.database.runs.lifecycle.find_run_by_request_key"
_GET_RUN = "src.server.database.runs.lifecycle.get_run"
_CACHE = "src.utils.cache.redis_cache.get_cache_client"
_QUEUE = "workflow:steering:t-1"
_LIVE_RUN = {**_LIVE_ROW, "conversation_thread_id": "t-1", "status": "in_progress"}


class _CancelledOnceTheSteerLeaves:
    """The fake client, with ``task`` cancelled at its first Redis call after
    the steer left the queue, as a client disconnect does to a request."""

    def __init__(self, client, task=None):
        self._client = client
        self.task = task
        self._queued = bool(client.lists.get(_QUEUE))
        self._fired = False

    def __getattr__(self, name):
        attr = getattr(self._client, name)
        if name == "pipeline" or not callable(attr):
            return attr

        async def call(*args, **kwargs):
            queued = bool(self._client.lists.get(_QUEUE))
            self._queued = self._queued or queued
            if (
                self._queued
                and not queued
                and not self._fired
                and asyncio.current_task() is self.task
            ):
                self._fired = True
                raise asyncio.CancelledError
            return await attr(*args, **kwargs)

        return call


class TestKeyedSendSteersOnce:
    """A keyed send reaches the conversation once, whichever way its first
    copy went in: as a turn of its own or as a steer into a running one."""

    @pytest.fixture(autouse=True)
    def ledger(self):
        with (
            patch(
                "src.server.database.runs.lifecycle.get_active_run",
                new_callable=AsyncMock,
                return_value=_LIVE_ROW,
            ) as slot,
            patch(_FIND_KEY, new_callable=AsyncMock, return_value=None) as find,
            patch(_GET_RUN, new_callable=AsyncMock, return_value=_LIVE_RUN),
        ):
            yield SimpleNamespace(slot=slot, find=find)

    @pytest.fixture
    def cache(self, monkeypatch):
        from .redis_fakes import FakeCache

        cache = FakeCache()
        monkeypatch.setattr(_CACHE, lambda: cache)
        return cache

    @staticmethod
    def _admitting(state="running"):
        manager = AsyncMock()
        manager.wait_for_admission = AsyncMock(
            return_value=(state, _LIVE_ROW if state == "running" else None)
        )
        return manager

    @staticmethod
    async def _send(state="running"):
        from src.server.handlers.chat.admission_gate import wait_or_steer

        return await wait_or_steer(
            TestKeyedSendSteersOnce._admitting(state),
            "t-1",
            "hello",
            "u-1",
            request_key=_KEY,
        )

    @pytest.mark.asyncio
    async def test_a_copy_whose_first_copy_started_past_its_probe_is_not_steered(
        self, ledger, cache
    ):
        """The first copy's START committed between this copy's duplicate
        probe and its admission read, so the run it sees running is its own."""
        from src.server.database.runs.lifecycle import DuplicateRequestError

        first_copy = {**_LIVE_ROW, "conversation_thread_id": "t-1"}
        ledger.find.return_value = first_copy

        with pytest.raises(DuplicateRequestError) as dup:
            await self._send()

        assert dup.value.existing_run is first_copy
        assert cache.client.lists == {}

    @pytest.mark.asyncio
    async def test_a_resend_of_a_steered_send_names_the_turn_that_took_it(
        self, cache
    ):
        from src.server.database.runs.lifecycle import DuplicateRequestError

        ready, event = await self._send()
        assert (ready, "steering_accepted" in event) == (False, True)

        with pytest.raises(DuplicateRequestError) as dup:
            await self._send()

        assert dup.value.existing_run is _LIVE_RUN
        assert len(cache.client.lists[_QUEUE]) == 1

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "named", [_LIVE_RUN, None], ids=["steered", "reclaimed-since"]
    )
    async def test_a_claim_lost_after_the_recheck_steers_nothing(self, cache, named):
        """Another copy claimed the key between the recheck and the claim.
        Its steer is the duplicate's answer; a claim whose steer was since
        reclaimed for a turn leaves the refusal to recheck the key again."""
        from fastapi import HTTPException

        from src.server.database.runs.lifecycle import DuplicateRequestError
        from src.server.services.runs.steer_queue import steer_records_key
        from src.server.services.runs.admission import KeyedRun

        cache.client.hashes[steer_records_key("t-1")] = {_KEY: "run-live"}
        lookups = AsyncMock(
            side_effect=[None, named and KeyedRun(named, steered=True)]
        )
        with (
            patch("src.server.services.runs.admission.run_named_by_key", lookups),
            pytest.raises(DuplicateRequestError if named else HTTPException) as err,
        ):
            await self._send()

        if named is None:
            assert err.value.detail["code"] == "running"
        assert cache.client.lists == {}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("after", ["idle", "next-turn"])
    async def test_a_copy_that_meets_a_steer_its_turn_never_read_carries_it(
        self, ledger, cache, after
    ):
        """The other copy steered into a turn that ended before reading it,
        after this copy's recheck, and may have answered accepted, so this one
        carries the message: it moves it into the next turn, or starts a turn
        whose START takes it back."""
        from src.server.handlers.chat.steering import steer_thread, unsteer_thread
        from src.server.services.runs import steer_queue

        other = {}
        push = cache.client.eval

        async def other_copy_pushes_first(script, numkeys, *args):
            if script is steer_queue._STEER_LUA and not other:
                cache.client.eval = push
                other.update(await steer_thread(
                    "t-1", "hello", "u-1", run_id="run-live", request_key=_KEY
                ))
            return await push(script, numkeys, *args)

        cache.client.eval = other_copy_pushes_first
        next_turn = {**_LIVE_ROW, "conversation_response_id": "run-next"}
        ledger.slot.return_value = None if after == "idle" else next_turn
        ended = {**_LIVE_RUN, "status": "completed"}

        with patch(_GET_RUN, new_callable=AsyncMock, return_value=ended):
            answer = await self._send()

        records = cache.client.hashes[steer_queue.steer_records_key("t-1")]
        if after == "idle":
            # Left queued for this copy's START, which a client leaving
            # cannot cut short between the take-back and the commit.
            assert answer == (True, None)
            assert cache.client.lists[_QUEUE] == [other["payload"]]
            assert records == {_KEY: "run-live"}
            return
        assert answer[0] is False and "steering_accepted" in answer[1]
        [queued] = cache.client.lists[_QUEUE]
        assert json.loads(queued)["run_id"] == "run-next"
        assert records == {_KEY: "run-next"}
        # The other copy's check after its push finds nothing to reclaim.
        assert await unsteer_thread("t-1", other["payload"]) is False

    @pytest.mark.asyncio
    async def test_a_copy_whose_claim_could_not_be_written_is_refused(self, cache):
        """Passing it would queue a steer no later copy can see, which the
        next copy would then steer again."""
        from fastapi import HTTPException

        failed = []

        def failing_once(method):
            async def call(*args, **kwargs):
                if not failed and any(":key" in str(a) for a in args):
                    failed.append(True)
                    raise ConnectionError("redis down")
                return await method(*args, **kwargs)

            return call

        for name in ("set", "eval"):
            if hasattr(cache.client, name):
                setattr(cache.client, name, failing_once(getattr(cache.client, name)))

        with pytest.raises(HTTPException) as refused:
            await self._send()
        assert refused.value.detail["code"] == "running"
        assert cache.client.lists.get(_QUEUE, []) == []

        ready, event = await self._send()
        assert (ready, "steering_accepted" in event) == (False, True)
        assert len(cache.client.lists[_QUEUE]) == 1

    @pytest.mark.asyncio
    async def test_a_steer_reclaimed_for_a_turn_frees_its_key(self, ledger, cache):
        """The turn it was steered into had ended, so it starts as a turn of
        its own, whose row is what holds the key from here on."""
        from src.server.services.runs.steer_queue import steer_records_key

        ledger.slot.return_value = None

        assert await self._send() == (True, None)
        assert cache.client.lists[_QUEUE] == []
        assert cache.client.hashes[steer_records_key("t-1")] == {}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", ["reclaim", "drain"])
    async def test_a_cancel_after_the_steer_left_the_queue_strands_no_claim(
        self, ledger, cache, path
    ):
        """A disconnect cancels the request at its next await, and a cancel
        is no Exception. A claim left behind would answer the resend with a
        turn that never saw the message."""
        from src.server.handlers.chat.steering import drain_pending_steerings

        if path == "reclaim":
            # The turn ended between the admission read and the push.
            ledger.slot.return_value = None
            client = cache.client = _CancelledOnceTheSteerLeaves(cache.client)
            first = asyncio.create_task(self._send())
        else:
            await self._send()
            client = cache.client = _CancelledOnceTheSteerLeaves(cache.client)
            first = asyncio.create_task(drain_pending_steerings("t-1"))
        client.task = first
        with contextlib.suppress(asyncio.CancelledError):
            await first

        assert client._client.lists.get(_QUEUE, []) == []
        assert await self._send(state="fresh") == (True, None)


# ---------------------------------------------------------------------------
# admission_conflict_detail (single 409 wording source)
# ---------------------------------------------------------------------------


class TestAdmissionConflictDetail:
    """The single wording source for every in-generator admission 409 — the
    ``stopping``/``compacting``/``running`` conflicts and the ``steer_only``
    probe's ``not_running`` refusal. Same mapping for PTC and Flash, foreground
    and dispatched."""

    def test_compacting_state_names_compaction(self):
        from src.server.handlers.chat.admission_gate import admission_conflict_detail

        detail = admission_conflict_detail("compacting")
        # Structured detail (code + message) so handle_workflow_error can tag the
        # SSE error with a code and the client can recognize a transient state.
        assert isinstance(detail, dict)
        assert detail["code"] == "compacting"
        assert "compacting" in detail["message"].lower()
        assert "retry" in detail["message"].lower() or "resend" in detail["message"].lower()

    def test_stopping_state_names_stopping(self):
        from src.server.handlers.chat.admission_gate import admission_conflict_detail

        detail = admission_conflict_detail("stopping")
        assert isinstance(detail, dict)
        assert detail["code"] == "stopping"
        assert "stopping" in detail["message"].lower()

    def test_not_running_names_the_steer_refusal(self):
        from src.server.handlers.chat.admission_gate import admission_conflict_detail

        # The steer_only probe against an idle thread: not a wait_for_admission
        # state, but routed through the same mapper so the wording lives here too.
        detail = admission_conflict_detail("not_running")
        assert isinstance(detail, dict)
        assert detail["code"] == "not_running"
        assert "running" in detail["message"].lower()

    def test_running_state_is_the_generic_fallback(self):
        from src.server.handlers.chat.admission_gate import admission_conflict_detail

        # Any other non-fresh state (e.g. "running") falls through to the
        # "still running" code.
        detail = admission_conflict_detail("running")
        assert isinstance(detail, dict)
        assert detail["code"] == "running"
        assert "still running" in detail["message"].lower()
        # The actionable hint (reconnect / cancel) is part of the contract —
        # the web UI renders this message verbatim, so keep it pinned.
        assert "reconnect" in detail["message"].lower()
        assert "cancel" in detail["message"].lower()

    def test_unknown_state_falls_back_to_generic(self):
        from src.server.handlers.chat.admission_gate import admission_conflict_detail

        detail = admission_conflict_detail("wedged")
        assert detail["code"] == "running"
        assert "still running" in detail["message"].lower()
