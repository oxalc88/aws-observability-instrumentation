# Review and enforcement

Use the review rubric for semantic decisions. A static scan cannot prove operational value, diagnostic usefulness, AWS coverage, or distributed continuity. This skill does not ship a generic application gate or E2E harness.

## Consumer verification

Use the project's existing lint/CI and focused instrumentation unit checks:

- Reject dynamic metric/event names, IDs in dimensions, raw event/body/error logging, INFO narration, and helper subsegments during review. Add project lint rules only where real bypasses occur.
- Assert failure-category records contain safe rule/path/dependency/location and correlation; test pathological input without exposing values.
- Capture Logger stdout and EMF in memory/local sinks. Assert one application event/publication, bounded dimensions, aggregate values, and no secrets.
- Exercise two warm invocations and failed SDK publication; verify no retained keys/metrics and unchanged application outcomes.
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
