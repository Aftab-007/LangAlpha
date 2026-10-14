"""A user's subagents as the pane and the agent's files see them.

Two writers share this package: REST for the pane (``app/subagents.py``) and
the file route over ``.agents/user/agents/``. Both read the same view
(``view``), refuse the same values (``rules``) and save through the same
function (``writes``), so a value one of them refuses the other refuses too,
and a save from either moves the version the other checks.

The per-turn merge that turns rows into the roster a build compiles stays in
``ptc_agent.agent.subagents.merge``; nothing here runs during a turn.
"""

from .context import Connector, SubagentContext, SubagentsUnavailable, load_context
from .rules import (
    CUSTOM_KEYS,
    DESCRIPTION_MAX,
    EDITABLE_KEYS,
    INHERIT,
    INSTRUCTIONS_MAX_BYTES,
    MAX_CUSTOM,
    NAME_RE,
    FieldError,
    SubagentInvalid,
    changed_fields,
    content_errors,
    custom_text_errors,
    description_match_note,
    description_matches,
    normalize_value,
    validate_fields,
    validate_new_name,
)
from .view import (
    BODY_GUIDANCE,
    agent_file,
    attach_titles,
    build_views,
    definition_values,
    editable_values,
    render_base_body,
    version_of,
)
from .writes import (
    SaveResult,
    SubagentNotFound,
    VersionConflict,
    delete_subagent,
    list_subagents,
    save_subagent,
)

__all__ = [
    "BODY_GUIDANCE",
    "CUSTOM_KEYS",
    "DESCRIPTION_MAX",
    "EDITABLE_KEYS",
    "INHERIT",
    "INSTRUCTIONS_MAX_BYTES",
    "MAX_CUSTOM",
    "NAME_RE",
    "Connector",
    "FieldError",
    "SaveResult",
    "SubagentContext",
    "SubagentInvalid",
    "SubagentNotFound",
    "SubagentsUnavailable",
    "VersionConflict",
    "agent_file",
    "attach_titles",
    "build_views",
    "changed_fields",
    "content_errors",
    "custom_text_errors",
    "definition_values",
    "delete_subagent",
    "description_match_note",
    "description_matches",
    "editable_values",
    "list_subagents",
    "load_context",
    "normalize_value",
    "render_base_body",
    "save_subagent",
    "validate_fields",
    "validate_new_name",
    "version_of",
]
