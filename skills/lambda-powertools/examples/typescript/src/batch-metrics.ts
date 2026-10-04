import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Logger } from "@aws-lambda-powertools/logger";
import type { Context } from "aws-lambda";
import { publishMeasurements } from "./metric-publication.js";

// Coverage: local workflow stage + fallback custom; invocation managed.
// Queue/ack, resource and retry surfaces not_applicable in this local example.
// Tracing not_applicable: no remote call/distributed path. Reassess real consumers.
// Questions: batch duration/failures, record outcomes, fallback/processed ratio.
// Owner: ingestion. Counts describe attempts, not exactly-once business events.
// BatchDuration is batch latency (ms), not per-record latency. All other values
// Count/Sum: outcomes, except FallbackRecords (correctness). Failure class none|unknown.
// Namespace identifies the fixed stage; service + failure_class => <=14 series.
// One aggregated EMF record at nonempty batch exit. No per-record metadata.
export const metrics = new Metrics({ namespace: "Example/Ingestion", serviceName: "ingestion" });
export const logger = new Logger({ serviceName: "ingestion", logLevel: "INFO" });

export interface RecordInput { primaryScore?: number }
export interface RecordResult { score: number; usedFallback: boolean }
type ProcessRecord = (record: RecordInput) => Promise<RecordResult>;

export function makeBatchHandler(processRecord: ProcessRecord) {
  return async (event: { records: readonly RecordInput[] }, context: Pick<Context, "awsRequestId">) => {
    const started = performance.now();
    let attempted = 0;
    let processed = 0;
    let failed = 0;
    let fallbacks = 0;
    const results: RecordResult[] = [];
    try {
      for (const record of event.records) {
        attempted += 1;
        let result: RecordResult;
        try { result = await processRecord(record); }
        catch (error) { failed += 1; throw error; }
        results.push(result);
        processed += 1;
        fallbacks += Number(result.usedFallback);
      }
      return results;
    } catch (error) {
      try {
        logger.error("Batch processing failed", {
          "event.name": "ingestion.batch.failed", "operation.name": "ingestion.batch",
          stage: "process", "failure.class": "unknown", reason: "unmapped_record_failure",
          location: "processRecord", request_id: context.awsRequestId,
          attempted_records: attempted, completed_records: processed,
        });
      } catch { /* Preserve original business error. */ }
      throw error;
    } finally {
      publishMeasurements(metrics, event.records.length === 0 ? [] : [
        { name: "ReceivedRecords", unit: MetricUnit.Count, value: event.records.length },
        { name: "AttemptedRecords", unit: MetricUnit.Count, value: attempted },
        { name: "ProcessedRecords", unit: MetricUnit.Count, value: processed },
        { name: "FailedRecords", unit: MetricUnit.Count, value: failed },
        { name: "FallbackRecords", unit: MetricUnit.Count, value: fallbacks },
        { name: "BatchFailures", unit: MetricUnit.Count, value: Number(failed > 0) },
        { name: "BatchDuration", unit: MetricUnit.Milliseconds, value: performance.now() - started },
      ], { failure_class: failed > 0 ? "unknown" : "none" });
    }
  };
}

export const handler = makeBatchHandler(async (record) => {
  const usedFallback = record.primaryScore === undefined;
  return { score: record.primaryScore ?? 0, usedFallback };
});

// This fallback is expected/harmless; its per-record log is not_applicable.
// Unexpected record failures require the one safe terminal log above.
// Unattempted records remain distinct from failures. Success is not queue ack.
// Empty input starts no stage work; no custom EMF. Lambda still counts invocation.
