---
name: lambda-powertools
description: >-
  Apply AWS Lambda Powertools Logger, Metrics (EMF), and Tracer with useful
  operational coverage and minimal implementation complexity. Use for Lambda
  request, dependency, workflow, queue, retry, fallback, and failure observability.
  Excludes generic OTel architecture and non-Lambda workloads.
metadata:
  version: "0.2.0"
---

# Lambda Powertools

**Goal:** Make failures diagnosable and behavior measurable with the least necessary code.
This is a set of implementation preferences, not a framework or recipe.

## Decisions

- Start with the operational question. Inspect existing telemetry and its owner before writing code.
- Keep required **metric coverage** for applicable surfaces. Reuse equivalent managed AWS metrics; otherwise implement missing aggregate counts, durations, and resource/correctness measures. Preserve the five metric purposes, dimension budgets, semantics, one publication owner, and warm-state cleanup. Read [surface coverage](references/lambda-surfaces.md), [metrics](references/metrics.md), and [signal selection](references/signal-selection.md).
- Emit one useful, safe **failure log** at the owner of each material failure, rejection, degradation, or security decision. Include operation, stage, specific safe reason/rule, location or dependency, correlation, and observed status/code where available. Use Powertools Logger directly. Read [logging](references/logging.md); consult [diagnostic sufficiency](references/diagnostic-sufficiency.md) for category-specific fields.
- Trace meaningful **dependencies and distributed paths** where a trace can answer a timing/causality question. Prefer supported Powertools middleware, decorators, and reviewed SDK instrumentation. Avoid duplicate capture and manual segment lifecycle unless a proven gap justifies it. Read [tracing](references/tracing.md).
- Keep received facts, failure classification, and the application's existing retry decision separate. Never change business results or retry/ack behavior for instrumentation.
- Never emit raw requests, events, headers, credentials, tokens, successful authentication payloads, unreviewed error/response objects, or personal data. Do not enable unchecked automatic response/error capture.
- Prefer subtraction: remove redundant logs, layers, custom serializers, emitters, segments, and shared mutable state before adding code. No custom diagnostic multipart protocol or cause-chain crawler by default.
- Keep Lambda Powertools independent of the root OpenTelemetry skill.

## Route only when relevant

| Need | Reference |
| --- | --- |
| Metric requirements and exact measurement contracts | [Metrics](references/metrics.md), [surface coverage](references/lambda-surfaces.md), [example contracts](references/example-contracts.md) |
| Failure investigation and safe fields | [Logging](references/logging.md), [diagnostic sufficiency](references/diagnostic-sufficiency.md) |
| Untrusted provider errors | [Error handling](references/error-evidence.md) |
| Dependency or distributed tracing | [Tracing](references/tracing.md) |
| SDK-specific APIs | [Language adaptation](references/language-adaptation.md) and selected language reference |
| Review, cost, coverage exceptions | [Review](references/review-rubric.md), [enforcement](references/enforcement.md), [cost](references/cost-and-noise.md) |

Load only references needed for the change. Examples are behavior illustrations, not required architecture. Use official Powertools documentation for SDK APIs and defaults. Test observable results rather than copying example internals.
