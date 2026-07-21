import { classifyFailure } from "./failure-taxonomy.js";
import {
  processKinesisRecord,
  type KinesisEventRecord,
} from "./kinesis-workflow.js";
import { logger, telemetry } from "./lambda-bootstrap.js";
import { LogEventDef } from "./log-event.js";
import { MetricDef } from "./metric-def.js";

interface KinesisEvent {
  Records: KinesisEventRecord[];
}

interface LambdaContext {
  getRemainingTimeInMillis(): number;
}

const RECORD_FAILURES = MetricDef.failureCounter({
  name: "app.kinesis.record.failure",
  unit: "{failure}",
  owner: "orders",
  description: "Kinesis records that failed application processing.",
  emitFrequency: "per_event",
});
const RECORD_COMPLETED = new LogEventDef({
  name: "app.kinesis.record.completed",
  level: "INFO",
  message: "Kinesis record processing completed",
  owner: "orders",
  operationName: "orders.process",
  samplingClass: "operational",
  fields: { "messaging.message.id": "correlation", outcome: "operational" },
  required: new Set(["messaging.message.id", "outcome"]),
});
const RECORD_FAILED = new LogEventDef({
  name: "app.kinesis.record.failed",
  level: "ERROR",
  message: "Kinesis record processing failed",
  owner: "orders",
  operationName: "orders.process",
  relatedMetric: RECORD_FAILURES,
  fields: {
    "messaging.message.id": "correlation",
    outcome: "operational",
    "failure.class": "operational",
  },
  required: new Set(["messaging.message.id", "outcome", "failure.class"]),
});

export async function handler(
  event: KinesisEvent,
  context: LambdaContext,
): Promise<void> {
  try {
    // This example uses default all-or-retry behavior; partial responses are a separate opt-in mapping mode.
    for (const record of event.Records) {
      await processKinesisRecord({
        record,
        tracer: telemetry.tracer,
        operationName: "orders.process",
        handler: async (data) => {
          try {
            await processData(data);
            logger.emit(RECORD_COMPLETED, {
              "messaging.message.id": record.kinesis.sequenceNumber,
              outcome: "success",
            });
          } catch (error) {
            const failure = classifyFailure(error);
            telemetry.emitter.failure(RECORD_FAILURES, failure); // instrumentation: loop-allowed
            logger.emit(
              RECORD_FAILED,
              {
                "messaging.message.id": record.kinesis.sequenceNumber,
                outcome: "failure",
                "failure.class": failure,
              },
              { error },
            );
            throw error;
          }
        },
      });
    }
  } finally {
    const flushBudget = Math.max(
      0,
      Math.min(1_000, context.getRemainingTimeInMillis() - 100),
    );
    if (flushBudget > 0) await telemetry.forceFlush(flushBudget);
  }
}

async function processData(_data: unknown): Promise<void> {
  // Replace with the idempotent application operation for one Kinesis record.
}
