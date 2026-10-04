# Python Powertools implementation

Apply the shared contract first. Representative examples use Python 3.12+ and pinned Powertools 3.35.0, boto3, X-Ray and test dependencies in examples/python/requirements-lock.txt. These examples map the same identities, fields and budgets as TypeScript; they do not claim every SDK feature behaves identically.

## Metrics

Use `add_metric`, MetricUnit and one guarded `flush_metrics()` owner, or the existing `log_metrics` decorator after reviewing failures. Do not combine them. Python Metrics shares metrics/dimensions/metadata across instances by default; use a deliberately shared owner, or EphemeralMetrics for independent namespaces/buffers. The examples use module-scope EphemeralMetrics so importing all three modules cannot mix namespaces.

In the pinned SDK, `clear_metrics()` resets metric, temporary dimension, dimension-set and metadata state and restores defaults. Verify on upgrades. The small publication helper drops an emission if reset fails and contains flush/cleanup errors. Aggregate local counters before flushing; do not assume separate instances or concurrent tasks are isolated. Preserve latency samples; bypassing metric emission is a reported coverage gap.

## Logger

Use Logger directly with safe `extra` fields. Never use `logger.exception`, `exc_info`, raw exception objects, payload dumps or unsafe field spreads for operational diagnostics. Pass invocation/record fields directly; the examples do not mutate persistent keys or decorate handlers to log invocation events. If using `inject_lambda_context`, disable `log_event` and use appropriate `clear_state`; keep `POWERTOOLS_LOGGER_LOG_EVENT=false` and inspect overrides. Python's WARN method is `warning`; required events must survive deployed levels.

## Tracer and botocore

Python's disable switch is `POWERTOOLS_TRACE_DISABLED=true`, unlike TypeScript's enabled switch. Tracer normally auto-patches supported libraries. Configure one shared Tracer before imports/initialization that might establish a different global capture owner. The examples use `Tracer(auto_patch=False)` and manual provider subsegments to prevent broad SDK/HTTP capture. Do not combine these with botocore patching or another decorator at the same boundary.

If using capture decorators, disable response and error capture (`capture_response=False`, `capture_error=False`) and inspect effective environment settings (`POWERTOOLS_TRACER_CAPTURE_RESPONSE=false`, `POWERTOOLS_TRACER_CAPTURE_ERROR=false`). Decorator flags do not sanitize independent SDK capture. Manual context managers must not automatically serialize exceptions; the example guards begin/end/status/context restoration and uses a fault flag without raw exception metadata.

Botocore `ResponseMetadata.RetryAttempts` counts retries, excluding the first attempt. Convert actual observed metadata to attempts by adding one; invalid/absent evidence increments MissingAttemptEvidence. Do not equate this with queue redelivery or application retry exhaustion.

Python uncaught errors can print chained exceptions. The example's fixed public RuntimeError uses `from None` to avoid dumping raw SDK context; this is illustrative application error policy, not a reason to alter consumer retry semantics. Never import root OTel examples as the Python implementation of this contract.

Sources: [Metrics/isolation](https://docs.aws.amazon.com/powertools/python/latest/core/metrics/), [Logger](https://docs.aws.amazon.com/powertools/python/latest/core/logger/), [Tracer](https://docs.aws.amazon.com/powertools/python/latest/core/tracer/), [boto3 retries](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/retries.html).
