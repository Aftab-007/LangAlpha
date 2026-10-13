"""NonRetainingTracer posts every run as the stock tracer does, without the tree.

A turn has no step cap, so a root that keeps its children grows for as long as
the turn runs. These pin both halves: each run still reaches LangSmith on its
own with the parent and ordering it had, and nothing holds the finished runs.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from langchain_core.callbacks.manager import CallbackManager
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.runnables import RunnableLambda
from langchain_core.tracers.langchain import LangChainTracer
from langsmith.run_helpers import tracing_context
from langsmith.run_trees import RunTree

from src.observability.langsmith_tracer import NonRetainingTracer, with_run_tracer


class _RecordingClient:
    """Stands in for the LangSmith client: records what would be sent."""

    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self.updated: list[dict[str, Any]] = []

    def create_run(self, **kwargs: Any) -> None:
        self.created.append(kwargs)

    def update_run(self, **kwargs: Any) -> None:
        self.updated.append(kwargs)

    def flush(self) -> None:
        return None


def _traced_chain(seen: dict[str, Any]):
    """outer -> (inner, chat model); inner records what the tracer holds."""
    model = FakeListChatModel(responses=["ok"])

    def inner(x: str, config) -> str:
        tracer = next(
            h for h in config["callbacks"].handlers if isinstance(h, LangChainTracer)
        )
        roots = [r for r in tracer.run_map.values() if r.parent_run_id is None]
        seen["root_children_mid_run"] = len(roots[0].child_runs)
        return x

    def outer(x: str, config) -> str:
        RunnableLambda(inner).invoke(x, config)
        return model.invoke(x, config).content

    return RunnableLambda(outer, name="outer")


def _segments(dotted_order: str) -> list[str]:
    return dotted_order.split(".")


@pytest.mark.parametrize("tracer_cls", [LangChainTracer, NonRetainingTracer])
def test_each_run_is_posted_with_its_parent_and_order(tracer_cls):
    client = _RecordingClient()
    tracer = tracer_cls(project_name="proj", client=client)
    seen: dict[str, Any] = {}

    assert _traced_chain(seen).invoke("hi", {"callbacks": [tracer]}) == "ok"

    created = {str(c["id"]): c for c in client.created}
    names = sorted(c["name"] for c in created.values())
    assert names == ["FakeListChatModel", "inner", "outer"]
    assert sorted(str(u["run_id"]) for u in client.updated) == sorted(created)

    root = next(c for c in created.values() if c["name"] == "outer")
    assert root.get("parent_run_id") is None
    assert str(root["trace_id"]) == str(root["id"])
    assert _segments(root["dotted_order"])[-1].endswith(str(root["id"]))
    for child in (c for c in created.values() if c is not root):
        assert str(child["parent_run_id"]) == str(root["id"])
        assert str(child["trace_id"]) == str(root["id"])
        segs = _segments(child["dotted_order"])
        assert ".".join(segs[:-1]) == root["dotted_order"]
        assert segs[-1].endswith(str(child["id"]))
        assert child["inputs"]
    assert all(c["session_name"] == "proj" for c in client.created)

    # The control proves the probe can see a held child; the subclass holds none.
    expected = 1 if tracer_cls is LangChainTracer else 0
    assert seen["root_children_mid_run"] == expected
    assert tracer.run_map == {}


def test_nests_under_an_outer_run_without_holding_on_to_it():
    """A subagent starts under its launcher's tool run, which another tracer owns."""
    client = _RecordingClient()
    launcher = RunTree(name="Task", run_type="tool", client=client, session_name="proj")
    with tracing_context(parent=launcher, enabled=True):
        config = with_run_tracer({})
        RunnableLambda(lambda x: x, name="subagent").invoke("hi", config)

    run = next(c for c in client.created if c["name"] == "subagent")
    assert str(run["parent_run_id"]) == str(launcher.id)
    assert str(run["trace_id"]) == str(launcher.trace_id)
    assert run["dotted_order"].startswith(launcher.dotted_order + ".")
    assert run["session_name"] == "proj"
    # langchain_core's own tracer appends the subagent's root here, so the
    # launcher's tree would hold the subagent's too.
    assert launcher.child_runs == []


def _ambient_tracer() -> LangChainTracer:
    manager = CallbackManager.configure(inheritable_callbacks=None)
    return next(h for h in manager.handlers if isinstance(h, LangChainTracer))


def test_built_as_langchain_core_builds_its_own():
    client = _RecordingClient()
    with tracing_context(
        enabled=True,
        client=client,
        project_name="proj",
        tags=["t1"],
        metadata={"k": "v"},
    ):
        ours = with_run_tracer({})["callbacks"][-1]
        ambient = _ambient_tracer()

    assert type(ours) is NonRetainingTracer
    assert type(ambient) is LangChainTracer
    assert ours.project_name == ambient.project_name == "proj"
    assert ours.client is ambient.client is client
    assert ours.tags == ambient.tags
    assert ours.tracing_metadata == ambient.tracing_metadata


def test_under_a_parent_run_uses_its_project_and_client():
    client = _RecordingClient()
    parent = RunTree(name="Task", run_type="tool", client=client, session_name="theirs")
    with tracing_context(parent=parent, enabled=True):
        ours = with_run_tracer({})["callbacks"][-1]
        ambient = _ambient_tracer()

    assert ours.project_name == ambient.project_name == "theirs"
    assert ours.client is ambient.client is client


def test_named_tracer_stops_langchain_core_adding_its_own():
    client = _RecordingClient()
    with tracing_context(enabled=True, client=client):
        config = with_run_tracer({"callbacks": [object()]})
        manager = CallbackManager.configure(inheritable_callbacks=config["callbacks"])

    tracers = [h for h in manager.handlers if isinstance(h, LangChainTracer)]
    assert len(tracers) == 1
    assert type(tracers[0]) is NonRetainingTracer


def test_unchanged_when_tracing_is_off():
    config = {"callbacks": [object()]}
    with tracing_context(enabled=False):
        assert with_run_tracer(config) is config
        assert with_run_tracer({}) == {}


def test_unchanged_when_the_callbacks_already_trace():
    client = _RecordingClient()
    with tracing_context(enabled=True, client=client):
        traced = {"callbacks": [LangChainTracer(client=client)]}
        assert with_run_tracer(traced) is traced
        # A callback manager carries its parent's tracer to the run.
        managed = {"callbacks": CallbackManager(handlers=[], parent_run_id=uuid4())}
        assert with_run_tracer(managed) is managed
