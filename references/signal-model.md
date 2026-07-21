# Signal model

Define every custom metric and structured event once. These registries are design contracts and the source for runtime validation, SDK views, review, and CI.

## MetricDef

```text
name                    OTel instrument name
kind                    counter | gauge | histogram
unit                    UCUM unit
purpose                 outcome | latency | load | resource | correctness
description             one precise operational sentence
owner                   team or component
attribute_constraints   closed set or approved bucket per key
required_attributes     subset required on every data point
emit_frequency          per_request | per_step | per_event | periodic
histogram_boundaries    explicit ascending values for histograms
loop_policy             forbidden | aggregate_only | allowed
version                 registry lifecycle version
deprecated/replaced_by  migration state
```

## Constructors

Use one of five constructors:

| Constructor | Instrument | Purpose | Default unit |
| --- | --- | --- | --- |
| `counter` | Counter | caller selects | `{event}` or explicit |
| `latency` | Histogram | latency | `s` |
| `gauge` | Gauge | load | explicit |
| `resource` | Counter | resource | explicit |
| `failure_counter` / `failureCounter` | Counter | outcome | explicit failure count |

The failure constructor adds required `failure.class` values from `FailureClass`.

## TypeScript

```ts
const STEP_DURATION = MetricDef.latency({
  name: "app.workflow.step.duration",
  owner: "workflows",
  description: "Elapsed time for a declared workflow step.",
  attributes: {
    "app.workflow.step": new Set(["ingest", "transform", "publish"]),
  },
  required: new Set(["app.workflow.step"]),
  emitFrequency: "per_step",
});
```

## Python

```python
STEP_DURATION = MetricDef.latency(
    "app.workflow.step.duration",
    owner="workflows",
    means="Elapsed time for a declared workflow step.",
    attributes={
        "app.workflow.step": frozenset({"ingest", "transform", "publish"})
    },
    required=frozenset({"app.workflow.step"}),
    emit_frequency="per_step",
)
```

## Registry validation

Reject:

- duplicate names
- missing descriptions, units, or owners
- required attributes not declared in constraints
- histograms without ascending explicit boundaries
- non-histograms with boundaries
- deprecated definitions without replacements
- forbidden attribute keys
- two definitions with the same name but different identity

Build SDK histogram views from the registry. Create each instrument lazily or during startup, never inside a request.

## LogEventDef

```text
name                 stable dotted event name
level                DEBUG | INFO | WARN | ERROR
message              fixed human-readable summary
owner                team or component
security_relevant    bypasses ordinary verbosity filtering
sampling_class       optional bounded class such as mandatory | operational | diagnostic
operation_name       stable operation shared with the span
related_metric       primary MetricDef explained by this event
fields               declared key -> operational | correlation | sensitive
required             subset required on every record
```

Unlike metric attributes, log fields may contain approved high-cardinality correlation values. They still require an explicit schema, bounded lengths, privacy classification, injection-safe encoding, and retention/access review. Sensitive fields are disabled by default. Read `structured-logging.md` before adding an event.

When `related_metric` is present, all of its required attributes must be required event fields. The logger emits the exact metric name as `metric.name`. Logger-managed resource, trace, metric, exception, and code-origin fields are reserved and cannot be supplied by event data.

## LogSamplingRule

```text
id                    stable policy identifier
rate                  number from 0.0 through 1.0
locked                mandatory-policy guard; required for explicit ERROR/security rules
levels                optional closed severity list
events                optional exact event.name list
operations            optional exact operation.name list
environments          optional exact deployment environment list
sampling_classes      optional exact declared sampling-class list
security_relevant     optional exact boolean
```

Evaluate rules in declaration order and use the first match. Hash the policy ID with the workflow `correlation_id`, falling back to the active `trace_id`, so every component makes the same deterministic decision. Retained records contain managed `sampling.policy` and `sampling.rate` fields. Errors and security-relevant records are always retained at `1.0`, even when a broad rule would otherwise drop them.
