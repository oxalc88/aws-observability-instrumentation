from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from uuid import UUID

import pytest
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags

from .correlation_context import (
    CorrelationContractError,
    get_correlation_id,
    resolve_correlation_id,
    use_correlation_id,
)
from .sqs_workflow import (
    prepare_sqs_message_attributes,
    process_sqs_record,
    require_sqs_correlation_id,
)

TRACE_ID_A = "5759e988bd862e3fe1be46a994272793"
SPAN_ID_A = "53995c3f42cd8ad8"
TRACE_ID_B = "6759e988bd862e3fe1be46a994272794"
SPAN_ID_B = "63995c3f42cd8ad9"


def sqs_record(
    *,
    message_id: str = "message-1",
    correlation_id: str = "order-workflow-7",
    trace_id: str = TRACE_ID_A,
    span_id: str = SPAN_ID_A,
) -> dict[str, Any]:
    return {
        "messageId": message_id,
        "eventSourceARN": "arn:aws:sqs:us-east-1:123456789012:orders",
        "attributes": {
            "AWSTraceHeader": (
                f"Root=1-{trace_id[:8]}-{trace_id[8:]};"
                f"Parent={span_id};Sampled=1"
            )
        },
        "messageAttributes": {
            "correlation_id": {
                "dataType": "String",
                "stringValue": correlation_id,
            }
        },
    }


@contextmanager
def tracer_with_exporter() -> Iterator[tuple[trace.Tracer, InMemorySpanExporter]]:
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    try:
        yield provider.get_tracer(__name__), exporter
    finally:
        provider.shutdown()


def test_correlation_context_uses_explicit_active_trace_then_uuid() -> None:
    assert resolve_correlation_id("explicit-workflow") == "explicit-workflow"
    with use_correlation_id("active-workflow"):
        assert get_correlation_id() == "active-workflow"
        assert resolve_correlation_id() == "active-workflow"

    span_context = SpanContext(
        trace_id=int("0af7651916cd43dd8448eb211c80319c", 16),
        span_id=int("b7ad6b7169203331", 16),
        is_remote=False,
        trace_flags=TraceFlags.SAMPLED,
    )
    with trace.use_span(NonRecordingSpan(span_context)):
        assert resolve_correlation_id() == "0af7651916cd43dd8448eb211c80319c"
    UUID(resolve_correlation_id())


def test_prepare_sqs_attributes_rejects_conflicts_and_reserves_otel_slots() -> None:
    prepared = prepare_sqs_message_attributes(
        correlation_id="order-workflow-7",
        message_attributes={
            f"attribute_{index}": {"DataType": "String", "StringValue": "value"}
            for index in range(5)
        },
        propagation_fields={"traceparent", "tracestate", "baggage", "x-amzn-trace-id"},
    )
    assert len(prepared.message_attributes) == 6
    assert prepared.message_attributes["correlation_id"] == {
        "DataType": "String",
        "StringValue": "order-workflow-7",
    }

    with pytest.raises(CorrelationContractError, match="ten-message-attribute limit"):
        prepare_sqs_message_attributes(
            correlation_id="order-workflow-7",
            message_attributes={
                f"attribute_{index}": {"DataType": "String", "StringValue": "value"}
                for index in range(6)
            },
            propagation_fields={
                "traceparent",
                "tracestate",
                "baggage",
                "x-amzn-trace-id",
            },
        )

    without_propagation = prepare_sqs_message_attributes(
        correlation_id="order-workflow-7",
        message_attributes={
            f"attribute_{index}": {"DataType": "String", "StringValue": "value"}
            for index in range(9)
        },
        propagation_fields=set(),
    )
    assert len(without_propagation.message_attributes) == 10

    with pytest.raises(CorrelationContractError, match="Refusing to overwrite"):
        prepare_sqs_message_attributes(
            correlation_id="workflow-new",
            message_attributes={
                "correlation_id": {
                    "DataType": "String",
                    "StringValue": "workflow-original",
                }
            },
            propagation_fields=set(),
        )


def test_require_sqs_correlation_id_rejects_missing_invalid_and_non_string() -> None:
    assert require_sqs_correlation_id(sqs_record()) == "order-workflow-7"
    with pytest.raises(CorrelationContractError, match="missing correlation_id"):
        require_sqs_correlation_id({"messageAttributes": {}})
    with pytest.raises(CorrelationContractError, match="invalid characters"):
        require_sqs_correlation_id(sqs_record(correlation_id="invalid value"))
    record = sqs_record()
    record["messageAttributes"]["correlation_id"]["dataType"] = "Binary"
    with pytest.raises(CorrelationContractError, match="must be a String"):
        require_sqs_correlation_id(record)


