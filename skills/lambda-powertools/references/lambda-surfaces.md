# Required coverage at Lambda surfaces

Apply this baseline to every applicable surface even when the user has not specified telemetry. Start with its operational question; the prescription supplies a default question, not permission to instrument every helper. Record coverage as `managed`, `custom`, `not_applicable`, or `exception` using [signal selection](signal-selection.md). No silent omission.

## Metric prescriptions

Names below describe logical measurements, not a mandatory application namespace. Use stable project names and five governed purposes. Equivalent existing coverage can satisfy a row; otherwise implement the missing measurement with Powertools Metrics.

| Surface | Required aggregate question and measurements | Boundary and equivalence caution |
| --- | --- | --- |
| Lambda invocation | How often does it run/fail and how long does it execute? Invocation count, runtime failure count, duration | Managed Lambda Invocations/Errors/Duration normally cover invocation semantics; include managed throttles/timeouts for platform visibility |
| HTTP/application request | What is request volume, latency, and classified rejection/failure rate? Request count, request duration, conditional failure count with bounded status/failure class | Request entry → terminal response/error, including handled validation/business rejections. Lambda Errors does not count handled 400s; Lambda Duration is not automatically the same interval |
| External dependency | How often does a logical call fail/throttle and how long does it take from this caller? Call count, call duration, classified failure count, throttling/rate-limit count where applicable | Dependency entry → return/throw, including SDK retries when defined as a logical call. Server-side service latency and sampled traces are not equivalent caller metrics |
| Workflow stage | How long does a stage take and which failures occur? Duration on every completed attempt; classified failure count on failure | Stage entry → completion/failure; retries are attempts, not unique business outcomes. Add a stage total if a rate is needed and no compatible denominator exists |
| Queue/worker | How much work enters/leaves and what remains? Enqueued and received/dequeued counts, terminal record outcomes, backlog and in-flight values | Producer acceptance, consumer receive, actual ack/delete, terminal work, and queue state are distinct. Name each owner; managed queue/ESM metrics require matching semantics/scope and any required opt-in. Processing success is not proof of ack |
| Retry boundary | How many attempts are needed and what is the terminal result? Attempt count/buckets and terminal outcome | Aggregate at retry loop exit, distinguishing SDK attempts, application retries, and queue delivery. Do not invent invisible SDK attempts or claim exhaustion from a receive count |
| Fallback/degradation | How often does an assumption fail or fallback occur? Correctness count with bounded reason | One fallback selection owner. Count recovered fallback separately from terminal failure; use a compatible total if reporting a rate |
| Consumable resource | How much of a relevant budget did work consume? Resource amount with explicit unit | Actual bytes/tokens/quota consumed at the responsible boundary; record applicability when no relevant metered budget exists |

Failure subsets may be queried from an outcome metric with a closed result/failure-class dimension instead of publishing duplicate totals, provided the full prescribed meaning remains available. Do not sample exact outcome/resource totals. Preserve duration samples for distributions; a batch total is not per-record latency.

## Log and trace prescriptions (extensions beyond Sentry)

| Surface/event | Required execution evidence | Required path/timing coverage |
| --- | --- | --- |
| Material validation/business rejection | One safe rule/reason + location + correlation event | Local validation needs no helper subsegment; document tracing non-applicability |
| Terminal dependency/internal failure | One classified event identifying dependency/location and safe reason | Meaningful dependency boundary, including successful calls, with safe capture and sampling |
| Material fallback/degradation | One diagnostic event when operators need the cause for that execution | Trace the alternative remote path when present; no subsegment just for a local choice |
| Security decision | Required safe decision/rule evidence under the security contract | Trace only meaningful remote/distributed path; never put credentials into traces |
| Distributed workflow/queue stages | Correlation at material outcomes, per invocation/record | Producer → supported transport → consumer continuity; verify each handoff and report unsupported gaps |
| Ordinary successful local processing | No narrative INFO or routine success log required | No trivial helper subsegments |

Tracing is prescribed for meaningful external dependencies and distributed execution paths, even without a user preference. A workload with neither can record `not_applicable` and disable Tracer. Existing tracing may own the path. Unsupported continuity is an exception/gap, not proof of coverage; sampled traces never replace metrics or required failure logs.

## Lifecycle and ownership

Use one reusable boundary pattern per applicable surface, extending the project's existing instrumentation. Use Powertools directly; small publication/sanitization helpers are acceptable, not a competing framework. Keep contracts separate from domain logic. Do not copy emissions into internal helpers or import the root OTel runtime.

Reuse utilities at module scope. Aggregate counters in loops and publish compatible buffers at boundary exit. Keep one publication owner; clear metric/dimension/metadata state between invocations. Never attach changing dimensions to an already populated buffer. Publish distinct bounded dimension groups separately when needed, with volume budgeted.

Hard timeouts can bypass in-process publication/logging; retain managed platform coverage. At-least-once delivery repeats attempts and metrics; do not claim exactly-once business counts. Preserve SQS `batchItemFailures`, ack ownership, SDK retry behavior, and original business error semantics. Log terminal outcomes once at the owning boundary, not at every retry/helper.
