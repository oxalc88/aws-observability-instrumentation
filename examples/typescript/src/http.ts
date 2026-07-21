import { SpanKind, SpanStatusCode, type Tracer } from "@opentelemetry/api";

import { classifyFailure } from "./failure-taxonomy.js";
import type { MetricEmitter } from "./metric-emitter.js";
import { MetricDef } from "./metric-def.js";

const METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "OTHER",
]);
const ROUTES = new Set([
  "/users",
  "/orders",
  "/orders/{order_id}",
  "_unmatched",
]);
const STATUS_CLASSES = new Set(["1xx", "2xx", "3xx", "4xx", "5xx", "other"]);
const REQUESTS = MetricDef.counter({
  name: "app.http.server.request",
  unit: "{request}",
  purpose: "outcome",
  owner: "platform",
  description: "Completed inbound HTTP requests at the framework boundary.",
  attributes: {
    "http.request.method": METHODS,
    "http.route": ROUTES,
    "http.response.status_class": STATUS_CLASSES,
  },
  required: new Set([
    "http.request.method",
    "http.route",
    "http.response.status_class",
  ]),
  emitFrequency: "per_request",
});
const DURATION = MetricDef.latency({
  name: "app.http.server.request.duration",
  owner: "platform",
  description: "Elapsed time for completed inbound HTTP requests.",
  attributes: REQUESTS.attributeConstraints,
  required: REQUESTS.requiredAttributes,
  emitFrequency: "per_request",
});
const FAILURES = MetricDef.failureCounter({
  name: "app.http.server.request.failure",
  unit: "{failure}",
  owner: "platform",
  description: "Inbound HTTP requests that terminated with an exception.",
  attributes: {
    "http.request.method": METHODS,
    "http.route": ROUTES,
  },
  required: new Set(["http.request.method", "http.route"]),
  emitFrequency: "per_request",
});

export async function instrumentHttpHandler<T>(options: {
  emitter: MetricEmitter;
  tracer: Tracer;
  method: string;
  route: string;
  run: () => Promise<{ value: T; statusCode: number }>;
}): Promise<T> {
  const method = METHODS.has(options.method) ? options.method : "OTHER";
  const route = ROUTES.has(options.route) ? options.route : "_unmatched";
  const started = performance.now();
  let statusCode = 500;
  return options.tracer.startActiveSpan(
    `${method} ${route}`,
    {
      kind: SpanKind.SERVER,
      attributes: { "http.request.method": method, "http.route": route },
    },
    async (span) => {
      try {
        const result = await options.run();
        statusCode = result.statusCode;
        span.setAttribute("http.response.status_code", statusCode);
        return result.value;
      } catch (error) {
        if (error instanceof Error) span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        options.emitter.failure(FAILURES, classifyFailure(error), {
          "http.request.method": method,
          "http.route": route,
        });
        throw error;
      } finally {
        const statusClass =
          statusCode >= 100 && statusCode < 600
            ? `${Math.floor(statusCode / 100)}xx`
            : "other";
        const attributes = {
          "http.request.method": method,
          "http.route": route,
          "http.response.status_class": statusClass,
        };
        options.emitter.counter(REQUESTS, 1, attributes);
        options.emitter.latency(
          DURATION,
          (performance.now() - started) / 1_000,
          attributes,
        );
        span.end();
      }
    },
  );
}
