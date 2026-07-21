"""SQS workflow correlation and per-record OpenTelemetry consumer spans."""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

from opentelemetry import propagate, trace
from opentelemetry.context import Context
from opentelemetry.propagators.aws import AwsXRayPropagator
from opentelemetry.propagators.textmap import Getter
from opentelemetry.trace import Link, SpanKind, Tracer

from .correlation_context import (
    CorrelationContractError,
    resolve_correlation_id,
    use_correlation_id,
    validate_correlation_id,
)

SQS_CORRELATION_ATTRIBUTE = "correlation_id"
SQS_MAX_MESSAGE_ATTRIBUTES = 10
SqsPropagationMode = Literal["aws-trace-header", "global-message-attributes"]
SqsMessageAttribute = Mapping[str, Any]
T = TypeVar("T")


@dataclass(frozen=True)
class PreparedSqsMessageAttributes:
    correlation_id: str
    message_attributes: dict[str, dict[str, Any]]


def prepare_sqs_message_attributes(
    *,
    correlation_id: str | None = None,
    message_attributes: Mapping[str, SqsMessageAttribute] | None = None,
    propagation_fields: Collection[str] | None = None,
) -> PreparedSqsMessageAttributes:
    prepared = {key: dict(value) for key, value in (message_attributes or {}).items()}
    existing = _read_string_attribute(prepared.get(SQS_CORRELATION_ATTRIBUTE))
    if (
        existing is not None
        and correlation_id is not None
        and existing != correlation_id
    ):
        raise CorrelationContractError(
            "Refusing to overwrite an existing correlation_id"
        )
    candidate = existing if existing is not None else correlation_id
    resolved = resolve_correlation_id(candidate)
    prepared[SQS_CORRELATION_ATTRIBUTE] = {
        "DataType": "String",
        "StringValue": resolved,
    }

    fields = (
        set(propagation_fields)
        if propagation_fields is not None
        else set(propagate.get_global_textmap().fields)
    )
    eventual_attribute_names = set(prepared) | fields
    if len(eventual_attribute_names) > SQS_MAX_MESSAGE_ATTRIBUTES:
        raise CorrelationContractError(
            "SQS message attributes exceed the ten-message-attribute limit "
            "after OTel propagation"
        )
    return PreparedSqsMessageAttributes(resolved, prepared)


def require_sqs_correlation_id(record: Mapping[str, Any]) -> str:
    message_attributes = record.get("messageAttributes")
    if not isinstance(message_attributes, Mapping):
        raise CorrelationContractError("SQS message is missing correlation_id")
    value = _read_string_attribute(message_attributes.get(SQS_CORRELATION_ATTRIBUTE))
    if value is None:
        raise CorrelationContractError("SQS message is missing correlation_id")
    return validate_correlation_id(value)


def process_sqs_record(
    record: Mapping[str, Any],
    *,
    tracer: Tracer,
    operation_name: str,
    callback: Callable[[Mapping[str, Any], str], T],
    propagation_mode: SqsPropagationMode = "aws-trace-header",
) -> T:
    correlation_id = require_sqs_correlation_id(record)
    message_id = _required_string(record, "messageId")
    producer_context = _extract_producer_span_context(record, propagation_mode)
    links: Sequence[Link] = (
        ()
        if producer_context is None
        else (
            Link(
                producer_context,
                attributes={"messaging.message.id": message_id},
            ),
        )
    )
    queue_name = _queue_name(record.get("eventSourceARN"))

    with use_correlation_id(correlation_id):
        with tracer.start_as_current_span(
            f"process {queue_name}",
            kind=SpanKind.CONSUMER,
            attributes={
                "messaging.system": "aws_sqs",
                "messaging.destination.name": queue_name,
                "messaging.message.id": message_id,
                "messaging.operation.name": "process",
                "messaging.operation.type": "process",
                "operation.name": operation_name,
            },
            links=links,
            record_exception=True,
            set_status_on_exception=True,
        ):
            return callback(record, correlation_id)


def _extract_producer_span_context(
    record: Mapping[str, Any],
    propagation_mode: SqsPropagationMode,
) -> trace.SpanContext | None:
    if propagation_mode == "global-message-attributes":
        message_attributes = record.get("messageAttributes")
        carrier = message_attributes if isinstance(message_attributes, Mapping) else {}
        extracted = propagate.extract(
            carrier,
            context=Context(),
            getter=_SQS_MESSAGE_ATTRIBUTE_GETTER,
        )
    else:
        attributes = record.get("attributes")
        trace_header = (
            attributes.get("AWSTraceHeader")
            if isinstance(attributes, Mapping)
            else None
        )
        if not isinstance(trace_header, str):
            return None
        extracted = AwsXRayPropagator().extract(
            {"X-Amzn-Trace-Id": trace_header},
            context=Context(),
        )
    span_context = trace.get_current_span(extracted).get_span_context()
    return span_context if span_context.is_valid else None


class _SqsMessageAttributeGetter(Getter[Mapping[str, SqsMessageAttribute]]):
    def get(
        self,
        carrier: Mapping[str, SqsMessageAttribute],
        key: str,
    ) -> list[str] | None:
        value = _read_string_attribute(carrier.get(key))
        return None if value is None else [value]

    def keys(self, carrier: Mapping[str, SqsMessageAttribute]) -> list[str]:
        return list(carrier)


_SQS_MESSAGE_ATTRIBUTE_GETTER = _SqsMessageAttributeGetter()


def _read_string_attribute(attribute: object) -> str | None:
    if not isinstance(attribute, Mapping):
        return None
    data_type = attribute.get("DataType", attribute.get("dataType"))
    if data_type is not None and (
        not isinstance(data_type, str) or not data_type.startswith("String")
    ):
        raise CorrelationContractError(
            "SQS correlation and propagation attributes must be a String"
        )
    for key in ("StringValue", "stringValue", "Value", "value"):
        value = attribute.get(key)
        if isinstance(value, str):
            return value
    return None


def _required_string(record: Mapping[str, Any], key: str) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value:
        raise CorrelationContractError(f"SQS record is missing {key}")
    return value


def _queue_name(event_source_arn: object) -> str:
    if not isinstance(event_source_arn, str):
        return "unknown"
    queue_name = event_source_arn.rsplit(":", 1)[-1]
    return queue_name or "unknown"


__all__ = [
    "CorrelationContractError",
    "PreparedSqsMessageAttributes",
    "SQS_CORRELATION_ATTRIBUTE",
    "SqsPropagationMode",
    "prepare_sqs_message_attributes",
    "process_sqs_record",
    "require_sqs_correlation_id",
]
