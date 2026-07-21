# Attributes and cardinality

CloudWatch native OTLP accepts many labels, but every unique metric name and complete label tuple is a time series. Service limits are ceilings, not a reason to attach arbitrary context.

## Never use as metric attributes

- user, account, tenant, device, request, trace, span, session, or conversation IDs
- email addresses, IP addresses, or authorization data
- raw URL paths, full URLs, query strings, SQL text, or object keys
- exception messages, stack traces, or arbitrary exception class names
- prompt, completion, tool input, or tool output content
- timestamps, commit hashes, container IDs, task ARNs, pod UIDs, or generated names copied from the runtime

Runtime identity may be present as resource attributes supplied by a detector or AWS enrichment. Do not duplicate it as a custom data-point attribute.

## Approved value shapes

1. A closed enum documented in `MetricDef`:

```ts
attributes: {
  outcome: new Set(["success", "failure"]);
}
```

2. A route template from the framework router, never `request.url`:

```text
/orders/{order_id}
```

3. An approved bucket function:

```text
status_code_class: 2xx | 3xx | 4xx | 5xx | other
attempt_bucket:    1 | 2 | 3-5 | 6+
size_bucket:       0_1kb | 1_10kb | 10_100kb | 100kb_1mb | 1mb_plus
```

4. A stable operation name declared in code, such as `create_order` or `publish_invoice`.

## Resource attributes

Use the resource for stable identity:

```text
service.name
service.version
deployment.environment.name
cloud.provider
cloud.region
cloud.platform
```

Use OTel resource detectors and AWS enrichment for ECS, EKS, EC2, and Lambda metadata. Avoid per-request metadata service calls.

## Cardinality budget

Before adding an attribute, multiply the maximum values of all attributes. A metric with 8 routes, 7 methods, 6 status classes, 3 environments, and 5 versions can create 5,040 active series before runtime enrichment.

Use these project defaults:

- low cardinality: at most 50 intended combinations per service and version
- medium cardinality: at most 500 intended combinations with a documented query need
- above 500: require an explicit cost and query review

CloudWatch may enrich resources with additional labels. Include that effect in volume and query testing.

## Spans and logs

High-cardinality debugging context normally belongs on a span or governed structured log, subject to privacy and retention policy. This is not permission to record sensitive data automatically. Log fields must be declared and classified; credentials, session values, bodies, and GenAI content remain excluded from the operational stream by default. Read `structured-logging.md`.
