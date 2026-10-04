# Charter

Govern required operational coverage for AWS Lambda in any language, CloudWatch, and AWS Lambda Powertools. Metric = aggregate behavior; log = explain a material execution outcome; trace = reconstruct dependency/distributed path and timing. Different questions require different signals; not every helper needs all three.

## Invariants

- Start with the operational question and applicable surface. Apply the prescribed metric baseline even when the user has no preference. Evaluate log and trace requirements alongside it.
- Preserve required measurement meaning; equivalent existing AWS/application coverage can satisfy it. Prove equivalence before omitting custom emission.
- Record coverage as managed, custom, not_applicable, or exception. Unknown needs investigation. Exceptions remain visible gaps with mitigation, owner, and review date.
- Define stable metric name, unit, purpose, population, boundary, statistic/denominator, bounded dimensions, owner, frequency, sampling, and cost. Meaning changes need versioning/migration. Keep the five purposes: outcome, latency, load, resource, correctness.
- Require safe diagnostics for material failures/rejections/degradation/security decisions. Require tracing of meaningful dependencies and distributed paths; document deployment and continuity gaps.
- Use reusable boundary patterns and one emission owner. Helpers translate results/errors; do not scatter instrumentation through local internals.
- Aggregate loops, budget series and EMF volume, keep exact totals unsampled, and preserve latency sample meaning. Cost controls must not silently remove required coverage.
- Use Powertools directly. Initialize utilities outside handlers and reset invocation state. Do not build another logger or a generic observability runtime.
- Keep telemetry failures from changing business outcomes; monitor sustained loss. Required best-effort telemetry does not promise complete delivery through hard timeouts.
- Keep the core contract language neutral. Detect the handler language and adapt its SDK APIs; TypeScript/Python examples are validated mappings, not language limits.
- Keep this skill independent of the root OTel contract and its language implementations.

## Sentry preservation and AWS adaptation

Preserve Sentry Instrumentation's required surface measurements, five purposes, immutable definitions, bounded taxonomy/cardinality, reusable patterns, cost governance, fail-safe behavior, and review/test enforcement. Equivalent AWS coverage is an explicit adaptation of emitter ownership, not an exemption from measurement. Do not copy Sentry APIs, vendor-specific sampling weights, or SDK integration.

Diagnostic log contracts and general dependency/distributed tracing are extensions; the original Sentry skill focuses tracing on AI conversations and does not prescribe these general contracts. Do not claim full rubric coverage is statically enforced.

## Scope

No E2E framework, user-story automation, test generation, ECS/Fargate, EKS, generic OTel architecture, product analytics, or unrelated features. Security evidence does not replace a separately governed durable audit trail.
