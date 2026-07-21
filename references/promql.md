# PromQL verification and alarms

Add a query with each production metric. Verify the exact metric and label names in Query Studio because OTLP-to-Prometheus translation can normalize dots and other characters.

## Resource label forms

CloudWatch preserves resource, scope, data-point, and AWS enrichment metadata. Native selectors can use quoted UTF-8 names, for example:

```promql
{"app.workflow.duration", "@resource.service.name"="checkout"}
```

Prometheus-compatible histogram series may expose normalized names such as `app_workflow_duration_bucket`. Discover the actual exported series before committing dashboards.

## Counter

Use `rate` for per-second throughput and `increase` for totals over a window:

```promql
sum by (app_workflow_name) (
  rate(app_workflow_execution_total{resource_service_name="checkout"}[5m])
)
```

Never alert on a raw cumulative counter value.

## Error ratio

Keep numerator and denominator label sets aligned:

```promql
sum(rate(app_workflow_failure_total{resource_service_name="checkout"}[5m]))
/
clamp_min(sum(rate(app_workflow_execution_total{resource_service_name="checkout"}[5m])), 1)
```

Alert only after choosing a minimum traffic condition so a single low-volume failure does not create a misleading page.

## Histogram percentile

Aggregate across all dimensions that should share a percentile and retain `le`:

```promql
histogram_quantile(
  0.99,
  sum by (le, app_workflow_name) (
    rate(app_workflow_duration_bucket{resource_service_name="checkout"}[5m])
  )
)
```

Do not average percentiles. Aggregate histogram buckets, then calculate the quantile.

## Gauge

Query a current value directly. Use `max_over_time`, `avg_over_time`, or `min_over_time` only when the operational question calls for a window:

```promql
max by (app_queue_name) (
  app_queue_depth{resource_service_name="worker"}
)
```

## Query constraints

CloudWatch PromQL has finite query concurrency, range, series, scan, sample, and execution limits. Keep dashboards selective, pre-aggregate intentionally, and avoid regex selectors over unbounded labels. A single query request is limited to a seven-day range in the current service documentation.

CloudWatch alarms that use PromQL require `cloudwatch:GetMetricData` and `cloudwatch:ListMetrics` for query access. Use the same expression in Query Studio before creating the alarm.

## Release checklist

- Verify data arrives in the intended Region within the expected export delay.
- Verify resource and data-point labels are distinguishable.
- Verify counter suffix and histogram bucket normalization.
- Test empty traffic, low traffic, and missing-series behavior.
- Record the dashboard and alarm owner beside the metric definition.
- Include a query for collector export failures so missing telemetry is visible.

Source: [CloudWatch PromQL documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-PromQL.html).
