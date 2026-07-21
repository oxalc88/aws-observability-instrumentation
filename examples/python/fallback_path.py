"""Single helper for governed fallback-path metrics."""

from __future__ import annotations

from .emission_module import MetricEmitter
from .metric_def import MetricDef

FALLBACK_REASONS = frozenset(
    {"primary_empty", "dependency_unavailable", "policy_denied", "parse_failed"}
)
FALLBACKS = MetricDef.counter(
    "app.fallback",
    purpose="correctness",
    owner="platform",
    means="Requests that selected a declared fallback path.",
    attributes={"fallback.reason": FALLBACK_REASONS},
    required=frozenset({"fallback.reason"}),
)


def record_fallback(emitter: MetricEmitter, *, reason: str) -> None:
    emitter.emit_counter(FALLBACKS, attributes={"fallback.reason": reason})


__all__ = ["record_fallback"]
