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
| Metrics | `MetricDef` + shared OTel emitter; native OTLP/PromQL preferred | Required surface measurements and five purposes retained; equivalent existing coverage or direct Powertools EMF gaps |
| Logs | `LogEventDef` + custom governed structured logger; metric linkage and mandatory sampling metadata | Direct Powertools Logger; independent events with failure-category diagnostics |
| Traces | OTel required; X-Ray SDK prohibited by rules and CI | Explicit tracing enable/disable decision; Powertools Tracer uses the X-Ray SDK |
| Lambda example | Root handler defines invocation/failure metrics and completion/failure logs | Examples implement prescribed applicable metrics, diagnostic logs and meaningful traces |
| Delivery | OTel providers/ADOT/collector topology; platform logs preferred | Lambda stdout for Logger and EMF; Lambda active tracing for Tracer |
| Installation | Fixed root profile; Claude symlink, Codex enable block, other adapters concatenate root references | Explicit `--skill`; nested symlink or compact enable block; conflict rejection |
| Enforcement | Cross-language gate rejects X-Ray/raw logger bypass | Separate rubric and focused example/install checks; root gate stays scoped |

The root skill already warns against mechanically creating the metric triad. Its current Lambda example nevertheless creates custom invocation/failure metrics and completion logging without a consumer-specific decision. The Powertools skill makes the selection record precede API choice; this task does not refactor the root examples.

Preserve Sentry's prescriptive surface coverage, rather than asking the user to invent a metric requirement for each feature. Every applicable request/dependency/stage/queue/retry/fallback/resource surface gets its specified aggregate measurements. Managed AWS/application telemetry can satisfy a measurement only with equivalent population, boundary, outcomes, unit/statistic, scope/dimensions and actual enabled delivery. A server-side DynamoDB latency metric is not caller-observed SDK latency. Logs and sampled traces cannot replace required aggregate coverage.

Use managed/custom/not_applicable/exception per requirement. Unknown triggers assessment; omissions do not silently become opt-outs. Exceptions expose the missing capability, mitigation, owner and review date. Agents apply the baseline when users have no telemetry preference. General diagnostic logging and meaningful dependency/distributed tracing are extensions of the original Sentry metric contract, not substitutes. Trace selection, deployment activation and invocation sampling remain separate; reference order is not implementation order.

Root logging is governed and safe but its event schema alone does not guarantee a specific failed rule or dependency diagnosis. The new skill extends diagnostic sufficiency rather than inheriting mandatory metric linkage or inventing another logger.

## Sentry principles retained and adapted

| Source principle | Treatment |
| --- | --- |
| Outcome, latency, load, resource, correctness | Retain purpose; map semantics to CloudWatch units/statistics rather than Sentry/OTel constructors |
| Closed tags and immutable meaning | Retain bounded dimensions and explicit meaning/version migrations |
| Choke points and reusable surfaces | Retain one emission owner; use Powertools utility/middleware APIs and small category helpers |
| Required surface emissions | Preserve measurement prescription; adapt ownership to proven equivalent AWS/application coverage, otherwise implement Powertools gaps |
| Cost metadata and loop aggregation | Retain budgeting/aggregation; include EMF log volume and CloudWatch series |
| Sampling weights/rate-limit counters | Do not port vendor-specific assumptions or create a governance runtime; exact totals stay unsampled |
| Observability must preserve business behavior | Retain best-effort publication/logging/trace cleanup and focused failure checks |
| Logs outside the core metric contract | Extend with material event selection and category-specific safe diagnostics |
| AST/test enforcement | Preserve enforcement intent through boundary contract tests and review; no claim of full 13-rule Powertools AST parity |

No Sentry APIs, product-specific spans, or Sentry logging integration are copied.

## Tradeoffs and implementation scope

Literal copying of every Sentry custom metric gives uniform emissions but duplicates managed invocation/queue signals and adds CloudWatch series/EMF volume. Per-feature opt-in lowers immediate volume but loses default coverage when the user does not specify requirements. Required equivalent coverage preserves the prescription with less duplication, at the cost of an explicit equivalence/exception review.

Keep definitions local to existing project boundaries, with stable identities, versioned migration, bounded taxonomy and volume budgets. The canonical TypeScript examples use a tiny synchronous publication adapter for cleanup/failure isolation, not a generic registry/logger framework. Request and dependency durations preserve individual samples; batch duration remains a batch sample. Buffer aggregation cuts log records, not series count. No rate cap or sampling may silently discard required exact outcome/resource totals.

## Separate loading and installation

The new SKILL is a small entry point. Its references and canonical examples are self-contained; none imports the root definitions, logger, providers, collector configuration, or Python gate. `--skill=lambda-powertools` resolves only that directory. Omitting `--skill` retains `cloudwatch-instrumentation`.

Claude Code gets a selected-directory symlink. Codex gets a managed enable block. The new Cursor/Aider/Continue/Windsurf adapters also get compact pointers with absolute paths and load references only when needed. Existing root concatenated adapter behavior remains available. Managed updates preserve unrelated text and reject malformed blocks.

Before any installation write, check known project and ancestor discovery surfaces and Claude user-level skill locations for the opposite profile. Reject conflicts with a path and remediation message; do not silently overwrite/switch/merge architectures. Mixed-runtime monorepos need separately scoped project instruction roots. Custom unmanaged instructions still require review; the installer cannot discover every agent configuration.

## Verification and limits

Repository checks cover selected-profile isolation, defaults, idempotence, legacy concatenation detection, marker safety, and preservation of local instructions. Powertools examples are type-checked and exercise diagnostic fields/privacy, one EMF publication per batch, warm cleanup, aggregation, sink/publication failure containment, and meaningful dependency trace cleanup. Root TypeScript/Python checks remain unchanged in scope.

The example checks verify request acceptance/rejection coverage, caller-specific dependency failure/throttle/timing, batch stage/record/fallback totals, safe diagnostics, warm-state cleanup and SDK/sink failure containment. Required surface coverage and managed equivalence are review obligations; the focused tests do not prove every consumer surface is instrumented.

Local checks do not prove EMF extraction, IAM, Lambda active tracing, trace sampling, or continuity through SQS/SNS/EventBridge. Verify those during the consumer's non-production rollout. A correlation ID is not a trace parent, and a batch can contain multiple producer contexts.

Powertools' full-error capture flag does not govern independent SDK instrumentation. The tracing example uses manual meaningful handler/dependency subsegments with independent best-effort cleanup, disables automatic HTTP/response/error capture, and avoids duplicate SDK capture. Consumers that choose SDK capture must review its data separately. The example's fixed application error policy avoids raw runtime error text; consumer business/retry semantics remain the consumer's responsibility.

No E2E framework, user-story automation, test-generation system, non-Lambda runtime, Python parity, or application feature is introduced.

## Sources

- [Sentry Instrumentation](https://github.com/tortastudios/sentry-instrumentation/tree/2beb60282ec5acd7060b4efa60a29d1774784c85)
- [Powertools Logger](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/)
- [Powertools Metrics](https://docs.aws.amazon.com/powertools/typescript/latest/features/metrics/)
- [Powertools Tracer](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/)
- [CloudWatch EMF](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html)
- [SQS trace propagation](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html)
