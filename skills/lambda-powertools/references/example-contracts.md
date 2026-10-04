# Shared coverage contracts and canonical language mappings

The examples are instrumentation patterns, not an application or complete deployment. Extend existing project boundaries instead of copying every example. Each owns its emission sites; the tiny synchronous publication adapter for its language contains SDK failures and resets buffers, dimensions, and metadata. No middleware also flushes these Metrics instances.

TypeScript/JavaScript and Python map the same measurement meanings, names/units, complete dimension sets, diagnostic fields and budgets below. SDK-specific API choices and retry metadata differ; see [language adaptation](language-adaptation.md). Other languages must preserve these semantics and verify their SDK behavior rather than copy syntax.

## Coverage map

| Example | Managed coverage | Custom coverage | Not applicable / limitations |
| --- | --- | --- | --- |
| Validation request | Lambda invocation count/runtime errors/duration | Application request count, classified failures, request latency; one safe rejection/internal failure log | No dependency/distributed path, retry, queue, fallback, or metered resource. Tracing disabled. Runtime invocation metrics do not cover handled rejection semantics |
| Local batch stage | Lambda invocation metrics | Stage duration/classified failure; received/attempted/successful/failed record attempts; fallback count; unexpected failure diagnostic | No actual queue/ack, retry, resource or remote path. Tracing disabled. Do not copy to a distributed consumer without adding its queue/propagation coverage |
| DynamoDB lookup | Lambda invocation metrics | Caller-specific logical call count/duration/failures/throttles; timed dependency subsegment; one terminal dependency failure log | Direct Lambda handler, not HTTP. No application retry loop/queue/workflow/fallback. SDK transport attempts are counted from actual response/error metadata (v3 attempts includes the first; botocore RetryAttempts excludes it), inside the logical call interval. Missing metadata is explicitly exposed as a coverage gap; do not infer attempts from one client.send |

Managed invocation coverage must still be verified in the consumer deployment. Trace activation/continuity and EMF extraction remain rollout checks, not locally proven capabilities.

## Metric identities

All counts use Count/Sum, normal resolution, no sampling/rate cap; durations use Milliseconds with latency samples (Average/percentiles only where CloudWatch supports the stored samples). Names, units, dimensions and boundaries are immutable. Changes need a new version/explicit migration with consumers. The examples do not ship dashboards or alarms.

| Namespace / owner | Names and purposes | Population / boundary / query |
| --- | --- | --- |
| `Example/Validation` / orders | `Requests`, `RequestFailures` (outcome); `RequestDuration` (latency) | One attempted application request, handler boundary entry → return/throw; failure includes rejection. Query rejected Requests Sum / all Requests Sum over same period; failure rate RequestFailures Sum / Requests Sum |
| `Example/Ingestion` / ingestion | `ReceivedRecords`, `AttemptedRecords`, `ProcessedRecords`, `FailedRecords`, `BatchFailures` (outcome); `FallbackRecords` (correctness); `BatchDuration` (latency) | Local nonempty batch stage entry → return/throw. Received is input length, attempted enters processor, processed is completed success, failed is observed throw, untouched records are not failures. Fallback reason is fixed `primary_missing`; query FallbackRecords Sum / ProcessedRecords Sum. Record failures / attempts and batch failure totals have distinct populations |
| `Example/OrderLookup` / orders | `DependencyCalls`, `DependencyFailures`, `DependencyThrottles`, `DependencyAttempts` (outcome); `DependencyDuration` (latency); `MissingAttemptEvidence` (correctness) | One logical `DynamoDB.GetItem` call including SDK retries/network, entry → SDK return/throw. Failures / Calls over same period, summed across failure classes; throttle counts are terminal logical-call throttles, not every intermediate SDK retry. SDK attempts include the first attempt; their metadata may be unavailable, in which case no invented attempt value is emitted and MissingAttemptEvidence increments |

| Contract | Complete dimension set and closed tuples | Publication budget |
| --- | --- | --- |
| Request | service=orders; (result, failure_class, status_class)=(accepted,none,2xx), (rejected,validation_failure,4xx), (failed,internal_error,5xx) | <=9 series, one EMF record/completed request |
| Batch | service=ingestion; failure_class=none or unknown | <=14 series, one EMF record/nonempty completed batch attempt |
| Dependency | service=orders; failure_class=none, timeout, rate_limited or unknown | <=24 series, one EMF record/completed logical call |

Budgets are conservative upper bounds per namespace/account/region and include zero-valued failure series; no rollup dimension sets. Rules, request IDs, record values, raw errors and payload metadata are absent from EMF. Query across closed tuples deliberately; CloudWatch does not automatically create an all-dimensions total series.

Buffered counts reduce log records; they do not remove series cost. BatchDuration is a batch distribution, not a per-record distribution. Empty input starts no stage work and emits no custom record. Retried calls/batches can repeat counts. `finally` may not run on hard timeout; do not claim complete or exactly-once totals.

## Diagnostic and trace ownership

Rejection helper emits one safe validation event; request wrapper owns unexpected internal failure. Batch wrapper emits one terminal event with safe location and invocation ID; harmless local fallback needs no per-record narrative log. DynamoDB caller wrapper records metrics and a manual timed subsegment; Lambda boundary emits one safe failure event and owns a best-effort handler segment with independent close/context restoration. Do not add another SDK capture owner, response/error dump, or helper subsegment.

Classify unknown provider exceptions as `unknown`, not arbitrary exception names. The unknown series supplies investigation coverage without another duplicate metric. Consumer typed mappings can add declared bounded categories with a reviewed cardinality/identity migration.

Missing SDK attempt evidence is a retry-coverage exception until the consumer verifies delivery: owner = instrumentation maintainer; mitigation = MissingAttemptEvidence monitoring and SDK metadata checks; review = before production rollout, no later than 2026-11-04. It does not fulfill exact attempt totals for those calls.

Telemetry publication/cleanup/log/trace failures are best effort and preserve business results. If pre-publication reset fails, skip emission rather than publish stale diagnostic data. The dependency example's fixed outward error code is illustrative application policy; consumers must retain their own error/retry semantics.
