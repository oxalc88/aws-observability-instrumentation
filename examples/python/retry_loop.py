"""Retry helper that emits bounded attempt and terminal metrics."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from .emission_module import MetricEmitter
from .failure_taxonomy import classify
from .metric_def import MetricDef
from .metric_tags import attempt_bucket

T = TypeVar("T")

ATTEMPT_BUCKETS = frozenset({"1", "2", "3-5", "6+"})
OUTCOMES = frozenset({"success", "exhausted"})
RETRY_ATTEMPTS = MetricDef.counter(
    "app.retry.attempt",
    purpose="load",
    owner="platform",
    means="Attempts made by a governed retry loop.",
    unit="{attempt}",
    attributes={"retry.name": frozenset({"dependency_call", "workflow_step"}), "attempt.bucket": ATTEMPT_BUCKETS},
    required=frozenset({"retry.name", "attempt.bucket"}),
    loop_policy="allowed",
)
RETRY_TERMINAL = MetricDef.counter(
    "app.retry.terminal",
    purpose="outcome",
    owner="platform",
    means="Terminal outcomes of a governed retry loop.",
    attributes={"retry.name": frozenset({"dependency_call", "workflow_step"}), "outcome": OUTCOMES},
    required=frozenset({"retry.name", "outcome"}),
)
RETRY_FAILURES = MetricDef.failure_counter(
    "app.retry.failure",
    owner="platform",
    means="Retry loops that exhausted their attempt budget.",
    attributes={"retry.name": frozenset({"dependency_call", "workflow_step"})},
    required=frozenset({"retry.name"}),
)


async def retry_with_instrumentation(
    operation: Callable[[], Awaitable[T]],
    *,
    emitter: MetricEmitter,
    retry_name: str,
    max_attempts: int = 3,
    base_delay_seconds: float = 0.1,
) -> T:
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        emitter.emit_counter(  # instrumentation: loop-allowed
            RETRY_ATTEMPTS,
            attributes={"retry.name": retry_name, "attempt.bucket": attempt_bucket(attempt)},
        )
        try:
            result = await operation()
            emitter.emit_counter(  # instrumentation: loop-allowed
                RETRY_TERMINAL,
                attributes={"retry.name": retry_name, "outcome": "success"},
            )
            return result
        except Exception as exc:
            last_error = exc
            if attempt < max_attempts:
                await asyncio.sleep(base_delay_seconds * 2 ** (attempt - 1))
    assert last_error is not None
    emitter.emit_counter(
        RETRY_TERMINAL,
        attributes={"retry.name": retry_name, "outcome": "exhausted"},
    )
    emitter.emit_failure(
        RETRY_FAILURES,
        failure=classify(last_error),
        attributes={"retry.name": retry_name},
    )
    raise last_error


__all__ = ["retry_with_instrumentation"]