def test_process_sqs_record_links_valid_xray_context_without_false_parent() -> None:
    observed: list[tuple[str | None, str, str]] = []
    with tracer_with_exporter() as (tracer, exporter):
        for record in (
            sqs_record(),
            sqs_record(
                message_id="message-2",
                correlation_id="order-workflow-8",
                trace_id=TRACE_ID_B,
                span_id=SPAN_ID_B,
            ),
        ):
            process_sqs_record(
                record,
                tracer=tracer,
                operation_name="orders.process",
                callback=lambda _record, correlation_id: observed.append(
                    (
                        get_correlation_id(),
                        correlation_id,
                        trace.format_span_id(
                            trace.get_current_span().get_span_context().span_id
                        ),
                    )
                ),
            )

        spans = exporter.get_finished_spans()

    assert [(active, argument) for active, argument, _span_id in observed] == [
        ("order-workflow-7", "order-workflow-7"),
        ("order-workflow-8", "order-workflow-8"),
    ]
    assert len(spans) == 2
    assert [span.parent for span in spans] == [None, None]
    assert [
        (
            trace.format_trace_id(span.links[0].context.trace_id),
            trace.format_span_id(span.links[0].context.span_id),
        )
        for span in spans
    ] == [(TRACE_ID_A, SPAN_ID_A), (TRACE_ID_B, SPAN_ID_B)]
    assert all(span.kind is trace.SpanKind.CONSUMER for span in spans)


def test_process_sqs_record_ignores_invalid_xray_header() -> None:
    record = sqs_record()
    record["attributes"]["AWSTraceHeader"] = "Root=invalid;Parent=invalid;Sampled=1"
    with tracer_with_exporter() as (tracer, exporter):
        assert (
            process_sqs_record(
                record,
                tracer=tracer,
                operation_name="orders.process",
                callback=lambda _record, _correlation_id: "processed",
            )
            == "processed"
        )
        span = exporter.get_finished_spans()[0]
    assert span.links == ()


def test_process_sqs_record_extracts_w3c_message_attributes() -> None:
    record = sqs_record()
    record["messageAttributes"]["traceparent"] = {
        "dataType": "String",
        "stringValue": f"00-{TRACE_ID_A}-{SPAN_ID_A}-01",
    }
    with tracer_with_exporter() as (tracer, exporter):
        process_sqs_record(
            record,
            tracer=tracer,
            operation_name="orders.process",
            propagation_mode="global-message-attributes",
            callback=lambda _record, _correlation_id: None,
        )
        link = exporter.get_finished_spans()[0].links[0]
    assert trace.format_trace_id(link.context.trace_id) == TRACE_ID_A
    assert trace.format_span_id(link.context.span_id) == SPAN_ID_A


def test_sqs_lambda_handler_returns_only_failed_item_identifiers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from . import sqs_lambda_handler

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

    def process_message(record: dict[str, Any]) -> None:
        if record["messageId"] == "message-2":
            raise TypeError("undefined order")

    monkeypatch.setattr(sqs_lambda_handler, "RUNTIME", FakeRuntime())
    monkeypatch.setattr(sqs_lambda_handler, "LOGGER", FakeLogger())
    monkeypatch.setattr(sqs_lambda_handler, "_process_message", process_message)

    with tracer_with_exporter() as (tracer, _exporter):
        monkeypatch.setattr(sqs_lambda_handler, "TRACER", tracer)
        response = sqs_lambda_handler.handler(
            {
                "Records": [
                    sqs_record(),
                    sqs_record(
                        message_id="message-2",
                        correlation_id="order-workflow-8",
                        trace_id=TRACE_ID_B,
                        span_id=SPAN_ID_B,
                    ),
                ]
            },
            FakeContext(),
        )

    assert response == {"batchItemFailures": [{"itemIdentifier": "message-2"}]}
    assert emitted_failures == ["internal_error"]
    assert emitted_logs == [
        ("app.sqs.message.completed", "order-workflow-7"),
        ("app.sqs.message.failed", "order-workflow-8"),
    ]
    assert flush_budgets == [650]
