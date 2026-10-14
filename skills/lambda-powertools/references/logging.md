# Logging: diagnose a material outcome

Use **Powertools Logger directly**. Its structured JSON, levels and Lambda context are the default; do not add a competing logger or multi-part evidence pipeline.

- Emit one application event at the owning failure/rejection/degradation/security boundary. Do not log-and-rethrow in every helper. Ordinary success does not require a log.
- Include a stable event/operation, stage, closed failure category, specific safe reason/rule, fixed location or dependency, and request/workflow correlation. Add only fields useful to the incident.
- For provider failures, retain the exact observed HTTP status and approved safe provider code **even if unknown to the application**. Include a reviewed safe provider message if helpful. A closed internal classification must not overwrite observed facts.
- Separate observed fields, internal classification and the application's existing retry decision. Logging does not determine retry or change the thrown error.
- **Never** log raw requests, headers, events, successful auth responses, tokens, credentials, unchecked errors, full provider response bodies or sensitive data. Unknown fields are not automatically safe.
- Exception messages, stacks and causes can contain sensitive data. Include only reviewed safe portions when needed. Do not require full cause traversal, recursive sanitizers, completeness manifests, hashes or multipart logs.
- Keep safe log records small and queryable. If an error cannot be logged safely, emit a stable reason/code, dependency and correlation instead; investigate larger evidence in an access-controlled system by explicit design.
- Ensure required WARN/ERROR events pass both Powertools and Lambda Advanced Logging Controls. Use INFO only for an operator-relevant workflow transition; not helper narration. DEBUG is never a fallback for missing failure diagnostics.
- Use invocation-local context or explicit per-call fields. Do not share per-record mutable keys across concurrent batches. A log failure must not replace a business result.

See [diagnostic sufficiency](diagnostic-sufficiency.md), [error handling](error-evidence.md) and the runtime-specific Powertools Logger documentation.
