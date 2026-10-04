# Tracing: useful path and timing

Tracing is optional. Enable Powertools Tracer when operators need dependency timing, distributed causality, a path across AWS services/Lambdas, or workflow investigation that logs/metrics cannot answer. A simple local validation/transform Lambda may need none.

## Meaningful boundaries

Good subsegments describe a DynamoDB operation, external payment request, event publication, or a meaningful workflow stage. Do not decorate validateInput, mapDto, buildResponse, or formatString. Instrument an AWS SDK client once with `captureAWSv3Client`; do not wrap the same call with another manual dependency subsegment. Choose one HTTP capture owner.

Powertools Tracer is an X-Ray SDK wrapper, not an OTel tracer. Enable Lambda active tracing, required execution-role permissions, and the relevant upstream AWS service configuration. Verify current sampling/transport support. Do not run ADOT/OTel auto-instrumentation for the same boundaries under this contract.

Initialize Tracer and clients outside the handler. Middleware/decorators own handler subsegment close/restore behavior. Manual subsegments require `finally` cleanup and restored context, including errors and warm invocations.

## Capture safety

Disable handler/method response capture with `captureResponse: false` and deploy `POWERTOOLS_TRACER_CAPTURE_RESPONSE=false`. Deploy `POWERTOOLS_TRACER_CAPTURE_ERROR=false` to disable Powertools' automatic full-error metadata. The latter does not disable AWS SDK auto-instrumentation's independent error/attribute capture: review that capture and sanitize errors at its boundary when needed. HTTP auto-capture can include raw URLs; disable it (`captureHTTPsRequests: false`) when paths/query strings can contain sensitive data and use reviewed safe instrumentation.

Use bounded annotations for filtering; only approved safe metadata. No raw payloads, bodies, responses, unrestricted exceptions, secrets, or personal data. Do not confuse non-indexed metadata with safe/free storage. A fixed operation/failure category can correlate signals without duplicating the log's whole diagnostic record.

## Asynchronous causality

Keep one approved `correlation_id` across SQS/SNS/EventBridge/workflow stages in declared transport metadata. Keep request ID per Lambda and message ID per record in logs, never metric dimensions. Preserve supported AWS trace context (for example SQS `AWSTraceHeader`) separately from correlation.

Transport support and active tracing vary. Verify the producer → managed service → consumer path in the target deployment; adding Tracer to both Lambdas alone does not prove continuity. Batches can contain records from different traces/workflows. Never treat the first record as every record's parent. Correlation logs remain useful when a path is not sampled/supported; do not invent links or claim OTel span-link semantics for X-Ray.

Sources: [Powertools Tracer](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/), [SQS X-Ray propagation](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html). Verify package behavior when upgrading; the canonical example is pinned.
