"""AWS Lambda SQS batch handler with per-record OTel correlation."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any, Protocol

from .emission_module import init_telemetry
from .failure_taxonomy import classify
from .metric_def import MetricDef
from .sqs_workflow import SqsPropagationMode, process_sqs_record
from .structured_logging import LogEventDef, StructuredLogger, parse_log_level


class LambdaContext(Protocol):
    def get_remaining_time_in_millis(self) -> int: ...


MESSAGE_FAILURES = MetricDef.failure_counter(
    "app.sqs.message.failure",
    owner="orders",
    means="SQS messages that failed application processing.",
    emit_frequency="per_event",
)
MESSAGE_COMPLETED = LogEventDef(
    "app.sqs.message.completed",
    level="INFO",
    message="SQS message processing completed",
    owner="orders",
    operation_name="orders.process",
    sampling_class="operational",
    fields={"messaging.message.id": "correlation", "outcome": "operational"},
    required=frozenset({"messaging.message.id", "outcome"}),
)
MESSAGE_FAILED = LogEventDef(
    "app.sqs.message.failed",
    level="ERROR",
    message="SQS message processing failed",
    owner="orders",
    operation_name="orders.process",
    related_metric=MESSAGE_FAILURES,
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
SQS_PROPAGATION_MODE: SqsPropagationMode = (
    "global-message-attributes"
    if os.getenv("OTEL_LAMBDA_SQS_PROPAGATION") == "global-message-attributes"
    else "aws-trace-header"
)

RUNTIME = init_telemetry(
    service_name=SERVICE_NAME,
    service_version=SERVICE_VERSION,
    environment=ENVIRONMENT,
    metric_export_interval_millis=1_000,
    registry=[MESSAGE_FAILURES],
)
TRACER = RUNTIME.tracer_provider.get_tracer(__name__)
LOGGER = StructuredLogger(
    service_name=SERVICE_NAME,
    service_version=SERVICE_VERSION,
    environment=ENVIRONMENT,
    minimum_level=parse_log_level(os.getenv("LOG_LEVEL")),
)


def handler(event: Mapping[str, Any], context: LambdaContext) -> dict[str, Any]:
    try:
        records = event.get("Records")
        if not isinstance(records, list):
            raise ValueError("SQS event Records must be a list")
        batch_item_failures: list[dict[str, str]] = []
        for record in records:
            if not isinstance(record, Mapping):
                raise ValueError("SQS event record must be an object")
            message_id = record.get("messageId")
            if not isinstance(message_id, str) or not message_id:
                raise ValueError("SQS event record requires messageId")
            try:
                process_sqs_record(
                    record,
                    tracer=TRACER,
                    operation_name="orders.process",
                    propagation_mode=SQS_PROPAGATION_MODE,
                    callback=_process_and_emit,
                )
            except BaseException:
                batch_item_failures.append({"itemIdentifier": message_id})
        return {"batchItemFailures": batch_item_failures}
    finally:
        remaining = context.get_remaining_time_in_millis()
        flush_budget = max(0, min(1_000, remaining - 100))
        if flush_budget:
            RUNTIME.force_flush(flush_budget)


def _process_and_emit(record: Mapping[str, Any], correlation_id: str) -> None:
    message_id = str(record["messageId"])
    try:
        _process_message(record)
        LOGGER.emit(
            MESSAGE_COMPLETED,
            {"messaging.message.id": message_id, "outcome": "success"},
            correlation_id=correlation_id,
        )
    except BaseException as exc:
        failure = classify(exc)
        RUNTIME.emitter.emit_failure(MESSAGE_FAILURES, failure=failure)
        LOGGER.emit(
            MESSAGE_FAILED,
            {
                "messaging.message.id": message_id,
                "outcome": "failure",
                "failure.class": failure.value,
            },
            correlation_id=correlation_id,
            exception=exc,
        )
        raise


def _process_message(_record: Mapping[str, Any]) -> None:
    """Replace with the idempotent application operation for one SQS message."""


__all__ = ["handler"]
