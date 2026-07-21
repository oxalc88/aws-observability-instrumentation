# Changelog

## Unreleased

### CloudWatch/OpenTelemetry adaptation

- Replaced vendor-specific instrumentation policy with language-agnostic OpenTelemetry contracts for CloudWatch native OTLP metrics and traces.
- Added TypeScript as the canonical Node.js implementation with runtime metric validation, histogram views, auto-instrumentation, HTTP patterns, Lambda lifecycle handling, typechecking, and tests.
- Retained Python as a secondary cross-language implementation and expanded the policy gate to check Python, TypeScript, and JavaScript.
- Added SigV4 and bearer-token collector configurations, an ECS/Fargate task definition template, and least-scope metric/trace IAM actions.
- Added AWS runtime guidance for Fargate, Lambda, EKS, EC2, App Runner, local, and on-premises workloads.
- Added CloudWatch PromQL naming, query, and dashboard guidance.
- Added a third observability pillar: AWS/OWASP-aligned structured logging with declared event schemas, trace/correlation fields, sensitive-data defaults, log-injection controls, security-event behavior, and sink failure isolation.
- Added Lambda/Fargate platform-log guidance, an opt-in three-signal CloudWatch OTLP collector, log IAM scope, Logs Insights queries, and a safe investigation playbook.
- Added safe exception type and OTel `code.*` source locations, checked metric/log operation links, managed-field protection, and TypeError taxonomy tests so failure metrics lead to the responsible code and trace.
- Added ordered deterministic log sampling in TypeScript and Python, managed sampling metadata, and locked 100% retention for errors and security events.
- Added transport-neutral asynchronous OTel/correlation carriers, an AWS Lambda `xray-lambda` bootstrap, and a tested TypeScript SQS adapter with attribute-quota enforcement, producer links, per-record spans, and partial-batch failures.
- Added the Python SQS adapter with the same correlation cascade, AWS X-Ray or W3C extraction modes, ten-attribute quota enforcement, producer links, per-record spans, correlated metrics/logs, and partial-batch failures.
- Added the TypeScript Kinesis adapter with a versioned propagation envelope, a conservative 1 MiB serialized-envelope preflight, producer links, per-record spans, a bounded-flush Lambda batch example, and tests for contract failures and trace-context round trips.
- Updated Lambda guidance for AWS's optimized ADOT layer and collectorless SDK, and removed the legacy embedded-collector template as a default option.
- Ended Lambda invocation spans before bounded provider flushes and contained exporter failures so telemetry cannot replace the function result.
- Updated the agent manifest, installer, adapters, and repository documentation for `cloudwatch-instrumentation`.

The repository remains pre-release. Pin exact OpenTelemetry packages and AWS collector/layer versions after integration testing in the target region.
