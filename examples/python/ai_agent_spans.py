"""OpenTelemetry GenAI spans with sensitive content disabled by default."""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from opentelemetry.trace import Span, SpanKind, Status, StatusCode, Tracer


def _finish_failed(span: Span, exc: BaseException) -> None:
    span.record_exception(exc)
    span.set_status(Status(StatusCode.ERROR))


@contextmanager
def agent_span(
    tracer: Tracer,
    *,
    agent_name: str,
    conversation_id: str,
) -> Iterator[Span]:
    with tracer.start_as_current_span(
        f"invoke_agent {agent_name}",
        kind=SpanKind.INTERNAL,
        attributes={
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.agent.name": agent_name,
            "gen_ai.conversation.id": conversation_id,
        },
    ) as span:
        try:
            yield span
        except BaseException as exc:
            _finish_failed(span, exc)
            raise


@contextmanager
def chat_span(
    tracer: Tracer,
    *,
    provider: str,
    model: str,
    conversation_id: str,
    input_messages: list[Mapping[str, Any]] | None = None,
    capture_content: bool = False,
) -> Iterator[Span]:
    attributes: dict[str, str] = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": provider,
        "gen_ai.request.model": model,
        "gen_ai.conversation.id": conversation_id,
    }
    if capture_content and input_messages is not None:
        attributes["gen_ai.input.messages"] = json.dumps(input_messages)
    with tracer.start_as_current_span(
        f"chat {model}", kind=SpanKind.CLIENT, attributes=attributes
    ) as span:
        try:
            yield span
        except BaseException as exc:
            _finish_failed(span, exc)
            raise


@contextmanager
def tool_span(
    tracer: Tracer,
    *,
    tool_name: str,
    conversation_id: str,
) -> Iterator[Span]:
    with tracer.start_as_current_span(
        f"execute_tool {tool_name}",
        kind=SpanKind.INTERNAL,
        attributes={
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": tool_name,
            "gen_ai.conversation.id": conversation_id,
        },
    ) as span:
        try:
            yield span
        except BaseException as exc:
            _finish_failed(span, exc)
            raise


def set_token_usage(span: Span, *, input_tokens: int, output_tokens: int) -> None:
    span.set_attribute("gen_ai.usage.input_tokens", input_tokens)
    span.set_attribute("gen_ai.usage.output_tokens", output_tokens)


__all__ = ["agent_span", "chat_span", "set_token_usage", "tool_span"]
