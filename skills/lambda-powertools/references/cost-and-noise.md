# Cost and noise

Every custom metric must pass:

**operational value > CloudWatch metric + EMF/log volume + cardinality + maintenance cost**.

Powertools Metrics writes EMF records to stdout. Lambda sends them to CloudWatch Logs, which extracts classic custom metrics. Those records consume log ingestion/storage/query capacity as well as metric series. EMF is not native OTLP/PromQL.

## Estimate before emitting

| Signal | Estimate | Reduce cost without losing meaning |
| --- | --- | --- |
| Metrics | Names × bounded dimension combinations, summed over dimension sets/namespaces | Reuse managed signals; remove dimensions and duplicate metrics |
| EMF | Publications per invocation × invocations × mean/max encoded bytes, plus automatic buffer splits | Aggregate loops; buffer related metrics; avoid singleMetric and per-record publication |
| Logs | Records × encoded bytes, retention, query scan volume | Material outcomes; safe allowlisted fields; no INFO narration |
| Traces | Sampled invocations × meaningful subsegments and metadata bytes | Trace only useful dependencies; no helper subsegments or duplicate capture |
| Maintenance | Contracts, consumers, alarms, upgrades, investigation time | One owner, stable meaning, few canonical patterns |

Two metric names with service=1 and outcome=3 can create up to six series per namespace/full dimension set. Adding a request ID makes combinations grow with traffic; forbidden even when current traffic is small. Include rollup dimension sets and regions/accounts in deployment estimates.

Buffered publication reduces records but does not remove per-series metric cost. Avoid attaching diagnostic metadata to every EMF record; Logger owns diagnostics when required. Do not mirror every metric publication with an INFO log.

Use normal resolution unless a specific response-time need justifies higher cost. Disable optional ColdStart metric publication by default. Do not sample outcome/resource totals or silently alter denominators. Aggregating latency to one total changes its question and loses per-record percentiles.

Set finite log retention, scoped access, and compatible Lambda application/system levels. DEBUG sampling controls verbosity, while X-Ray sampling controls trace availability; neither must disable required operational/security evidence. Do not promise every failure has a stored trace.

Use current regional pricing and real encoded record sizes before a production rollout; no fixed dollar price is part of this contract. Check EMF extraction, retention, trace permissions/sampling, unexpected volume, and telemetry silence.

Source: [CloudWatch EMF](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html).
