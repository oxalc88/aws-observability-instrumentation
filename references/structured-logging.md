# Structured logging contract

Use this reference whenever application logging, CloudWatch Logs, correlation, or a three-signal observability setup is in scope. The contract combines the AWS Well-Architected Serverless Lens guidance with the OWASP Logging Cheat Sheet and the OpenTelemetry log data model.

## Scope

This logging pillar covers operational application records and security-relevant application events. It does not turn operational logs into a compliance audit trail. Audit, legal-intercept, and regulated transaction logs often need different schemas, access controls, immutability, retention, and deletion processes; design those as separate streams.

Use a structured logging library already established by the application. The examples provide `LogEventDef` and `StructuredLogger` as a dependency-light reference contract, not as a requirement to replace Pino, Winston, Python `logging`, or another mature logger. OpenTelemetry recommends bridging existing logging libraries into its log data model instead of making application teams call the OTel Logs API directly.

## Required record shape

Every application record is one JSON object with stable field names and types:

| Field | Rule |
| --- | --- |
| `timestamp` | RFC 3339/ISO 8601 in UTC; keep workload clocks synchronized |
| `level` | `DEBUG`, `INFO`, `WARN`, or `ERROR` |
| `message` | Stable human-readable description; do not interpolate request data |
| `event.name` | Stable dotted event identifier such as `app.order.completed` |
| `event.owner` | Team or component accountable for the event |
| `operation.name` | Stable operation shared with its span when the event declares one |
| `metric.name` | Exact primary `MetricDef` name that the event explains, when applicable |
| `service.name` | Stable service identity, aligned with the OTel resource |
| `service.version` | Deployed version when known |
| `deployment.environment.name` | Stable environment name |
| `security.relevant` | Boolean that identifies security monitoring events |
| `sampling.policy`, `sampling.rate` | Applied policy identifier and configured retention rate on every retained record |
| `trace_id`, `span_id`, `trace_flags` | Active valid OTel context when present |
| `correlation_id` | Validated interaction ID propagated across components |
| `faas.name`, `faas.version`, `faas.invocation_id` | Lambda runtime and invocation origin when applicable |
| `exception.type` | Dynamic exception class for a passed exception; never an exception message |
| `code.file.path`, `code.function.name`, `code.line.number`, `code.column.number` | First thrown source frame when available |
| event fields | Declared, typed fields needed to answer the event's operational question |

The application should be able to answer OWASP's "when, where, who, and what" questions. "Who" does not require a raw identity: prefer a permitted, pseudonymized subject reference or a coarse subject type. Record the action, target class, outcome, bounded reason, and detection confidence when relevant.

## Event schema and classification

Define stable operational events before emitting them. For each `LogEventDef`, declare:

- name, severity, fixed message, owner, and security relevance
- stable operation name and primary related metric when applicable
- optional declared sampling class such as `mandatory`, `operational`, or `diagnostic`
- allowed and required fields
- each field's class: `operational`, `correlation`, or `sensitive`
- the Logs Insights query or alarm that consumes the event
- expected rate, retention class, and response owner

Sensitive fields are disabled by default in the examples. Enabling one requires an approved purpose, legal basis, destination classification, retention, and access policy. Hashing or pseudonymizing an identifier reduces exposure but does not automatically make it non-sensitive.

When an event declares a related metric, every required metric attribute must also be a required event field. This makes `metric.name`, `outcome`, and `failure.class` a checked join contract rather than a naming convention. Logger-managed resource, metric, trace, exception, and `code.*` fields cannot be declared or overwritten by application event fields.

## What to log

Log terminal business and operational outcomes at the component that owns the lifecycle. Avoid narration at every function call. Security requirements should be threat-model driven; OWASP recommends considering at least:

- input/output validation failures
- authentication successes and failures, authorization failures, and session validation failures
- application, dependency, connectivity, and configuration failures
- service and logging startup/shutdown state changes
- privileged administration and access to sensitive operations
- data import/export, file upload, deserialization, and cryptographic key operations
- suspicious workflow ordering, limit bypass, and other business-logic abuse

Set `security.relevant=true` for events required by the security monitoring design. The reference logger does not discard these events when an ordinary minimum log level changes. Never use sampling to suppress required security, audit, or error events.

## What not to log

Never record credentials or data that the log system is not authorized to store. Reject or remove:

- passwords, access/refresh tokens, session IDs, cookies, authorization headers, API keys, connection strings, and encryption keys
- raw request or response bodies, full headers, query strings, form data, uploaded files, prompts, completions, and tool payloads
- payment data, government/health identifiers, or other regulated personal data
- arbitrary exception messages and stack traces in the normal operational stream
- source code, internal secrets, or data above the destination's classification

When a permitted correlation value is needed, validate its syntax and length. Prefer a generated interaction ID or the active OTel trace ID. Do not create a new correlation ID for every log line, and do not trust an incoming ID until it has passed input validation.

## Error origin and source maps

