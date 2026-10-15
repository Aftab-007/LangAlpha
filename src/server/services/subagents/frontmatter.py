"""The subagent file's frontmatter, read the same way wherever a file arrives.

The agent's folder and a plugin's ``agents/`` folder carry the same file, so
both read it here: a file one of them accepts the other reads the same way.
"""

from __future__ import annotations

import re
from typing import Any

import yaml


class StrictLoader(yaml.SafeLoader):
    """Safe YAML that refuses a key given twice, where plain YAML keeps the last."""


def _mapping(loader: StrictLoader, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    seen: set[Any] = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=True)
        try:
            duplicate = key in seen
        except TypeError:
            continue  # construct_mapping refuses an unhashable key
        if duplicate:
            raise yaml.constructor.ConstructorError(
                None, None, f"{key} is given twice", key_node.start_mark
            )
        seen.add(key)
    return loader.construct_mapping(node, deep=deep)


StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping)


# What Postgres stores in neither text nor JSONB: a NUL, and a lone UTF-16
# surrogate, which no UTF-8 encoding holds. A YAML escape (``"\0"``,
# ``"\ud800"``) or a JSON one makes either from printable text.
UNSAVABLE = re.compile("[\x00\ud800-\udfff]")


def unsavable_char(value: Any) -> str | None:
    """A character saved text can't hold in a string anywhere in ``value``,
    key or item, or None. A lone surrogate wins over a NUL wherever each
    sits, since a refusal can echo a NUL but not a surrogate. Walked without
    recursion, since YAML may nest deeper than Python recurses.
    """
    stack = [value]
    nul = None
    while stack:
        node = stack.pop()
        if isinstance(node, str):
            for found in UNSAVABLE.finditer(node):
                if found.group() != "\x00":
                    return found.group()
                nul = "\x00"
        elif isinstance(node, dict):
            stack.extend(node)
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return nul


def split_frontmatter(content: str) -> tuple[str, str, int] | None:
    """(frontmatter, body, line the frontmatter starts on), or None without fences."""
    lines = content.removeprefix("﻿").replace("\r\n", "\n").split("\n")
    start = 0
    while start < len(lines) and not lines[start].strip():
        start += 1
    if start == len(lines) or lines[start].rstrip() != "---":
        return None
    for end in range(start + 1, len(lines)):
        if lines[end].rstrip() == "---":
            return "\n".join(lines[start + 1:end]), "\n".join(lines[end + 1:]), start + 2
    return None
