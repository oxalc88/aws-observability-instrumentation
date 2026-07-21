# Enforcement

Run static checks and executable tests. Static checks prevent obvious contract bypasses; tests prove the SDK wrapper behavior.

## CI gate

`examples/python/ci_gate.py` scans Python, TypeScript, and JavaScript source for these rules:

1. OTel instruments are created only in the approved emission module.
2. Application code does not call CloudWatch `PutMetricData` directly.
3. CloudWatch regional OTLP endpoints are not hardcoded in business source.
4. Metric definitions do not use Prometheus-generated suffixes.
5. Forbidden high-cardinality attribute keys are not declared.
6. Exception messages and stack traces are not metric attributes.
7. Resource identity is not copied into data-point emission attributes.
8. Elapsed duration does not use wall-clock functions.
9. Metric emission inside loops requires aggregation or an explicit allow marker.
10. Metric definition names are unique.
11. Lambda handlers do not initialize telemetry inside the handler.
12. Lambda handlers do not shut down providers per invocation.
13. Legacy Sentry SDK calls are absent from the adaptation source.
14. Legacy X-Ray SDK imports, packages, and daemon images are absent.
15. Raw console/print calls do not bypass the approved structured logger.
16. Operational log definitions/emissions exclude credentials, bodies, session values, prompts, and other prohibited content.
17. Log events use bounded failure classes instead of raw exception messages or stacks.
18. Raw request events, payloads, bodies, and headers are not passed to loggers.

Run:

```bash
python examples/python/ci_gate.py examples/typescript/src examples/python config
```

## TypeScript

```bash
cd examples/typescript
npm ci
npm run check
npm test
```

The tests cover metric construction, required/closed attributes, instrument reuse, monotonic counter validation, structured event fields, sensitive-data defaults, trace/workflow correlation, ordered deterministic sampling, mandatory retention, injection neutralization, SQS quota/links, Kinesis envelopes/links, generic asynchronous carriers, level behavior, and sink failure containment. Consumer projects should also use in-memory exporters and logger sinks to assert resource context and emitted records.

## Python

Install `examples/python/requirements.txt`, then run:

```bash
pytest -q examples/python
```

Test provider setup with in-memory exporters rather than live CloudWatch. Keep one explicit AWS integration smoke test per deployment topology outside the unit suite.

## Deployment validation

Validate collector YAML with the exact pinned collector image. Component availability differs between core, contrib, ADOT, CloudWatch agent, and Lambda distributions.

Validate ECS task JSON before registration. Deploy to a non-production service, generate a counter/gauge/histogram and structured success/failure/security records, then verify PromQL labels in Query Studio and correlation in Logs Insights.

For Lambda, test cold and warm invocation paths, near-timeout behavior, exporter failure, and the real asynchronous route from producer through consumer. Verify trace links plus stable `correlation_id` through retry, replay, fan-out, and DLQ/redrive where applicable. A unit test cannot prove that a deployed layer contains the configured collector components or that a managed transport preserves the selected carrier.
