# Node.js and TypeScript examples

This is the canonical implementation of the language-agnostic three-signal contract. It targets Node.js 20 or newer and OpenTelemetry JS.

```bash
npm ci
npm run check
npm test
```

## Integration order

Initialize OpenTelemetry before loading libraries that will be auto-instrumented. Put provider startup in a small bootstrap module and load it first with Node's `--import` option, or ensure the application entrypoint calls it before dynamically importing the rest of the service.

```ts
import { startTelemetry } from "./observability/telemetry.js";

export const telemetry = startTelemetry({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "orders-api",
  serviceVersion: process.env.APP_VERSION ?? "unknown",
  environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "development",
  registry: [REQUESTS, REQUEST_DURATION],
});
```

For long-running processes, call `telemetry.shutdown()` during graceful process termination. For Lambda, preload `src/lambda-bootstrap.ts` before the selected handler module, use a bounded `forceFlush()` for application-owned metrics/traces, and do not shut down the SDK while the execution environment can be reused. Do not use this bootstrap when an ADOT layer or Application Signals bootstrap already owns the provider.

Initialize the structured logger once as well. `LogEventDef` restricts fields and `StructuredLogger` emits one-line JSON with the active trace/span context. Its stdout sink fits Lambda platform logging and the Fargate `awslogs` driver; replace only the sink/adapter when the application already uses Pino, Winston, Powertools Logger, or an OTel log bridge.

`StructuredLogger` accepts ordered `samplingRules` matched only on bounded event properties. It makes deterministic decisions from `correlation_id` or the active trace ID and emits `sampling.policy` plus `sampling.rate` on retained records. Explicit `ERROR` and security rules must be locked at `1.0`, and the runtime mandatory guard prevents broad rules from dropping either class.

Pass a caught `Error` through the `LogContext`. Failure records add `exception.type` and the first thrown frame as stable OTel `code.*` fields, plus the declared `metric.name` and `operation.name`. They do not add the exception message or full stack. Emit source maps and run Node with `--enable-source-maps` so bundled/transpiled failures point to TypeScript rather than generated JavaScript. Accessing stacks has a cost, so ordinary successful records do not capture their log call site.

## Asynchronous workflows

`src/workflow-propagation.ts` injects and extracts OTel fields plus one stable `correlation_id` through any normalized text carrier. Wrap it with a transport adapter that enforces the real carrier shape and limits: message attributes, message headers, a versioned payload envelope, an HTTP header allowlist, or another declared mechanism.

`src/sqs-workflow.ts` maps correlation to an SQS string message attribute, reserves the ten-attribute quota for configured OTel fields, extracts either `AWSTraceHeader` or global message attributes, and creates a linked per-record consumer span. `src/sqs-lambda-handler.ts` adds partial-batch failure handling.

`src/kinesis-workflow.ts` uses the same generic propagation helpers inside a versioned JSON envelope because Kinesis has no generic message-attribute map. It enforces this adapter's conservative 1 MiB serialized-envelope ceiling, decodes Lambda event records, and creates a linked per-record consumer span. `src/kinesis-lambda-handler.ts` demonstrates the default all-or-retry batch behavior. The adapter expects non-aggregated records; KPL deaggregation remains outside its scope. See `references/async-trace-propagation.md` for the transport-neutral contract.

For the self-managed Lambda example, compile first and configure:

```bash
NODE_OPTIONS="--enable-source-maps --import=./dist/lambda-bootstrap.js"
OTEL_PROPAGATORS="tracecontext,baggage,xray-lambda"
```

The bootstrap constructs the AWS propagator directly and defaults SQS extraction to the `AWSTraceHeader` system attribute. Set `OTEL_LAMBDA_SQS_PROPAGATION=global-message-attributes` only for the alternative W3C SQS message-attribute contract.

## Export

Application code normally sends OTLP/HTTP to a local collector:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

The collector owns CloudWatch endpoints, SigV4, retry, batching, and queues. Do not add static AWS credentials or direct `PutMetricData` calls to these modules. For OTLP logs, configure an established logger bridge and the three-signal collector template. Do not export records through OTLP when the same stdout records are already delivered to CloudWatch Logs.

## Modules

| File | Purpose |
| --- | --- |
| `src/telemetry.ts` | NodeSDK, resource, exporters, sampling, histogram views |
| `src/metric-def.ts` | Immutable custom metric contract |
| `src/metric-emitter.ts` | Instrument reuse and attribute validation |
| `src/log-event.ts` | Immutable log event schema and field classification |
| `src/structured-logger.ts` | JSON encoding, trace correlation, levels, sanitization, sink isolation |
| `src/correlation-context.ts` | Active business-workflow correlation |
| `src/workflow-propagation.ts` | Generic asynchronous text-carrier injection/extraction |
| `src/failure-taxonomy.ts` | Closed failure classes |
| `src/http.ts` | Framework-neutral request boundary |
| `src/workflow.ts` | Workflow-step boundary |
| `src/lambda-handler.ts` | Lambda lifecycle pattern |
| `src/lambda-bootstrap.ts` | Early Lambda OTel initialization and logging policy |
| `src/sqs-workflow.ts` | SQS-specific carrier quota and per-record spans |
| `src/sqs-lambda-handler.ts` | SQS batch and partial-failure example |
| `src/kinesis-workflow.ts` | Versioned Kinesis envelope, size validation, and per-record spans |
| `src/kinesis-lambda-handler.ts` | Kinesis batch and bounded-flush example |

The Lambda example never logs the raw event or exception text. Configure the function with `LoggingConfig.LogFormat=JSON`; the logger includes the `level` and RFC 3339 `timestamp` fields Lambda needs for application log filtering.
