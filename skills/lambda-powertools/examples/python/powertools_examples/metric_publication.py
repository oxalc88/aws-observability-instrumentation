"""One synchronous, best-effort EMF owner; no competing telemetry framework."""
from collections.abc import Mapping, Sequence

from aws_lambda_powertools.metrics import EphemeralMetrics, MetricUnit

Measurement = tuple[str, MetricUnit, float]


def publish_measurements(
    metrics: EphemeralMetrics,
    measurements: Sequence[Measurement],
    dimensions: Mapping[str, str] | None = None,
) -> None:
    try:
        # Python clear_metrics resets metrics, dimensions AND metadata together.
        # If reset fails, skip publication rather than leak stale diagnostic data.
        metrics.clear_metrics()
        if not measurements:
            return
        for name, value in (dimensions or {}).items():
            metrics.add_dimension(name=name, value=value)
        for name, unit, value in measurements:
            metrics.add_metric(name=name, unit=unit, value=value)
        metrics.flush_metrics()
    except Exception:
        # Required best-effort coverage; deployment checks detect sustained loss.
        pass
    finally:
        try:
            metrics.clear_metrics()
        except Exception:
            pass
