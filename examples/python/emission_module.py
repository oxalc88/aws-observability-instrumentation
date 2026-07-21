"""OpenTelemetry provider setup and governed metric emission.

Applications normally export to a local agent or collector. That process owns
CloudWatch endpoints and authentication; this module remains backend-neutral.
"""

from __future__ import annotations

import contextlib
import os
import time
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from typing import Any

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.metrics.view import ExplicitBucketHistogramAggregation, View
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

from .failure_taxonomy import FailureClass
from .metric_def import MetricDef

AttributeValue = str | bool | int | float | tuple[str, ...]


class InstrumentationContractError(ValueError):
    """Raised when an emission violates its MetricDef."""


def _signal_endpoint(base: str, signal: str) -> str:
    clean = base.rstrip("/")
    suffix = f"/v1/{signal}"
    return clean if clean.endswith(suffix) else clean + suffix


@dataclass
class TelemetryRuntime:
    """Providers whose lifecycle is owned by the application process."""

    meter_provider: MeterProvider
    tracer_provider: TracerProvider
    emitter: MetricEmitter

    def force_flush(self, timeout_millis: int = 1_000) -> bool:
        try:
            metrics_ok = self.meter_provider.force_flush(timeout_millis)
            traces_ok = self.tracer_provider.force_flush(timeout_millis)
            return bool(metrics_ok and traces_ok)
        except Exception:
            return False

    def shutdown(self) -> None:
        self.meter_provider.shutdown()
        self.tracer_provider.shutdown()


def init_telemetry(
    *,
    service_name: str,
    service_version: str,
    environment: str,
    otlp_endpoint: str | None = None,
    metric_export_interval_millis: int = 60_000,
    trace_sample_ratio: float = 0.05,
    registry: list[MetricDef] | None = None,
    set_global: bool = True,
) -> TelemetryRuntime:
    """Build OTel providers that export OTLP/HTTP to an agent or collector."""

    if not 0.0 <= trace_sample_ratio <= 1.0:
        raise ValueError("trace_sample_ratio must be between 0 and 1")
    base = otlp_endpoint or os.getenv(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318"
    )
    resource = Resource.create(
        {
            "service.name": service_name,
            "service.version": service_version,
            "deployment.environment.name": environment,
        }
    )

    metric_exporter = OTLPMetricExporter(
        endpoint=os.getenv(
            "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
            _signal_endpoint(base, "metrics"),
        )
    )
    metric_reader = PeriodicExportingMetricReader(
        metric_exporter,
        export_interval_millis=metric_export_interval_millis,
    )
    views = [
        View(
            instrument_name=item.name,
            aggregation=ExplicitBucketHistogramAggregation(
                boundaries=list(item.histogram_boundaries)
            ),
        )
        for item in registry or []
        if item.kind == "histogram"
    ]
    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[metric_reader],
        views=views,
    )

    trace_exporter = OTLPSpanExporter(
        endpoint=os.getenv(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            _signal_endpoint(base, "traces"),
        )
    )
    tracer_provider = TracerProvider(
        resource=resource,
        sampler=ParentBased(TraceIdRatioBased(trace_sample_ratio)),
    )
    tracer_provider.add_span_processor(BatchSpanProcessor(trace_exporter))

    if set_global:
        metrics.set_meter_provider(meter_provider)
        trace.set_tracer_provider(tracer_provider)

    meter = meter_provider.get_meter(service_name, service_version)
    return TelemetryRuntime(
        meter_provider=meter_provider,
        tracer_provider=tracer_provider,
        emitter=MetricEmitter(meter),
    )


_BUCKET_REGISTRY: dict[str, Callable[..., str]] = {}


def register_bucket(name: str, fn: Callable[..., str]) -> None:
    _BUCKET_REGISTRY[name] = fn


def _validate_attributes(
    metric: MetricDef,
    attributes: Mapping[str, AttributeValue] | None,
) -> dict[str, AttributeValue]:
    values = dict(attributes or {})
    unknown = set(values) - metric.allowed_attributes
    if unknown:
        raise InstrumentationContractError(
            f"metric {metric.name!r} has undeclared attributes: {sorted(unknown)}"
        )
    missing = metric.required_attributes - set(values)
    if missing:
        raise InstrumentationContractError(
            f"metric {metric.name!r} is missing required attributes: {sorted(missing)}"
        )
    for key, value in values.items():
        constraint = metric.attribute_constraints[key]
        if isinstance(constraint, frozenset) and value not in constraint:
            raise InstrumentationContractError(
                f"metric {metric.name!r}: {key}={value!r} is outside its closed set"
            )
        if isinstance(constraint, str) and constraint not in _BUCKET_REGISTRY:
            raise InstrumentationContractError(
                f"metric {metric.name!r}: unknown bucket {constraint!r} for {key!r}"
            )
    return values


