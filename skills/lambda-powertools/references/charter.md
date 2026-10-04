# Charter

Govern operational telemetry for AWS Lambda, TypeScript/Node.js, CloudWatch, and AWS Lambda Powertools. Logger explains one material outcome; Metrics answers an aggregate question; Tracer reconstructs useful path and timing. Each can exist independently.

## Invariants

- Start with a question and an operator action, then choose a signal and API.
- Prefer managed AWS coverage before custom telemetry.
- Define metric meaning, dimensions, units, ownership, and emission frequency once. Define log diagnostics by failure category.
- Measure at choke points. Helpers translate domain results/errors; the owning boundary emits.
- Use closed categories, safe shape/type information, and bounded fields. Correlation identifiers are approved opaque values, never metric dimensions.
- Initialize selected utilities at module scope. Prevent warm-invocation state leakage and duplicate emission.
- Keep observability failures from changing business outcomes. Make sustained telemetry loss visible through operational checks.
- Keep this skill independent of the root OTel skill. No OTel provider, collector, resource contract, or shared custom logger is required here.

## Scope limits

No E2E framework, user-story automation, test generation, ECS/Fargate, EKS, generic OTel architecture, Python parity, product analytics, or unrelated application features. Important security decisions are operational evidence; a regulated audit trail needs its own durability and access contract.

The metric purposes, bounded cardinality, immutable meaning, cost review, and boundary ownership extend [Sentry Instrumentation](https://github.com/tortastudios/sentry-instrumentation). Do not copy Sentry APIs, automatic emission triads, sampling weights, or its logging integration.
