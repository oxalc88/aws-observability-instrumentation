# Emission boundaries

Emit where one component owns the complete lifecycle.

| Surface | Owner | Signals |
| --- | --- | --- |
| HTTP server | Framework auto-instrumentation or middleware | standard span/metrics, route template, status |
| HTTP client | Client instrumentation or shared wrapper | client span, dependency outcome and duration |
| Workflow step | Decorator or higher-order function | internal span, step duration and failure |
| Retry loop | Shared retry helper | attempts and terminal result |
| Fallback | Fallback-selection helper | one correctness counter |
| Queue/stream/event bus | Consumer/producer adapter | propagation, send/process spans, links, lag, outcome |
| Lambda | Runtime wrapper and handler boundary | invocation span, terminal structured event, explicit flush behavior |
| Security control | Authentication/authorization/validation boundary | classified security event and bounded outcome |

## One owner

Do not instrument the same HTTP request in framework auto-instrumentation, custom middleware, and a handler. Pick the layer with route-template and final-status knowledge.

Do not emit dependency metrics in every call site. Put them in the shared client that knows the stable dependency and operation names.

Do not narrate the same operation with logs at every layer. Emit a terminal structured event at the boundary that knows the action, outcome, and safe correlation context. A security control may independently own a required security event when its purpose and response workflow differ.

## Completion semantics

Increment completion counters only after the boundary has a terminal outcome. Record durations in `finally` so failures are included. Emit a failure counter exactly once at the boundary that owns the failure.

## Context propagation

Use OTel context propagation across HTTP, messaging, and supported AWS SDK calls. Do not create unrelated root spans inside an active request. When asynchronous work intentionally outlives a request, inject trace context plus a stable `correlation_id` through the transport's declared carrier and link contexts according to the messaging/task model. SQS message attributes are one adapter; streams and event buses may require a versioned metadata envelope.

## Resource detection

Initialize resource detection at process cold start. Never call ECS task metadata, EC2 instance metadata, or Kubernetes APIs on each emission.

## Lambda

Initialize providers outside the handler, reuse them for warm invocations, and force flush with a bounded timeout near completion. A hard Lambda timeout can prevent in-process flush; use platform/runtime telemetry for timeout visibility.
