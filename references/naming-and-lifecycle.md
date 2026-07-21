# Naming and lifecycle

## Names

Prefer current OTel semantic-convention names when they exist. Use a project namespace such as `app.` for custom metrics.

```text
app.workflow.step.duration
app.workflow.step.failure
app.retry.attempt
app.queue.depth
```

Use lowercase dot-separated words. Do not encode service, environment, region, unit, or attribute values in the name. Do not add Prometheus `_total`, `_bucket`, `_sum`, or `_count` suffixes manually; translation may create them.

## Immutable identity

Treat this tuple as immutable after release:

```text
(name, kind, unit, purpose, histogram boundaries,
 allowed attributes, required attributes, attribute meanings)
```

Description and owner may be clarified without a new metric only when operational meaning does not change.

## Versioning

Create `.v2`, `.v3`, and so on when an identity field changes:

```text
app.workflow.step.duration
app.workflow.step.duration.v2
```

Do not reuse a retired name. Run old and new metrics in parallel only for a documented migration window, then remove the old emission after dashboards and alarms move.

## Deprecation

Mark a definition deprecated and set `replaced_by`. The emission helper rejects new use of deprecated definitions. Record an owner and retirement date in the registry or adjacent documentation.

## Renames and PromQL normalization

The OTel instrument name and PromQL-exported series name can differ after Prometheus compatibility normalization. Treat the OTel name as source identity and verify the actual CloudWatch query name. A normalization difference is not a reason to rename the OTel instrument.

## Resource versions

Put deploy version in `service.version`. Do not create a new metric definition for each application release. During a metric migration, use the metric version suffix and the service resource version for distinct purposes.
