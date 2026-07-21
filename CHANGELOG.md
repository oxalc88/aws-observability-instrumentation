# Changelog

All notable changes to the `cloudwatch-instrumentation` skill are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); version numbers follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-21

Initial CloudWatch/OpenTelemetry release, derived from `sentry-instrumentation` `v1.2.0` at commit `2beb602`. This project follows an independent version line from that baseline.

### Added

- **TypeScript reference implementation** with runtime metric validation, histogram views, OTel auto-instrumentation, structured logging, HTTP/workflow surfaces, Lambda lifecycle handling, typechecking, and tests.
- **Python parity implementation** for governed metrics, structured logs, traces, Lambda lifecycle, and the shared failure taxonomy.
- **SQS adapters for TypeScript and Python** with correlation validation, AWS X-Ray or W3C extraction, ten-attribute quota enforcement, producer links, per-record spans, correlated metrics/logs, and partial-batch failures.
- **Kinesis adapters for TypeScript and Python** with versioned propagation envelopes, conservative 1 MiB serialized-envelope preflights, producer links, per-record spans, correlated metrics/logs, default all-or-retry Lambda handlers, and contract tests.
- **Transport-neutral workflow propagation** carrying OTel context and a stable business `correlation_id` independently across retries, fan-out, DLQs, and replay.
- **CloudWatch deployment templates** for SigV4 or bearer-token OTLP export, ECS/Fargate, three-signal collection, and least-scope IAM.
- **AWS/OWASP-aligned structured logging** with declared schemas, trace correlation, privacy classes, injection controls, deterministic sampling, locked error/security retention, safe exception source fields, and sink failure isolation.
- **CloudWatch references** for native OTLP and PromQL, deployment targets, structured logging, asynchronous propagation, Logs Insights investigations, and AI/LLM semantic spans.

### Changed

- Replaced vendor-specific instrumentation policy with language-agnostic OpenTelemetry contracts for CloudWatch native OTLP metrics and traces.
- Expanded the static policy gate to cover Python, TypeScript, JavaScript, metric/log operation links, Lambda lifecycle, sensitive content, and unsafe raw logging.
- Updated Lambda guidance for optimized ADOT/Application Signals or verified collectorless SDK ownership, bounded flushes, and platform-delivered JSON logs.
- Updated the skill manifest, installer, agent adapters, and repository documentation for `cloudwatch-instrumentation`.

### Removed

- Removed inherited vendor-specific instrumentation rules and obsolete AWS X-Ray SDK/embedded-collector recommendations; AWS-compatible propagation remains implemented through OpenTelemetry.
