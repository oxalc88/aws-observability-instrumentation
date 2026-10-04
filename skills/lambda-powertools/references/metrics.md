# Metrics: aggregate operational questions

Metrics are optional. Reject a custom metric unless it answers a question across executions and supports a defined operational action.

| Purpose | Meaning | Powertools/CloudWatch representation |
| --- | --- | --- |
| `outcome` | Completed work by result | Add non-negative `Count`; use Sum and a compatible denominator |
| `latency` | Time between declared boundaries | Monotonic elapsed time, `Milliseconds` or explicit `Seconds`; preserve samples for distribution statistics |
| `load` | Work present or in progress | Point-in-time value with a declared unit; managed SQS backlog/Lambda concurrency preferred |
| `resource` | Consumed bytes, tokens, quota, records | Aggregate additive amount with a CloudWatch-supported unit; custom quantities can use Count with explicit meaning |
| `correctness` | Fallback, degradation, or assumption violation | Non-negative Count with a bounded reason if needed |

CloudWatch Metrics does not expose OTel counter/gauge/histogram constructors. Preserve semantics through unit, value, statistic, and boundary; do not copy OTel instrument code. A sum of loop durations is total batch time, not a per-record latency distribution.

## Contract before `addMetric`

Declare a fixed name, namespace, unit, purpose, question, owner, completion/start-stop boundary, statistic/query, dimension keys and closed values, emission frequency, and volume estimate. Keep meanings stable; changed unit/boundary/dimension meaning needs an explicit version/migration with downstream consumers.

Search existing AWS/custom metrics first. Lambda Invocations, Errors, Duration, Throttles, concurrency, and managed queue metrics often suffice. A batch record outcome is different from a Lambda invocation outcome; partial SQS failures can return successfully and require a separate question.

CloudWatch series identity is namespace + metric name + complete dimension set/values. Include Powertools' default `service` dimension in the budget. Additional dimension sets create extra series. IDs, user inputs, raw URLs, timestamps, and exception text are forbidden dimensions. Metadata is still a log record: it adds bytes and privacy risk even when it does not create a metric dimension.

## Publication and lifecycle

- Initialize Metrics outside the handler. Use only justified utilities/packages.
- Aggregate counters/resource values in loops; add totals at batch exit. Publish a buffer once using `logMetrics` middleware, a decorator, or explicit `publishStoredMetrics()` in `finally`. Do not combine owners.
- Keep all buffered measurements on one coherent dimension set. Changing a dimension between buffered items can associate values with the wrong context. Aggregate by bounded tuple and deliberately publish separate buffers only when needed.
- Clear temporary metrics, dimensions, and metadata across warm invocations, including failed publication. Keep default dimensions static.
- Do not enable ColdStart metrics, high-resolution metrics, singleMetric immediate emission, or additional dimension sets by default.
- Do not sample exact totals. If latency sampling is justified, document bias and percentile limits; do not import Sentry's weighting claims.
- Production publication errors must not replace application results. Catch SDK/serialization failures at the selected publication owner; verify loss separately. A hard timeout may prevent `finally`.

Require operational value greater than **custom metric + EMF/log ingestion/storage/query volume + cardinality + maintenance**. See [cost-and-noise](cost-and-noise.md).

API source: [Powertools Metrics](https://docs.aws.amazon.com/powertools/typescript/latest/features/metrics/).
