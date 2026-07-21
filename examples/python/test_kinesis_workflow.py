from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import NonRecordingSpan, SpanContext, SpanKind, TraceFlags
from opentelemetry.trace.propagation.tracecontext import (
    TraceContextTextMapPropagator,
)

from .correlation_context import CorrelationContractError, get_correlation_id
from .kinesis_workflow import (
    KINESIS_MAX_RECORD_BYTES,
    KinesisContractError,
    prepare_kinesis_record,
    process_kinesis_record,
)
from .workflow_propagation import inject_workflow_context

TRACE_ID = "0af7651916cd43dd8448eb211c80319c"
SPAN_ID = "b7ad6b7169203331"


@contextmanager
def tracer_with_exporter() -> Iterator[tuple[trace.Tracer, InMemorySpanExporter]]:
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    try:
        yield provider.get_tracer(__name__), exporter
    finally:
        provider.shutdown()


def kinesis_record(data: bytes) -> dict[str, Any]:
    return {
        "eventID": "shardId-000:sequence-7",
        "eventSourceARN": "arn:aws:kinesis:us-east-1:123456789012:stream/orders",
        "kinesis": {
            "data": base64.b64encode(data).decode("ascii"),
            "partitionKey": "order-7",
            "sequenceNumber": "sequence-7",
        },
    }


def test_kinesis_envelope_round_trip_links_producer_context() -> None:
    span_context = SpanContext(
        trace_id=int(TRACE_ID, 16),
        span_id=int(SPAN_ID, 16),
        is_remote=False,
        trace_flags=TraceFlags.SAMPLED,
    )
    producer_context = trace.set_span_in_context(
        NonRecordingSpan(span_context),
        Context(),
    )
    propagator = TraceContextTextMapPropagator()
    prepared = prepare_kinesis_record(
        {"order_id": "ord-7", "action": "created"},
        correlation_id="order-workflow-7",
        active_context=producer_context,
        propagator=propagator,
    )

    assert prepared.envelope.schema_version == 1
    assert prepared.envelope.propagation == {
        "correlation_id": "order-workflow-7",
        "traceparent": f"00-{TRACE_ID}-{SPAN_ID}-01",
    }
    assert prepared.envelope.data == {"order_id": "ord-7", "action": "created"}

    observed: list[tuple[object, str, str | None, str]] = []
    with tracer_with_exporter() as (tracer, exporter):
        result = process_kinesis_record(
            kinesis_record(prepared.data),
            tracer=tracer,
            operation_name="orders.process",
            propagator=propagator,
            callback=lambda data, correlation_id: observed.append(
                (
                    data,
                    correlation_id,
                    get_correlation_id(),
                    trace.format_span_id(
                        trace.get_current_span().get_span_context().span_id
                    ),
                )
            )
            or "processed",
        )
        span = exporter.get_finished_spans()[0]

    assert result == "processed"
    assert observed == [
        (
            {"order_id": "ord-7", "action": "created"},
            "order-workflow-7",
            "order-workflow-7",
            trace.format_span_id(span.context.span_id),
        )
    ]
    assert span.kind is SpanKind.CONSUMER
    assert span.parent is None
    assert trace.format_trace_id(span.links[0].context.trace_id) == TRACE_ID
    assert trace.format_span_id(span.links[0].context.span_id) == SPAN_ID
    assert span.attributes["messaging.destination.name"] == "orders"


def test_kinesis_consumer_requires_supported_schema_version() -> None:
    envelope = json.dumps(
        {"_propagation": {"correlation_id": "workflow-7"}, "data": {}},
        separators=(",", ":"),
    ).encode()
    with tracer_with_exporter() as (tracer, _exporter):
        with pytest.raises(KinesisContractError, match="requires schema_version 1"):
            process_kinesis_record(
                kinesis_record(envelope),
                tracer=tracer,
                operation_name="orders.process",
                callback=lambda _data, _correlation_id: None,
            )


