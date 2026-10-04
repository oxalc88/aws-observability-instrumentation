import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";

// Question: Is fallback usage increasing among completed record attempts?
// Purpose: correctness. Ratio = Sum(FallbackRecords) / Sum(ProcessedRecords).
// Lambda Invocations/Errors do not provide this denominator or fallback count.
// Expected harmless fallback needs no individual log or local-helper trace.
// Owner: ingestion. One buffer at batch exit, service dimension only (1 value).
// Cost: two series and one EMF record per nonempty completed batch; no metadata.
export const metrics = new Metrics({ namespace: "Example/Ingestion", serviceName: "ingestion" });
const PROCESSED = "ProcessedRecords"; // outcome: completed attempts, ratio denominator
const FALLBACKS = "FallbackRecords"; // correctness: completed attempts using fallback

function resetBuffer() {
  for (const clear of [
    () => metrics.clearMetrics(),
    () => metrics.clearDimensions(),
    () => metrics.clearMetadata(),
  ]) {
    try { clear(); } catch { /* Cleanup must not change the business outcome. */ }
  }
}

export interface RecordInput { primaryScore?: number }
export interface RecordResult { score: number; usedFallback: boolean }

type ProcessRecord = (record: RecordInput) => Promise<RecordResult>;

export function makeBatchHandler(processRecord: ProcessRecord) {
  return async (event: { records: readonly RecordInput[] }) => {
    let processed = 0;
    let fallbacks = 0;
    const results: RecordResult[] = [];
    try {
      for (const record of event.records) {
        const result = await processRecord(record);
        results.push(result);
        processed += 1;
        fallbacks += Number(result.usedFallback);
      }
      return results;
    } finally {
      // Explicit publication is the only owner. Do not also use logMetrics.
      try {
        resetBuffer(); // clear metrics, temporary dimensions/metadata
        if (processed > 0) {
          metrics.addMetric(PROCESSED, MetricUnit.Count, processed);
          metrics.addMetric(FALLBACKS, MetricUnit.Count, fallbacks);
          metrics.publishStoredMetrics();
        }
      } catch {
        // Preserve success or the original application error; monitor loss.
      } finally {
        resetBuffer();
      }
    }
  };
}

export const handler = makeBatchHandler(async (record) => {
  const usedFallback = record.primaryScore === undefined;
  return { score: record.primaryScore ?? 0, usedFallback };
});

// Totals describe completed attempts, including work before a later record fails.
// Retried batches can repeat these counts. They are not exactly-once outcomes.
// Adapt at the existing SQS partial-failure/ack boundary without changing it.