Pass the actual caught exception to the approved logger. The reference loggers derive `exception.type` and the innermost thrown source frame. They deliberately omit `exception.message`, `exception.stacktrace`, and the source-code line from the ordinary operational stream. OpenTelemetry permits `exception.type` without `exception.message` and warns that the message may contain sensitive data.

For transpiled or bundled Node.js, emit source maps and start Node with `--enable-source-maps`. In Lambda, place the tested option in `NODE_OPTIONS`; in Fargate, add it to the Node process arguments or `NODE_OPTIONS`. Without source maps, the record can only identify the generated JavaScript location. Accessing an error stack has a runtime cost, so the reference logger does it only when an exception is passed, not for every successful INFO record.

`code.file.path` identifies source code. Do not use `log.file.path` for this; that OTel field identifies the file used to transport a log record.

## Injection and failure behavior

Treat all values originating in another trust zone as untrusted. The approved logger must:

1. allow only declared fields and primitive values
2. bound string lengths
3. neutralize CR, LF, control, and record-separator characters
4. encode records with a real JSON serializer, one object per line
5. reject invalid correlation IDs and non-finite numbers
6. contain destination/sink failures so observability loss does not crash the business operation

Contract violations are programming defects and should fail tests. Sink failure must be observable through platform/collector health without recursively writing the same failed log path.

## Correlation across three signals

Use standard OTel propagators for distributed trace context. A structured logger reads the active span and adds `trace_id`, `span_id`, and `trace_flags`. Use `correlation_id` for the broader business interaction when retries, fan-out, replay, long-running work, sampling, or retention can create multiple traces. Pass that value through an explicit, transport-appropriate metadata contract; read `async-trace-propagation.md`.

Each terminal event should declare the primary metric it explains and the same stable operation name used by the span. The logger then adds `metric.name` and `operation.name`; shared bounded fields such as `outcome` and `failure.class` remain identical across signals. Set `aws.log.group.names` as an OTel resource attribute when using a supported AWS path and CloudWatch related-telemetry navigation is desired. This resource association complements the record-level fields; it does not replace them.

High-cardinality IDs belong in governed logs or spans, never metric labels. Operational metrics should carry only bounded outcome/failure fields. This lets an alarm lead to a trace or a Logs Insights query without creating an unbounded metric series.

## Runtime delivery

Choose exactly one delivery owner for each application record.

### Lambda

Default to structured JSON written to stdout/stderr and let Lambda deliver it to CloudWatch Logs. Configure Lambda `LoggingConfig` with `LogFormat: JSON`, an appropriate `ApplicationLogLevel`, and an explicit log group/retention policy. The execution role needs the CloudWatch Logs permissions provided by `AWSLambdaBasicExecutionRole` or an equivalent least-privilege policy.

Powertools for AWS Lambda Logger is an optional Lambda-specific adapter, not a dependency of this reference implementation. If an application already uses it, preserve this contract with a custom formatter/adapter.

| Powertools Logger behavior | Decision in this skill |
| --- | --- |
| Module-scope logger, JSON, levels, Lambda context, cold start | Adopt |
| Error name and source location | Adopt as `exception.type` plus stable OTel `code.*` fields |
| Active request/correlation keys | Adopt only after validation; add active OTel `trace_id` and `span_id` |
| Incoming event logging | Keep disabled; raw events commonly contain credentials or personal data |
| Default error message and full stack | Exclude from the ordinary stream; route only to a separately approved diagnostic destination |
| Arbitrary extra/persistent keys | Replace with declared event fields; reset invocation-scoped state if an adapter uses mutable keys |
| Debug sampling and bounded buffering | Optional for diagnostics; never suppress errors or required security events, and account for timeout loss |
| `xray_trace_id` | Do not use as a substitute for W3C/OTel trace and span IDs |

Do not adopt Powertools Metrics or Tracer as part of this decision: Metrics uses EMF and Tracer wraps the legacy X-Ray SDK, while this skill uses native OTLP metrics and OpenTelemetry traces.

Do not also export the same application records through an OTLP log exporter. Lambda platform delivery is already the owner.

### ECS/Fargate

Default to one-line JSON on stdout and the ECS `awslogs` log driver. Pre-create the log group, configure retention and encryption, and grant delivery actions to the execution role. This path remains independent of the application task role used by an OTel collector.

Use an OTel logging bridge plus the collector logs pipeline only when the project needs the OTel log data model or a common multi-destination pipeline. Then remove or exclude the same records from `awslogs` to prevent duplicate ingestion. The CloudWatch OTLP logs endpoint requires `x-aws-log-group` and `x-aws-log-stream` headers and SigV4 service name `logs`.

### EKS, EC2, and external workloads

Use structured stdout/files with the CloudWatch Agent `filelog` receiver, or an established logger bridge to OTLP. Prefer the CloudWatch Agent for AWS workloads unless a custom collector component is required. Keep receiver exposure private and use TLS/authentication for non-loopback or cross-network collection.

## Ordered log sampling

