# Signal selection

Record one decision per operational question; a short code comment or existing instrumentation document is enough. Do not build a new telemetry registry system merely to record these decisions.

| Field | Required decision |
| --- | --- |
| Question | What must an operator know? |
| Action and owner | Who responds, and what investigation/action follows? |
| Existing coverage | Which AWS metric, log, or trace already answers it? |
| Signal or omission | Metric, log, trace, a justified combination, or none |
| Boundary and meaning | Where is work complete? Per attempt, record, batch, or workflow? |
| Safe contract | Closed dimensions; category-specific log fields; safe trace metadata |
| Cost | Expected series, EMF records, log bytes, subsegments, retention |

Metrics come first for aggregate monitoring and alerts: identify required coverage and reuse managed metrics before adding custom ones. Selecting a diagnostic log does not close an unanswered rate/count question.

## Examples of independent decisions

| Question | Minimum useful choice | Why |
| --- | --- | --- |
| Is Lambda timing out more often? | Existing Lambda telemetry | Do not recreate timeout/error counters |
| Which validation rule rejected this invocation? | Log | Rule/path/type and request correlation explain one outcome; this is diagnosis-only |
| Is the validation rejection rate increasing? | Existing adequate outcome metric, or one custom outcome metric; diagnostic log separately if needed | Count all completed decisions by accepted/rejected result; handled 400s are not Lambda Errors |
| Is fallback usage increasing among completed records? | Two batch-aggregated metrics | Fallback total / processed-record total; no per-item log required if fallback is expected and harmless |
| Which downstream call consumed the request time? | Trace | Causal path and dependency timings; Lambda Duration cannot locate the delay |
| Why did a payment dependency fail? | Log, plus trace only if path/timing matters | Bounded dependency reason and retry evidence explain failure; trace answers a different question |
| Did a trivial mapper run? | None | No operational action follows |

For a combination, state a different question for each signal. Do not copy complete diagnostic fields into every signal. A small shared operation/failure category is useful correlation, not a reason to publish everything three times.

Use deployment-native AWS metrics for infrastructure questions. Custom metrics may be justified for handled rejections, partial failures, or workflow outcomes that Lambda `Errors` does not represent. Prove the gap rather than assuming it.
