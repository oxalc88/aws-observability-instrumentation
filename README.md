# CloudWatch Instrumentation

A Node.js-first coding skill for three-pillar observability in Amazon CloudWatch: governed native OpenTelemetry metrics, OpenTelemetry traces, and secure structured application logs. It preserves the original repository's contract-first approach while replacing Sentry-specific APIs with standard OTel SDKs, AWS-supported collection, PromQL-aware metrics, and AWS/OWASP-aligned logging.

The policy is language agnostic. TypeScript is the canonical Node.js implementation; Python maintains behavioral parity for the core metric, logging, tracing, Lambda lifecycle, SQS, and Kinesis contracts.

This project is based on [Sentry Instrumentation](https://github.com/tortastudios/sentry-instrumentation), a skill that standardizes how application observability is instrumented. Credit for the contract-first approach and guidance on what to measure goes to the team at [Torta Studios](https://tortastudios.com/).

## Quick start

### One-command install (all agents except Claude.ai web)

```bash
git clone https://github.com/oxalc88/aws-observability-instrumentation.git
cd aws-observability-instrumentation
scripts/install.sh --agent=<agent> --project=/path/to/your/project
```

`<agent>` is one of `claude-code`, `cursor`, `codex`, `aider`, `continue`, or `windsurf`. The installer is idempotent, so it can be run again after updating this clone. For Claude Code, omit `--project` to install for the current user under `~/.claude/skills/`.

Keep this skill in a separate clone instead of nesting its Git repository inside the application repository.

### Pin a version

Check out a release tag before running the installer to keep the project on a stable skill contract:

```bash
git clone https://github.com/oxalc88/aws-observability-instrumentation.git
cd aws-observability-instrumentation
git checkout v0.1.0
scripts/install.sh --agent=<agent> --project=/path/to/your/project
```

Available releases can be listed with:

```bash
git ls-remote --tags https://github.com/oxalc88/aws-observability-instrumentation.git
```

### Pick your agent

| Agent           | Install guide                                            |
| --------------- | -------------------------------------------------------- |
| Claude Code     | [`adapters/claude-code.md`](adapters/claude-code.md)     |
| Claude.ai (web) | [`adapters/claude-ai-web.md`](adapters/claude-ai-web.md) |
| Cursor          | [`adapters/cursor.md`](adapters/cursor.md)               |
| Codex           | [`adapters/codex.md`](adapters/codex.md)                 |
| Aider           | [`adapters/aider.md`](adapters/aider.md)                 |
| Continue        | [`adapters/continue.md`](adapters/continue.md)           |
| Windsurf        | [`adapters/windsurf.md`](adapters/windsurf.md)           |

Each guide explains what the installer writes, how the agent loads the skill, and how to verify the installation.

### Try the skill

Paste any of these prompts into your agent:

```text
Add CloudWatch-compatible OpenTelemetry instrumentation to the new /users
endpoint, including governed metrics, a trace, and a correlated structured
outcome log.

Instrument the external Stripe client with the standard triad
(count + duration + failure) and the matching dependency span.

Add a fallback metric and correlated failure log for the case where the LLM
response parse fails.

This workflow step has no instrumentation. Apply the matching TypeScript or
Python workflow pattern and add the required MetricDef and LogEventDef entries.

Review this PR for metrics, tracing, logging, privacy, and cardinality quality
against the skill's review rubric.

Port the instrumentation layer from our Python service to our TypeScript
service with the same signal contracts and idiomatic language APIs.
```

The agent will read `SKILL.md`, select the matching runtime and signal paths, use the governed definitions and surface patterns, and produce code that passes the policy gate.

## What it covers

- OpenTelemetry metric names, units, histogram boundaries, attributes, and lifecycle rules.
- Low-cardinality metric contracts enforced at runtime and in CI.
- Node.js SDK initialization, auto-instrumentation, custom metrics, and traces.
- Declared structured log events with trace correlation, privacy classes, injection controls, log levels, security-event handling, and Logs Insights queries.
- Ordered deterministic log-sampling policies with mandatory error/security retention and per-record policy metadata.
- Transport-neutral asynchronous context propagation with tested SQS and Kinesis adapters in TypeScript and Python.
- AWS SigV4 collector export to CloudWatch's native OTLP/HTTP endpoints.
- ECS/Fargate sidecar, optimized Lambda layer/collectorless SDK, EKS, EC2, App Runner, local, and on-premises deployment choices.
- PromQL queries for counters, rates, histograms, availability, and failures.
- AI/LLM spans using OpenTelemetry `gen_ai.*` semantic conventions.
- Safe agent/operator investigation playbooks for CloudWatch Logs.

## Architecture

For Fargate and other long-running workloads, application code exports standard OTLP to a local collector:

```text
Node.js application
  -> OTLP/HTTP on localhost:4318
  -> ADOT or collector-contrib sidecar
  -> SigV4-signed CloudWatch metrics endpoint
  -> native OTel metrics queried with PromQL

Application traces
  -> the same collector
  -> optional SigV4-signed CloudWatch OTLP traces endpoint

Structured application logs
  -> one-line JSON stdout
  -> ECS awslogs driver
  -> CloudWatch Logs
```

The application has no AWS SDK metric calls and no static AWS credentials. Its instrumentation remains portable; the collector owns AWS authentication, batching, retry, and backpressure.

Lambda uses the same metric contracts but a different lifecycle: initialize at module scope, reuse providers across warm invocations, and perform a bounded `forceFlush()` before the runtime freezes. Lambda cannot run a normal sidecar, so use the current optimized ADOT layer or a verified collectorless ADOT SDK path, with exactly one owner initializing the OTel providers. AWS now marks the older Lambda layers with an embedded collector as not recommended for CloudWatch-only destinations. For logs, use governed JSON stdout and Lambda Advanced Logging Controls (`LogFormat: JSON`) by default; do not add an in-process OTLP log exporter for records Lambda already delivers.

This project does not use the AWS X-Ray SDK or X-Ray daemon. AWS has placed those instrumentation components in maintenance mode and recommends migrating to OpenTelemetry. AWS still currently exposes its CloudWatch OTLP traces API at `https://xray.<region>.amazonaws.com/v1/traces` and requires the SigV4 service name `xray`; that endpoint naming is independent of the deprecated SDK/daemon.

OpenTelemetry can still participate in the AWS-managed flow from API Gateway through Lambda and asynchronous services. For Lambda active tracing, use OTel's `xray-lambda` propagator; for the worked SQS path, use the AWS-managed `AWSTraceHeader` system attribute or deliberately select W3C message attributes. Other queues, streams, topics, event buses, and workflow engines use the same OTel context plus stable `correlation_id` contract through a transport-specific carrier. See [`references/async-trace-propagation.md`](references/async-trace-propagation.md).

## CloudWatch paths

This repository targets CloudWatch's native OpenTelemetry metric store when PromQL is required:

```text
https://monitoring.<region>.amazonaws.com/v1/metrics
```

An ADOT `awsemf` exporter and direct `PutMetricData` calls produce classic CloudWatch metrics. They are valid for existing namespace/dimension workflows, but they are a different storage and query path. Do not dual-publish unless a documented migration requires it.

Read [`references/cloudwatch-otlp.md`](references/cloudwatch-otlp.md) before changing endpoints, authentication, or collector behavior.

## Structured logs

Every application record uses a declared `LogEventDef`, a stable message and level, approved fields, service identity, and active trace/span context. The reference logger defaults sensitive fields off, bounds and neutralizes untrusted strings, rejects unsafe correlation IDs, and contains sink failures so logging loss does not alter the business operation.

Fargate defaults to JSON stdout through `awslogs`; Lambda defaults to JSON stdout through the Lambda service. An OTel logger bridge and the three-signal collector template are optional when the OTel log model or multi-destination routing is required. Pick one path per record to avoid duplicate ingestion.

Powertools Logger is a supported optional Lambda adapter. Powertools Metrics uses EMF and Powertools Tracer uses the legacy X-Ray SDK, so those utilities do not replace this repository's native OTLP metrics and OTel trace paths. See [`references/structured-logging.md`](references/structured-logging.md).

An internal undefined-property failure produces a record shaped like this (pretty-printed here; the sink writes one line):

```json
{
  "timestamp": "2026-07-21T14:30:00.000Z",
  "level": "ERROR",
  "message": "Lambda invocation failed",
  "event.name": "app.lambda.invocation.failed",
  "event.owner": "platform",
  "security.relevant": false,
  "sampling.policy": "errors",
  "sampling.rate": 1,
  "operation.name": "lambda.handler",
  "metric.name": "app.lambda.invocation.failure",
  "service.name": "orders-api",
  "service.version": "1.2.3",
  "deployment.environment.name": "production",
  "outcome": "failure",
  "failure.class": "internal_error",
  "faas.coldstart": false,
  "faas.name": "orders-api-create-order",
  "faas.version": "42",
  "faas.invocation_id": "c6af9ac6-7b61-11e6-9a41-93e8deadbeef",
  "exception.type": "TypeError",
  "code.file.path": "/var/task/src/orders/create-order.ts",
  "code.function.name": "createOrder",
  "code.line.number": 84,
  "code.column.number": 17,
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "span_id": "b7ad6b7169203331",
  "trace_flags": 1,
  "correlation_id": "order-workflow-opaque-id"
}
```

The raw exception message, stack, and source-code text are excluded from this operational record. Query by `metric.name` plus `failure.class`, group by `exception.type` and `code.*`, then pivot through `trace_id` to the matching OTel trace.

## Repository map

```text
cloudwatch-instrumentation/
|- SKILL.md
|- AGENTS.md
|- references/
|  |- cloudwatch-otlp.md
|  |- deployment-targets.md
|  |- async-trace-propagation.md
|  |- structured-logging.md
|  |- investigation-playbooks.md
|  |- promql.md
|  |- signal-model.md
|  |- tagging-and-cardinality.md
|  `- ...governance and review references
|- examples/
|  |- typescript/                 # TypeScript reference implementation
|  |  |- src/telemetry.ts
|  |  |- src/metric-def.ts
|  |  |- src/metric-emitter.ts
|  |  |- src/log-event.ts
|  |  |- src/structured-logger.ts
|  |  |- src/correlation-context.ts
|  |  |- src/failure-taxonomy.ts
|  |  |- src/http.ts
|  |  |- src/workflow.ts
|  |  |- src/lambda-bootstrap.ts
|  |  |- src/lambda-handler.ts
|  |  |- src/workflow-propagation.ts
|  |  |- src/sqs-workflow.ts
|  |  |- src/sqs-lambda-handler.ts
|  |  |- src/kinesis-workflow.ts
|  |  `- src/kinesis-lambda-handler.ts
|  `- python/                     # Core-contract and transport parity
|     |- emission_module.py
|     |- metric_def.py
|     |- metric_tags.py
|     |- structured_logging.py
|     |- correlation_context.py
|     |- failure_taxonomy.py
|     |- http_middleware.py
|     |- workflow_decorator.py
|     |- lambda_handler.py
|     |- workflow_propagation.py
|     |- sqs_workflow.py
|     |- sqs_lambda_handler.py
|     |- kinesis_workflow.py
|     |- kinesis_lambda_handler.py
|     |- external_api_client.py
|     |- retry_loop.py
|     |- fallback_path.py
|     `- ai_agent_spans.py
|- config/
|  |- otel-collector-cloudwatch.yaml
|  |- otel-collector-cloudwatch-three-signals.yaml
|  |- otel-collector-bearer.yaml
|  |- ecs-fargate-task-definition.json
|  |- iam-otel-writer-policy.json
|  `- README.md
|- scripts/install.sh
`- adapters/
```

## Node.js quick start

The examples require Node.js 20 or newer.

```bash
cd examples/typescript
npm ci
npm run check
npm test
```

Start telemetry once during process initialization:

```ts
const telemetry = startTelemetry({
  serviceName: "orders-api",
  serviceVersion: process.env.APP_VERSION ?? "unknown",
  environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "development",
  registry: [REQUESTS, REQUEST_DURATION],
});
```

Point the application at a collector without changing code:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Create instruments only through `MetricEmitter`; define every custom metric as a `MetricDef`. Resource identity such as `service.name`, version, environment, region, and AWS workload identity belongs on the OTel resource, not on every data point.

Define operational events through `LogEventDef` and send them through the approved structured logger or an equivalent established adapter:

```ts
const logger = new StructuredLogger({
  serviceName: "orders-api",
  serviceVersion: process.env.APP_VERSION ?? "unknown",
  environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "development",
  minimumLevel: parseLogLevel(process.env.LOG_LEVEL),
  samplingRules: [
    { id: "security", securityRelevant: true, rate: 1, locked: true },
    { id: "errors", levels: ["ERROR"], rate: 1, locked: true },
    { id: "diagnostic-info", levels: ["INFO"], rate: 0.1 },
  ],
});

logger.emit(ORDER_COMPLETED, { outcome: "success" });
```

## AWS deployment

### ECS/Fargate

1. Build a pinned collector image containing a tested collector configuration.
2. Add it as a task sidecar using [`config/ecs-fargate-task-definition.json`](config/ecs-fargate-task-definition.json).
3. Grant the collector's task role the actions in [`config/iam-otel-writer-policy.json`](config/iam-otel-writer-policy.json).
4. Set `AWS_REGION` and `OTEL_MEMORY_LIMIT_MIB` on the collector container.
5. Keep application JSON stdout on `awslogs`, or deliberately switch to the three-signal collector plus an OTel logger bridge. Never enable both for the same records.
6. Query one counter and one histogram in CloudWatch Query Studio before enabling production alerts.

### Lambda

Use [`examples/typescript/src/lambda-bootstrap.ts`](examples/typescript/src/lambda-bootstrap.ts) with [`lambda-handler.ts`](examples/typescript/src/lambda-handler.ts) for early initialization, bounded flush, terminal metric/log events, and trace correlation. Preload the compiled bootstrap with `NODE_OPTIONS=--enable-source-maps --import=./dist/lambda-bootstrap.js`. If the optimized ADOT layer, Application Signals, or another collectorless ADOT bootstrap owns OTel initialization, use that provider instead of starting the example `NodeSDK` a second time.

[`workflow-propagation.ts`](examples/typescript/src/workflow-propagation.ts) and [`workflow_propagation.py`](examples/python/workflow_propagation.py) implement the transport-neutral asynchronous carrier. Both languages provide complete SQS and Kinesis workflow/handler examples under their respective example directories. Other transports must preserve the same OTel context plus `correlation_id` contract through their own carrier-specific adapter.

Set Lambda `LoggingConfig` to JSON, choose application/system levels, pre-create the log group with finite retention, and use the platform log delivery path.

AWS layer ARNs and supported components vary by release and region, so this repository deliberately does not hardcode them.

### Other runtimes

[`references/deployment-targets.md`](references/deployment-targets.md) contains the decision matrix for EKS, EC2, App Runner, and non-AWS workloads. Choose one export owner per signal to avoid duplicate telemetry.

## PromQL

Example availability query:

```promql
sum(rate({"app.http.server.request", "http.response.status_class"=~"2xx|3xx"}[5m]))
/
sum(rate({"app.http.server.request"}[5m]))
```

PromQL exposes normalized metric identifiers, while OTel instrument names in code remain dot-delimited and do not include generated suffixes. See [`references/promql.md`](references/promql.md) for mappings and query patterns.

## Contract gate

Run the same static policy over Node and Python sources:

```bash
python examples/python/ci_gate.py examples/typescript/src examples/python config
```

The gate blocks direct OTel instrument creation outside the emission module, direct `PutMetricData`, hardcoded regional endpoints in application source, unbounded identifiers, exception text on metrics, wall-clock duration timing, loop emission, duplicate metric names, incorrect Lambda lifecycle, raw console/print logging, sensitive log content, and raw payload/error logging.

## Roadmap

### Complete

- **SQS TypeScript and Python:** propagation quota enforcement, linked per-record spans, correlation, and partial-batch failure handling.
- **Kinesis TypeScript and Python:** versioned payload envelopes, linked per-record spans, correlation, size validation, and non-aggregated record handling.

### Backlog

- **Step Functions:** transport adapter pending; the transport-neutral contract is already documented in [`references/async-trace-propagation.md`](references/async-trace-propagation.md).

## Production checks

- Pin Node, OTel package, collector image, and ADOT layer versions.
- Use task roles, execution roles, instance profiles, or workload identity; never commit static AWS keys.
- Bound metric attributes even though CloudWatch supports a large label count.
- Monitor collector queue, refusal, retry, and failed-export telemetry.
- Set an explicit trace sample ratio; do not assume metric and trace sampling have the same semantics.
- Test forced shutdown, collector restart, IAM denial, Lambda timeout, and Fargate memory pressure before rollout.
- Set log-group encryption, access, retention, and deletion controls; test log injection, sink failure, silence, throttling, and unexpected volume.

## Sources

- [CloudWatch OTLP endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html)
- [CloudWatch OpenTelemetry getting started](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPGettingStarted.html)
- [CloudWatch PromQL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-PromQL.html)
- [AWS Distro for OpenTelemetry Lambda](https://aws-otel.github.io/docs/getting-started/lambda/)
- [OpenTelemetry JavaScript exporters](https://opentelemetry.io/docs/languages/js/exporters/)
- [AWS Well-Architected structured logging](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

## License

MIT. See [`LICENSE`](LICENSE).
