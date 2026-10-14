# Blinded judging rubric

Score each artifact 0 (fails), 1 (partially meets), or 2 (meets), based on code and focused runtime evidence, not claims.

| Criterion | Score 2 requires |
| --- | --- |
| Operational usefulness | The required material failure log names the operation, stage, specific safe reason/dependency and correlation; status/provider code stay exact even if unknown |
| Data safety | No raw events, requests, arbitrary provider error objects, response bodies, credentials, tokens or unchecked trace error/response metadata |
| Native instrumentation | Uses Powertools Logger directly and supported Tracer middleware/decorators or reviewed SDK capture; no unjustified duplicate capture |
| Minimal reader load | No general-purpose serializers, cause crawlers, base64 fragments, manifests or defensive wrappers, unnecessary indirection or shared diagnostic state |
| Behavior and metrics | Preserves original result/error/retry semantics and the existing metric names, units, dimensions, publication boundaries and totals; focused tests pass |

A variant **fails regardless of total** if it leaks sensitive data, changes a business error/retry result, or silently drops required metric coverage. Require direct comparison of generated code size/complexity and manual lifecycle layers; line count is only supporting evidence, not the objective.

Report per-scenario scores, test evidence, version/SHA, evaluator uncertainty and the deployment checks still required. A scenario cannot pass based only on comments or a design description.
