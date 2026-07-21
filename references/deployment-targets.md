# AWS deployment targets

Choose one export owner per signal and one delivery owner per log record. Keep instrument, event, and attribute contracts unchanged when moving between runtimes.

## Decision matrix

For most customers, AWS recommends the CloudWatch Agent, which is built on the OpenTelemetry Collector and includes CloudWatch integrations. Use an upstream or custom collector when its portability or component set is required. Do not deploy an X-Ray SDK or X-Ray daemon in any topology.

| Runtime | Metric/trace owner | Default log owner | Lifecycle concern |
| --- | --- | --- | --- |
| ECS/Fargate | ADOT or OTel sidecar | JSON stdout -> `awslogs` | Sidecar health, role separation, bounded memory |
| ECS on EC2 | Sidecar or host collector | JSON stdout/file -> log driver or agent | Avoid double collection |
| Lambda | Optimized ADOT layer/Application Signals or a verified collectorless ADOT SDK | JSON stdout -> Lambda service | One SDK owner, cold start, freeze, bounded flush |
| EKS | CloudWatch Observability add-on or OTel collector | JSON stdout -> agent/filelog | Workload identity, pod/resource enrichment |
| EC2 | CloudWatch agent or OTel collector | JSON file/stdout -> agent | Instance profile, agent supervision |
| App Runner | Supported collectorless ADOT SDK or remote collector | Platform stdout collection | No sidecar container |
| On-premises/local | OTel collector | File/stdout agent or OTel bridge | SigV4 credential chain or bearer token |

## ECS and Fargate

Run a collector sidecar in the same task when native OTLP/PromQL metrics are required.

1. Bake `config/otel-collector-cloudwatch.yaml` into a pinned ADOT or collector-contrib image.
2. Set the application exporter endpoint to `http://127.0.0.1:4318`; containers in an `awsvpc` task share the task network namespace.
3. Make the application depend on the collector health check.
4. Grant `cloudwatch:PutMetricData` to the **task role** used by the collector. Keep image pulls and log-driver permissions on the task execution role.
5. Reserve CPU and memory for the collector. Configure `memory_limiter`, a bounded queue, and batch size below CloudWatch limits.
6. Use ECS resource detection or the CloudWatch agent when CloudWatch entity correlation is required.
7. Send one-line structured JSON to stdout through `awslogs` by default. The execution role owns log-driver permissions; the task role owns collector export. If an OTel log bridge is selected, enable the three-signal collector template and remove duplicate platform collection for those records.

AWS also documents an ECS **Use metric collection** option and `ecs-cloudwatch.yaml`. That default ADOT integration exports through EMF to the `ECS/AWSOTel/Application` classic namespace. It is valid for classic metrics but is not the native OTLP/PromQL path. Replace the collector export pipeline when the requirement is the native CloudWatch OTLP store.

Use `config/ecs-fargate-task-definition.json` as a structural template. Pin image digests or tested versions before production.

## AWS Lambda

Lambda does not support a normal long-running sidecar. For CloudWatch APM, prefer the current optimized AWS-managed ADOT Lambda layer/Application Signals or its container-image equivalent. AWS now marks the older Lambda layers with an embedded collector as not recommended for CloudWatch-only destinations.

1. Initialize OTel providers outside the handler so warm invocations reuse instruments and exporters.
2. Choose one provider owner. When the ADOT layer or collectorless ADOT bootstrap initializes OTel, do not also start a second `NodeSDK` in application code.
3. Keep metrics exporting explicit. Current ADOT Lambda defaults can leave metrics disabled or route them through `awsemf`; `awsemf` creates classic metrics, not native OTLP/PromQL metrics.
4. When native OTLP/PromQL custom metrics are required, verify that the selected collectorless ADOT SDK release supports metrics and SigV4 export to the CloudWatch metrics endpoint. The generic `startTelemetry()` example assumes a reachable local OTLP receiver and must not be deployed unchanged when the selected Lambda layer does not expose one.
5. Configure short batch/export intervals appropriate to the remaining invocation time and bound any application-owned flush so telemetry cannot consume the function timeout. When OTel Lambda auto-instrumentation owns the invocation span, do not end or duplicate that span in the handler; let its wrapper finish and flush it. Do not let exporter failure replace the business result.
6. Never call provider `shutdown()` after every invocation; the execution environment may be reused.
7. Configure Lambda `LoggingConfig` as JSON with explicit application/system levels, log group retention, and CloudWatch Logs permissions. Use platform delivery rather than an in-process OTLP log exporter by default.
8. Grant only the required metric, trace, and platform-log write actions to the Lambda execution role.
9. Treat cold-start and timeout telemetry as separate concerns. A function terminated at its hard timeout cannot reliably flush in-process data.
10. Add `aws.log.group.names` to `OTEL_RESOURCE_ATTRIBUTES` when supported and CloudWatch metric/trace-to-log-group navigation is desired. Continue to put `trace_id` and `span_id` in each governed failure record.
11. Load instrumentation before the handler module. The self-managed TypeScript example uses `NODE_OPTIONS=--enable-source-maps --import=./dist/lambda-bootstrap.js`; an ADOT layer or Application Signals bootstrap has its own documented wrapper and must remain the sole provider owner.
12. For AWS active tracing with an ADOT-owned provider, configure `OTEL_PROPAGATORS=tracecontext,baggage,xray-lambda`; never list `xray` and `xray-lambda` together. The self-managed example constructs the equivalent propagator directly.

