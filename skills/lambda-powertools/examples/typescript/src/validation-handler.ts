import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

// Question: Which safe rule rejected an enrichment request, and where?
// AWS errors do not explain handled 400s. No aggregate question or dependency
// path requires custom Metrics or Tracer in this example.
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

export async function handler(event: APIGatewayProxyEventV2, context: Context) {
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
