from __future__ import annotations

from datetime import UTC, datetime

import pytest
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from .emission_module import InstrumentationContractError, MetricEmitter
from .failure_taxonomy import FailureClass, classify
from .metric_def import MetricDef
from .structured_logging import (
    LogEventDef,
    LogSamplingRule,
    LoggingContractError,
    StructuredLogger,
)


def emitter_with_reader() -> tuple[MetricEmitter, InMemoryMetricReader]:
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    return MetricEmitter(provider.get_meter("test")), reader


def test_counter_reuses_instrument_and_records_closed_attributes() -> None:
    emitter, reader = emitter_with_reader()
    metric = MetricDef.counter(
        "app.request",
        purpose="outcome",
        unit="{request}",
        owner="platform",
        means="Completed requests.",
        attributes={"outcome": frozenset({"success", "failure"})},
        required=frozenset({"outcome"}),
    )

    emitter.emit_counter(metric, attributes={"outcome": "success"})
    emitter.emit_counter(metric, value=2, attributes={"outcome": "failure"})

    data = reader.get_metrics_data()
    assert data is not None
    points = data.resource_metrics[0].scope_metrics[0].metrics[0].data.data_points
    assert sum(point.value for point in points) == 3


def test_counter_rejects_unknown_or_unbounded_attributes() -> None:
    emitter, _ = emitter_with_reader()
    metric = MetricDef.counter(
        "app.request",
        purpose="outcome",
        owner="platform",
        means="Completed requests.",
        attributes={"outcome": frozenset({"success", "failure"})},
        required=frozenset({"outcome"}),
    )
    with pytest.raises(InstrumentationContractError, match="undeclared"):
        emitter.emit_counter(metric, attributes={"outcome": "success", "user.id": "42"})
    with pytest.raises(InstrumentationContractError, match="outside its closed set"):
        emitter.emit_counter(metric, attributes={"outcome": "other"})


def test_failure_counter_requires_closed_failure_class() -> None:
    emitter, reader = emitter_with_reader()
    metric = MetricDef.failure_counter(
        "app.failure",
        owner="platform",
        means="Operations that failed.",
    )
    emitter.emit_failure(metric, failure=FailureClass.TIMEOUT)
    assert reader.get_metrics_data() is not None


def test_type_defects_are_internal_failures() -> None:
    assert classify(TypeError("object is not subscriptable")) is FailureClass.INTERNAL_ERROR


def test_latency_is_seconds_histogram() -> None:
    emitter, reader = emitter_with_reader()
    metric = MetricDef.latency(
        "app.operation.duration",
        owner="platform",
        means="Elapsed operation time.",
    )
    emitter.emit_latency(metric, duration_seconds=0.25)
    data = reader.get_metrics_data()
    assert data is not None
    point = data.resource_metrics[0].scope_metrics[0].metrics[0].data.data_points[0]
    assert point.sum == pytest.approx(0.25)


def test_gauge_records_current_value() -> None:
    emitter, reader = emitter_with_reader()
    metric = MetricDef.gauge(
        "app.queue.depth",
        unit="{item}",
        owner="workers",
        means="Current number of queued items.",
    )
    emitter.emit_gauge(metric, value=7)
    data = reader.get_metrics_data()
    assert data is not None
    point = data.resource_metrics[0].scope_metrics[0].metrics[0].data.data_points[0]
    assert point.value == 7


def test_metric_definition_rejects_invalid_boundaries() -> None:
    with pytest.raises(ValueError, match="ascending"):
        MetricDef.latency(
            "app.bad.duration",
            owner="platform",
            means="Invalid histogram.",
            boundaries_seconds=(1.0, 0.5),
        )


def test_structured_logger_emits_declared_fields_and_rejects_sensitive_data() -> None:
    with pytest.raises(ValueError, match="classification"):
        LogEventDef(
            "app.order.invalid",
            level="INFO",
            message="Invalid event schema",
            owner="orders",
            fields={"outcome": "unclassified"},  # type: ignore[dict-item]
        )

    for field_name in ("session.id", "error.message"):
        with pytest.raises(ValueError, match="forbidden log field"):
            LogEventDef(
                "app.order.failed",
                level="ERROR",
                message="Order failed",
                owner="orders",
                fields={field_name: "sensitive"},
            )

    with pytest.raises(ValueError, match="managed log field"):
        LogEventDef(
            "app.order.invalid",
            level="ERROR",
            message="Invalid event schema",
            owner="orders",
            fields={"service.name": "operational"},
        )

    records: list[dict[str, object]] = []
    event = LogEventDef(
        "app.order.completed",
        level="INFO",
        message="Order completed",
        owner="orders",
        fields={"outcome": "operational", "customer.email": "sensitive"},
        required=frozenset({"outcome"}),
    )
    logger = StructuredLogger(
        service_name="orders-api",
        service_version="1.2.3",
        environment="test",
        sink=lambda record: records.append(dict(record)),
        now=lambda: datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
    )

    assert logger.emit(event, {"outcome": "success"})
    assert records[0]["timestamp"] == "2026-01-02T03:04:05.000Z"
    assert records[0]["event.name"] == "app.order.completed"
    assert records[0]["service.name"] == "orders-api"
    with pytest.raises(LoggingContractError, match="sensitive"):
        logger.emit(event, {"outcome": "success", "customer.email": "person@example.com"})


