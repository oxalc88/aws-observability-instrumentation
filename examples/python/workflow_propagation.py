"""Transport-neutral OTel and business-workflow context propagation."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from opentelemetry import propagate
from opentelemetry.context import Context
from opentelemetry.propagators.textmap import TextMapPropagator

from .correlation_context import (
    CorrelationContractError,
    resolve_correlation_id,
    validate_correlation_id,
)

WORKFLOW_CORRELATION_FIELD = "correlation_id"


@dataclass(frozen=True)
class InjectedWorkflowContext:
    carrier: dict[str, str]
    correlation_id: str


@dataclass(frozen=True)
class ExtractedWorkflowContext:
    context: Context
    correlation_id: str


def inject_workflow_context(
    *,
    carrier: Mapping[str, str] | None = None,
    correlation_id: str | None = None,
    active_context: Context | None = None,
    propagator: TextMapPropagator | None = None,
) -> InjectedWorkflowContext:
    prepared = dict(carrier or {})
    existing = prepared.get(WORKFLOW_CORRELATION_FIELD)
    if (
        existing is not None
        and correlation_id is not None
        and existing != correlation_id
    ):
        raise CorrelationContractError(
            "Refusing to overwrite an existing correlation_id"
        )
    candidate = existing if existing is not None else correlation_id
    resolved = resolve_correlation_id(candidate, active_context)
    prepared[WORKFLOW_CORRELATION_FIELD] = resolved
    (propagator or propagate.get_global_textmap()).inject(
        prepared,
        context=active_context,
    )
    return InjectedWorkflowContext(prepared, resolved)


def extract_workflow_context(
    carrier: Mapping[str, str],
    *,
    parent_context: Context | None = None,
    propagator: TextMapPropagator | None = None,
) -> ExtractedWorkflowContext:
    candidate = carrier.get(WORKFLOW_CORRELATION_FIELD)
    if candidate is None:
        raise CorrelationContractError(
            "Asynchronous carrier is missing correlation_id"
        )
    correlation_id = validate_correlation_id(candidate)
    extracted = (propagator or propagate.get_global_textmap()).extract(
        carrier,
        context=parent_context if parent_context is not None else Context(),
    )
    return ExtractedWorkflowContext(extracted, correlation_id)


__all__ = [
    "ExtractedWorkflowContext",
    "InjectedWorkflowContext",
    "WORKFLOW_CORRELATION_FIELD",
    "extract_workflow_context",
    "inject_workflow_context",
]
