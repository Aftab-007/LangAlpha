"""Whether the installed langgraph still needs the delta branch backport.

``ptc_agent.agent.delta_branch`` backports langgraph 1.2.13's snapshot of a
new branch's ``DeltaChannel`` state, for runs and for state updates. The
upgrade that brings the upstream rule fails here and says what to remove; the
behaviour stays pinned by ``test_delta_channel_branches.py``, which must pass
with or without it.
"""

from importlib.metadata import version

from langgraph.pregel._loop import PregelLoop
from langgraph.pregel.main import Pregel

from ptc_agent.agent.delta_branch import upstream_snapshots_new_branches
import ptc_agent.agent.state  # noqa: F401  (installs the backport)


def test_the_installed_langgraph_still_needs_the_backport():
    assert not upstream_snapshots_new_branches(), (
        f"langgraph {version('langgraph')} snapshots a new branch's delta channels "
        "itself, so the backport is inert. Remove src/ptc_agent/agent/delta_branch.py, "
        "its calls in src/ptc_agent/agent/state.py and this test, and raise the "
        "langgraph floor in pyproject.toml to this version."
    )


def test_the_backport_is_installed():
    assert getattr(PregelLoop._first, "_snapshots_new_branch", False)
    assert getattr(Pregel.abulk_update_state, "_snapshots_update_base", False)
    assert getattr(Pregel.bulk_update_state, "_snapshots_update_base", False)
