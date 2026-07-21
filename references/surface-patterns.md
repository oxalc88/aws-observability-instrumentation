# Reusable surface patterns

Use the matching TypeScript or Python example and adapt its declared routes, dependencies, workflow steps, and failure mappings.

## HTTP

Prefer OTel framework instrumentation. Use the custom HTTP wrapper only when standard metrics are absent or a separate business SLI is justified.

- span name uses method plus route template
- metric attributes use method, route template, and status class
- raw URL, query string, and request ID are forbidden metric attributes
- duration records on every terminal path

Examples: `examples/typescript/src/http.ts`, `examples/python/http_middleware.py`.

## External HTTP dependency

Centralize in a shared client:

- client span with stable dependency and operation name
- bounded outcome counter
- duration histogram
- classified failure counter
- response status on the span

Never use raw dependency URLs or response bodies as metric attributes.

Example: `examples/python/external_api_client.py`. Port the same shape to the consumer Node HTTP client when needed.

## Workflow

Wrap the entire step with one span and duration histogram. Add `failure.class` once when the step terminates with an exception. Declare step values in a closed set.

Examples: `examples/typescript/src/workflow.ts`, `examples/python/workflow_decorator.py`.

## Retry

Emit one attempt counter per actual attempt only when the attempt distribution matters. Bucket attempt number and emit one terminal outcome. Classify only the terminal exhausted failure.

Do not label with arbitrary exception type or backoff duration.

Example: `examples/python/retry_loop.py`.

## Fallback

Call one helper at the decision point with a closed reason. A fallback is a correctness signal, not necessarily a failure.

Example: `examples/python/fallback_path.py`.

## Lambda

Initialize telemetry and the logger before the handler module and reuse them across warm invocations. Let OTel Lambda auto-instrumentation own the invocation span; create only application operation or per-message spans in the handler. Keep `faas.invocation_id` as runtime identity and use a separate stable `correlation_id` for the business workflow. Never log the raw invocation event. Flush application-owned OTel metrics/traces within remaining time; platform-delivered stdout logs do not need that OTel flush. Do not shut down providers after each invocation.

Examples: `examples/typescript/src/lambda-bootstrap.ts`, `examples/typescript/src/lambda-handler.ts`, `examples/typescript/src/sqs-lambda-handler.ts`, `examples/typescript/src/kinesis-lambda-handler.ts`, `examples/python/lambda_handler.py`, `examples/python/sqs_lambda_handler.py`, and `examples/python/kinesis_lambda_handler.py`.

## Asynchronous messaging

Use OTel propagators through a transport-specific carrier, carry one validated `correlation_id`, and use span links for batches or fan-out with multiple producer contexts. A per-message span gives logs one unambiguous active span. Enforce each transport's metadata count, byte-size, encoding, privacy, replay, and reserved-field rules.

Examples: `examples/typescript/src/workflow-propagation.ts` and `examples/python/workflow_propagation.py` for a generic text carrier; both language directories also contain SQS and Kinesis transport adapters. Other transports require their own thin adapter.

## Structured event

Create a `LogEventDef` with a fixed message and declared fields. Emit it at the terminal boundary, not throughout helper layers. Mark security-required events explicitly, and use a separate audit stream when compliance needs independent retention or immutability. Apply ordered deterministic sampling only through bounded event properties and retain errors/security at `1.0`.

Examples: `examples/typescript/src/log-event.ts`, `examples/typescript/src/structured-logger.ts`, and `examples/python/structured_logging.py`.

## GenAI

Create `invoke_agent`, `chat`, and `execute_tool` spans following current OTel GenAI conventions. Conversation IDs and content never become metric attributes. Content capture is explicit and subject to redaction and retention policy.

Examples: `references/ai-agent-conversations.md`, `examples/python/ai_agent_spans.py`.
