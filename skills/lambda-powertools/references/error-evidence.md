# Diagnostic error evidence for AWS Lambda Powertools

Use this contract at the owning material failure boundary. It is language-independent; TypeScript and Python examples are adaptations, not the supported-language list.

## Separate three concerns

- **Observed:** exact `http.status_code` (integer when received), `http.status_class` as an optional derived convenience, sanitized `provider.error_code` and `provider.error_message` even if previously unknown, and local `exception.name`, `exception.message`, `exception.stack` and `exception.causes` when available.
- **Classification:** bounded `failure.class` and `reason`; `unknown` is valid and does not suppress evidence.
- **Decision:** explicit `retry.decision` and `retry.reason` from the application's existing policy. Do not infer the cause, business behavior, or retry policy from HTTP status alone.

Use one terminal WARN/ERROR at the owning boundary, not log-and-rethrow in every helper. Record material INFO workflow transitions (received, routed, accepted, published, processed) only when a declared operator can reconstruct the workflow from them. Preserve original correlation across Lambda/SQS/retries, along with per-record message ID and invocation ID. Never mix concurrent batch-record context.

## Security policy: approved sources and bounded diagnostics

1. **Capture source, not whole objects.** Only read reviewed provider fields (e.g. status, declared error code/message field), not raw bodies/responses/headers/error spreads. Unknown *values* in an approved field may be preserved; an unknown payload shape does **not** authorize dumping its contents.
2. **Sanitize all free text before Logger.** Neutralize control characters, redact obvious credentials, tokens, authorization values, URLs with query strings, emails and other sensitive patterns. Apply maximum sizes to each field **and** the complete event. Sanitizing by regex alone cannot prove arbitrary free text contains no PII; each external message field needs an explicit data-handling review and access/retention policy. Omit unsafe/unknown values if review or reliable redaction is absent.
3. **Never erase omissions.** Emit `diagnostic.redacted`, `diagnostic.truncated` and `diagnostic.omitted` as field-name lists where relevant. For unexpected/non-JSON responses prefer observed status, content type and size or safe schema/type evidence; set an omission reason rather than logging a raw body. Do not claim an incomplete stack is complete.
4. **Example budgets** (overridable only after review): max 512 chars per provider/exception message, 128 per code, 4096 per stack, 4 causes, 12 KiB total diagnostic event. Never attach diagnostic strings to metric dimensions, EMF, or arbitrary trace metadata.
5. **Preserve provenance.** Keep original exception identity when rethrowing; use `cause` (JS) or `raise ... from error` (Python) when wrapping. The local stack shows our execution path, not the provider's server-side stack unless supplied by the provider.
6. **Check separate emission paths.** Uncaught runtime/Lambda error serialization can leak unsanitized messages independently of Powertools Logger; consider the outer error/response boundary and test it. Do not enable raw Powertools/SDK trace exception or response capture merely to obtain log evidence. No second delivery pipeline.

## Illustrative unknown provider failure

```json
{
  "level": "ERROR",
  "event.name": "order.dependency.failed",
  "operation.name": "order.process",
  "stage": "provider.accept",
  "request_id": "lambda-invocation",
  "correlation_id": "approved-correlation",
  "http.status_code": 426,
  "http.status_class": "4xx",
  "provider.error_code": "UNMAPPED_CODE",
  "provider.error_message": "Unexpected upgrade requirement",
  "failure.class": "unknown",
  "reason": "unmapped_dependency_failure",
  "retry.decision": "fail",
  "retry.reason": "existing_policy",
  "exception.name": "ProviderCallError",
  "exception.message": "Provider returned HTTP 426",
  "exception.stack": "ProviderCallError: Provider returned HTTP 426\\n at adapter:23",
  "exception.causes": [],
  "diagnostic.redacted": [],
  "diagnostic.truncated": [],
  "diagnostic.omitted": []
}
```

All names/values above are illustrative, not a recorded provider response.

## Acceptance/evals

- A provider HTTP 426 with unknown safe error code/message retains exact status and approved text, not only `4xx` / `unknown`.
- A local exception preserves sanitized name/message/stack/cause chain; source-map deployment is documented; truncation/omissions are visible.
- Explicit test data with bearer tokens, API keys, URL queries, email/PII, malformed responses, enormous stacks and cyclic/throwing causes cannot leak via the structured record. Unknown unreviewed free-text providers fail closed.
- WARN/ERROR at deployed INFO carries sufficient evidence; DEBUG is optional and cannot restore previously filtered data.
- A cross-invocation workflow can be followed by correlation ID; parallel batch records never exchange identities; exactly one terminal application error is logged.
- Logger/metrics/tracer failures do not replace original business errors, retries or target decisions.

## Deployment verification

Coordinate Powertools Logger level with Lambda Advanced Logging Controls; check effective versions/aliases, change propagation, rollback, deployment drift and EMF extraction under the selected Lambda JSON logging configuration. The code example is not proof of deployed filter behavior. Never promise every failure has a sampled trace.
