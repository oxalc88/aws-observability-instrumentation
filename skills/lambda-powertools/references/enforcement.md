# Review and enforcement

Use the review rubric for semantic decisions. A static scan cannot prove operational value, diagnostic usefulness, AWS coverage, or distributed continuity. This skill does not ship a generic application gate or E2E harness.

## Coverage enforcement

Review must compare the code/deployment inventory with the prescribed surface table and coverage record. Assert required emissions at the existing boundary patterns, not at helpers. Reject incomplete coverage represented as complete; require a documented exception for intentional gaps. Verify managed equivalence and actual enablement before removing custom instrumentation. User preference is not required to apply the baseline.

Retain Sentry's enforcement intent: fixed names, complete definitions, closed dimensions, taxonomy, duplicate detection, immutable identities/versioned migration, no silent removal, and loop aggregation. Use existing project lint/AST and contract checks where supported; this repository does not ship a generic 13-rule Powertools AST gate. Semantic coverage, exception review, and deployment evidence remain human/agent review duties. Never describe them as fully machine-enforced.

## Consumer verification

Use the project's existing lint/CI and focused instrumentation unit checks:

- Reject dynamic metric/event names, IDs in dimensions, raw event/body/error logging, INFO narration, and helper subsegments during review. Add project lint rules only where real bypasses occur.
- Assert failure-category records contain safe rule/path/dependency/location and correlation; test pathological input without exposing values.
- Assert request acceptance/rejection totals and latency, dependency success/failure/throttle/timing, stage failure/duration, retry/fallback counts, and applicable queue/resource semantics at their boundaries. Trace sampling must not gate aggregate emission.
- Capture Logger stdout and EMF in memory/local sinks. Assert one application event/publication, bounded dimensions, aggregate values, and no secrets.
- Exercise two warm invocations and failed SDK publication; verify no retained keys/metrics and unchanged application outcomes.
- Require the explicit tracing enable/disable record and verify code/deployment agree with it. If causality is required, report unsupported continuity as a gap rather than treating correlation logs as trace coverage.
- Inspect middleware order and effective capture flags. Assert no automatic full-error/response capture under the selected trace contract.
- Verify supported propagation, sampling, and managed telemetry coverage in a deliberate non-production deployment check when rolling out instrumentation. Do not create a testing framework or automate user stories.

## Repository verification

```bash
python3 scripts/test_install.py
cd skills/lambda-powertools/examples/typescript
npm ci
npm run check
npm test
```

The example tests verify local privacy, aggregation, duplicate publication, cleanup, and failure containment. They do not contact AWS or prove trace continuity/EMF extraction in a deployment. The existing root OTel gate remains scoped to root examples/config; its prohibition of X-Ray is incompatible with this skill and must not be applied to the Powertools subtree.

Do not describe the entire rubric as machine-enforced. Installation checks enforce selected-profile isolation; type checks and SDK-focused tests enforce representative examples. Human review owns the remaining semantic decisions.
