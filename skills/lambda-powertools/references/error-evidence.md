# External error evidence: safe fields, not complete capture

The operational requirement is to identify the failed dependency, what was observed, and where to investigate. It is **not** to reconstruct an arbitrary remote exception from CloudWatch.

- Keep the received integer HTTP status when available, plus safe numeric/textual provider error codes from known response fields. Unknown codes remain observed evidence; classify them independently as `unknown` when necessary.
- Include only a provider message or error details known safe for this integration. An arbitrary error body, nested unknown key, URL, message or stack is untrusted.
- Prefer allowlisted fields and stable application codes at the adapter boundary. Avoid broad recursive redaction: regex sanitizers are not proof that an unknown response contains no secrets or personal data.
- Do not log a request, success/authentication response, raw exception, full provider response, or an object spread from untrusted input.
- Keep `failure.class` and `reason` separate from `retry.decision` and `retry.reason`. Logging may not change retry policy or replace the original exception.
- When essential safe evidence is unavailable, use the request ID, provider request ID (if safe), code/status and dependency/operation to locate the failure. Do not synthesize evidence or require a catalog of all provider codes.
- Prefer one bounded, structured WARN/ERROR record. No exhaustive cause-chain traversal, no multipart/base64 logging, no SHA manifests or generic capture-completeness system.
- A special forensic capture requirement needs a named threat model, controlled storage/retention, security review and a separate implementation decision; it is not the default Powertools pattern.

This rule applies equally to TypeScript, Python and other Lambda runtimes.
