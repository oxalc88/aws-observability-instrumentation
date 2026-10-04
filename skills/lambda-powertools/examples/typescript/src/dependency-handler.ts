import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { captureLambdaHandler } from "@aws-lambda-powertools/tracer/middleware";
import middy from "@middy/core";
import type { Context } from "aws-lambda";

// Trace question: How much time did the lookup spend in DynamoDB?
// Log question: Which dependency operation failed, at which stage/invocation?
// No custom metric: managed Lambda/DynamoDB metrics cover the current aggregate need.
// Set these in deployment too. Constructor has no captureError option; set before
// construction so this canonical example is safe even without environment setup.
process.env.POWERTOOLS_TRACER_CAPTURE_ERROR = "false";
process.env.POWERTOOLS_TRACER_CAPTURE_RESPONSE = "false";
export const tracer = new Tracer({ serviceName: "orders", captureHTTPsRequests: false });
export const logger = new Logger({ serviceName: "orders", logLevel: "INFO" });
export const client = new DynamoDBClient({});

// Manual dependency boundary avoids SDK auto-capture of raw exception/URL details.
// Do not also patch this client with captureAWSv3Client or ADOT auto-instrumentation.
export async function lookupOrder(orderId: string) {
  let segment: ReturnType<NonNullable<ReturnType<typeof tracer.getSegment>>["addNewSubsegment"]> | undefined;
  try {
    segment = tracer.getSegment()?.addNewSubsegment("DynamoDB.GetItem");
  } catch {
    // A trace setup failure must not prevent the dependency call.
  }
  try {
    return await client.send(new GetItemCommand({
      TableName: process.env.ORDERS_TABLE ?? "orders",
      Key: { id: { S: orderId } },
    }));
  } catch (error) {
    try { segment?.addFaultFlag(); } catch { /* Best-effort trace status. */ }
    throw error;
  } finally {
    try { segment?.close(); } catch { /* Preserve dependency result/error. */ }
  }
}

function dependencyEvidence(error: unknown) {
  // Only select declared status/code values. Do not serialize or log the error.
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  const name = (error as { name?: string })?.name;
  return {
    "failure.class": name === "TimeoutError" ? "timeout" : "dependency_failure",
    reason: name === "TimeoutError" ? "deadline_exceeded" : "lookup_failed",
    "http.status_class": typeof status === "number" && status >= 400 && status < 600
      ? `${Math.floor(status / 100)}xx` : "unknown",
  };
}

export async function lambdaHandler(event: { orderId: string }, context: Context) {
  try {
    const response = await lookupOrder(event.orderId);
    return { found: response.Item !== undefined };
  } catch (error) {
    try {
      logger.error("Order lookup failed", {
        "event.name": "order.dependency.failed",
        "operation.name": "order.lookup",
        stage: "lookup",
        "dependency.name": "dynamodb",
        "dependency.operation": "GetItem",
        ...dependencyEvidence(error),
        request_id: context.awsRequestId,
      });
    } catch { /* Logging failure must not replace the dependency failure. */ }
    // This example's application boundary uses a fixed public failure code;
    // Lambda also serializes uncaught errors. Retain the consumer's existing
    // error/retry policy; do not change it merely to add instrumentation.
    throw new Error("ORDER_LOOKUP_FAILED");
  }
}

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer, { captureResponse: false }));

// Deployment: active tracing + X-Ray role permissions, finite log retention,
// application level INFO, SDK retry policy owned by consumer. Never log orderId.
// This records sampled invocations, not every execution or only failures.
// POWERTOOLS_TRACE_ENABLED=false disables Tracer. Instrument SDK calls once;
// this example owns a manual DynamoDB subsegment instead of SDK auto-capture.
// A supported trace path must still be verified in a real deployment.
