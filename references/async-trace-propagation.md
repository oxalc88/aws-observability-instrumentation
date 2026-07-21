# Asynchronous trace and workflow propagation

Use this reference when a workflow crosses API Gateway, Lambda, a queue, stream, event bus, topic, workflow engine, or another asynchronous boundary. The goal is end-to-end trace continuity plus a stable business-workflow identity while application instrumentation uses OpenTelemetry rather than a vendor SDK. SQS has complete TypeScript and Python examples, and Kinesis has a complete TypeScript example; these worked adapters do not limit the transport-neutral pattern.

## Keep the concepts separate

The X-Ray SDK is deprecated; the AWS trace header format, Lambda active tracing, SQS active tracing, and the CloudWatch/X-Ray trace backend are not. OpenTelemetry supplies the SDK, spans, propagators, and standard log fields. AWS-managed services can still carry `AWSTraceHeader`, and CloudWatch can still build the connected trace experience from the exported OTel spans.

Do not add `xray_trace_id` to the log schema. The active OTel context supplies `trace_id`, `span_id`, and `trace_flags`. A separate validated `correlation_id` identifies the broader business workflow when retries, fan-out, DLQs, or multiple traces make one trace ID insufficient. The Lambda `awsRequestId` remains `faas.invocation_id`; it is not the workflow correlation ID.

## Transport-neutral contract

Every adapter must carry two related but independent contexts:

1. Inject and extract the active OTel context using the standard propagator API so producer and consumer spans can be connected or linked.
2. Carry one explicit, validated `correlation_id` for the broader workflow, including retries, fan-out, DLQs, replay, and cases where trace sampling or retention creates multiple traces.

`examples/typescript/src/workflow-propagation.ts` implements this contract for any string-key/string-value carrier. Use it directly for normalized message headers or a versioned metadata envelope, then add a small transport adapter for quotas, binary encoding, reserved fields, batch semantics, and SDK-specific shapes. `examples/typescript/src/correlation-context.ts` and `StructuredLogger` are transport-independent.

| Transport | Typical carrier | Required adapter concern |
| --- | --- | --- |
| SQS | System `AWSTraceHeader` or message attributes; explicit `correlation_id` message attribute | Ten message-attribute limit and batch span links |
| SNS | Message attributes or AWS-managed trace metadata | Confirm delivery preserves selected fields and reserve attribute capacity |
| Kinesis | Versioned JSON payload envelope with `_propagation` and separate `data` | No generic user message-attribute map; payload and partition-key size, schema evolution, aggregation, and replay |
| DynamoDB Streams | Versioned item metadata or an approved side channel | Existing item schemas, stream views, payload size, and replay |
| EventBridge | Trace header where supported plus versioned event-detail metadata | Entry-level fields, archive/replay behavior, and target transformations |
| Kafka / AMQP | Message headers | Header encoding, broker limits, batch links, and framework instrumentation behavior |
| Step Functions / workflow engines | Execution input metadata plus platform trace integration | Execution-history privacy, state transformations, and long-running multi-trace workflows |
| HTTP / gRPC callback | Standard trace headers plus a validated correlation header | Trust-boundary validation and header allowlists |

Never serialize arbitrary OTel baggage or raw platform events into a payload by default. Declare the allowed propagation fields, validate `correlation_id`, and apply the same privacy and size review used for other message metadata.

## SQS example: choose one propagation mode

| Mode | Producer transport | Lambda extraction | Use when |
| --- | --- | --- | --- |
| `aws-trace-header` (default) | SQS `AWSTraceHeader` system attribute supplied by AWS active tracing | OTel Lambda instrumentation's built-in AWS X-Ray propagator | API Gateway, Lambda, and SQS active tracing are enabled and AWS-managed continuity is required |
| `global-message-attributes` | Fields injected by the global OTel propagator into SQS message attributes | `useGlobalPropagatorForSqsExtraction: true` | A producer explicitly uses W3C message attributes or the queue cannot provide the system attribute |

Do not mix extraction modes by accident. The default is specification-aligned and does not consume a user message-attribute slot for `AWSTraceHeader`. The W3C alternative is supported by OTel JS but consumes message attributes and must be part of the queue message contract.

