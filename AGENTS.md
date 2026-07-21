# Agents guide - cloudwatch-instrumentation

## Repository purpose

This repository is an agent skill for adding governed OpenTelemetry metrics and traces plus secure structured logging for Amazon CloudWatch. It is not an application. TypeScript under `examples/typescript/` is the canonical Node.js reference; Python under `examples/python/` is a secondary executable port.

## Editing rules

- Preserve vendor-neutral OTel instrumentation in application code.
- Keep CloudWatch endpoints, SigV4, bearer tokens, batching, and retries in deployment configuration.
- Prefer platform delivery for governed JSON logs on Lambda/Fargate. Use an OTel log bridge only deliberately, and never duplicate records across both paths.
- Apply AWS Well-Architected and OWASP logging guidance: schemas, correlation, sanitization, data minimization, security-event coverage, sink failure isolation, access, and retention.
- Distinguish native CloudWatch OTLP/PromQL metrics from classic CloudWatch/EMF metrics.
- Cover ECS/Fargate and Lambda behavior when changing runtime guidance. Also consider EKS, EC2, App Runner, local development, and on-premises collection.
- Prefer official AWS and OpenTelemetry documentation for compatibility claims. Mark preview behavior and time-sensitive limits.
- Update the matching reference, example, tests, and adapter whenever a public rule changes.
- Run the TypeScript type check/tests and Python gate/tests before committing.

## Skill-enable block

```markdown
<!-- BEGIN cloudwatch-instrumentation -->

## CloudWatch OpenTelemetry instrumentation

Use the `cloudwatch-instrumentation` skill for metrics, traces, structured logs, collectors, PromQL, Logs Insights, and AWS runtime telemetry.

1. Read `<path-to-skill>/SKILL.md`.
2. Select native OTLP/PromQL or classic/EMF before writing instrumentation.
3. Read `<path-to-skill>/references/deployment-targets.md` for Fargate, Lambda, EKS, EC2, App Runner, or non-AWS topology.
4. Read `<path-to-skill>/references/structured-logging.md` before adding application logs.
5. Use `<path-to-skill>/examples/typescript/` for Node.js/TypeScript or `<path-to-skill>/examples/python/` for Python.

Never put raw identifiers, URLs, exception messages, or message bodies in metric attributes. Never log credentials, session values, bodies, prompts, or raw errors. Never hand-roll SigV4 in application instrumentation when a supported agent, ADOT SDK, or collector can own export.

<!-- END cloudwatch-instrumentation -->
```
