"""Validated business-workflow correlation independent of OTel trace identity."""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from uuid import uuid4

from opentelemetry import trace
from opentelemetry.context import Context

_CORRELATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:/-]{1,128}$")
_ACTIVE_CORRELATION_ID: ContextVar[str | None] = ContextVar(
    "cloudwatch_instrumentation_correlation_id",
    default=None,
)


class CorrelationContractError(ValueError):
    """Raised when workflow correlation violates its transport contract."""


def validate_correlation_id(value: str) -> str:
    if not _CORRELATION_ID_PATTERN.fullmatch(value):
        raise CorrelationContractError(
            "correlation_id contains invalid characters or is too long"
        )
    return value


def get_correlation_id() -> str | None:
    return _ACTIVE_CORRELATION_ID.get()


@contextmanager
def use_correlation_id(correlation_id: str) -> Iterator[None]:
    token = _ACTIVE_CORRELATION_ID.set(validate_correlation_id(correlation_id))
    try:
        yield
    finally:
        _ACTIVE_CORRELATION_ID.reset(token)


def resolve_correlation_id(
    candidate: str | None = None,
    source_context: Context | None = None,
) -> str:
    if candidate is not None:
        return validate_correlation_id(candidate)
    active_correlation_id = get_correlation_id()
    if active_correlation_id is not None:
        return active_correlation_id
    span_context = trace.get_current_span(source_context).get_span_context()
    if span_context.is_valid:
        return trace.format_trace_id(span_context.trace_id)
    return str(uuid4())


__all__ = [
    "CorrelationContractError",
    "get_correlation_id",
    "resolve_correlation_id",
    "use_correlation_id",
    "validate_correlation_id",
]
