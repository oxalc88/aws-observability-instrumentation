# Tracing: meaningful path, native instrumentation

Trace **when an execution path or dependency duration is operationally useful**. Preserve required tracing decisions for meaningful dependencies and distributed execution. Do not create subsegments for small local helpers.

## Prefer the supported SDK

- Reuse existing managed or application tracing before adding a second owner.
- Prefer Powertools handler middleware/decorators and reviewed SDK client capture. Configure them once, outside the handler where supported.
- Do not wrap an auto-instrumented SDK call in another manual subsegment. Manual segments and context restoration are exceptions for a proven unsupported boundary, not the default example.
- Configure response and full-error capture **off** when payload safety is not established. Broad automatic HTTP/SDK instrumentation also needs review: decorator flags do not sanitize independently captured SDK fields.
- Add only safe, bounded annotations/metadata. Do not attach raw URLs, payloads, responses, credentials, exceptions or personal data.
- Keep metrics for unsampled aggregate counts/durations. A trace can be absent because sampling or runtime/transport support differs.
- Preserve per-invocation request IDs and approved workflow correlation across asynchronous handoffs. Verify actual producer → transport → consumer continuity; two traced Lambdas do not prove one connected trace.
- Verify deployment activation, X-Ray permissions, sampling and the runtime's effective capture configuration. If continuity is unsupported, document the gap; correlation logs remain useful but are not equivalent traces.
- Tracing must not change business results, retries or acknowledgments. Prefer SDK lifecycle management; test error behavior and cold/warm invocations.

TypeScript: use reviewed `captureLambdaHandler` middleware and `captureAWSv3Client` when supported. Disable unwanted response/error capture in options and environment.

Python: prefer `capture_lambda_handler` and `capture_method` with `capture_response=False` and `capture_error=False`. Avoid manual X-Ray provider management for ordinary dependencies.

See [runtime references](language-adaptation.md) and official [TypeScript Tracer](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/) or [Python Tracer](https://docs.aws.amazon.com/powertools/python/latest/core/tracer/) docs. Do not mix root OTel tracing with the X-Ray-backed Powertools tracer.
