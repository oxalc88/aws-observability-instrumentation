"""Instrumented async HTTP dependency client."""

from __future__ import annotations

import time
from collections.abc import Mapping
from typing import Any

import httpx
from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode

from .emission_module import MetricEmitter
from .failure_taxonomy import FailureClass, classify, register
from .metric_def import MetricDef

DEPENDENCIES = frozenset({"payments", "identity", "catalog"})
OPERATIONS = frozenset({"list", "get", "create", "update"})
OUTCOMES = frozenset({"success", "client_error", "server_error"})

register(httpx.HTTPError, FailureClass.DEPENDENCY_FAILURE)

DEPENDENCY_CALLS = MetricDef.counter(
    "app.dependency.request",
    purpose="outcome",
    owner="platform",
    means="Completed calls to a configured external HTTP dependency.",
    unit="{request}",
    attributes={"dependency": DEPENDENCIES, "operation": OPERATIONS, "outcome": OUTCOMES},
    required=frozenset({"dependency", "operation", "outcome"}),
)
DEPENDENCY_DURATION = MetricDef.latency(
    "app.dependency.request.duration",
    owner="platform",
    means="Elapsed time for a configured external HTTP dependency call.",
    attributes={"dependency": DEPENDENCIES, "operation": OPERATIONS, "outcome": OUTCOMES},
    required=frozenset({"dependency", "operation", "outcome"}),
)
DEPENDENCY_FAILURES = MetricDef.failure_counter(
    "app.dependency.request.failure",
    owner="platform",
    means="External HTTP dependency calls that raised or returned a server failure.",
    attributes={"dependency": DEPENDENCIES, "operation": OPERATIONS},
    required=frozenset({"dependency", "operation"}),
)


class InstrumentedHttpClient:
    def __init__(
        self,
        *,
        dependency: str,
        base_url: str,
        emitter: MetricEmitter,
        timeout_seconds: float = 10.0,
    ) -> None:
        if dependency not in DEPENDENCIES:
            raise ValueError(f"undeclared dependency: {dependency!r}")
        self.dependency = dependency
        self.emitter = emitter
        self.client = httpx.AsyncClient(base_url=base_url, timeout=timeout_seconds)
        self.tracer = trace.get_tracer(__name__)

    async def request(
        self,
        method: str,
        path: str,
        *,
        operation: str,
        params: Mapping[str, Any] | None = None,
        json: Any = None,
    ) -> httpx.Response:
        if operation not in OPERATIONS:
            raise ValueError(f"undeclared operation: {operation!r}")
        started = time.monotonic()
        outcome = "server_error"
        attributes = {"dependency": self.dependency, "operation": operation}
        with self.tracer.start_as_current_span(
            f"{method.upper()} {self.dependency}.{operation}",
            kind=SpanKind.CLIENT,
            attributes={
                "http.request.method": method.upper(),
                "server.address": self.dependency,
                "app.dependency.operation": operation,
            },
        ) as span:
            try:
                response = await self.client.request(
                    method, path, params=params, json=json
                )
                span.set_attribute("http.response.status_code", response.status_code)
                outcome = (
                    "success"
                    if response.status_code < 400
                    else "client_error"
                    if response.status_code < 500
                    else "server_error"
                )
                response.raise_for_status()
                return response
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR))
                self.emitter.emit_failure(
                    DEPENDENCY_FAILURES,
                    failure=classify(exc),
                    attributes=attributes,
                )
                raise
            finally:
                complete = {**attributes, "outcome": outcome}
                self.emitter.emit_counter(DEPENDENCY_CALLS, attributes=complete)
                self.emitter.emit_latency(
                    DEPENDENCY_DURATION,
                    duration_seconds=time.monotonic() - started,
                    attributes=complete,
                )


__all__ = ["InstrumentedHttpClient"]
