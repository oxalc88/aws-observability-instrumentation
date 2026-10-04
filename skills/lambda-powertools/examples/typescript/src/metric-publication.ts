import { Metrics } from "@aws-lambda-powertools/metrics";

import type { MetricUnit } from "@aws-lambda-powertools/metrics/types";

export interface Measurement { name: string; unit: MetricUnit; value: number }

// Tiny synchronous publication adapter, not a registry or logging framework.
// Callers own fixed names/contracts and pass only declared dimension values.
function clear(metrics: Metrics): boolean {
  let clean = true;
  for (const reset of [
    () => metrics.clearMetrics(),
    () => metrics.clearDimensions(),
    () => metrics.clearMetadata(),
  ]) {
    try { reset(); } catch { clean = false; }
  }
  return clean;
}

export function publishMeasurements(
  metrics: Metrics,
  measurements: readonly Measurement[],
  dimensions: Readonly<Record<string, string>> = {},
): void {
  try {
    // If state cannot be reset, drop publication instead of leaking old data.
    if (!clear(metrics) || measurements.length === 0) return;
    metrics.addDimensions(dimensions);
    for (const point of measurements) metrics.addMetric(point.name, point.unit, point.value);
    // One owner, one coherent dimension set. No logMetrics/singleMetric alongside.
    metrics.publishStoredMetrics();
  } catch {
    // Preserve business outcomes. Deployment checks must detect sustained loss.
  } finally {
    clear(metrics);
  }
}
