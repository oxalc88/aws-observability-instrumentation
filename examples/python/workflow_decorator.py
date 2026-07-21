"""Decorator for bounded workflow-step metrics and spans."""

from __future__ import annotations

import functools
import inspect
import time
from collections.abc import Callable
from typing import Any, ParamSpec, TypeVar, cast

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from .emission_module import MetricEmitter
from .failure_taxonomy import classify
from .metric_def import MetricDef

P = ParamSpec("P")
R = TypeVar("R")

STEPS = frozenset({"ingest", "transform", "publish"})
STEP_DURATION = MetricDef.latency(
    "app.workflow.step.duration",
    owner="workflows",
    means="Elapsed time for a declared workflow step.",
    attributes={"app.workflow.step": STEPS},
    required=frozenset({"app.workflow.step"}),
    emit_frequency="per_step",
)
STEP_FAILURE = MetricDef.failure_counter(
    "app.workflow.step.failure",
    owner="workflows",
    means="Declared workflow steps that terminated with an exception.",
    attributes={"app.workflow.step": STEPS},
    required=frozenset({"app.workflow.step"}),
    emit_frequency="per_step",
)


def instrumented_step(
    emitter: MetricEmitter, step: str
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    if step not in STEPS:
        raise ValueError(f"undeclared workflow step: {step!r}")

    def decorate(fn: Callable[P, R]) -> Callable[P, R]:
        if inspect.iscoroutinefunction(fn):
            return cast(Callable[P, R], _decorate_async(emitter, step, fn))
        return _decorate_sync(emitter, step, fn)

    return decorate


def _decorate_sync(
    emitter: MetricEmitter, step: str, fn: Callable[P, R]
) -> Callable[P, R]:
    @functools.wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return _run_sync(emitter, step, fn, args, kwargs)

    return wrapper


def _run_sync(
    emitter: MetricEmitter,
    step: str,
    fn: Callable[..., R],
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> R:
    started = time.monotonic()
    with trace.get_tracer(__name__).start_as_current_span(
        f"workflow {step}", attributes={"app.workflow.step": step}
    ) as span:
        try:
            return fn(*args, **kwargs)
        except BaseException as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR))
            emitter.emit_failure(
                STEP_FAILURE,
                failure=classify(exc),
                attributes={"app.workflow.step": step},
            )
            raise
        finally:
            emitter.emit_latency(
                STEP_DURATION,
                duration_seconds=time.monotonic() - started,
                attributes={"app.workflow.step": step},
            )


def _decorate_async(
    emitter: MetricEmitter, step: str, fn: Callable[P, Any]
) -> Callable[P, Any]:
    @functools.wraps(fn)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
        started = time.monotonic()
        with trace.get_tracer(__name__).start_as_current_span(
            f"workflow {step}", attributes={"app.workflow.step": step}
        ) as span:
            try:
                return await fn(*args, **kwargs)
            except BaseException as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR))
                emitter.emit_failure(
                    STEP_FAILURE,
                    failure=classify(exc),
                    attributes={"app.workflow.step": step},
                )
                raise
            finally:
                emitter.emit_latency(
                    STEP_DURATION,
                    duration_seconds=time.monotonic() - started,
                    attributes={"app.workflow.step": step},
                )

    return wrapper


__all__ = ["instrumented_step"]
