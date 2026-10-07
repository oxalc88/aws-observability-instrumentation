---
name: lambda-powertools
description: Apply prescribed operational coverage for AWS Lambda across languages using CloudWatch and AWS Lambda Powertools Logger, Metrics (EMF), and Tracer. Use when adding or reviewing request, dependency, workflow, queue/batch, retry, fallback, resource, diagnostic logging, or distributed tracing instrumentation. Preserve Sentry-style required surface measurements; reuse proven equivalent AWS telemetry, fill gaps, and record exceptions. Excludes generic OTel architecture, non-Lambda platforms, E2E frameworks, and test generation.
---

# Lambda Powertools

Start with an operational question. Apply required coverage at applicable boundaries; add the minimum telemetry that fulfills it safely and within budget. Do not scatter Logger + Metrics + Tracer across helpers.

## Coverage before coding

```mermaid
flowchart TD
    S["Applicable operational surface"] --> Q["Prescribed questions"]
    Q --> M["Metrics: aggregate behavior"]
    Q --> L["Logs: material outcome diagnosis"]
    Q --> T["Traces: dependency and distributed path"]
    M --> C["Prove existing coverage or fill gaps"]
    L --> C
    T --> C
```

Evaluate all signals together; order here is not implementation priority. Metrics are primary for aggregate monitoring/alerts. Logs and sampled traces cannot replace metric coverage. Required measurements do not imply custom metrics when AWS/application equivalents already exist.

1. Detect the handler language/runtime from entry points, deployment and manifests. Apply this shared contract in any language; load [language adaptation](references/language-adaptation.md) and the matching SDK reference. TypeScript/Python are tested examples, not an allowlist. Inspect Lambda triggers, dependencies, stages, retries/acks, fallback/resource use, existing emitters, deployment, and Powertools versions. Apply [required surface coverage](references/lambda-surfaces.md) even when the user has no preference.
2. Record each requirement as `managed`, `custom`, `not_applicable`, or `exception`, with question, owner, evidence, semantics and cost. Prove existing equivalence; report gaps with mitigation, owner and review date. Unknown requires assessment, not silent opt-out. Read [signal selection](references/signal-selection.md).
3. Define custom metrics once: fixed name/unit, exactly one purpose (`outcome`, `latency`, `load`, `resource`, `correctness`), population, boundary, statistic/denominator, bounded dimensions, frequency, sampling and budget. Version meaning changes. Read [metrics](references/metrics.md) and [canonical contracts](references/example-contracts.md).
4. Require one safe diagnostic event for each material failure/rejection/degradation/security outcome. Use its category contract, not generic `invalid_input`. Read [logging](references/logging.md), [diagnostic sufficiency](references/diagnostic-sufficiency.md), and [failure taxonomy](references/failure-taxonomy.md).
5. Require tracing of meaningful dependencies and distributed paths. Record enabled/disabled and coverage state; reuse an existing owner, or document non-applicability/exception. Verify activation, permissions, sampling, capture safety and supported handoffs. Read [tracing](references/tracing.md).
6. Extend reusable boundary patterns with Powertools directly. Keep one emission owner, aggregate loops, preserve latency samples, clear warm state and contain telemetry failures. Do not import the root OTel runtime or create a competing logger/framework.
7. Budget metric series + EMF/log volume + trace volume + maintenance. Reduce duplicates/dimensions/publications before exceptions. Read [cost and noise](references/cost-and-noise.md).
8. Apply [review rubric](references/review-rubric.md) and [enforcement](references/enforcement.md). Report covered requirements and unresolved gaps. Do not claim unverified managed equivalence or trace continuity.

## Hard rules

- Never emit raw events/bodies/headers, credentials/tokens, arbitrary/unreviewed error objects, or sensitive data in logs, trace metadata, or EMF. Preserve exact observed HTTP status, approved provider code/message, and sanitized bounded exception message/stack/cause chain at material failures; record redaction, truncation and omissions. Separate observed evidence, internal classification and retry decision. Read [error evidence](references/error-evidence.md).
- No helper-step narrative INFO, helper metrics/subsegments, duplicate terminal logs, SDK/manual subsegments, or publication owners. Meaningful workflow transitions with an operator reconstruction use case may emit bounded INFO.
- Keep exact outcome/resource totals unsampled. A duration total is not a latency distribution. A processed record is not an acknowledged message or unique business event.
- Keep business results/retries intact when telemetry fails; hard timeouts can bypass cleanup. Retain managed platform coverage and verify sustained telemetry loss separately.
- Keep this contract separate from root `cloudwatch-instrumentation`: classic EMF metrics and X-Ray-backed Powertools Tracer, not root OTel/OTLP requirements.

## Load on demand

| Need | Read |
| --- | --- |
| Language detection, other-language ports and SDK gaps | [language adaptation](references/language-adaptation.md) |
| Node.js API/lifecycle/capture details | [TypeScript/JavaScript](references/languages/typescript.md) |
| Python API/lifecycle/capture details | [Python](references/languages/python.md) |
| Scope, Sentry preservation and AWS adaptation | [charter](references/charter.md) |
| Required measurements/events/paths | [Lambda surfaces](references/lambda-surfaces.md) |
| Coverage states, equivalence and exceptions | [signal selection](references/signal-selection.md) |
| Metric definitions, lifecycle, publication | [metrics](references/metrics.md), [example contracts](references/example-contracts.md) |
| Safe diagnostic logging | [logging](references/logging.md), [diagnostic sufficiency](references/diagnostic-sufficiency.md), [error evidence](references/error-evidence.md), [failure taxonomy](references/failure-taxonomy.md) |
| Dependency/distributed tracing and activation | [tracing](references/tracing.md) |
| Cost, review and checks | [cost/noise](references/cost-and-noise.md), [review](references/review-rubric.md), [enforcement](references/enforcement.md) |
| Request metrics + validation diagnostics; tracing not applicable | [validation-handler.ts](examples/typescript/src/validation-handler.ts) |
| Batch outcome/duration/fallback metrics + terminal diagnostics | [batch-metrics.ts](examples/typescript/src/batch-metrics.ts) |
| Dependency metrics + meaningful trace + terminal diagnostics | [dependency-handler.ts](examples/typescript/src/dependency-handler.ts) |

Python equivalents: [validation_handler.py](examples/python/powertools_examples/validation_handler.py), [batch_metrics.py](examples/python/powertools_examples/batch_metrics.py), [dependency_handler.py](examples/python/powertools_examples/dependency_handler.py). Load only the implementation matching the handler.
