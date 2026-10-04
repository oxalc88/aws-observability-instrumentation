# Failure taxonomy

Use a closed set for `failure.class`; a class groups incidents and does not replace the specific reason.

| Class | Meaning | Diagnostic family |
| --- | --- | --- |
| `validation_failure` | Declared input/schema check rejected work | Validation rule/path/type |
| `business_rejection` | Valid input failed a domain rule | Business rule/reason |
| `dependency_failure` | Remote service failed | Dependency operation/reason/status |
| `timeout` | Dependency/application deadline expired | Dependency or stage/deadline reason |
| `rate_limited` | Remote or local throttle | Dependency/control and bounded attempt evidence |
| `quota_exhausted` | Finite budget exhausted | Dependency/budget category |
| `auth_failure` | Authentication/authorization rejected | Security rule/decision |
| `internal_error` | Implementation or invariant defect | Fixed code location/reason |
| `cancelled` | Work deliberately cancelled | Stage and closed cancellation reason |
| `unknown` | No declared mapping matches | Safe location and unmapped-failure code |

A fallback can succeed; use a fallback event and correctness metric only when their separate questions justify them. Do not mark every fallback as a terminal operation failure.

Classify by typed domain errors or explicit status/code mapping. Do not parse exception messages, generate values from arbitrary class names, or assume `TypeError` means user validation. Unmapped SDK errors become a bounded `unknown`/dependency reason; inspect deployment/version and trace rather than logging the raw error.

Retries require two distinct meanings: failed attempt and terminal operation outcome. If aggregate attempt counts are useful, bucket/aggregate them; log the terminal outcome once. Queue delivery attempt does not prove retry budget exhaustion or DLQ arrival. Model exhausted retries or DLQ/redrive as their own lifecycle boundary.

A growing unknown category can justify investigation. It does not automatically justify another custom metric: use existing logs or aggregate failure coverage first.
