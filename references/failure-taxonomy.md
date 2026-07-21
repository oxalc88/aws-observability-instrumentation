# Failure taxonomy

Every custom failure metric uses the closed `failure.class` taxonomy:

| Value                | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `timeout`            | A bounded operation exceeded its deadline            |
| `cancelled`          | Work was cancelled before completion                 |
| `dependency_failure` | An external dependency failed                        |
| `validation_failure` | Input or state failed validation                     |
| `auth_failure`       | Authentication or authorization failed               |
| `rate_limited`       | A dependency or policy rejected excess rate          |
| `quota_exhausted`    | A finite quota was exhausted                         |
| `internal_error`     | A known internal invariant or implementation failure |
| `unknown`            | No registered classification matched                 |

## Rules

- Register domain error classes next to the domain integration.
- Treat JavaScript/Python `TypeError` and JavaScript `RangeError` as internal implementation defects by default. Register explicit domain validation error classes as `validation_failure`; do not infer validation from a runtime type defect.
- Walk wrapped causes where the language/runtime preserves them.
- Prefer an explicit dependency response classification over message parsing.
- Use `unknown` rather than generating a new label from the exception class.
- Alert on growth in `unknown`; it indicates missing classification.
- Record the exception on the active span when policy permits it. Put only the bounded `failure.class`, safe `exception.type`, OTel `code.*` origin, and approved diagnostic fields in the normal structured log; route raw messages/stacks to a separately controlled diagnostic stream only when explicitly required.

## TypeScript

```ts
try {
  await callDependency();
} catch (error) {
  emitter.failure(DEPENDENCY_FAILURES, classifyFailure(error), {
    dependency: "payments",
  });
  throw error;
}
```

## Python

```python
try:
    call_dependency()
except BaseException as exc:
    emitter.emit_failure(
        DEPENDENCY_FAILURES,
        failure=classify(exc),
        attributes={"dependency": "payments"},
    )
    raise
```

Never pass `str(exc)`, `error.message`, a stack trace, or an arbitrary class name as a metric attribute.
