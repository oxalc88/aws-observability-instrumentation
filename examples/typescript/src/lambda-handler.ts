import { SpanStatusCode, context, trace } from "@opentelemetry/api";

import {
  contextWithCorrelationId,
  resolveCorrelationId,
} from "./correlation-context.js";
import { classifyFailure } from "./failure-taxonomy.js";
import { logger, telemetry } from "./lambda-bootstrap.js";
import { LogEventDef } from "./log-event.js";
import { MetricDef } from "./metric-def.js";

interface LambdaContext {
  functionName: string;
  functionVersion: string;
  awsRequestId: string;
  getRemainingTimeInMillis(): number;
}

const INVOCATIONS = MetricDef.counter({
  name: "app.lambda.invocation",
  unit: "{invocation}",
  purpose: "outcome",
  owner: "platform",
  description: "Completed invocations of this Lambda function.",
  attributes: { outcome: new Set(["success", "failure"]) },
  required: new Set(["outcome"]),
  emitFrequency: "per_request",
});
const FAILURES = MetricDef.failureCounter({
  name: "app.lambda.invocation.failure",
  unit: "{failure}",
  owner: "platform",
  description:
    "Lambda invocations that terminated with an application exception.",
  emitFrequency: "per_request",
});
const OPERATION_NAME = "lambda.handler";
const INVOCATION_COMPLETED = new LogEventDef({
  name: "app.lambda.invocation.completed",
  level: "INFO",
  message: "Lambda invocation completed",
  owner: "platform",
  operationName: OPERATION_NAME,
  relatedMetric: INVOCATIONS,
  fields: {
    outcome: "operational",
    "faas.coldstart": "operational",
    "faas.name": "operational",
    "faas.version": "operational",
    "faas.invocation_id": "correlation",
  },
  required: new Set([
    "outcome",
    "faas.coldstart",
    "faas.name",
    "faas.version",
    "faas.invocation_id",
  ]),
});
const INVOCATION_FAILED = new LogEventDef({
  name: "app.lambda.invocation.failed",
  level: "ERROR",
  message: "Lambda invocation failed",
  owner: "platform",
  operationName: OPERATION_NAME,
  relatedMetric: FAILURES,
  fields: {
    outcome: "operational",
    "failure.class": "operational",
    "faas.coldstart": "operational",
    "faas.name": "operational",
    "faas.version": "operational",
    "faas.invocation_id": "correlation",
  },
  required: new Set([
    "outcome",
    "failure.class",
    "faas.coldstart",
    "faas.name",
    "faas.version",
    "faas.invocation_id",
  ]),
});

let coldStart = true;

export async function handler(event: unknown, lambdaContext: LambdaContext) {
  let outcome = "failure";
  const wasColdStart = coldStart;
  coldStart = false;
  const span = trace.getActiveSpan();
  span?.setAttributes({
    "faas.name": lambdaContext.functionName,
    "faas.version": lambdaContext.functionVersion,
    "faas.invocation_id": lambdaContext.awsRequestId,
  });
  const correlationId = resolveCorrelationId();
  return context.with(contextWithCorrelationId(correlationId), async () => {
    try {
      outcome = "success";
      logger.emit(INVOCATION_COMPLETED, {
        outcome,
        "faas.coldstart": wasColdStart,
        "faas.name": lambdaContext.functionName,
        "faas.version": lambdaContext.functionVersion,
        "faas.invocation_id": lambdaContext.awsRequestId,
      });
      return { ok: true, event };
    } catch (error) {
      if (error instanceof Error) span?.recordException(error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      const failure = classifyFailure(error);
      span?.setAttributes({ outcome, "failure.class": failure });
      telemetry.emitter.failure(FAILURES, failure);
      logger.emit(
        INVOCATION_FAILED,
        {
          outcome,
          "failure.class": failure,
          "faas.coldstart": wasColdStart,
          "faas.name": lambdaContext.functionName,
          "faas.version": lambdaContext.functionVersion,
          "faas.invocation_id": lambdaContext.awsRequestId,
        },
        { error },
      );
      throw error;
    } finally {
      span?.setAttribute("outcome", outcome);
      telemetry.emitter.counter(INVOCATIONS, 1, { outcome });
      const flushBudget = Math.max(
        0,
        Math.min(1_000, lambdaContext.getRemainingTimeInMillis() - 100),
      );
      if (flushBudget > 0) await telemetry.forceFlush(flushBudget);
    }
  });
}

// Do not call telemetry.shutdown() after each invocation; Lambda may reuse the process.
