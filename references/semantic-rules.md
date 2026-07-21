# OTel metric semantic rules

## Counter

Use a monotonic counter when values only add to a total:

- completed operations
- failures
- bytes or tokens consumed
- retries attempted

Never add a negative value. Do not append `_total` to an OTel instrument name solely for Prometheus; exporters may apply the Prometheus counter suffix. Query the exported series name in CloudWatch.

Use `rate()` or `increase()` in PromQL. Never alert on the raw cumulative value.

## Gauge

Use a gauge for a current, independently meaningful state:

- queue depth
- active workers
- in-flight requests
- pool utilization

Do not repeatedly add deltas to a gauge. If a callback can observe the current value at collection time, prefer an observable gauge. The bundled examples use a synchronous gauge for portability.

## Histogram

Use a histogram for distributions:

- request or workflow duration
- payload size
- batch size
- age or lag

Define explicit boundaries that match operational thresholds. Histograms cannot recover useful tail percentiles if all expected values fall into one bucket.

Record duration in seconds (`s`) unless an applicable OTel semantic convention specifies another unit. Measure elapsed time with a monotonic clock:

```ts
const started = performance.now();
try {
  await operation();
} finally {
  emitter.latency(DURATION, (performance.now() - started) / 1_000, attributes);
}
```

```python
started = time.monotonic()
try:
    operation()
finally:
    emitter.emit_latency(DURATION, duration_seconds=time.monotonic() - started)
```

## Up/down counter

An OTel up/down counter can represent changes to current state, but it is easy to corrupt when processes crash before decrementing. Prefer an observable or synchronous gauge unless the state transition model and reset behavior are explicit.

## Temporality and restarts

Let the SDK/exporter negotiate supported temporality. Application code must not infer a lifetime total from local process state. PromQL rate functions handle counter resets when series identity remains stable.

## Units

Use UCUM units:

- `s` for seconds
- `By` for bytes
- `1` for ratios
- `{request}`, `{item}`, `{token}`, or another annotated unit for counts

Do not place units in metric names unless an established semantic convention requires the name.
