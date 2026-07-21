# Cost and volume model

Estimate cost from data-point volume, series churn, label metadata, histogram size, trace sampling, and query scan volume. Verify current CloudWatch pricing before a production rollout.

## Metrics

Do not sample monotonic counter additions in application code. Sampling makes rates and totals incorrect. Reduce metric volume by:

- using SDK aggregation instead of exporting each event directly
- choosing a reasonable periodic export interval; 60 seconds is the normal default
- aggregating loop values before emission
- removing unnecessary attributes and duplicate instruments
- selecting histogram boundaries intentionally
- using collector batching below CloudWatch request limits

Shorter export intervals improve freshness but increase requests, payload overhead, and Lambda flush pressure.

## Histograms

Each histogram point carries bucket counts. More boundaries increase payload size. Use enough boundaries to resolve SLO thresholds and useful percentiles, not arbitrary fine-grained buckets.

For an SLO at 500 ms, ensure a boundary at 0.5 seconds. Include meaningful lower and upper ranges based on real workload behavior.

## Loops

Counters inside item loops should normally aggregate and add once:

```ts
let processed = 0;
for (const item of items) {
  await process(item);
  processed += 1;
}
emitter.counter(ITEMS_PROCESSED, processed, attributes);
```

Per-item histograms are allowed only when the distribution itself answers an operational question and `loopPolicy` is explicitly `allowed`.

## Traces

Use parent-based ratio sampling for general traffic and preserve upstream decisions. Record 100% only when the selected CloudWatch feature requires it and the cost is accepted. Never sample errors by writing a second independent trace; use tail sampling in a collector when the topology and memory budget support it.

## Logs

Estimate records per event, average/maximum encoded size, ingestion volume, Logs Insights scan volume, retention, archival, and duplicate delivery. Use INFO for material outcomes rather than step-by-step narration. Apply ordered deterministic policies keyed by workflow correlation when approved; never sample required security, error, or audit events. Track policy/rate on retained records and monitor aggregate intentional drops separately. Set retention on every log group; an indefinite default is a cost and privacy decision, not a neutral setting.

## Collector resources

Budget CPU and memory for serialization, batching, retry queues, enrichment, and TLS. Bounded queues trade temporary resilience for bounded memory. Monitor dropped and failed exports so backpressure does not become invisible data loss.

## Lambda

Telemetry affects cold-start size, invocation duration, and memory. Keep initialization at module scope, use short bounded flushes, and measure p95/p99 duration and memory overhead before rollout. A force flush must not consume the remaining function timeout.

## Review checklist

- Estimate combinations for all data-point and resource labels.
- Estimate points per export interval and uncompressed payload size.
- Confirm no duplicate EMF and native OTLP pipeline.
- Confirm trace sample ratio and expected spans per request.
- Confirm expected log bytes, retention, query scans, and no stdout/OTLP duplicate path.
- Confirm PromQL selectors avoid broad regex scans.
- Set an owner for collector capacity and export-failure alarms.
