"""Versioned Kinesis envelopes and per-record OTel consumer spans."""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.propagators.textmap import TextMapPropagator
from opentelemetry.trace import Link, SpanKind, Tracer

from .correlation_context import use_correlation_id
from .workflow_propagation import (
    extract_workflow_context,
    inject_workflow_context,
)

KINESIS_SCHEMA_VERSION = 1
KINESIS_MAX_RECORD_BYTES = 1_048_576
T = TypeVar("T")
R = TypeVar("R")


class KinesisContractError(ValueError):
    """Raised when a Kinesis envelope violates its transport contract."""


@dataclass(frozen=True)
class KinesisEnvelope(Generic[T]):
    schema_version: int
    propagation: dict[str, str]
    data: T


@dataclass(frozen=True)
class PreparedKinesisRecord(Generic[T]):
    correlation_id: str
    envelope: KinesisEnvelope[T]
    data: bytes


def prepare_kinesis_record(
    data: T,
    *,
    correlation_id: str | None = None,
    active_context: Context | None = None,
    propagator: TextMapPropagator | None = None,
) -> PreparedKinesisRecord[T]:
    injected = inject_workflow_context(
        correlation_id=correlation_id,
        active_context=active_context,
        propagator=propagator,
    )
    envelope = KinesisEnvelope(
        schema_version=KINESIS_SCHEMA_VERSION,
        propagation=injected.carrier,
        data=data,
    )
    try:
        serialized = json.dumps(
            {
                "schema_version": envelope.schema_version,
                "_propagation": envelope.propagation,
                "data": envelope.data,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise KinesisContractError(
            f"Kinesis envelope is not JSON serializable: {type(exc).__name__}"
        ) from None
    if len(serialized) > KINESIS_MAX_RECORD_BYTES:
        raise KinesisContractError(
            f"Serialized envelope is {len(serialized)} bytes and exceeds this "
            "adapter's 1 MiB compatibility limit"
        )
    return PreparedKinesisRecord(injected.correlation_id, envelope, serialized)


def process_kinesis_record(
    record: Mapping[str, Any],
    *,
    tracer: Tracer,
    operation_name: str,
    callback: Callable[[Any, str], R],
    propagator: TextMapPropagator | None = None,
) -> R:
    # KPL aggregation needs deaggregation first; this adapter expects non-aggregated records.
    envelope = _decode_kinesis_envelope(record)
    extracted = extract_workflow_context(
        envelope.propagation,
        propagator=propagator,
    )
    producer_context = trace.get_current_span(extracted.context).get_span_context()
    sequence_number = _sequence_number(record)
    links: Sequence[Link] = (
        (
            Link(
                producer_context,
                attributes={"messaging.message.id": sequence_number},
            ),
        )
        if producer_context.is_valid
        else ()
    )
    stream_name = _stream_name(record.get("eventSourceARN"))

    with use_correlation_id(extracted.correlation_id):
        with tracer.start_as_current_span(
            f"process {stream_name}",
            kind=SpanKind.CONSUMER,
            attributes={
                "messaging.system": "aws_kinesis",
                "messaging.destination.name": stream_name,
                "messaging.message.id": sequence_number,
                "messaging.operation.name": "process",
                "messaging.operation.type": "process",
                "operation.name": operation_name,
            },
            links=links,
            record_exception=True,
            set_status_on_exception=True,
        ):
            return callback(envelope.data, extracted.correlation_id)


def _decode_kinesis_envelope(record: Mapping[str, Any]) -> KinesisEnvelope[Any]:
    kinesis = record.get("kinesis")
    encoded = kinesis.get("data") if isinstance(kinesis, Mapping) else None
    if not isinstance(encoded, str):
        raise KinesisContractError(
            "Kinesis record data must be a base64-encoded JSON envelope"
        )
    try:
        candidate = json.loads(base64.b64decode(encoded, validate=True).decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        raise KinesisContractError(
            "Kinesis record data must be a base64-encoded JSON envelope"
        ) from None
    if not isinstance(candidate, dict):
        raise KinesisContractError("Kinesis envelope must be a JSON object")
    if candidate.get("schema_version") != KINESIS_SCHEMA_VERSION:
        raise KinesisContractError(
            f"Kinesis envelope requires schema_version {KINESIS_SCHEMA_VERSION}"
        )
    if "data" not in candidate:
        raise KinesisContractError("Kinesis envelope is missing data")
    propagation = candidate.get("_propagation")
    if not isinstance(propagation, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in propagation.items()
    ):
        raise KinesisContractError("Kinesis envelope requires a _propagation object")
    return KinesisEnvelope(
        schema_version=KINESIS_SCHEMA_VERSION,
        propagation=propagation,
        data=candidate["data"],
    )


def _sequence_number(record: Mapping[str, Any]) -> str:
    kinesis = record.get("kinesis")
    value = kinesis.get("sequenceNumber") if isinstance(kinesis, Mapping) else None
    if not isinstance(value, str) or not value:
        raise KinesisContractError("Kinesis record requires sequenceNumber")
    return value


def _stream_name(event_source_arn: object) -> str:
    if not isinstance(event_source_arn, str) or ":stream/" not in event_source_arn:
        return "unknown"
    return event_source_arn.rsplit(":stream/", 1)[-1] or "unknown"


__all__ = [
    "KINESIS_MAX_RECORD_BYTES",
    "KINESIS_SCHEMA_VERSION",
    "KinesisContractError",
    "KinesisEnvelope",
    "PreparedKinesisRecord",
    "prepare_kinesis_record",
    "process_kinesis_record",
]
