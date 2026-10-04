# Diagnostic sufficiency

A structured record is useful only if an engineer can identify what failed and where to investigate next without blindly reproducing the request.

For failures, move through **operation → stage → category → specific safe rule/reason → location or dependency → correlation**. Fields are category-specific; do not populate unrelated empty fields.

## Minimum contracts

All failure events need stable `event.name`, `operation.name`, `stage`, `failure.class`, and `request_id` (or Powertools `function_request_id`). Add a validated `correlation_id` when the workflow crosses invocations; retain both IDs. A trace ID is optional and may exist even when no sampled trace is stored.

| Category | Additional evidence |
| --- | --- |
| Validation | `validation.code`, `validation.rule`, `validation.path`, `validation.expected`, `validation.received_type`; a fixed schema/code location if path is not enough |
| Business rule | Closed `business.rule`, safe `reason`, and fixed `location` or rule stage |
| Dependency/timeout/rate limit | `dependency.name`, `dependency.operation`, safe `reason`; `http.status_class` for HTTP, `retry.attempt`/attempt count when retry occurred |
| Internal/invariant/unknown | Closed `reason`, fixed `location`, safe allowlisted error type when helpful, deployment version if it changes investigation |
| Fallback/degradation | Selected fallback, closed trigger reason, affected stage/location/dependency, and expected operational effect |
| Security | Closed decision/rule, security relevance, safe actor class and resource class if necessary; no principal secret/token |

`validation.received_fields`, `validation.schema`, and `validation.stage` are useful optional extensions. Enumerate safe field names, cap array length, use `validation.unknown_field_count` for unknown names. Use schema paths/templates, never user values or dynamic JSON keys as paths. `validation.expected` describes a rule/type, not an expected secret or database value.

## Sufficient validation example

```json
{
  "event.name": "order.validation.rejected",
  "operation.name": "order.enrich",
  "stage": "validate",
  "failure.class": "validation_failure",
  "validation.code": "NO_SUPPORTED_ENRICHMENT_FIELDS",
  "validation.rule": "supported_enrichment",
  "validation.path": "body",
  "validation.expected": "at_least_one_supported_field",
  "validation.received_type": "object",
  "validation.received_fields": [],
  "validation.unknown_field_count": 2,
  "request_id": "opaque-invocation-id"
}
```

The code/rule identifies the condition, path/stage locate it, safe shape explains it, and request ID provides a pivot. `{ "reason": "invalid_input" }` cannot do this.

Keep correlation opaque, bounded, and from a trusted metadata contract. A string-length/regex check does not prove that a caller-supplied ID contains no personal data or token. Use request ID when no approved workflow ID exists.
