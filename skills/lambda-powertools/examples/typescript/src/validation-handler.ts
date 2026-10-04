import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { publishMeasurements } from "./metric-publication.js";
import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

// Coverage: Lambda invocation metrics managed; application requests custom.
// Questions: request/rejection volume, classified failures and request latency;
// diagnostic rule/location. Tracing not_applicable: only local validation.
// Owner: orders. Population: completed attempts, not unique business operations.
// Requests and RequestFailures: outcome Count/Sum; RequestDuration: latency ms.
// Dimensions: service=orders, result=accepted|rejected|failed,
// failure_class=none|validation_failure|internal_error, status_class=2xx|4xx|5xx.
// At most 3 valid tuples/9 series.
// One EMF record per completed request; no IDs, rules, or payload metadata.
export const metrics = new Metrics({ namespace: "Example/Validation", serviceName: "orders" });
export const logger = new Logger({ serviceName: "orders", logLevel: "INFO" });
const supportedFields = ["notes", "scheduled_at"] as const;

function inputType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function reject(
  requestId: string,
  code: "BODY_NOT_OBJECT" | "NO_SUPPORTED_ENRICHMENT_FIELDS",
  value: unknown,
) {
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  // Unknown input keys can themselves contain personal data or secrets.
  const fields = isObject
    ? supportedFields.filter((key) => Object.hasOwn(value, key))
    : [];
  const unknownFieldCount = isObject ? Object.keys(value).length - fields.length : 0;
  try {
    logger.warn("Order enrichment rejected", {
      "event.name": "order.validation.rejected",
      "operation.name": "order.enrich",
      stage: "validate",
      "failure.class": "validation_failure",
      "validation.code": code,
      "validation.rule": code === "BODY_NOT_OBJECT" ? "body_shape" : "supported_enrichment",
      "validation.path": "body",
      "validation.expected": code === "BODY_NOT_OBJECT" ? "json_object" : "at_least_one_supported_field",
      "validation.received_type": inputType(value),
      "validation.received_fields": fields,
      "validation.unknown_field_count": unknownFieldCount,
      request_id: requestId,
    });
  } catch {
    // Telemetry loss must not turn an intended 400 into a business exception.
  }
  return { statusCode: 400, body: JSON.stringify({ code }) };
}

async function validateRequest(event: APIGatewayProxyEventV2, context: Context) {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "null");
  } catch {
    return reject(context.awsRequestId, "BODY_NOT_OBJECT", undefined);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reject(context.awsRequestId, "BODY_NOT_OBJECT", body);
  }
  if (!supportedFields.some((key) => Object.hasOwn(body, key))) {
    return reject(context.awsRequestId, "NO_SUPPORTED_ENRICHMENT_FIELDS", body);
  }
  // Consumer domain validation/implementation belongs here. This example only
  // demonstrates the rejection boundary; it does not implement order enrichment.
  return { statusCode: 204, body: "" };
}

// Per-record fields are passed directly, so there are no mutable invocation keys
// to reset and no raw event auto-logging middleware to enable accidentally.

// Reusable request boundary owns metrics; reject() owns one diagnostic event.
export async function handler(event: APIGatewayProxyEventV2, context: Context) {
  const started = performance.now();
  let result = "failed";
  let failureClass = "internal_error";
  let statusClass = "5xx";
  try {
    const response = await validateRequest(event, context);
    result = response.statusCode < 400 ? "accepted" : "rejected";
    failureClass = result === "accepted" ? "none" : "validation_failure";
    statusClass = `${Math.floor(response.statusCode / 100)}xx`;
    return response;
  } catch (error) {
    try {
      logger.error("Validation operation failed", {
        "event.name": "order.validation.failed", "operation.name": "order.enrich",
        stage: "validate", "failure.class": "internal_error",
        reason: "unexpected_validation_failure", location: "validateRequest",
        request_id: context.awsRequestId,
      });
    } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    publishMeasurements(metrics, [
      { name: "Requests", unit: MetricUnit.Count, value: 1 },
      { name: "RequestFailures", unit: MetricUnit.Count, value: Number(result !== "accepted") },
      { name: "RequestDuration", unit: MetricUnit.Milliseconds, value: performance.now() - started },
    ], { result, failure_class: failureClass, status_class: statusClass });
  }
}
