# Review rubric

## Destination

- Is this native OTLP/PromQL or classic/EMF?
- Does exactly one pipeline own the metric?
- Is OTLP/HTTP used for direct CloudWatch endpoints?
- Is SigV4 or bearer authentication outside business instrumentation?
- Does exactly one path own each log record: platform stdout/file collection or an OTel bridge?

## Semantics

- Does a standard OTel semantic convention already cover the signal?
- Is the instrument kind correct?
- Is the UCUM unit correct?
- Are histogram boundaries aligned to operating thresholds?
- Does the description state exactly what increments or records?

## Attributes

- Are all data-point attributes declared and bounded?
- Are route values templates rather than raw paths?
- Are resource identity fields on the resource?
- Are IDs, exception messages, content, and secrets absent from metric attributes?
- Is projected cardinality documented and acceptable after AWS enrichment?

## Ownership

- Is the signal emitted at one lifecycle boundary?
- Is duration measured with a monotonic clock and recorded on failure?
- Is a failure counted once with a bounded `failure.class`?
- Are instruments reused rather than created per request?
- Is each structured event emitted once at the boundary that knows its terminal outcome?

## Logging

- Does every record use a declared schema, fixed message, stable level, and owner?
- Are trace/span and validated interaction IDs present when context exists?
- Are untrusted fields length-bounded, control-character safe, and JSON encoded?
- Are credentials, session values, bodies, prompts, raw errors, and unapproved personal data absent?
- Are required security events classified and protected from ordinary level filtering/sampling?
- Are sampling rules ordered, bounded, deterministic by workflow, and recorded as `sampling.policy`/`sampling.rate`?
- Are explicit error/security policies locked at `1.0`, with trace sampling reviewed separately?
- Does a sink/export failure leave business behavior unchanged and remain detectable?
- Are log-group access, encryption, retention, deletion, and access monitoring explicit?

## Runtime

- Fargate: Does the task role allow export, and is the sidecar health/memory configured?
- Lambda: Is initialization outside the handler, flush bounded, JSON `LoggingConfig` set, and per-invocation shutdown absent?
- Async: Does the adapter propagate OTel context plus stable `correlation_id`, enforce carrier limits, and represent batches/fan-out with links?
- EKS: Does workload identity and resource enrichment match the collector topology?
- EC2/local: Is the receiver exposure and credential source appropriate?

## Operations

- Is there a tested PromQL query?
- Does the alarm handle missing and low-traffic data?
- Are collector/export failures monitored?
- Are current Region availability and CloudWatch limits verified?
- Is there a tested Logs Insights query for each operational/security event consumer?
- Are SDK, layer, collector, and image versions pinned and compatible?

## Block the change for

- raw `PutMetricData` calls in business code
- a hardcoded token or regional endpoint in application source
- `awsemf` described as native OTLP/PromQL
- `aws-xray-sdk`, `aws_xray_sdk`, or an X-Ray daemon instead of OTel
- raw exception/user/request/session content as a metric attribute
- duplicate standard HTTP, database, or messaging instrumentation
- unbounded series creation without an approved budget
- Lambda telemetry initialized or shut down per invocation
- a production metric with no query or owner
- raw `console.log`/`print` calls outside an approved structured logging adapter
- secrets, credentials, session values, bodies, prompt content, or raw error data in logs
- duplicate stdout and OTLP ingestion of the same record
- required security events that runtime verbosity or sampling can disable
- asynchronous code that generates a new correlation ID at every hop or assumes every batch record has one parent
