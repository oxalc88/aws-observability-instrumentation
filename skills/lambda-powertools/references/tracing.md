# Tracing: useful path and timing

Tracing selection is mandatory; trace emission depends on that explicit decision. Evaluate tracing alongside metrics and logs, not after them. Prescribe tracing for meaningful external dependency calls and distributed execution paths: their default questions are where caller time went and how execution stages connect. User preference is not needed to establish this baseline. A simple local validation/transform Lambda may mark tracing not applicable and disable it with a reason.

## Required enable/disable decision

Record `tracing: enabled|disabled`, reason/question, instrumentation owner, dependency/workflow boundaries, and propagation requirements before implementation. When enabled, also record deployment activation and sampling policy. No decision is a review failure. Record managed/custom/not_applicable/exception as defined in [signal selection](signal-selection.md). An explicit disable is not sufficient to waive an applicable requirement.

- **Enable:** meaningful DynamoDB/S3/external calls, or distributed execution across multiple Lambdas, AWS services, queues, or workflow stages. Identify producer → transport → consumer continuity, not just individual handler instrumentation.
- **Disable:** no meaningful dependency/path question, or adequate existing tracing owns these boundaries. Name that existing owner when applicable; do not create duplicate Powertools subsegments. A local-only validation example can disable tracing because it has no dependency or distributed path.
- **Blocked:** when required continuity is unsupported or unavailable, report the gap and a mitigation/owner. Correlation logs help investigation but do not fulfill the trace requirement. Do not silently mark the requirement complete or disabled merely to reduce cost.

This is a skill decision contract, not a new configuration framework. Use a short comment or the project’s existing instrumentation document. The selected SDK’s tracing enable/disable setting is a runtime switch; deployment and code must agree with the decision. Verify its name/default in the [language reference](language-adaptation.md).

## When tracing is activated

Separate the instrumentation decision, deployment configuration, and sampling:

1. **Select it for a useful question.** For example: which DynamoDB or S3 SDK call consumed this Lambda execution time? A sampled trace provides the execution timeline and timed dependency subsegments. Managed Lambda Duration shows aggregate invocation latency; it cannot locate the slow integration. Tracing useful dependency calls does not require a workflow spanning multiple Lambdas.
2. **Enable it before execution.** Set Lambda CloudFormation `TracingConfig: { Mode: Active }` (SAM `Tracing: Active`), grant the execution role `xray:PutTraceSegments` and `xray:PutTelemetryRecords`, and instrument the handler and selected SDK/dependency boundaries. Powertools Tracer must be enabled through the selected SDK’s configuration. Installing this skill changes agent instructions, not AWS deployment settings.
3. **Record sampled invocations.** Active tracing does not record every invocation. Lambda honors upstream sampling decisions where present; otherwise Lambda sampling applies. It can record successful and failed executions. Tracing does not switch on retroactively because an error occurred or an execution was slow. Keep aggregate latency/error monitoring in metrics and required individual failure evidence in logs.

SDK calls appear only when their client/boundary is instrumented. Use the selected SDK’s reviewed client capture or a safe manual dependency subsegment, never both for the same call. A call duration measures what the Lambda observed, including client/network overhead; it is not a breakdown of internal DynamoDB/S3 processing. Verify the deployed trace timeline and service path.

## Meaningful boundaries

Good subsegments describe a DynamoDB operation, external payment request, event publication, or a meaningful workflow stage. Do not decorate validateInput, mapDto, buildResponse, or formatString. Instrument an AWS SDK client once using the selected language’s API; do not wrap the same call with another manual dependency subsegment. Choose one HTTP capture owner.

Powertools Tracer is an X-Ray SDK wrapper, not an OTel tracer. Enable Lambda active tracing, required execution-role permissions, and the relevant upstream AWS service configuration. Verify current sampling/transport support. Do not run ADOT/OTel auto-instrumentation for the same boundaries under this contract.

Initialize Tracer and clients outside the handler. Middleware/decorators own handler subsegment close/restore behavior. Manual subsegments require `finally` cleanup and restored context, including errors and warm invocations.

## Capture safety

Disable automatic response and full-error metadata capture through the selected SDK's explicit options and effective environment configuration. Review SDK auto-instrumentation independently: a Powertools capture flag may not govern underlying SDK attributes/errors. Avoid broad automatic HTTP capture when raw URLs/query strings can contain sensitive data. Read the language reference for actual option names, auto-patching defaults and cleanup behavior; do not copy TypeScript flags into Python or another language.

Use bounded annotations for filtering; only approved safe metadata. No raw payloads, bodies, responses, unrestricted exceptions, secrets, or personal data. Do not confuse non-indexed metadata with safe/free storage. A fixed operation/failure category can correlate signals without duplicating the log's whole diagnostic record.

## Asynchronous causality

Keep one approved `correlation_id` across SQS/SNS/EventBridge/workflow stages in declared transport metadata. Keep request ID per Lambda and message ID per record in logs, never metric dimensions. Preserve supported AWS trace context (for example SQS `AWSTraceHeader`) separately from correlation.

Transport support and active tracing vary. Verify the producer → managed service → consumer path in the target deployment; adding Tracer to both Lambdas alone does not prove continuity. Batches can contain records from different traces/workflows. Never treat the first record as every record's parent. Correlation logs remain useful when a path is not sampled/supported; do not invent links or claim OTel span-link semantics for X-Ray.

Sources: [Lambda active tracing and sampling](https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html), [SDK-specific Tracer references](language-adaptation.md), [SQS X-Ray propagation](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html). Verify package behavior when upgrading; the canonical example is pinned.
