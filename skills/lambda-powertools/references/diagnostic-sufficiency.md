# Diagnostic sufficiency

An operator needs to identify **what failed, where, why, and which invocation** without replaying a sensitive payload. Include category-specific fields, not every possible field.

All material failure logs use a stable `event.name`, `operation.name`, `stage`, `failure.class`, and request ID (Powertools' `function_request_id` or a project equivalent). Add a trusted workflow correlation ID only when needed.

| Failure | Additional safe fields |
| --- | --- |
| Validation | Stable `validation.code`, `validation.rule`, schema `validation.path`, `validation.expected`, `validation.received_type`; optional approved field names and unknown-field count |
| Business rule | Closed `business.rule`, `reason`, fixed stage/location |
| Dependency or timeout | `dependency.name`, `dependency.operation`, exact observed `http.status_code`, approved safe `provider.error_code`, optional reviewed message, known retry/attempt evidence |
| Internal or unknown | Stable `reason`, fixed location, version and a safe exception type/code when available |
| Fallback/degradation | Selected fallback, trigger reason, stage/dependency, effect |
| Security | Closed decision/rule and safe actor/resource class; no principal token |

Never use caller-controlled field names or raw values as diagnostic paths. An undocumented HTTP 426 and code 731 must stay 426 and 731; the internal failure class can still be `unknown`. A full provider response, arbitrary error message or stack is **not** required to meet this contract. See [logging](logging.md) and [error handling](error-evidence.md).

A generic `invalid_input` alone is insufficient; a stable validation rule, location and safe received shape are useful. Do not log the original request to explain the rejection.
