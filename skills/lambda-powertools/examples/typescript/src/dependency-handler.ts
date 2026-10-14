import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { captureLambdaHandler } from "@aws-lambda-powertools/tracer/middleware";
import middy from "@middy/core";
import type { Context } from "aws-lambda";
import { publishMeasurements } from "./metric-publication.js";

// One logical dependency call owns the same aggregate metric contract as before.
// No raw error/response capture in traces or logs.
process.env.POWERTOOLS_TRACER_CAPTURE_ERROR = "false";
process.env.POWERTOOLS_TRACER_CAPTURE_RESPONSE = "false";

export const metrics = new Metrics({ namespace: "Example/OrderLookup", serviceName: "orders" });
export const logger = new Logger({ serviceName: "orders", logLevel: "INFO" });
export const tracer = new Tracer({ serviceName: "orders", captureHTTPsRequests: false });
export const client = tracer.captureAWSv3Client(new DynamoDBClient({}));

function errorField(error: unknown, key: string): unknown {
  try { return (error as Record<string, unknown> | null)?.[key]; }
  catch { return undefined; }
}

function observedError(error: unknown) {
  const metadata = errorField(error, "$metadata");
  const status = errorField(metadata, "httpStatusCode");
  const code = errorField(error, "code") ?? errorField(error, "name");
  // Allow only the SDK's documented code-like field; never free-text messages.
  const safeCode = typeof code === "number" && Number.isSafeInteger(code)
    ? code
    : typeof code === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(code) ? code : undefined;
  return {
    ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? { "http.status_code": status, "http.status_class": `${Math.floor(status / 100)}xx` }
      : {}),
    ...(safeCode !== undefined ? { "provider.error_code": safeCode } : {}),
  };
}

function failureClass(error: unknown): "timeout" | "rate_limited" | "unknown" {
  const name = errorField(error, "name");
  if (name === "TimeoutError") return "timeout";
  if (name === "ProvisionedThroughputExceededException" || name === "ThrottlingException") return "rate_limited";
  return "unknown";
}

export async function lookupOrder(orderId: string) {
  const started = performance.now();
  let classification: ReturnType<typeof failureClass> | "none" = "none";
  let attempts: number | undefined;
  try {
    const response = await client.send(new GetItemCommand({
      TableName: process.env.ORDERS_TABLE ?? "orders",
      Key: { id: { S: orderId } },
    }));
    attempts = sdkAttempts(response);
    return response;
  } catch (error) {
    classification = failureClass(error);
    attempts = sdkAttempts(error);
    throw error;
  } finally {
    publishMeasurements(metrics, [
      { name: "DependencyCalls", unit: MetricUnit.Count, value: 1 },
      { name: "DependencyFailures", unit: MetricUnit.Count, value: Number(classification !== "none") },
      { name: "DependencyThrottles", unit: MetricUnit.Count, value: Number(classification === "rate_limited") },
      { name: "DependencyDuration", unit: MetricUnit.Milliseconds, value: performance.now() - started },
      { name: "MissingAttemptEvidence", unit: MetricUnit.Count, value: Number(attempts === undefined) },
      ...(attempts === undefined ? [] : [{ name: "DependencyAttempts", unit: MetricUnit.Count, value: attempts }]),
    ], { failure_class: classification });
  }
}

function sdkAttempts(value: unknown): number | undefined {
  const attempts = errorField(errorField(value, "$metadata"), "attempts");
  return typeof attempts === "number" && Number.isSafeInteger(attempts) && attempts > 0 ? attempts : undefined;
}

export async function lambdaHandler(event: { orderId: string }, context: Context) {
  try {
    const response = await lookupOrder(event.orderId);
    return { found: response.Item !== undefined };
  } catch (error) {
    const classification = failureClass(error);
    try {
      logger.error("Order lookup failed", {
        "event.name": "order.dependency.failed",
        "operation.name": "order.lookup",
        stage: "lookup",
        "dependency.name": "dynamodb",
        "dependency.operation": "GetItem",
        "failure.class": classification,
        reason: classification === "timeout" ? "deadline_exceeded"
          : classification === "rate_limited" ? "dependency_throttled" : "unmapped_dependency_failure",
        ...observedError(error),
        "retry.decision": "propagate",
        request_id: context.awsRequestId,
      });
    } catch { /* A logger failure must not replace the business error. */ }
    throw error;
  }
}

export const handler = middy(lambdaHandler).use(captureLambdaHandler(tracer, {
  captureResponse: false,
}));
