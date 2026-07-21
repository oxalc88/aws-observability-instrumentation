# Deployment configuration templates

These files are not loaded automatically by the skill or by application code. They are validated infrastructure examples that an agent can select and adapt after it identifies the target AWS runtime and required signals.

## Why they belong in the skill

Instrumentation is incomplete until telemetry can leave the process safely. The templates prevent common generated-code errors:

- Pointing a normal OTel exporter directly at AWS without SigV4.
- Using OTLP/gRPC against CloudWatch endpoints that accept OTLP/HTTP only.
- Calling `PutMetricData` from Node business code.
- Using `awsemf` while claiming the result is in the native OTel/PromQL store.
- Putting collector permissions on the Fargate execution role instead of the task role.
- Deploying unbounded queues or batches above CloudWatch request limits.
- Sending the same application log through an ECS/Lambda platform channel and an OTLP log bridge.
- Logging JSON without field governance, injection controls, retention, or access policy.
- Initializing or shutting down telemetry on every Lambda invocation.
- Adding the legacy X-Ray SDK or X-Ray daemon because the current AWS trace endpoint contains `xray` in its hostname.

The files also give the skill concrete values that can be schema-validated. This is more reliable than asking an agent to reconstruct collector component names, endpoint fields, and pipeline wiring from prose for every project.

## Files

| File | Use |
| --- | --- |
| `otel-collector-cloudwatch.yaml` | ADOT/upstream collector on long-running AWS workloads using SigV4; includes native metrics and optional OTel traces |
| `otel-collector-cloudwatch-three-signals.yaml` | Opt-in metrics/traces/logs collector for an application using an OTel logging bridge; requires log group/stream headers |
| `otel-collector-bearer.yaml` | Metrics-only export from a non-AWS workload using a mounted CloudWatch bearer token |
| `ecs-fargate-task-definition.json` | Application plus collector sidecar topology, health dependency, ports, roles, and resource reservation |
| `iam-otel-writer-policy.json` | Example metric, trace, and OTLP log write actions; split/remove statements and scope placeholders for least privilege |

## Selection rules

1. Start with the signals the workload actually emits. Remove unused pipelines and IAM statements.
2. On AWS, prefer the CloudWatch Agent for most workloads because AWS manages its CloudWatch components and integrations. Use the upstream collector when portability or a different component set is required.
3. Do not copy a long-running collector configuration into Lambda. Use the current optimized ADOT layer or a verified collectorless ADOT release, and ensure only one component owns OTel provider initialization.
4. Replace every placeholder and pin image digests or tested versions before deployment.
5. Validate the final configuration with the exact collector or CloudWatch Agent build used in production.

## Log delivery selection

The default Fargate task template writes governed one-line JSON to stdout and uses the ECS `awslogs` driver. Keep `otel-collector-cloudwatch.yaml` for native metrics and traces in that topology. Log-driver permissions belong on the ECS execution role; collector export permissions belong on the task role.

Use `otel-collector-cloudwatch-three-signals.yaml` only after configuring an established application logger bridge/exporter to send OTLP logs to the local receiver. Set `CLOUDWATCH_LOG_GROUP` and `CLOUDWATCH_LOG_STREAM`, pre-create both resources, and scope `logs:PutLogEvents` to that stream. Remove or filter the equivalent stdout path so CloudWatch does not ingest each record twice.

For the CloudWatch Agent, append the selected OTel YAML with unique component suffixes as AWS documents; do not assume a standalone collector configuration can be copied into the agent without resolving merged component names.

## Lambda logging

Lambda should normally use platform log delivery, not the collector logs pipeline. Configure the function in CloudFormation/SAM with:

```yaml
Properties:
  LoggingConfig:
    LogFormat: JSON
    ApplicationLogLevel: INFO
    SystemLogLevel: WARN
    LogGroup: /aws/lambda/replace-me
```

Pre-create the group with encryption and a finite retention policy. Grant the execution role `logs:CreateLogStream` and `logs:PutLogEvents`; include `logs:CreateLogGroup` only when infrastructure does not create it. The AWS managed `AWSLambdaBasicExecutionRole` is a convenient baseline but may be broader than a resource-scoped application policy.

The older ADOT Lambda layers with an embedded collector are not the default CloudWatch path. AWS currently marks them as not recommended for CloudWatch-only destinations. If a non-CloudWatch destination forces that advanced topology, build and validate a release-specific extension configuration outside these general templates.

## About the `xray` name

This skill does not depend on the X-Ray SDK or daemon. AWS currently documents `https://xray.<region>.amazonaws.com/v1/traces` as the CloudWatch OTLP/HTTP trace endpoint and `xray` as its SigV4 service name. That backend endpoint remains the documented destination for OTel spans even though AWS recommends replacing its legacy SDK and daemon with OpenTelemetry.

## AWS sources

- [CloudWatch Agent with OpenTelemetry configuration](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPCloudWatchAgent.html)
- [CloudWatch OTLP endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html)
- [Lambda structured JSON logging](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)
- [Current ADOT Lambda guidance](https://aws-otel.github.io/docs/getting-started/lambda/)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Migrate X-Ray instrumentation to OpenTelemetry](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-migration.html)
