# Instrumentation charter

## Scope

This skill governs application metrics, traces, and structured logs exported to Amazon CloudWatch. It covers custom metric and log-event contracts, ordered log sampling, semantic-convention reuse, failure classification, synchronous/asynchronous correlation, cardinality, exporter topology, AWS runtime deployment, PromQL and Logs Insights verification, and CI enforcement.

It does not turn operational logs into product analytics, regulated audit trails, legal evidence, or business intelligence events. Security-relevant application events are in scope, but their threat model, incident response, retention, and compliance controls still require the appropriate organizational system.

## Invariants

1. **Instrument once.** Application code uses OTel APIs and remains independent of CloudWatch authentication and endpoints.
2. **Define once.** Every custom metric has one immutable `MetricDef` in a registry and one instrument instance per meter provider.
3. **Reuse standards.** Prefer current OTel semantic conventions and auto-instrumentation over custom equivalents.
4. **Bound metric attributes.** A metric attribute value comes from a documented closed set or bucket function. Identifiers and free-form content belong on spans or logs when policy permits.
5. **Separate identity from operation.** Service, version, environment, and cloud runtime identity belong on the OTel resource. Operation fields belong on data points and spans.
6. **Keep meaning stable.** A change to name, kind, unit, aggregation, boundaries, or attribute meaning creates a new versioned metric.
7. **Measure at ownership boundaries.** Middleware owns server measurements, client wrappers own dependency measurements, workflow wrappers own step measurements, and queue adapters own message lifecycle measurements.
8. **Make missing telemetry visible.** Monitor collectors, export errors, rejected data, queues, and authentication failures.
9. **Prove queryability.** Each production SLI ships with a tested PromQL query and owner.
10. **Choose one CloudWatch metric path.** Native OTLP/PromQL and classic/EMF are different stores. Do not dual-publish accidentally.
11. **Structure and classify logs.** Emit one JSON record from a declared event schema; validate and sanitize untrusted fields.
12. **Correlate signals.** Put active trace/span IDs into logs and propagate a validated interaction ID through a transport-specific carrier where the workflow outlives one trace.
13. **Minimize logged data.** Secrets, credentials, bodies, prompts, and unapproved personal data never enter the operational log stream.
14. **Choose one log delivery path.** Do not send the same record through platform stdout collection and an OTLP bridge.
15. **Sample deterministically.** Evaluate ordered policies only against bounded event properties, record the applied policy/rate, and retain errors and security events at `1.0`.
16. **Model async honestly.** Preserve trace context and workflow correlation through queues, streams, topics, and event buses; use links for batches/fan-out rather than inventing one parent.

## Reject immediately

- `PutMetricData` calls scattered through business code.
- A collector endpoint or bearer token hardcoded in application source.
- Request IDs, user IDs, session IDs, raw URL paths, query strings, prompt text, or exception messages as metric attributes.
- New custom HTTP or database metrics that duplicate OTel auto-instrumentation.
- Wall-clock time used to measure elapsed duration.
- Per-invocation provider initialization in Lambda.
- Provider shutdown at the end of every Lambda invocation.
- An `awsemf` pipeline presented as native OTLP/PromQL ingestion.
- Raw `console.log`/`print` calls that bypass the approved structured logger.
- Logging request/response bodies, authorization data, credentials, session values, prompts, or arbitrary error text.
- A logger that permits CR/LF injection, unbounded fields, or sink failures that crash the business operation.
- An explicit error/security sampling policy that is not locked at `1.0`.
- An asynchronous adapter that replaces `correlation_id` at each hop or ignores carrier quotas and batch links.