## SQS example: AWS-managed flow

```text
API Gateway active tracing
  -> Lambda A active tracing
  -> OTel xray-lambda propagator extracts _X_AMZN_TRACE_ID
  -> instrumented AWS SDK creates the SQS producer span
  -> SQS active tracing carries AWSTraceHeader as a system attribute
  -> Lambda B OTel instrumentation creates the invocation and batch consumer spans
  -> batch consumer span links every producer context
  -> application creates one child consumer span per record for unambiguous logs
  -> the next instrumented AWS SDK call continues the same pattern
```

For an ADOT Lambda distribution that owns SDK initialization, use `OTEL_PROPAGATORS=tracecontext,baggage,xray-lambda`. Never configure `xray` and `xray-lambda` together. The self-managed NodeSDK example constructs the equivalent composite propagator in `examples/typescript/src/telemetry.ts` because the generic NodeSDK environment parser does not register AWS propagators by itself.

Instrumentation must be loaded before the handler module. For the self-managed TypeScript example, build the files and set `NODE_OPTIONS=--enable-source-maps --import=./dist/lambda-bootstrap.js`. The bootstrap enables the OTel Lambda and AWS SDK instrumentations and exports the single provider used by `lambda-handler.ts` or `sqs-lambda-handler.ts`. Do not preload this bootstrap when an ADOT layer or Application Signals bootstrap already owns the provider.

## SQS example: W3C message-attribute alternative

Set `OTEL_LAMBDA_SQS_PROPAGATION=global-message-attributes` for the self-managed example. This configures the Lambda instrumentation with:

```ts
getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-aws-lambda": {
    useGlobalPropagatorForSqsExtraction: true,
  },
});
```

The AWS SDK instrumentation injects the configured global propagation fields into SQS message attributes, and Lambda extracts from those fields. Do not enable this option while expecting extraction from the `AWSTraceHeader` system attribute.

## Business correlation contract

Every asynchronous business message carries `correlation_id` in the transport's declared metadata contract. `injectWorkflowContext()` and `extractWorkflowContext()` implement the generic text-carrier form. An adapter must preserve that identity rather than generating a new one at each hop. At the first ingress, the helper reuses an existing validated correlation ID, falls back to the active trace ID, and generates an ID only when neither exists.

For SQS, `prepareSqsMessageAttributes()` maps the generic rule to an explicit string message attribute. It refuses to overwrite a different existing ID and reserves enough of SQS's ten message attributes for every configured OTel propagation field.

```ts
const prepared = prepareSqsMessageAttributes({
  messageAttributes: input.MessageAttributes,
});

await sqs.send(
  new SendMessageCommand({
    ...input,
    MessageAttributes: prepared.messageAttributes,
  }),
);
```

Run the send while the producer span and workflow correlation context are active. Do not put `correlation_id`, message ID, trace ID, or span ID on metrics. These high-cardinality values belong in governed logs and spans.

On the consumer, `processSqsRecord()` requires and validates `correlation_id`, creates one consumer span for one record, links the corresponding producer context, and activates both the span and correlation contexts while the callback runs. The TypeScript `StructuredLogger` reads both active contexts automatically; the Python SQS handler passes the resolved `correlation_id` explicitly to its unchanged logger while the logger reads the active OTel span. `examples/typescript/src/sqs-lambda-handler.ts` and `examples/python/sqs_lambda_handler.py` show per-record spans, safe failure logs, bounded metrics, partial batch failure responses, and a bounded metrics/traces flush. The transport helpers are `examples/typescript/src/sqs-workflow.ts` and `examples/python/sqs_workflow.py`.

## Kinesis example: versioned payload envelope

Kinesis has no generic user message-attribute map, so `examples/typescript/src/kinesis-workflow.ts` serializes one JSON envelope with `schema_version: 1`, an isolated `_propagation` text carrier produced by `injectWorkflowContext()`, and the business value under `data`. `_propagation` therefore contains the active propagator's allowlisted fields plus the validated `correlation_id` without colliding with business keys. The producer helper enforces this adapter's conservative 1 MiB serialized-envelope ceiling before an application calls `PutRecord`. Current Kinesis APIs allow a larger record and apply their service limit to the data blob plus partition key, so the PutRecord integration must still validate the complete request against the current AWS limit.