Use `examples/typescript/src/lambda-bootstrap.ts` plus `lambda-handler.ts` as the canonical provider-reuse and flush example. TypeScript and Python both provide worked SQS and Kinesis asynchronous batch handlers. Check current regional layer ARNs in official AWS documentation instead of hardcoding an ARN in this skill.

## Asynchronous AWS services

The observability contract is not limited to SQS. Every queue, stream, topic, event bus, or workflow adapter must inject/extract OTel context, propagate one stable `correlation_id`, model batches/fan-out with span links, and respect the carrier's quota and privacy rules. Read `async-trace-propagation.md` before claiming end-to-end continuity.

For the SQS example, enable active tracing on API Gateway, every Lambda function, and the SQS queue. The default OTel Lambda instrumentation extracts the `AWSTraceHeader` system attribute and creates consumer links. Use `useGlobalPropagatorForSqsExtraction: true` only when producers deliberately inject W3C fields into message attributes. Enable partial-batch failure reporting when returning `batchItemFailures`.

Kinesis and DynamoDB Streams do not provide the same generic user message-attribute carrier as SQS. The TypeScript and Python Kinesis adapters put the allowlisted propagation carrier and `correlation_id` in a versioned payload envelope, enforce a conservative 1 MiB serialized-envelope ceiling, and assume records have already been deaggregated when KPL aggregation is used. The PutRecord integration must additionally check the current service limit across the data blob and partition key. For DynamoDB Streams, SNS, EventBridge, Step Functions, Kafka, or another transport, verify the current SDK instrumentation and managed-service propagation behavior rather than copying SQS- or Kinesis-specific settings.

## EKS and Kubernetes

Prefer the CloudWatch Observability add-on when Container Insights, AWS resource enrichment, and managed lifecycle are desired. Otherwise run a collector gateway or DaemonSet with IRSA or EKS Pod Identity.

- Point SDKs at the collector service, usually OTLP/gRPC on 4317 or OTLP/HTTP on 4318.
- Enable Kubernetes and AWS resource detection in the collector.
- Keep pod UID, container ID, and similar runtime identity as resource labels supplied by enrichment. Do not copy them into every custom metric definition.
- Separate application custom metrics from collector self-telemetry and infrastructure scraping.

## EC2

Use the CloudWatch agent's OTLP receiver for the most integrated path, or a local OTel collector for direct native endpoints and custom processors. Bind local receivers to loopback unless other hosts must send to them. Use an instance profile for SigV4.

## App Runner

App Runner has no arbitrary sidecar. Use a supported ADOT SDK that can authenticate directly, or export to a reachable collector in a VPC. Do not embed long-lived AWS access keys in the service. Confirm the language distribution supports the desired signal and SigV4 endpoint before selecting collectorless export.

## Local, CI, and on-premises

Send to a local collector and use debug export in tests. For CloudWatch integration tests, prefer a short-lived role obtained through the normal AWS credential chain. If that is impossible, use a CloudWatch metrics bearer token mounted from a secret.

## Verification per deployment

- Confirm the resource contains the expected service and runtime identity.
- Confirm only one metric pipeline exports each instrument.
- Confirm only one delivery path owns each application log record.
- Query one counter, one gauge, and one histogram in Query Studio.
- Query one success/failure event by trace ID in Logs Insights.
- Traverse one real asynchronous workflow and verify the active trace/span IDs plus one stable `correlation_id` through retry, replay, fan-out, and batch links.
- Stop or restart the workload and verify queued telemetry behavior.
- Induce an exporter authentication failure and confirm collector diagnostics make it visible.
- Check that Fargate task or Lambda memory and duration overhead remain within budget.

## Source documentation

- [CloudWatch OTLP getting started](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPGettingStarted.html)
- [Export ECS/Fargate application metrics](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/application-metrics-cloudwatch.html)
- [CloudWatch agent OTLP receiver](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-OpenTelemetry-metrics.html)
- [AWS Distro for OpenTelemetry Lambda](https://aws-otel.github.io/docs/getting-started/lambda/)
- [Collectorless ADOT SDK export](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLP-UsingADOT.html)
- [Lambda structured JSON log format](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)
- [OpenTelemetry AWS Lambda conventions](https://opentelemetry.io/docs/specs/semconv/faas/aws-lambda/)
- [OpenTelemetry messaging span conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
- [AWS SQS tracing](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html)