class MetricEmitter:
    """Create each OTel instrument once and validate every data point."""

    def __init__(self, meter: metrics.Meter) -> None:
        self._meter = meter
        self._instruments: dict[str, Any] = {}

    def _instrument(self, metric: MetricDef) -> Any:
        existing = self._instruments.get(metric.name)
        if existing is not None:
            return existing
        if metric.deprecated:
            raise InstrumentationContractError(
                f"metric {metric.name!r} is deprecated; use {metric.replaced_by!r}"
            )
        if metric.kind == "counter":
            instrument = self._meter.create_counter(
                metric.name, unit=metric.unit, description=metric.description
            )
        elif metric.kind == "histogram":
            instrument = self._meter.create_histogram(
                metric.name, unit=metric.unit, description=metric.description
            )
        elif metric.kind == "gauge":
            instrument = self._meter.create_gauge(
                metric.name, unit=metric.unit, description=metric.description
            )
        else:
            raise InstrumentationContractError(f"unsupported kind: {metric.kind!r}")
        self._instruments[metric.name] = instrument
        return instrument

    def emit_counter(
        self,
        metric: MetricDef,
        *,
        value: int | float = 1,
        attributes: Mapping[str, AttributeValue] | None = None,
    ) -> None:
        if metric.kind != "counter":
            raise InstrumentationContractError("emit_counter requires a counter")
        if value < 0:
            raise InstrumentationContractError("monotonic counters cannot decrease")
        self._instrument(metric).add(
            value, attributes=_validate_attributes(metric, attributes)
        )

    def emit_gauge(
        self,
        metric: MetricDef,
        *,
        value: int | float,
        attributes: Mapping[str, AttributeValue] | None = None,
    ) -> None:
        if metric.kind != "gauge":
            raise InstrumentationContractError("emit_gauge requires a gauge")
        self._instrument(metric).set(
            value, attributes=_validate_attributes(metric, attributes)
        )

    def emit_histogram(
        self,
        metric: MetricDef,
        *,
        value: int | float,
        attributes: Mapping[str, AttributeValue] | None = None,
    ) -> None:
        if metric.kind != "histogram":
            raise InstrumentationContractError("emit_histogram requires a histogram")
        self._instrument(metric).record(
            value, attributes=_validate_attributes(metric, attributes)
        )

    def emit_latency(
        self,
        metric: MetricDef,
        *,
        duration_seconds: float,
        attributes: Mapping[str, AttributeValue] | None = None,
    ) -> None:
        if metric.kind != "histogram" or metric.unit != "s":
            raise InstrumentationContractError(
                "emit_latency requires a seconds-based histogram"
            )
        if duration_seconds < 0:
            raise InstrumentationContractError("duration cannot be negative")
        self.emit_histogram(
            metric, value=duration_seconds, attributes=attributes
        )

    def emit_failure(
        self,
        metric: MetricDef,
        *,
        failure: FailureClass,
        attributes: Mapping[str, AttributeValue] | None = None,
    ) -> None:
        values: dict[str, AttributeValue] = {"failure.class": failure.value}
        values.update(attributes or {})
        self.emit_counter(metric, attributes=values)

    @contextlib.contextmanager
    def time_latency(
        self,
        metric: MetricDef,
        *,
        attributes: Mapping[str, AttributeValue] | None = None,
    ) -> Iterator[None]:
        started = time.monotonic()
        try:
            yield
        finally:
            self.emit_latency(
                metric,
                duration_seconds=time.monotonic() - started,
                attributes=attributes,
            )


class AggregatingCounter:
    """Accumulate values in a loop and emit one counter data point."""

    def __init__(
        self,
        emitter: MetricEmitter,
        metric: MetricDef,
        *,
        attributes: Mapping[str, AttributeValue] | None = None,
    ) -> None:
        self.emitter = emitter
        self.metric = metric
        self.attributes = dict(attributes or {})
        self.total = 0.0

    def add(self, value: float = 1.0) -> None:
        self.total += value

    def __enter__(self) -> AggregatingCounter:
        return self

    def __exit__(self, *exc_info: object) -> None:
        if self.total:
            self.emitter.emit_counter(
                self.metric, value=self.total, attributes=self.attributes
            )


__all__ = [
    "AggregatingCounter",
    "AttributeValue",
    "InstrumentationContractError",
    "MetricEmitter",
    "TelemetryRuntime",
    "init_telemetry",
    "register_bucket",
]