The consumer decodes `event.Records[].kinesis.data`, validates the schema and propagation carrier, calls `extractWorkflowContext()`, and creates one consumer span linked to that record's producer context while activating both the span and `correlation_id`. `examples/typescript/src/kinesis-lambda-handler.ts` demonstrates a bounded flush and the default all-or-retry batch behavior; partial-batch responses are a separate event-source-mapping opt-in. The adapter assumes non-aggregated records because KPL aggregation requires deaggregation before the logical record envelopes can be processed.

## Batch and fan-out semantics

One consumer batch can contain messages from unrelated producer traces, so a batch span must not pretend that every message has one parent. Represent producer contexts as span links under the applicable OTel messaging conventions. A per-message consumer span gives each message an unambiguous active `span_id` for logs and carries the matching producer link. Keep platform invocation/batch spans owned by auto-instrumentation; do not create a duplicate manual invocation span.

## SQS example: infrastructure requirements

Configure the AWS services as well as the application:

```yaml
ApiStage:
  Type: AWS::ApiGateway::Stage
  Properties:
    TracingEnabled: true

WorkerFunction:
  Type: AWS::Lambda::Function
  Properties:
    TracingConfig:
      Mode: Active
    Environment:
      Variables:
        NODE_OPTIONS: --enable-source-maps --import=./dist/lambda-bootstrap.js
        OTEL_PROPAGATORS: tracecontext,baggage,xray-lambda

WorkQueue:
  Type: AWS::SQS::Queue
  Properties:
    TracingConfig: Active
```

Also enable `ReportBatchItemFailures` on the Lambda event-source mapping when using the partial-batch response in the example. The execution role and selected collector/layer still need their documented trace-export permissions. Treat this snippet as structural: validate resource properties against the IaC framework and AWS region used by the target project.

## Sampling is two controls

Log sampling and trace sampling are independent. Retaining 100% of `ERROR` logs guarantees the error record, not the entire trace, because an upstream API Gateway or SDK trace sampler may have made a non-recording decision earlier. Configure the trace sampler and API Gateway active-tracing policy according to the diagnostic requirement and cost budget; do not claim complete error traces solely from the log policy.

Deterministic log sampling uses `correlation_id`, so every Lambda in one asynchronous workflow makes the same decision for a matching policy. When no correlation or trace key exists, the reference logger fails open and retains the record. Errors and security-relevant records remain locked at rate `1.0`.

## Deployment verification

1. Send one request through the real ingress and every asynchronous hop in the target workflow.
2. Confirm the trace contains or links the ingress, producer, broker/platform, consumer, and per-message operation nodes expected by the selected backend.
3. Confirm consumer logs contain the per-message active `trace_id` and `span_id`, plus the same `correlation_id` emitted at ingress.
4. Retry, replay, redrive, and fan out one message and confirm `correlation_id` remains stable even if new traces are created.
5. Send a mixed batch and confirm producer contexts are links rather than one false parent.
6. Confirm the adapter respects the selected transport's metadata count, byte-size, encoding, and reserved-field limits.
7. Repeat with a non-sampled trace and verify that mandatory error logs are still present.

## Sources

- [OpenTelemetry AWS Lambda conventions](https://opentelemetry.io/docs/specs/semconv/faas/aws-lambda/)
- [OpenTelemetry JS AWS Lambda instrumentation](https://www.npmjs.com/package/@opentelemetry/instrumentation-aws-lambda)
- [OpenTelemetry propagators API](https://opentelemetry.io/docs/specs/otel/context/api-propagators/)
- [OpenTelemetry messaging span conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
- [OpenTelemetry log trace context](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)
- [AWS X-Ray SDK migration to OpenTelemetry](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-migration.html)
- [AWS SQS tracing](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html)
- [Amazon SQS message metadata and attribute quota](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-metadata.html)
- [Amazon Kinesis PutRecord limits](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecord.html)
- [AWS Lambda Kinesis partial batch responses](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-batchfailurereporting.html)
- [API Gateway active tracing](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-enabling-xray.html)
- [CloudWatch trace-to-log correlation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Application-Signals-TraceLogCorrelation.html)
