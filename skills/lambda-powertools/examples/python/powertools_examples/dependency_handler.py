"""Caller metrics, safe manual Powertools traces and terminal diagnostics.

Same contract as TypeScript; botocore RetryAttempts excludes the initial attempt.
Do not also auto-patch botocore or use a second trace/metric publication owner.
"""
import os
from contextlib import contextmanager
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


@contextmanager
def safe_subsegment(name):
    parent = segment = None
    try:
        if not tracer.disabled:
            parent = tracer.provider.get_trace_entity()
            segment = tracer.provider.begin_subsegment(name)
    except Exception:
        pass
    try:
        yield
    except Exception:
        try:
            if segment is not None:
                segment.add_fault_flag()
        except Exception:
            pass
        raise
    finally:
        try:
            if segment is not None:
                tracer.provider.end_subsegment()
        except Exception:
            pass
        try:
            if parent is not None:
                tracer.provider.set_trace_entity(parent)
        except Exception:
            pass


def safe_response(value):
    try:
        response = value if isinstance(value, dict) else getattr(value, "response", {})
        return response if isinstance(response, dict) else {}
    except Exception:
        return {}


def sdk_attempts(value):
    try:
        retries = safe_response(value).get("ResponseMetadata", {}).get("RetryAttempts")
        return retries + 1 if type(retries) is int and retries >= 0 else None
    except Exception:
        return None


def dependency_evidence(error):
    try:
        response = safe_response(error)
        code = response.get("Error", {}).get("Code")
        status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    except Exception:
        code = status = None
    failure_class = "timeout" if isinstance(error, (TimeoutError, ReadTimeoutError)) else (
        "rate_limited" if code in ("ThrottlingException", "ProvisionedThroughputExceededException") else "unknown"
    )
    return {
        "failure.class": failure_class,
        "reason": {"timeout": "deadline_exceeded", "rate_limited": "dependency_throttled"}.get(
            failure_class, "unmapped_dependency_failure"),
        "http.status_class": f"{status // 100}xx" if type(status) is int and 400 <= status < 600 else "unknown",
    }


def lookup_order(order_id):
    started = perf_counter()
    failure_class, attempts = "none", None
    try:
        with safe_subsegment("DynamoDB.GetItem"):
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
                "event.name": "order.dependency.failed", "operation.name": "order.lookup",
                "stage": "lookup", "dependency.name": "dynamodb", "dependency.operation": "GetItem",
                **dependency_evidence(error), "request_id": context.aws_request_id,
            })
        except Exception:
            pass
        # Illustrative application policy, never copy over consumer retry semantics.
        # Suppress Python exception chaining so runtime output does not dump SDK text.
        raise RuntimeError("ORDER_LOOKUP_FAILED") from None


def handler(event, context):
    with safe_subsegment("Lambda.OrderLookup"):
        return lambda_handler(event, context)

# Deployment: Active tracing, X-Ray role permissions, finite retention. Python's
# disable flag is POWERTOOLS_TRACE_DISABLED=true (not TypeScript's enabled flag).
# One shared Tracer configured before any auto-patching import; verify continuity.
