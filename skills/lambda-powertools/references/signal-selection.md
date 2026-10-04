# Coverage selection before APIs

Inventory applicable boundaries, then apply the [surface prescriptions](lambda-surfaces.md). Agents supply the prescribed operational questions when the user has no telemetry preference. User uncertainty does not disable coverage. Metrics answer aggregate questions; logs explain material outcomes; traces reconstruct meaningful dependency/distributed paths. Evaluate them together.

## Required coverage record

Use a short comment or the project's existing instrumentation document, not a new registry/configuration system. Record each required measurement or diagnostic/path contract separately; one whole-function “covered” label is insufficient.

| Field | Required meaning |
| --- | --- |
| Surface/question | Applicable boundary and aggregate, diagnostic, or path question |
| Owner/action | Existing emitter and operational investigation/response owner |
| Coverage state | `managed`, `custom`, `not_applicable`, or `exception` |
| Evidence | Metric/query, diagnostic event contract, or verified trace path plus deployment configuration |
| Semantics | Population, start/stop, attempt/record/batch/workflow, success/failure meaning, unit/statistic and dimensions |
| Safety/cost | Bounded fields/dimensions, sampling, frequency, EMF/log/trace volume and retention |
| Gap/exception | Missing capability, reason, mitigation, responsible owner, and review date |

- `managed`: existing AWS or application telemetry supplies the requirement; name it and prove equivalence. This label means existing coverage, not necessarily AWS ownership.
- `custom`: implement the missing coverage with the selected Powertools utility, one boundary owner, and a governed contract.
- `not_applicable`: the surface/event/question does not exist (for example no retries, remote dependencies, or queue). State the reason. Low volume or an unspecified user preference is not non-applicability.
- `exception`: coverage is required but missing or deliberately waived. Identify reason, mitigation, owner, and review date. Report it as a gap; do not call the requirement complete. Follow existing project approval policy, without inventing an extra permission workflow.

Unknown is an assessment task, not a final coverage state. Inspect existing code/deployment. If evidence remains unavailable, record an exception rather than inventing equivalence. Fill straightforward gaps autonomously; ask only when an unresolved business/deployment constraint changes the decision.

## Equivalence checks

A managed/custom metric can satisfy a prescribed measurement only if its population, boundary, outcome semantics, unit, available statistic, dimensions/scope, enabled delivery, and freshness match. Record the query/denominator for rates. A proposed dashboard is not evidence that a metric exists.

Lambda invocation metrics can cover Lambda execution; they do not automatically cover handled 400s, record outcomes, workflow stages, or caller-observed SDK timings. AWS dependency metrics may mix callers and measure server-side time. Queue receive/delete counts are not unique business operations. Some managed metrics need explicit enablement. Verify actual deployment rather than relying on a metric name.

Existing logs must satisfy the category's safe diagnostic contract and survive deployed levels/retention. Existing traces must instrument the required boundaries, enable collection, and verify supported handoffs and sampling. A correlation ID alone is not trace coverage. Do not add duplicate capture owners.

## Canonical decisions

| Surface/question | Coverage |
| --- | --- |
| Lambda invocation errors and duration | `managed`: Lambda Errors/Invocations/Duration with matching function scope |
| Handled request rejection rate | `custom` unless equivalent request telemetry exists: count all request outcomes, query rejected / total |
| Validation failure diagnosis | `custom` Logger event with safe rule/path/type and correlation |
| Dependency call aggregate latency/failures | `custom` unless caller-specific equivalent metrics exist; trace timing alone is insufficient |
| DynamoDB/S3 caller timeline | `custom` meaningful Tracer boundary, or `managed` existing trace owner |
| Local batch fallback trend | `custom` fallback and completed-record counts; unexpected failures also require diagnostics |
| Local helper with no operational surface | `not_applicable`: no helper metrics or subsegments |

For each workload record tracing as `enabled` or `disabled` plus coverage state/reason. Enable for meaningful dependency or distributed surfaces. Disable only for non-applicability, an existing owner (workload tracing stays enabled), or an explicit reported exception. Sampling is runtime policy, not an opt-out from assessment or metric coverage.
