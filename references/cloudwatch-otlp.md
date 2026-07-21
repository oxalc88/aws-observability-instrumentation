# CloudWatch OTLP contract

Use this reference before editing exporters, IAM, collector topology, or CloudWatch queries.

## Choose the metric store deliberately

CloudWatch currently has two relevant custom-metric paths:

| Path | Ingestion | Query model | Typical use |
| --- | --- | --- | --- |
| Native OTel metrics | OTLP/HTTP to the CloudWatch metrics endpoint | PromQL and Query Studio; OTel resource, scope, and data-point attributes remain queryable labels | New OTel/PromQL systems and label-rich telemetry |
| Classic CloudWatch metrics | `PutMetricData` or EMF through CloudWatch Logs | CloudWatch namespace, metric name, dimensions, and Metric Insights | Existing dashboards, Application Signals integrations, and EMF pipelines |

The paths are not interchangeable. An ADOT `awsemf` exporter produces classic metrics. An `otlphttp` exporter targeting the monitoring endpoint produces native OTel metrics. Do not dual-publish by default because it creates two billing and alerting surfaces.

## Native endpoints

Use regional HTTP endpoints:

```text
metrics: https://monitoring.<region>.amazonaws.com/v1/metrics
traces:  https://xray.<region>.amazonaws.com/v1/traces
logs:    https://logs.<region>.amazonaws.com/v1/logs
```

CloudWatch OTLP endpoints accept OTLP 1.x over HTTP only, with protobuf or JSON payloads and gzip or no compression. Do not point an OTLP/gRPC exporter directly at these endpoints.

For metrics, SigV4 uses service name `monitoring`. For traces it uses `xray`. For logs it uses `logs`.

## X-Ray name versus X-Ray instrumentation

Do not add an AWS X-Ray SDK or X-Ray daemon. AWS placed the SDKs and daemon in maintenance mode on February 25, 2026 and recommends OpenTelemetry SDKs with the CloudWatch Agent or an OpenTelemetry Collector.

AWS nevertheless documents `https://xray.<region>.amazonaws.com/v1/traces` as the current CloudWatch OTLP/HTTP traces endpoint, with `xray` as its SigV4 service name. Using that endpoint with OTel spans is the migration target, not continued use of the X-Ray SDK or daemon. Trace export is optional when the task only requires native metrics and PromQL.

## Authentication

Prefer SigV4 with short-lived role credentials on AWS:

```yaml
extensions:
  sigv4auth/metrics:
    service: monitoring
    region: ${env:AWS_REGION}
```

The metrics sender needs `cloudwatch:PutMetricData`. Trace export needs the X-Ray write actions required by the selected integration. Use a task role, Lambda execution role, EC2 instance profile, or EKS workload identity instead of static keys.

The OTLP logs endpoint requires `x-aws-log-group` and `x-aws-log-stream` headers and CloudWatch Logs write permission. Pre-create the group/stream when possible so the collector task role can be limited to `logs:PutLogEvents` on a specific log-stream ARN. Lambda platform logging instead uses the Lambda execution role and normally needs `logs:CreateLogGroup`, `CreateLogStream`, and `PutLogEvents` (or `AWSLambdaBasicExecutionRole`).

Metrics and logs also support bearer tokens. Use them for non-AWS workloads that cannot use the AWS credential chain. Mount the token from a secret and configure `bearertokenauth`; never commit it or put it in a metric attribute.

## Metrics endpoint limits

Design batching below the documented hard limits:

- 1 MB maximum uncompressed request size.
- 1,000 data points maximum per request.
- 150 labels maximum across resource, scope, and data-point attributes.
- 40 KB maximum combined label metadata per series and data point.
- 500 requests per second per account.
- Metric timestamps may be at most 10 minutes in the future or 14 days in the past.

These service limits are not design targets. Keep application attributes bounded even though CloudWatch accepts many labels: every unique label tuple is still a time series and affects query volume, operational complexity, and cost.

## Resource versus data-point attributes

Put stable process/workload identity on the resource:

```text
service.name
service.version
deployment.environment.name
cloud.region
cloud.account.id
cloud.platform
aws.ecs.cluster.arn
aws.ecs.task.arn
faas.name
faas.version
```

Use the applicable OTel resource detector rather than reading metadata endpoints by hand. Put operation-specific bounded fields such as `http.route`, `rpc.method`, `app.workflow.step`, `outcome`, and `failure.class` on metric data points.

## Collector requirements

- Receive OTLP on the task/pod/host network.
- Add `memory_limiter` before `batch` for long-running collectors.
- Keep batch size at or below 1,000 data points; the bundled configuration uses 200.
- Enable gzip, retry with a finite elapsed time, and a bounded sending queue.
- Use `metrics_endpoint`, `traces_endpoint`, and `logs_endpoint` when one collector exports multiple signals.
- Expose health checks for orchestrator startup dependencies.
- Monitor collector refused, dropped, failed-export, queue-size, and retry metrics.
- Do not enable an OTLP logs pipeline for records already delivered by Lambda or an ECS log driver.

## Logs endpoint requirements

CloudWatch OTLP log requests require POST, the signal-specific group/stream headers, and OTLP JSON or protobuf. Normal requests are limited to 1 MB uncompressed and 10,000 log events; an individual event is limited to 1 MB. CloudWatch may return partial success, and throttled/unavailable responses can include `Retry-After`. Verify current limits and Large Log Object regional support before relying on oversized-event behavior; application records should remain far smaller.

## Source documentation

- [CloudWatch OTLP endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html)
- [Migrate X-Ray instrumentation to OpenTelemetry](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-migration.html)
- [X-Ray SDK and daemon support timeline](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html)
- [Send metrics using OpenTelemetry](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/metrics-otel-send.html)
- [Query metrics with PromQL](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-PromQL.html)
- [CloudWatch OpenTelemetry getting started](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPGettingStarted.html)
- [Send logs to the CloudWatch OTLP endpoint](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_HTTP_Endpoints_OTLP.html)
