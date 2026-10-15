# Python Powertools implementation

Apply the shared contract first. Representative examples use Python 3.12+ and pinned Powertools 3.35.0, boto3, X-Ray and test dependencies in examples/python/requirements-lock.txt. These examples map the same identities, fields and budgets as TypeScript; they do not claim every SDK feature behaves identically.

## Metrics

Use `add_metric`, MetricUnit and one guarded `flush_metrics()` owner, or the existing `log_metrics` decorator after reviewing failures. Do not combine them. Python Metrics shares metrics/dimensions/metadata across instances by default; use a deliberately shared owner, or EphemeralMetrics for independent namespaces/buffers. The examples use module-scope EphemeralMetrics so importing all three modules cannot mix namespaces.

In the pinned SDK, `clear_metrics()` resets metric, temporary dimension, dimension-set and metadata state and restores defaults. Verify on upgrades. The small publication helper drops an emission if reset fails and contains flush/cleanup errors. Aggregate local counters before flushing; do not assume separate instances or concurrent tasks are isolated. Preserve latency samples; bypassing metric emission is a reported coverage gap.

## Logger

Use Logger directly with reviewed safe `extra` fields. Never log arbitrary exceptions with unchecked `exc_info`/`logger.exception`, unknown response bodies, payloads or sensitive values. Preserve the original exception with bare `raise`; use stable error codes/status and operation context for diagnostics. `inject_lambda_context(log_event=False)` may supply invocation context; avoid persistent per-record keys. See [logging](../logging.md).

## Tracer and botocore

Prefer `capture_lambda_handler(capture_response=False, capture_error=False)` and `capture_method(capture_response=False, capture_error=False)` over manual X-Ray provider segments. Review auto-patched botocore capture separately; this example uses `auto_patch=False` and one explicit dependency method. Set `POWERTOOLS_TRACER_CAPTURE_RESPONSE=false` and `POWERTOOLS_TRACER_CAPTURE_ERROR=false`. Python's disable switch is `POWERTOOLS_TRACE_DISABLED=true`. A failed trace must not change the business error/response. See [tracing](../tracing.md).

Botocore `ResponseMetadata.RetryAttempts` counts retries, excluding the first attempt. Convert actual observed metadata to attempts by adding one; invalid/absent evidence increments MissingAttemptEvidence. Do not equate this with queue redelivery or application retry exhaustion.

Python uncaught errors can print chained exceptions outside Logger. Review platform output and the outer response/error boundary separately; do not use `from None` to destroy causal evidence. Preserve business retry semantics. Never import root OTel examples as the Python implementation of this contract.

Sources: [Metrics/isolation](https://docs.aws.amazon.com/powertools/python/latest/core/metrics/), [Logger](https://docs.aws.amazon.com/powertools/python/latest/core/logger/), [Tracer](https://docs.aws.amazon.com/powertools/python/latest/core/tracer/), [boto3 retries](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/retries.html).
