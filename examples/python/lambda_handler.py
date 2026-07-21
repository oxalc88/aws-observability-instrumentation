"""AWS Lambda lifecycle pattern for custom OTel telemetry."""

from __future__ import annotations

import os
from typing import Any, Protocol

from opentelemetry.trace import Status, StatusCode

from .emission_module import init_telemetry
from .failure_taxonomy import classify
from .metric_def import MetricDef
from .structured_logging import LogEventDef, StructuredLogger, parse_log_level


class LambdaContext(Protocol):
    function_name: str
    function_version: str
    aws_request_id: str

    def get_remaining_time_in_millis(self) -> int: ...


INVOCATIONS = MetricDef.counter(
    "app.lambda.invocation",
    purpose="outcome",
    owner="platform",
    means="Completed invocations of this Lambda function.",
    unit="{invocation}",
    attributes={"outcome": frozenset({"success", "failure"})},
    required=frozenset({"outcome"}),
    emit_frequency="per_request",
)
FAILURES = MetricDef.failure_counter(
    "app.lambda.invocation.failure",
    owner="platform",
    means="Lambda invocations that terminated with an application exception.",
    emit_frequency="per_request",
)
OPERATION_NAME = "lambda.handler"
INVOCATION_COMPLETED = LogEventDef(
    "app.lambda.invocation.completed",
    level="INFO",
    message="Lambda invocation completed",
    owner="platform",
    operation_name=OPERATION_NAME,
    related_metric=INVOCATIONS,
    fields={
        "outcome": "operational",
        "faas.coldstart": "operational",
        "faas.name": "operational",
        "faas.version": "operational",
        "faas.invocation_id": "correlation",
    },
    required=frozenset(
        {"outcome", "faas.coldstart", "faas.name", "faas.version", "faas.invocation_id"}
    ),
)
INVOCATION_FAILED = LogEventDef(
    "app.lambda.invocation.failed",
    level="ERROR",
    message="Lambda invocation failed",
    owner="platform",
    operation_name=OPERATION_NAME,
    related_metric=FAILURES,
    fields={
        "outcome": "operational",
        "failure.class": "operational",
        "faas.coldstart": "operational",
        "faas.name": "operational",
        "faas.version": "operational",
        "faas.invocation_id": "correlation",
    },
    required=frozenset(
        {
            "outcome",
            "failure.class",
            "faas.coldstart",
            "faas.name",
            "faas.version",
            "faas.invocation_id",
        }
    ),
)

SERVICE_NAME = os.getenv(
    "OTEL_SERVICE_NAME", os.getenv("AWS_LAMBDA_FUNCTION_NAME", "lambda")
)
SERVICE_VERSION = os.getenv("AWS_LAMBDA_FUNCTION_VERSION", "unknown")
ENVIRONMENT = os.getenv("DEPLOYMENT_ENVIRONMENT", "unknown")

# Initialize during the cold start. Warm invocations reuse providers and instruments.
RUNTIME = init_telemetry(
    service_name=SERVICE_NAME,
    service_version=SERVICE_VERSION,
    environment=ENVIRONMENT,
    metric_export_interval_millis=1_000,
    registry=[INVOCATIONS, FAILURES],
)
TRACER = RUNTIME.tracer_provider.get_tracer(__name__)
LOGGER = StructuredLogger(
    service_name=SERVICE_NAME,
    service_version=SERVICE_VERSION,
    environment=ENVIRONMENT,
    minimum_level=parse_log_level(os.getenv("LOG_LEVEL")),
)
_COLD_START = True


def _handle(event: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "received_keys": sorted(event)}


def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    global _COLD_START
    outcome = "failure"
    was_cold_start = _COLD_START
    _COLD_START = False
    try:
        with TRACER.start_as_current_span(
            OPERATION_NAME,
            attributes={
                "faas.name": context.function_name,
                "faas.version": context.function_version,
                "faas.invocation_id": context.aws_request_id,
            },
            record_exception=False,
            set_status_on_exception=False,
        ) as span:
            try:
                result = _handle(event)
                outcome = "success"
                LOGGER.emit(
                    INVOCATION_COMPLETED,
                    {
                        "outcome": outcome,
                        "faas.coldstart": was_cold_start,
                        "faas.name": context.function_name,
                        "faas.version": context.function_version,
                        "faas.invocation_id": context.aws_request_id,
                    },
                    correlation_id=context.aws_request_id,
                )
                return result
            except BaseException as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR))
                failure = classify(exc)
                span.set_attributes({"outcome": outcome, "failure.class": failure.value})
                RUNTIME.emitter.emit_failure(FAILURES, failure=failure)
                LOGGER.emit(
                    INVOCATION_FAILED,
                    {
                        "outcome": outcome,
                        "failure.class": failure,
                        "faas.coldstart": was_cold_start,
                        "faas.name": context.function_name,
                        "faas.version": context.function_version,
                        "faas.invocation_id": context.aws_request_id,
                    },
                    correlation_id=context.aws_request_id,
                    exception=exc,
                )
                raise
            finally:
                span.set_attribute("outcome", outcome)
                RUNTIME.emitter.emit_counter(INVOCATIONS, attributes={"outcome": outcome})
    finally:
        remaining = context.get_remaining_time_in_millis()
        flush_budget = max(0, min(1_000, remaining - 100))
        if flush_budget:
            RUNTIME.force_flush(flush_budget)


__all__ = ["handler"]
