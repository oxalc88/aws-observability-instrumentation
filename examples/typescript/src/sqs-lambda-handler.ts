import { classifyFailure } from "./failure-taxonomy.js";
import { logger, SQS_PROPAGATION_MODE, telemetry } from "./lambda-bootstrap.js";
import { LogEventDef } from "./log-event.js";
import { MetricDef } from "./metric-def.js";
import { processSqsRecord, type SqsEventRecord } from "./sqs-workflow.js";

interface SqsEvent {
  Records: SqsEventRecord[];
}

interface SqsBatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

interface LambdaContext {
  getRemainingTimeInMillis(): number;
}

const MESSAGE_FAILURES = MetricDef.failureCounter({
  name: "app.sqs.message.failure",
  unit: "{failure}",
  owner: "orders",
  description: "SQS messages that failed application processing.",
  emitFrequency: "per_event",
});
const MESSAGE_COMPLETED = new LogEventDef({
  name: "app.sqs.message.completed",
  level: "INFO",
  message: "SQS message processing completed",
  owner: "orders",
  operationName: "orders.process",
  samplingClass: "operational",
  fields: { "messaging.message.id": "correlation", outcome: "operational" },
  required: new Set(["messaging.message.id", "outcome"]),
});
const MESSAGE_FAILED = new LogEventDef({
  name: "app.sqs.message.failed",
  level: "ERROR",
  message: "SQS message processing failed",
  owner: "orders",
  operationName: "orders.process",
  relatedMetric: MESSAGE_FAILURES,
  fields: {
    "messaging.message.id": "correlation",
    outcome: "operational",
    "failure.class": "operational",
  },
  required: new Set(["messaging.message.id", "outcome", "failure.class"]),
});

export async function handler(
  event: SqsEvent,
  context: LambdaContext,
): Promise<SqsBatchResponse> {
  try {
    const results = await Promise.all(
      event.Records.map(async (record) => {
        try {
          await processSqsRecord({
            record,
            tracer: telemetry.tracer,
            operationName: "orders.process",
            propagationMode: SQS_PROPAGATION_MODE,
            handler: async () => {
              try {
                await processMessage(record);
                logger.emit(MESSAGE_COMPLETED, {
                  "messaging.message.id": record.messageId,
                  outcome: "success",
                });
              } catch (error) {
                const failure = classifyFailure(error);
                telemetry.emitter.failure(MESSAGE_FAILURES, failure);
                logger.emit(
                  MESSAGE_FAILED,
                  {
                    "messaging.message.id": record.messageId,
                    outcome: "failure",
                    "failure.class": failure,
                  },
                  { error },
                );
                throw error;
              }
            },
          });
          return undefined;
        } catch {
          return { itemIdentifier: record.messageId };
        }
      }),
    );

    return {
      batchItemFailures: results.filter(
        (result): result is { itemIdentifier: string } => result !== undefined,
      ),
    };
  } finally {
    const flushBudget = Math.max(
      0,
      Math.min(1_000, context.getRemainingTimeInMillis() - 100),
    );
    if (flushBudget > 0) await telemetry.forceFlush(flushBudget);
  }
}

async function processMessage(_record: SqsEventRecord): Promise<void> {
  // Replace with the idempotent application operation for one SQS message.
}
