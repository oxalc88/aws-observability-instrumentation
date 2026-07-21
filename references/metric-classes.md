# Metric purposes

Purpose describes why a metric exists. Instrument kind describes how values aggregate. Keep both explicit.

## Outcome

Answers whether an operation completed and how. Use counters with bounded outcomes or a separate bounded failure counter. Derive success ratios with PromQL from compatible numerator and denominator series.

## Latency

Answers how long an operation took. Use a histogram in seconds with boundaries aligned to SLO thresholds. Emit on success and failure unless the metric definition explicitly measures only successful work.

## Load

Answers how much work exists or is occurring. Use counters for work accepted/completed and gauges for current backlog or concurrency.

## Resource

Answers what an operation consumed. Use monotonic counters for bytes, tokens, records, quota units, or similar additive amounts. Put stable provider/model/category values in closed attributes and request-specific context on spans.

## Correctness

Answers whether resilience or invariant paths activated. Examples include fallbacks, partial results, validation rejections, and reconciliation repairs. These are normally counters with a small reason taxonomy.

## Standard triad

For a new operational boundary, consider:

1. completed operation counter
2. duration histogram
3. failure counter

Do not create all three mechanically. Reuse standard OTel metrics when auto-instrumentation already owns the boundary, and add only metrics that answer a distinct operational question.