Sampling is an ordered policy list, not a hardcoded severity switch. The first matching rule decides retention. Rules may match only bounded properties: `level`, exact `event.name`, exact `operation.name`, `security.relevant`, `deployment.environment.name`, or a declared sampling class. Do not match arbitrary fields, exception text, user IDs, message IDs, URLs, or other unbounded data.

```ts
const samplingRules = [
  { id: "security", securityRelevant: true, rate: 1, locked: true },
  { id: "errors", levels: ["ERROR"], rate: 1, locked: true },
  { id: "queue-failures", events: ["app.queue.message.failed"], rate: 1 },
  { id: "diagnostic-info", levels: ["INFO"], rate: 0.1 },
  { id: "debug", levels: ["DEBUG"], rate: 0.01 },
];
```

Any rule explicitly targeting `ERROR` or `security.relevant=true` must be locked at `1.0`. The logger also enforces mandatory retention independently, so a broad drop rule cannot discard those records. Required audit evidence belongs in its separately controlled stream and must not rely only on this operational sampling policy.

For rates between zero and one, compute a deterministic decision from the policy ID plus `correlation_id`; fall back to the active `trace_id`. This gives the same decision at every service participating in one workflow. If neither key exists, fail open and retain the record. Do not use a process-local random decision independently on each log line.

Every retained record contains the managed `sampling.policy` and `sampling.rate` fields. Validate the complete event and its declared fields before applying sampling so a dropped record cannot hide a programming defect. Monitor aggregate logger/exporter drops separately; a record that was intentionally sampled out cannot describe its own absence.

Log sampling is independent of OTel trace sampling. Keeping 100% of error logs does not reconstruct spans rejected by an upstream trace sampler. Set trace sampling deliberately for the diagnostic and cost requirement.

## Levels and volume

- `ERROR`: terminal failure requiring investigation or a defined response
- `WARN`: degraded, suspicious, or recoverable condition
- `INFO`: terminal business/operational outcome and material lifecycle change
- `DEBUG`: temporary diagnostic detail; off by default in production

Set the default level and ordered policies in reviewed configuration and control changes through normal change management. Bound record size and event rate, set log-group retention explicitly, and alarm on rejected/dropped export.

## Logs Insights starting queries

Find all records for a trace or interaction:

```text
fields @timestamp, level, `event.name`, message, trace_id, correlation_id
| filter trace_id = "replace-me" or correlation_id = "replace-me"
| sort @timestamp asc
```

Find the source locations behind a failure-metric spike:

```text
fields @timestamp, `service.name`, `service.version`, `exception.type`,
  `code.file.path`, `code.function.name`, `code.line.number`, trace_id, span_id
| filter `metric.name` = "app.lambda.invocation.failure"
  and `failure.class` = "internal_error"
| stats count() as failures, latest(@timestamp) as latest,
    latest(trace_id) as example_trace
  by `service.name`, `service.version`, `exception.type`, `code.file.path`,
    `code.function.name`, `code.line.number`
| sort failures desc
| limit 100
```

Find recent security-relevant failures:

```text
fields @timestamp, `service.name`, `event.name`, message, correlation_id
| filter `security.relevant` = true and level in ["WARN", "ERROR"]
| sort @timestamp desc
```

## Verification

- Unit-test required/undeclared/sensitive/managed field behavior, error origin, related-metric attributes, trace/workflow correlation, deterministic sampling, and mandatory error/security retention.
- Fuzz CR/LF, delimiter, oversized, invalid Unicode, and malicious identifier inputs.
- Simulate unavailable stdout/network/destination, quota throttling, and full queues.
- Verify logging failure does not alter the business response and does not recurse.
- Verify log access, encryption, retention, deletion, and access monitoring.
- Confirm required security events cannot be disabled by a runtime level change.
- Query one deployed success, failure, security event, trace ID, and correlation ID.
- Monitor sudden volume changes, silence, tampering/deletion attempts, and collector rejects.

## Sources

- [AWS Well-Architected Serverless Lens: centralized and structured logging](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html)
- [AWS Lambda JSON and plain-text log formats](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)
- [Powertools for AWS Lambda TypeScript Logger](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/)
- [Powertools for AWS Lambda TypeScript Metrics](https://docs.aws.amazon.com/powertools/typescript/latest/features/metrics/)
- [Powertools for AWS Lambda TypeScript Tracer](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/)
- [CloudWatch OTLP endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html)
- [CloudWatch Agent OpenTelemetry configuration](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPCloudWatchAgent.html)
- [OpenTelemetry logging](https://opentelemetry.io/docs/specs/otel/logs/)
- [OpenTelemetry exception log conventions](https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/)
- [OpenTelemetry stable code attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/code/)
- [OpenTelemetry AWS Lambda conventions](https://opentelemetry.io/docs/specs/semconv/faas/aws-lambda/)
- [OpenTelemetry log trace context](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)
- [Node.js source-map support](https://nodejs.org/api/cli.html#--enable-source-maps)
- [CloudWatch related custom telemetry](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/adding-your-own-related-telemetry.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

For an operator or agent workflow that consumes these records safely, read `investigation-playbooks.md`.
