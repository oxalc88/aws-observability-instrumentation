"""AWS Lambda Kinesis batch handler with per-record OTel correlation."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any, Protocol

from .emission_module import init_telemetry
from .failure_taxonomy import classify
from .kinesis_workflow import process_kinesis_record
from .metric_def import MetricDef
from .structured_logging import LogEventDef, StructuredLogger, parse_log_level


class LambdaContext(Protocol):
    def get_remaining_time_in_millis(self) -> int: ...


RECORD_FAILURES = MetricDef.failure_counter(
    "app.kinesis.record.failure",
    owner="orders",
    means="Kinesis records that failed application processing.",
    emit_frequency="per_event",
)
RECORD_COMPLETED = LogEventDef(
    "app.kinesis.record.completed",
    level="INFO",
    message="Kinesis record processing completed",
    owner="orders",
    operation_name="orders.process",
    sampling_class="operational",
    fields={"messaging.message.id": "correlation", "outcome": "operational"},
    required=frozenset({"messaging.message.id", "outcome"}),
)
RECORD_FAILED = LogEventDef(
    "app.kinesis.record.failed",
    level="ERROR",
    message="Kinesis record processing failed",
    owner="orders",
    operation_name="orders.process",
    related_metric=RECORD_FAILURES,
    fields={
        "messaging.message.id": "correlation",
        "outcome": "operational",
        "failure.class": "operational",
    },
    required=frozenset({"messaging.message.id", "outcome", "failure.class"}),
)

SERVICE_NAME = os.getenv(
    "OTEL_SERVICE_NAME", os.getenv("AWS_LAMBDA_FUNCTION_NAME", "lambda")
)
SERVICE_VERSION = os.getenv("AWS_LAMBDA_FUNCTION_VERSION", "unknown")
ENVIRONMENT = os.getenv("DEPLOYMENT_ENVIRONMENT", "unknown")

RUNTIME = init_telemetry(
    service_name=SERVICE_NAME,
    service_version=SERVICE_VERSION,
    environment=ENVIRONMENT,
    metric_export_interval_millis=1_000,
    registry=[RECORD_FAILURES],
)
TRACER = RUNTIME.tracer_provider.get_tracer(__name__)
LOGGER = StructuredLogger(
    service_name=SERVICE_NAME,
    service_version=SERVICE_VERSION,
    environment=ENVIRONMENT,
    minimum_level=parse_log_level(os.getenv("LOG_LEVEL")),
)


def handler(event: Mapping[str, Any], context: LambdaContext) -> None:
    try:
        records = event.get("Records")
        if not isinstance(records, list):
            raise ValueError("Kinesis event Records must be a list")
        # Default all-or-retry; partial responses require an opt-in event-source mapping.
        for record in records:
            if not isinstance(record, Mapping):
                raise ValueError("Kinesis event record must be an object")
            process_kinesis_record(
                record,
                tracer=TRACER,
                operation_name="orders.process",
                callback=lambda data, correlation_id: _process_and_emit(
                    data,
                    correlation_id,
                    _sequence_number(record),
                ),
            )
    finally:
        remaining = context.get_remaining_time_in_millis()
        flush_budget = max(0, min(1_000, remaining - 100))
        if flush_budget:
            RUNTIME.force_flush(flush_budget)


def _process_and_emit(data: Any, correlation_id: str, sequence_number: str) -> None:
    try:
        _process_data(data)
        LOGGER.emit(
            RECORD_COMPLETED,
            {"messaging.message.id": sequence_number, "outcome": "success"},
            correlation_id=correlation_id,
        )
    except BaseException as exc:
        failure = classify(exc)
        RUNTIME.emitter.emit_failure(
            RECORD_FAILURES,
            failure=failure,
        )  # instrumentation: loop-allowed
        LOGGER.emit(
            RECORD_FAILED,
            {
                "messaging.message.id": sequence_number,
                "outcome": "failure",
                "failure.class": failure.value,
            },
            correlation_id=correlation_id,
            exception=exc,
        )
        raise


def _sequence_number(record: Mapping[str, Any]) -> str:
    kinesis = record.get("kinesis")
    value = kinesis.get("sequenceNumber") if isinstance(kinesis, Mapping) else None
    if not isinstance(value, str) or not value:
        raise ValueError("Kinesis event record requires sequenceNumber")
    return value


def _process_data(_data: Any) -> None:
    """Replace with the idempotent application operation for one Kinesis record."""


__all__ = ["handler"]
