# TypeScript / JavaScript Powertools implementation

Apply the shared contract first. Canonical examples use Node.js 22+, Powertools 2.35.0, and the SDK/tool versions pinned in examples/typescript/package-lock.json. JavaScript can use the same runtime APIs; no TypeScript-only policy applies.

## Metrics

Initialize Metrics outside the handler. Use `addMetric` with a declared MetricUnit and fixed name. Choose one owner: `logMetrics` middleware/decorator or guarded explicit `publishStoredMetrics()` in finally. The examples use the explicit owner. Clear metrics, temporary dimensions and metadata independently (`clearMetrics`, `clearDimensions`, `clearMetadata`); maintain static defaults. If cleanup fails, skip publication instead of leaking stale state. Do not change a populated buffer's dimensions or enable `singleMetric` publication by default.

The small synchronous metric-publication.ts helper contains SDK failures. It is not a registry or logger framework. Pass only fixed reviewed contracts; async record processors accumulate local counts before the publication boundary. Do not share mutable per-record diagnostic context.

## Logger

Use Powertools Logger directly with explicit safe fields; the example logs stable category, stage, exact observed HTTP status, and reviewed error code without serializing arbitrary errors. Prefer `injectLambdaContext(logger, { logEvent: false, resetKeys: true })` when context injection is needed. Set `POWERTOOLS_LOGGER_LOG_EVENT=false`, never enable raw payloads, and preserve original errors with `throw error`. See [logging](../logging.md).

## Tracer

Prefer built-in `captureLambdaHandler` middleware and reviewed `captureAWSv3Client` SDK capture when supported; each boundary has one owner. Disable response and full-error capture with `POWERTOOLS_TRACER_CAPTURE_RESPONSE=false` and `POWERTOOLS_TRACER_CAPTURE_ERROR=false` and supported middleware options (response only in the pinned TypeScript SDK; the error switch is environment-based). These flags do not automatically sanitize SDK instrumentation; review the actual captured attributes. Avoid broad HTTP capture with sensitive URLs. Use manual X-Ray segments only when native instrumentation cannot answer a proven operational question. TypeScript's disable switch is `POWERTOOLS_TRACE_ENABLED=false`. See [tracing](../tracing.md).

AWS SDK v3 `$metadata.attempts` includes the initial attempt. Use actual metadata; report absent/invalid evidence instead of inventing counts. The fixed public error in the example is illustrative application policy; retain consumer behavior when adapting.

Sources: [Metrics](https://docs.aws.amazon.com/powertools/typescript/latest/features/metrics/), [Logger](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/), [Tracer](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/).
