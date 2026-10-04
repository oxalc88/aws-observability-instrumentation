"""Request metrics + safe rejection diagnostics; local tracing not_applicable.

Same metric identities, purposes, dimensions, budget and boundaries as TypeScript.
See references/example-contracts.md. Lambda invocation coverage remains managed.
"""
import json
from time import perf_counter

from aws_lambda_powertools import Logger
from aws_lambda_powertools.metrics import EphemeralMetrics, MetricUnit

from .metric_publication import publish_measurements

metrics = EphemeralMetrics(namespace="Example/Validation", service="orders")
logger = Logger(service="orders", level="INFO")
SUPPORTED_FIELDS = ("notes", "scheduled_at")


def input_type(value):
    if value is None:
        return "null"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "string" if isinstance(value, str) else "unknown"


def reject(request_id, code, value):
    fields = [key for key in SUPPORTED_FIELDS if isinstance(value, dict) and key in value]
    unknown_count = len(value) - len(fields) if isinstance(value, dict) else 0
    try:
        logger.warning("Order enrichment rejected", extra={
            "event.name": "order.validation.rejected", "operation.name": "order.enrich",
            "stage": "validate", "failure.class": "validation_failure",
            "validation.code": code,
            "validation.rule": "body_shape" if code == "BODY_NOT_OBJECT" else "supported_enrichment",
            "validation.path": "body",
            "validation.expected": "json_object" if code == "BODY_NOT_OBJECT" else "at_least_one_supported_field",
            "validation.received_type": input_type(value),
            "validation.received_fields": fields,
            "validation.unknown_field_count": unknown_count, "request_id": request_id,
        })
    except Exception:
        pass
    return {"statusCode": 400, "body": json.dumps({"code": code})}


def validate_request(event, context):
    try:
        body = json.loads(event.get("body") or "null")
    except (ValueError, TypeError):
        return reject(context.aws_request_id, "BODY_NOT_OBJECT", None)
    if not isinstance(body, dict):
        return reject(context.aws_request_id, "BODY_NOT_OBJECT", body)
    if not any(key in body for key in SUPPORTED_FIELDS):
        return reject(context.aws_request_id, "NO_SUPPORTED_ENRICHMENT_FIELDS", body)
    # Consumer domain behavior belongs here; no enrichment feature is implemented.
    return {"statusCode": 204, "body": ""}


def handler(event, context):
    started = perf_counter()
    result, failure_class, status_class = "failed", "internal_error", "5xx"
    try:
        response = validate_request(event, context)
        result = "accepted" if response["statusCode"] < 400 else "rejected"
        failure_class = "none" if result == "accepted" else "validation_failure"
        status_class = f"{response['statusCode'] // 100}xx"
        return response
    except Exception:
        try:
            logger.error("Validation operation failed", extra={
                "event.name": "order.validation.failed", "operation.name": "order.enrich",
                "stage": "validate", "failure.class": "internal_error",
                "reason": "unexpected_validation_failure", "location": "validate_request",
                "request_id": context.aws_request_id,
            })
        except Exception:
            pass
        raise
    finally:
        publish_measurements(metrics, [
            ("Requests", MetricUnit.Count, 1),
            ("RequestFailures", MetricUnit.Count, int(result != "accepted")),
            ("RequestDuration", MetricUnit.Milliseconds, (perf_counter() - started) * 1000),
        ], {"result": result, "failure_class": failure_class, "status_class": status_class})
