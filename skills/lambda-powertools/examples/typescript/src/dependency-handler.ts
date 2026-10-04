import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { publishMeasurements } from "./metric-publication.js";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import type { Context } from "aws-lambda";

// Tracing: enabled; this handler owns dependency timing via Powertools.
// Trace question: How much time did the lookup spend in DynamoDB?
// Log question: Which dependency operation failed, at which stage/invocation?
// Coverage: Lambda invocation managed; logical dependency call custom.
// Caller-observed duration includes SDK retries/network overhead; service-side
// DynamoDB latency and sampled traces cannot satisfy this measurement.
// Owner: orders. Calls/Failures/Throttles: outcome Count/Sum; Duration: latency ms.
// Fixed operation GetItem via namespace; dimensions service + failure_class.
// failure_class=none|timeout|rate_limited|unknown. At most 4 tuples/24 series.
// DependencyAttempts counts actual SDK metadata attempts; MissingAttemptEvidence
// is correctness coverage of calls whose transport-attempt count is unavailable.
// One publication per logical call, no raw SDK evidence/IDs in EMF.
export const metrics = new Metrics({ namespace: "Example/OrderLookup", serviceName: "orders" });
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
  const started = performance.now();
  let failureClass = "none";
  let attempts: number | undefined;
  let segment: ReturnType<NonNullable<ReturnType<typeof tracer.getSegment>>["addNewSubsegment"]> | undefined;
  try {
    segment = tracer.getSegment()?.addNewSubsegment("DynamoDB.GetItem");
  } catch {
    // A trace setup failure must not prevent the dependency call.
  }
  try {
    const response = await client.send(new GetItemCommand({
      TableName: process.env.ORDERS_TABLE ?? "orders",
      Key: { id: { S: orderId } },
    }));
    attempts = sdkAttempts(response);
    return response;
  } catch (error) {
    failureClass = dependencyEvidence(error)["failure.class"];
    attempts = sdkAttempts(error);
    try { segment?.addFaultFlag(); } catch { /* Best-effort trace status. */ }
    throw error;
  } finally {
    try { segment?.close(); } catch { /* Preserve dependency result/error. */ }
    publishMeasurements(metrics, [
      { name: "DependencyCalls", unit: MetricUnit.Count, value: 1 },
      { name: "DependencyFailures", unit: MetricUnit.Count, value: Number(failureClass !== "none") },
      { name: "DependencyThrottles", unit: MetricUnit.Count, value: Number(failureClass === "rate_limited") },
      { name: "DependencyDuration", unit: MetricUnit.Milliseconds, value: performance.now() - started },
      { name: "MissingAttemptEvidence", unit: MetricUnit.Count, value: Number(attempts === undefined) },
      ...(attempts === undefined ? [] : [{ name: "DependencyAttempts", unit: MetricUnit.Count, value: attempts }]),
    ], { failure_class: failureClass });
  }
}

function sdkAttempts(value: unknown): number | undefined {
  try {
    const attempts = (value as { $metadata?: { attempts?: number } })?.$metadata?.attempts;
    if (typeof attempts === "number" && Number.isSafeInteger(attempts) && attempts > 0) return attempts;
  } catch { /* Unsafe getters are unavailable evidence, never invented counts. */ }
  return undefined;
}

function dependencyEvidence(error: unknown) {
  // Only select declared status/code values. Do not serialize or log the error.
  let status: unknown;
  let name: unknown;
  try {
    status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    name = (error as { name?: string })?.name;
  } catch { /* Even adversarial error getters must not break classification. */ }
  const failureClass = name === "TimeoutError" ? "timeout"
    : name === "ProvisionedThroughputExceededException" || name === "ThrottlingException"
      ? "rate_limited" : "unknown";
  return {
    "failure.class": failureClass,
    reason: failureClass === "timeout" ? "deadline_exceeded"
      : failureClass === "rate_limited" ? "dependency_throttled" : "unmapped_dependency_failure",
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

// Manual Powertools handler lifecycle keeps capture and cleanup best effort.
// No response/error serialization, no second middleware or SDK capture owner.
export async function handler(event: { orderId: string }, context: Context) {
  let parent: ReturnType<typeof tracer.getSegment>;
  let segment: ReturnType<NonNullable<ReturnType<typeof tracer.getSegment>>["addNewSubsegment"]> | undefined;
  try {
    if (tracer.isTracingEnabled()) {
      parent = tracer.getSegment();
      segment = parent?.addNewSubsegment("Lambda.OrderLookup");
      if (segment) tracer.setSegment(segment);
      tracer.annotateColdStart();
      tracer.addServiceNameAnnotation();
    }
  } catch { /* Trace setup cannot prevent the business operation. */ }
  try {
    return await lambdaHandler(event, context);
  } catch (error) {
    try { segment?.addFaultFlag(); } catch { /* Safe status only. */ }
    throw error;
  } finally {
    try { segment?.close(); } catch { /* Preserve response/original error. */ }
    try { if (parent) tracer.setSegment(parent); } catch { /* Independent cleanup. */ }
  }
}

// Deployment: active tracing + X-Ray role permissions, finite log retention,
// application level INFO, SDK retry policy owned by consumer. Never log orderId.
// This records sampled invocations, not every execution or only failures.
// POWERTOOLS_TRACE_ENABLED=false disables Tracer. Instrument SDK calls once;
// this example owns a manual DynamoDB subsegment instead of SDK auto-capture.
// A supported trace path must still be verified in a real deployment.
