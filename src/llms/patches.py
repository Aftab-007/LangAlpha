"""Monkey-patches for upstream library bugs."""

import logging

logger = logging.getLogger(__name__)


def _patch_langchain_anthropic_usage_metadata():
    """Fix TypeError when cache_creation fields are None.

    langchain-anthropic v1.4.0 crashes on dict.get(k, 0) returning None
    when third-party providers return null for cache token fields.
    """
    try:
        import langchain_anthropic.chat_models as chat_models
        from pydantic import BaseModel

        original_fn = chat_models._create_usage_metadata
        if getattr(original_fn, "_is_patched", False):
            return

        def _patched(anthropic_usage: BaseModel):
            cache_creation = getattr(anthropic_usage, "cache_creation", None)
            if cache_creation is not None:
                for field in ("ephemeral_5m_input_tokens", "ephemeral_1h_input_tokens"):
                    if isinstance(cache_creation, dict):
                        if cache_creation.get(field) is None:
                            cache_creation[field] = 0
                    elif getattr(cache_creation, field, None) is None:
                        object.__setattr__(cache_creation, field, 0)
            return original_fn(anthropic_usage)

        _patched._is_patched = True
        chat_models._create_usage_metadata = _patched
        logger.debug("Patched langchain_anthropic._create_usage_metadata for None cache values")
    except Exception as e:
        logger.warning(f"Failed to patch langchain_anthropic: {e}")


def _patch_langchain_anthropic_context_management():
    """Keep an unmodelled ``context_management`` stream field from killing the call.

    Some Anthropic-compatible proxies put it on the final ``message_delta``. The
    SDK's event model has no such field, so it lands in pydantic extras as a plain
    dict, and langchain-anthropic calls ``.model_dump()`` on it. The dict goes to
    ``response_metadata`` as-is, where the typed path would have put its dump.
    """
    try:
        from langchain_anthropic.chat_models import ChatAnthropic

        original_fn = ChatAnthropic._make_message_chunk_from_anthropic_event
        if getattr(original_fn, "_is_patched", False):
            return

        def _patched(self, event, *args, **kwargs):
            raw = None
            if getattr(event, "type", None) == "message_delta":
                raw = getattr(event, "context_management", None)
            if raw is None or hasattr(raw, "model_dump"):
                return original_fn(self, event, *args, **kwargs)

            # The event is the stream's own object, so the original gets a copy.
            stripped = event.model_copy()
            (stripped.__pydantic_extra__ or {}).pop("context_management", None)
            chunk, block_start_event = original_fn(self, stripped, *args, **kwargs)
            if chunk is not None and isinstance(raw, dict):
                chunk.response_metadata["context_management"] = raw
            return chunk, block_start_event

        _patched._is_patched = True
        ChatAnthropic._make_message_chunk_from_anthropic_event = _patched
        logger.debug("Patched ChatAnthropic stream event for a dict context_management")
    except Exception as e:
        logger.warning(f"Failed to patch langchain_anthropic context_management: {e}")
