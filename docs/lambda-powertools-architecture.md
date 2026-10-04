# Lambda Powertools architecture analysis

## Evidence and decision

Add an independent skill at `skills/lambda-powertools/`. Keep the existing root skill, examples, configurations, and default installation. Select one contract per workload; never concatenate the contracts.

Inspected baseline:

- `oxalc88/aws-observability-instrumentation` main: `b7f15ebea38e7b9446d254861ee8b2331dc240f9`.
- `tortastudios/sentry-instrumentation` main: `2beb60282ec5acd7060b4efa60a29d1774784c85`.
- Root `SKILL.md`, `AGENTS.md`, governance references, TypeScript Lambda/log/metric implementations, all adapters, installer, and validation workflow.
- Sentry `SKILL.md` and charter, metric classes, signal model, boundaries, surface patterns, cost, enforcement, and review rubric.
- Powertools Logger/Metrics/Tracer `2.35.0` source/types and current official documentation. The examples' lockfile records resolved SDK/tool versions.

## What exists and what changes

| Area | Existing root contract/implementation | New Lambda contract |
| --- | --- | --- |
| Scope | Multiple AWS runtimes, TypeScript plus Python parity | Lambda TypeScript/Node.js only |
| Metrics | `MetricDef` + shared OTel emitter; native OTLP/PromQL preferred | Five purposes retained; direct Powertools EMF publication when justified |
| Logs | `LogEventDef` + custom governed structured logger; metric linkage and mandatory sampling metadata | Direct Powertools Logger; independent events with failure-category diagnostics |
| Traces | OTel required; X-Ray SDK prohibited by rules and CI | Optional Powertools Tracer, which uses the X-Ray SDK |
| Lambda example | Root handler defines invocation/failure metrics and completion/failure logs | Examples deliberately omit unnecessary signals |
| Delivery | OTel providers/ADOT/collector topology; platform logs preferred | Lambda stdout for Logger and EMF; Lambda active tracing for Tracer |
| Installation | Fixed root profile; Claude symlink, Codex enable block, other adapters concatenate root references | Explicit `--skill`; nested symlink or compact enable block; conflict rejection |
| Enforcement | Cross-language gate rejects X-Ray/raw logger bypass | Separate rubric and focused example/install checks; root gate stays scoped |

The root skill already warns against mechanically creating the metric triad. Its current Lambda example nevertheless creates custom invocation/failure metrics and completion logging without a consumer-specific decision. The Powertools skill makes the selection record precede API choice; this task does not refactor the root examples.

Root logging is governed and safe but its event schema alone does not guarantee a specific failed rule or dependency diagnosis. The new skill extends diagnostic sufficiency rather than inheriting mandatory metric linkage or inventing another logger.

## Sentry principles retained and adapted

| Source principle | Treatment |
| --- | --- |
| Outcome, latency, load, resource, correctness | Retain purpose; map semantics to CloudWatch units/statistics rather than Sentry/OTel constructors |
| Closed tags and immutable meaning | Retain bounded dimensions and explicit meaning/version migrations |
| Choke points and reusable surfaces | Retain one emission owner; use Powertools utility/middleware APIs and small category helpers |
| Automatic surface emission triads | Replace with independent question-based signal choice |
| Cost metadata and loop aggregation | Retain budgeting/aggregation; include EMF log volume and CloudWatch series |
| Sampling weights/rate-limit counters | Do not port vendor-specific assumptions or create a governance runtime; exact totals stay unsampled |
| Observability must preserve business behavior | Retain best-effort publication/logging/trace cleanup and focused failure checks |
| Logs outside the core metric contract | Extend with material event selection and category-specific safe diagnostics |
| AST/test enforcement | Reuse review plus focused verification; do not claim a generic Powertools gate exists |

No Sentry APIs, product-specific spans, or Sentry logging integration are copied.

## Separate loading and installation

The new SKILL is a small entry point. Its references and canonical examples are self-contained; none imports the root definitions, logger, providers, collector configuration, or Python gate. `--skill=lambda-powertools` resolves only that directory. Omitting `--skill` retains `cloudwatch-instrumentation`.

Claude Code gets a selected-directory symlink. Codex gets a managed enable block. The new Cursor/Aider/Continue/Windsurf adapters also get compact pointers with absolute paths and load references only when needed. Existing root concatenated adapter behavior remains available. Managed updates preserve unrelated text and reject malformed blocks.

Before any installation write, check known project and ancestor discovery surfaces and Claude user-level skill locations for the opposite profile. Reject conflicts with a path and remediation message; do not silently overwrite/switch/merge architectures. Mixed-runtime monorepos need separately scoped project instruction roots. Custom unmanaged instructions still require review; the installer cannot discover every agent configuration.

## Verification and limits

Repository checks cover selected-profile isolation, defaults, idempotence, legacy concatenation detection, marker safety, and preservation of local instructions. Powertools examples are type-checked and exercise diagnostic fields/privacy, one EMF publication per batch, warm cleanup, aggregation, sink/publication failure containment, and meaningful dependency trace cleanup. Root TypeScript/Python checks remain unchanged in scope.

A forward trial loaded only the new skill/references for an HTTP Lambda with validation, DynamoDB, fallback, and SQS. It selected Logger + Tracer, removed helper counts/subsegments/raw data, and omitted custom metrics until a separate aggregate need exists. This is one decision-quality check, not proof of every scenario.

Local checks do not prove EMF extraction, IAM, Lambda active tracing, trace sampling, or continuity through SQS/SNS/EventBridge. Verify those during the consumer's non-production rollout. A correlation ID is not a trace parent, and a batch can contain multiple producer contexts.

Powertools' full-error capture flag does not govern independent SDK instrumentation. The tracing example uses a manual meaningful dependency subsegment, disables automatic HTTP/response/error capture, and avoids duplicate SDK capture. Consumers that choose SDK capture must review its data separately. The example's fixed application error policy avoids raw runtime error text; consumer business/retry semantics remain the consumer's responsibility.

No E2E framework, user-story automation, test-generation system, non-Lambda runtime, Python parity, or application feature is introduced.

## Sources

- [Sentry Instrumentation](https://github.com/tortastudios/sentry-instrumentation/tree/2beb60282ec5acd7060b4efa60a29d1774784c85)
- [Powertools Logger](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/)
- [Powertools Metrics](https://docs.aws.amazon.com/powertools/typescript/latest/features/metrics/)
- [Powertools Tracer](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/)
- [CloudWatch EMF](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html)
- [SQS trace propagation](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html)
