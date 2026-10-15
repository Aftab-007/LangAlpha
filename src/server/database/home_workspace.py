"""Which row is a user's flash workspace, the one that becomes their Home.

Identity is the row's id, never its status: once bound to a computer as Home
the row takes that computer's lifecycle like any workspace on it, so only a row
that was never bound still reads 'flash'. The status test stays for flash rows
created at another id, which still exist.

Nothing here imports the project, so every database module can ask.
"""

from __future__ import annotations

import uuid
from typing import Any, Mapping, Optional

FLASH_WORKSPACE_NAMESPACE = uuid.UUID("f1a50000-0000-5000-e000-f1a500000000")


def get_flash_workspace_id(user_id: str) -> str:
    return str(uuid.uuid5(FLASH_WORKSPACE_NAMESPACE, user_id))


def is_home_id(user_id: Any, workspace_id: Any) -> bool:
    """Whether ``workspace_id`` names ``user_id``'s Home, in any case a client spells it."""
    if not user_id or not workspace_id:
        return False
    return str(workspace_id).lower() == get_flash_workspace_id(str(user_id))


def is_unbound(workspace: Optional[Mapping[str, Any]]) -> bool:
    """Whether ``workspace`` is a flash row on no computer yet."""
    return bool(workspace) and workspace.get("status") == "flash"


def is_flash_row(workspace: Optional[Mapping[str, Any]]) -> bool:
    """Whether ``workspace`` is its owner's flash row, bound as Home or not."""
    if not workspace:
        return False
    if is_unbound(workspace):
        return True
    return is_home_id(workspace.get("user_id"), workspace.get("workspace_id"))
