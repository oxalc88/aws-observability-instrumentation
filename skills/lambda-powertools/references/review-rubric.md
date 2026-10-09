# Review rubric

Block telemetry that lacks a question, ownership, sufficient diagnostics, safe data, or an acceptable cost budget. Record the signal decision and evidence for any exception; do not waive payload/secret restrictions.

## Language mapping

- Is the actual handler language/runtime detected and the same core contract applied? No TypeScript/Python-only scope or copied cross-language flags.
- Are SDK availability, metric state/cleanup, capture defaults and retry metadata verified, with focused tests for each port? SDK gaps are reported, not invented APIs or silent architecture switches.

## Required coverage

- Has every applicable request, dependency, stage, queue/batch, retry, fallback and resource surface been assessed against the baseline, even without user preferences?
- Does each requirement have managed/custom/not_applicable/exception evidence? Missing coverage blocks completion unless a visible exception is recorded under existing project policy.
- Is managed equivalence proven for population, boundary, unit/statistic, outcomes, dimensions, enablement and freshness? No trace/log substitute for metrics.
- Do exceptions identify missing capability, reason, mitigation, owner and review date? No unknown final state or hidden cost opt-out.

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

- Are all prescribed material failures/rejections/degradation/security outcomes covered by one safe diagnostic event, or a visible non-applicability/exception?
- Is INFO free of helper-step narration while retaining reviewed business/async milestones needed for reconstructing a transaction?
- Does the event identify operation/stage/class and a specific safe reason/rule plus location/dependency and correlation?
- Does its category contract preserve sanitized original evidence for unknown provider errors and exact statuses (including HTTP 426) so investigators avoid blind reproduction?
- Are generic `invalid_input`, raw error dumps, raw requests/headers, successful authentication payloads, sensitive fields, and unbounded object spreads absent? Are sanitized exception/provider messages and stacks present with explicit redaction/truncation/omission?
- Are field names, paths, values, arrays, and correlations safe and bounded?
- Does one boundary emit one terminal application event, with no helper log-and-rethrow duplicates?
- Do runtime levels/sampling retain required security/error evidence? Is warm/concurrent record context safe?

## Tracing

- Is tracing explicitly enabled or disabled with a reason and owner? Missing selection blocks review; document activation/sampling when enabled.
- Are dependency timing and distributed execution requirements assessed alongside metrics/logs? An opt-out must not hide an unmet requirement; report unsupported continuity as a gap.
- Is there a path/timing/causality question that logs/metrics cannot answer?
- Are trivial helper subsegments and duplicate SDK/manual capture absent?
- Are response/error/HTTP capture defaults reviewed and sensitive metadata prevented?
- Is tracing present for meaningful external dependencies and distributed paths, without waiting for an explicit user request?
- Are active tracing, IAM, sampling, upstream configuration, and supported transport continuity verified?
- Are batch/fan-out parentage and unsampled paths represented honestly?

## Final decision

Ask: **Could an engineer understand what failed and where to investigate next without blindly reproducing the request?** A JSON object alone is not proof. Also ask what was omitted: a Lambda does not automatically need all three utilities.

Verify numeric provider codes, unknown response formats, all available stack/cause frames, cycles and throwing accessors, and multipart reconstruction with missing-part detection. Essential evidence must survive INFO filtering at WARN/ERROR. Confirm original exception identity and business results under telemetry failures; report platform delivery and sanitizer limitations.
