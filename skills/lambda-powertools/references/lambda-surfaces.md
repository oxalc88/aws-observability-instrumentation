# Lambda surfaces and emission ownership

| Boundary | When a metric is justified | When a log is justified | When a trace is justified |
| --- | --- | --- | --- |
| Lambda/request completion | Domain outcome absent from managed telemetry | Investigable terminal outcome | Invocation hosts a meaningful dependency path |
| Workflow stage | Stage outcome/duration needed across executions | Stage rejection/failure with a rule/location | Multiple components or stage timing matters |
| External dependency | Distinct aggregate dependency SLI not already covered | Terminal dependency failure with safe code/status/attempt evidence | Remote path/timing; instrument client once |
| Retry loop exit | Attempts or exhaustion trends; aggregate attempts | One exhausted operation, or material recovered degradation | Dependency attempts affect useful timing/path |
| Queue/batch exit | Completed/failed-record totals or lag not covered by AWS | Material record rejection/failure with record correlation | Producer/consumer causality supported by transport |
| Fallback choice | Correctness trend or resource effect | Unexpected/material degradation | Alternative dependency path matters |

The table is a decision guide, not required emissions.

## Handler lifecycle

Reuse selected utilities at module scope. End metric buffers at completion with one publication owner. Reset temporary Logger/metric context even after failure. Keep the domain result and ack/retry semantics unchanged. Do not log-and-rethrow at a helper and again at the handler.

Lambda Errors/Duration are managed signals. Custom application success/error/duration metrics need a different meaning. Hard timeouts bypass in-process logging/publication; do not claim complete timeout visibility from `finally`.

## Queue and retry semantics

Specify whether each count represents attempts, acknowledged records, completed business operations, or batches. At-least-once delivery can repeat work and metrics. Do not claim exactly-once telemetry across retries; use the existing domain deduplication boundary if that is the question.

For SQS partial batch responses, Lambda success is not record success. Preserve `batchItemFailures`; do not change failure handling just to make instrumentation simpler. Aggregate compatible counters at batch exit; use per-record logs only for material diagnostics. Concurrent records must pass correlation directly to Logger rather than mutate shared temporary keys.

An attempt-level log is justified only when a separate response/investigation requires it. Otherwise retain terminal evidence and total attempts. A fallback log plus terminal failure log for the same recovered outcome is misleading.