def test_kinesis_consumer_requires_correlation_id() -> None:
    envelope = json.dumps(
        {"schema_version": 1, "_propagation": {}, "data": {}},
        separators=(",", ":"),
    ).encode()
    with tracer_with_exporter() as (tracer, _exporter):
        with pytest.raises(CorrelationContractError, match="missing correlation_id"):
            process_kinesis_record(
                kinesis_record(envelope),
                tracer=tracer,
                operation_name="orders.process",
                callback=lambda _data, _correlation_id: None,
            )


def test_kinesis_consumer_requires_data_field() -> None:
    envelope = json.dumps(
        {
            "schema_version": 1,
            "_propagation": {"correlation_id": "workflow-7"},
        },
        separators=(",", ":"),
    ).encode()
    with tracer_with_exporter() as (tracer, _exporter):
        with pytest.raises(KinesisContractError, match="missing data"):
            process_kinesis_record(
                kinesis_record(envelope),
                tracer=tracer,
                operation_name="orders.process",
                callback=lambda _data, _correlation_id: None,
            )


def test_kinesis_producer_rejects_envelope_above_compatibility_limit() -> None:
    with pytest.raises(KinesisContractError, match="1 MiB compatibility limit"):
        prepare_kinesis_record(
            "x" * KINESIS_MAX_RECORD_BYTES,
            correlation_id="workflow-7",
        )


def test_kinesis_producer_wraps_json_serialization_failure() -> None:
    with pytest.raises(
        KinesisContractError,
        match="Kinesis envelope is not JSON serializable: TypeError",
    ):
        prepare_kinesis_record(object(), correlation_id="workflow-7")


def test_workflow_injection_rejects_invalid_existing_correlation_id() -> None:
    with pytest.raises(CorrelationContractError, match="invalid characters"):
        inject_workflow_context(carrier={"correlation_id": ""})


def test_kinesis_lambda_handler_retries_batch_and_flushes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from . import kinesis_lambda_handler

    processed: list[str] = []
    emitted_failures: list[str] = []
    emitted_logs: list[tuple[str, str | None]] = []
    flush_budgets: list[int] = []

    class FakeEmitter:
        def emit_failure(self, _metric: object, *, failure: object) -> None:
            emitted_failures.append(str(failure))

    class FakeRuntime:
        emitter = FakeEmitter()

        def force_flush(self, timeout_millis: int) -> bool:
            flush_budgets.append(timeout_millis)
            return True

    class FakeLogger:
        def emit(
            self,
            event: object,
            _fields: object,
            *,
            correlation_id: str | None = None,
            exception: BaseException | None = None,
        ) -> bool:
            emitted_logs.append((getattr(event, "name"), correlation_id))
            return exception is None

    class FakeContext:
        def get_remaining_time_in_millis(self) -> int:
            return 750

    def process_data(data: dict[str, str]) -> None:
        processed.append(data["order_id"])
        if data["order_id"] == "ord-2":
            raise TypeError("undefined order")

    records = [
        kinesis_record(
            prepare_kinesis_record(
                {"order_id": order_id},
                correlation_id=f"workflow-{index}",
            ).data
        )
        for index, order_id in enumerate(("ord-1", "ord-2", "ord-3"), start=1)
    ]
    for index, record in enumerate(records, start=1):
        record["kinesis"]["sequenceNumber"] = f"sequence-{index}"

    monkeypatch.setattr(kinesis_lambda_handler, "RUNTIME", FakeRuntime())
    monkeypatch.setattr(kinesis_lambda_handler, "LOGGER", FakeLogger())
    monkeypatch.setattr(kinesis_lambda_handler, "_process_data", process_data)
    with tracer_with_exporter() as (tracer, _exporter):
        monkeypatch.setattr(kinesis_lambda_handler, "TRACER", tracer)
        with pytest.raises(TypeError, match="undefined order"):
            kinesis_lambda_handler.handler({"Records": records}, FakeContext())

    assert processed == ["ord-1", "ord-2"]
    assert emitted_failures == ["internal_error"]
    assert emitted_logs == [
        ("app.kinesis.record.completed", "workflow-1"),
        ("app.kinesis.record.failed", "workflow-2"),
    ]
    assert flush_budgets == [650]
