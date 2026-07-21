"""ASGI metrics middleware for projects without standard HTTP metrics.

Prefer the framework's OTel instrumentation when it already emits the standard
HTTP server metrics. Do not install this middleware alongside duplicate metrics.
"""

from __future__ import annotations

import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from .emission_module import MetricEmitter
from .failure_taxonomy import classify
from .metric_def import MetricDef
from .metric_tags import status_code_class

METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "OTHER"})
ROUTES = frozenset({"/users", "/orders", "/orders/{order_id}", "_unmatched"})
STATUS_CLASSES = frozenset({"1xx", "2xx", "3xx", "4xx", "5xx", "other"})

HTTP_REQUESTS = MetricDef.counter(
    "app.http.server.request",
    purpose="outcome",
    owner="platform",
    means="Completed inbound HTTP requests at the ASGI boundary.",
    unit="{request}",
    attributes={
        "http.request.method": METHODS,
        "http.route": ROUTES,
        "http.response.status_class": STATUS_CLASSES,
    },
    required=frozenset({"http.request.method", "http.route", "http.response.status_class"}),
    emit_frequency="per_request",
)
HTTP_DURATION = MetricDef.latency(
    "app.http.server.request.duration",
    owner="platform",
    means="Elapsed time for completed inbound HTTP requests.",
    attributes={
        "http.request.method": METHODS,
        "http.route": ROUTES,
        "http.response.status_class": STATUS_CLASSES,
    },
    required=frozenset({"http.request.method", "http.route", "http.response.status_class"}),
    emit_frequency="per_request",
)
HTTP_FAILURES = MetricDef.failure_counter(
    "app.http.server.request.failure",
    owner="platform",
    means="Inbound HTTP requests that terminated with an application exception.",
    attributes={
        "http.request.method": METHODS,
        "http.route": ROUTES,
    },
    required=frozenset({"http.request.method", "http.route"}),
    emit_frequency="per_request",
)


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if path in ROUTES else "_unmatched"


class ObservabilityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: object, *, emitter: MetricEmitter) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.emitter = emitter

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        started = time.monotonic()
        method = request.method if request.method in METHODS else "OTHER"
        response: Response | None = None
        try:
            response = await call_next(request)
            return response
        except BaseException as exc:
            self.emitter.emit_failure(
                HTTP_FAILURES,
                failure=classify(exc),
                attributes={
                    "http.request.method": method,
                    "http.route": _route_template(request),
                },
            )
            raise
        finally:
            status = response.status_code if response is not None else 500
            attributes = {
                "http.request.method": method,
                "http.route": _route_template(request),
                "http.response.status_class": status_code_class(status),
            }
            self.emitter.emit_counter(HTTP_REQUESTS, attributes=attributes)
            self.emitter.emit_latency(
                HTTP_DURATION,
                duration_seconds=time.monotonic() - started,
                attributes=attributes,
            )


__all__ = ["ObservabilityMiddleware"]
