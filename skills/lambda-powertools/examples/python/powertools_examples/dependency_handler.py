"""Powertools dependency example: unchanged metrics, direct Logger, native tracing."""
import os
from time import perf_counter

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.metrics import EphemeralMetrics, MetricUnit
from botocore.exceptions import ReadTimeoutError

from .metric_publication import publish_measurements

os.environ["POWERTOOLS_TRACER_CAPTURE_RESPONSE"] = "false"
os.environ["POWERTOOLS_TRACER_CAPTURE_ERROR"] = "false"
tracer = Tracer(service="orders", auto_patch=False)
logger = Logger(service="orders", level="INFO")
metrics = EphemeralMetrics(namespace="Example/OrderLookup", service="orders")
client = boto3.client("dynamodb", region_name=os.getenv("AWS_REGION", "us-east-1"))


def safe_response(value):
    try:
        response = value if isinstance(value, dict) else getattr(value, "response", {})
        return response if isinstance(response, dict) else {}
    except Exception:
        return {}


def response_field(error, section, field):
    try:
        part = safe_response(error).get(section)
        return part.get(field) if isinstance(part, dict) else None
    except Exception:
        return None


def sdk_attempts(value):
    try:
        retries = safe_response(value).get("ResponseMetadata", {}).get("RetryAttempts")
        return retries + 1 if type(retries) is int and retries >= 0 else None
    except Exception:
        return None


def dependency_evidence(error):
    code = response_field(error, "Error", "Code")
    status = response_field(error, "ResponseMetadata", "HTTPStatusCode")
    failure_class = "timeout" if isinstance(error, (TimeoutError, ReadTimeoutError)) else (
        "rate_limited" if code in ("ThrottlingException", "ProvisionedThroughputExceededException") else "unknown"
    )
    safe_code = code if type(code) is int else (
        code if isinstance(code, str) and len(code) <= 80
        and code[:1].isalnum() and all(c.isalnum() or c in "_.-" for c in code) else None
    )
    return {
        "failure.class": failure_class,
        "reason": {"timeout": "deadline_exceeded", "rate_limited": "dependency_throttled"}.get(
            failure_class, "unmapped_dependency_failure"),
        **({"http.status_code": status, "http.status_class": f"{status // 100}xx"}
           if type(status) is int and 100 <= status <= 599 else {}),
        **({"provider.error_code": safe_code} if safe_code is not None else {}),
    }


@tracer.capture_method(capture_response=False, capture_error=False)
def lookup_order(order_id):
    started = perf_counter()
    failure_class, attempts = "none", None
    try:
        response = client.get_item(
            TableName=os.getenv("ORDERS_TABLE", "orders"), Key={"id": {"S": order_id}},
        )
        attempts = sdk_attempts(response)
        return response
    except Exception as error:
        failure_class = dependency_evidence(error)["failure.class"]
        attempts = sdk_attempts(error)
        raise
    finally:
        points = [
            ("DependencyCalls", MetricUnit.Count, 1),
            ("DependencyFailures", MetricUnit.Count, int(failure_class != "none")),
            ("DependencyThrottles", MetricUnit.Count, int(failure_class == "rate_limited")),
            ("DependencyDuration", MetricUnit.Milliseconds, (perf_counter() - started) * 1000),
            ("MissingAttemptEvidence", MetricUnit.Count, int(attempts is None)),
        ]
        if attempts is not None:
            points.append(("DependencyAttempts", MetricUnit.Count, attempts))
        publish_measurements(metrics, points, {"failure_class": failure_class})


def lambda_handler(event, context):
    try:
        response = lookup_order(event["orderId"])
        return {"found": "Item" in response}
    except Exception as error:
        try:
            logger.error("Order lookup failed", extra={
                "event.name": "order.dependency.failed",
                "operation.name": "order.lookup",
                "stage": "lookup",
                "dependency.name": "dynamodb",
                "dependency.operation": "GetItem",
                **dependency_evidence(error),
                "retry.decision": "propagate",
                "request_id": context.aws_request_id,
            })
        except Exception:
            pass
        raise


@tracer.capture_lambda_handler(capture_response=False, capture_error=False)
def handler(event, context):
    return lambda_handler(event, context)