def test_structured_logger_samples_one_workflow_deterministically() -> None:
    records: list[dict[str, object]] = []
    event = LogEventDef(
        "app.order.diagnostic",
        level="INFO",
        message="Order diagnostic recorded",
        owner="orders",
        sampling_class="diagnostic",
    )
    logger = StructuredLogger(
        service_name="orders-api",
        environment="production",
        sampling_rules=(
            LogSamplingRule(
                id="diagnostic-info",
                levels=frozenset({"INFO"}),
                sampling_classes=frozenset({"diagnostic"}),
                rate=0.1,
            ),
        ),
        sink=lambda record: records.append(dict(record)),
    )

    decisions: set[bool] = set()
    for index in range(100):
        correlation_id = f"workflow-{index}"
        first = logger.emit(event, correlation_id=correlation_id)
        second = logger.emit(event, correlation_id=correlation_id)
        assert second is first
        decisions.add(first)

    assert decisions == {False, True}
    assert 0 < len(records) < 200
    assert records[0]["sampling.policy"] == "diagnostic-info"
    assert records[0]["sampling.rate"] == 0.1


def test_structured_logger_never_samples_errors_or_security_events() -> None:
    records: list[dict[str, object]] = []
    error_event = LogEventDef(
        "app.sqs.message.failed",
        level="ERROR",
        message="SQS message processing failed",
        owner="orders",
    )
    security_event = LogEventDef(
        "app.auth.access.denied",
        level="INFO",
        message="Access denied",
        owner="identity",
        security_relevant=True,
    )
    info_event = LogEventDef(
        "app.sqs.message.completed",
        level="INFO",
        message="SQS message processing completed",
        owner="orders",
    )
    logger = StructuredLogger(
        service_name="orders-worker",
        environment="production",
        sampling_rules=(LogSamplingRule(id="drop-everything", rate=0),),
        sink=lambda record: records.append(dict(record)),
    )

    assert logger.emit(error_event, correlation_id="workflow-1")
    assert logger.emit(security_event, correlation_id="workflow-1")
    assert not logger.emit(info_event, correlation_id="workflow-1")
    assert [(record["sampling.policy"], record["sampling.rate"]) for record in records] == [
        ("mandatory.error", 1),
        ("mandatory.security", 1),
    ]

    with pytest.raises(LoggingContractError, match="must be locked"):
        LogSamplingRule(id="errors", levels=frozenset({"ERROR"}), rate=1)
    with pytest.raises(LoggingContractError, match="must be locked"):
        LogSamplingRule(id="security", security_relevant=True, rate=1)


def test_structured_logger_links_failure_to_metric_trace_fields_and_source() -> None:
    records: list[dict[str, object]] = []
    metric = MetricDef.failure_counter(
        "app.order.failure",
        owner="orders",
        means="Orders that terminated with an application exception.",
    )
    event = LogEventDef(
        "app.order.failed",
        level="ERROR",
        message="Order failed",
        owner="orders",
        operation_name="orders.create",
        related_metric=metric,
        fields={"failure.class": "operational"},
        required=frozenset({"failure.class"}),
    )
    logger = StructuredLogger(
        service_name="orders-api",
        service_version="1.2.3",
        environment="production",
        sink=lambda record: records.append(dict(record)),
    )

    try:
        {}["missing"]
    except KeyError as error:
        logger.emit(event, {"failure.class": "internal_error"}, exception=error)

    assert records[0]["operation.name"] == "orders.create"
    assert records[0]["metric.name"] == "app.order.failure"
    assert records[0]["exception.type"] == "KeyError"
    assert str(records[0]["code.file.path"]).endswith("test_instrumentation.py")
    assert records[0]["code.function.name"] == (
        "test_structured_logger_links_failure_to_metric_trace_fields_and_source"
    )
    assert isinstance(records[0]["code.line.number"], int)
    assert "exception.message" not in records[0]
    assert "exception.stacktrace" not in records[0]


def test_structured_logger_neutralizes_injection_and_contains_sink_failure() -> None:
    records: list[dict[str, object]] = []
    event = LogEventDef(
        "app.auth.validation.failed",
        level="INFO",
        message="Authentication validation failed",
        owner="security",
        fields={"reason": "operational"},
        required=frozenset({"reason"}),
        security_relevant=True,
    )
    logger = StructuredLogger(
        service_name="identity-api",
        environment="test",
        minimum_level="ERROR",
        sink=lambda record: records.append(dict(record)),
    )
    assert logger.emit(event, {"reason": "invalid\nforged"})
    assert records[0]["reason"] == "invalid\\u000aforged"
    assert records[0]["security.relevant"] is True

    failing_logger = StructuredLogger(
        service_name="identity-api",
        environment="test",
        sink=lambda _record: (_ for _ in ()).throw(OSError("unavailable")),
        on_sink_error=lambda _error: (_ for _ in ()).throw(
            RuntimeError("fallback unavailable")
        ),
    )
    assert not failing_logger.emit(event, {"reason": "invalid"})
