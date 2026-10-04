# Review rubric

Block telemetry that lacks a question, ownership, sufficient diagnostics, safe data, or an acceptable cost budget. Record the signal decision and evidence for any exception; do not waive payload/secret restrictions.

## Metrics

- Does every required aggregate monitoring/alert question have adequate managed or custom metric coverage? Do not accept logs or sampled traces as a substitute.
- Does each custom metric answer an aggregate operational question with a purpose and response owner?
- Is its managed AWS/Lambda equivalent absent or demonstrably insufficient?
- Is EMF/log volume justified along with metric series and maintenance?
- Are namespace/name/unit/statistic, boundary, frequency, and denominator explicit?
- Are dimensions closed, low-cardinality, and budgeted including default service and extra dimension sets?
- Does one choke point own emission, with loops aggregated and no double counting/publication?
- Are warm-state cleanup, failure publication, timeout gaps, sampling, and retry semantics honest?

## Logs

- Does an operator need execution-level evidence for this material outcome?
- Is INFO free of step narration and every internal-step logging?
- Does the event identify operation/stage/class and a specific safe reason/rule plus location/dependency and correlation?
- Does its category contract provide enough evidence to locate the next investigation without blind reproduction?
- Are generic `invalid_input`, error dumps, raw bodies/headers/payloads, sensitive fields, unbounded object spreads, and arbitrary exception text absent?
- Are field names, paths, values, arrays, and correlations safe and bounded?
- Does one boundary emit one terminal application event, with no helper log-and-rethrow duplicates?
- Do runtime levels/sampling retain required security/error evidence? Is warm/concurrent record context safe?

## Tracing

- Is there a path/timing/causality question that logs/metrics cannot answer?
- Are trivial helper subsegments and duplicate SDK/manual capture absent?
- Are response/error/HTTP capture defaults reviewed and sensitive metadata prevented?
- Is tracing present where distributed causality is a stated operational requirement?
- Are active tracing, IAM, sampling, upstream configuration, and supported transport continuity verified?
- Are batch/fan-out parentage and unsampled paths represented honestly?

## Final decision

Ask: **Could an engineer understand what failed and where to investigate next without blindly reproducing the request?** A JSON object alone is not proof. Also ask what was omitted: a Lambda does not automatically need all three utilities.
