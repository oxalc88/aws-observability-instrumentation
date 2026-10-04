# TypeScript / JavaScript Powertools implementation

Apply the shared contract first. Canonical examples use Node.js 22+, Powertools 2.35.0, and the SDK/tool versions pinned in examples/typescript/package-lock.json. JavaScript can use the same runtime APIs; no TypeScript-only policy applies.

## Metrics

Initialize Metrics outside the handler. Use `addMetric` with a declared MetricUnit and fixed name. Choose one owner: `logMetrics` middleware/decorator or guarded explicit `publishStoredMetrics()` in finally. The examples use the explicit owner. Clear metrics, temporary dimensions and metadata independently (`clearMetrics`, `clearDimensions`, `clearMetadata`); maintain static defaults. If cleanup fails, skip publication instead of leaking stale state. Do not change a populated buffer's dimensions or enable `singleMetric` publication by default.

The small synchronous metric-publication.ts helper contains SDK failures. It is not a registry or logger framework. Pass only fixed reviewed contracts; async record processors accumulate local counts before the publication boundary. Do not share mutable per-record diagnostic context.

## Logger

Use Logger directly. If using context middleware, set `injectLambdaContext(logger, { logEvent: false, resetKeys: true })`. Keep `POWERTOOLS_LOGGER_LOG_EVENT=false`; review deployment overrides. The examples pass request fields directly and do not use event logging middleware. Never pass an Error object or arbitrary object spread to Logger; its serialization can expose text/stacks. DEBUG sampling increases verbosity; it is not workflow evidence retention.

## Tracer

TypeScript's disable switch is `POWERTOOLS_TRACE_ENABLED=false`. Initialize one Tracer and instrument handler/meaningful clients once. Reviewed `captureAWSv3Client` can own SDK capture, or use manual safe subsegments, never both. Disable broad HTTP capture with `captureHTTPsRequests: false` when URLs can be sensitive. Disable response capture through `captureResponse: false` and `POWERTOOLS_TRACER_CAPTURE_RESPONSE=false`; set `POWERTOOLS_TRACER_CAPTURE_ERROR=false` for automatic full-error metadata. SDK auto-capture is independent and needs its own privacy review.

The example uses manual handler/dependency subsegments with guarded get/set/close/fault operations and independent parent restoration, without response/error serialization. It retains useful timing without copying raw SDK errors into traces. Standard middleware/decorators also need a failure/cleanup review at the effective owner.

AWS SDK v3 `$metadata.attempts` includes the initial attempt. Use actual metadata; report absent/invalid evidence instead of inventing counts. The fixed public error in the example is illustrative application policy; retain consumer behavior when adapting.

Sources: [Metrics](https://docs.aws.amazon.com/powertools/typescript/latest/features/metrics/), [Logger](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/), [Tracer](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/).
