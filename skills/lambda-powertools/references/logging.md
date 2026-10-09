# Logs: one material outcome

Use Powertools Logger directly; it already provides JSON serialization, levels, Lambda context, and trace correlation. A small safe-field function is acceptable. Do not create another logger framework or require the root OTel `LogEventDef` adapter.

## Required event coverage

Require one safe diagnostic event for actionable terminal failures, investigable validation/business-rule rejections, terminal dependency failure, unexpected internal failure, material fallback/degradation, and important security decisions. Apply category contracts even without a user logging preference. Existing safe events may satisfy coverage; record owner/evidence rather than adding duplicates. For non-material expected outcomes, document non-applicability. Missing diagnostics need a visible exception, not silent omission. Ordinary successful invocations do not require application logs. Distributed workflows may emit declared, bounded INFO milestones for acceptance, routing, handoff/publication and completion when operators need to reconstruct a transaction without replay.

| Level | Use |
| --- | --- |
| ERROR | Unexpected/internal failure or terminal dependency failure requiring response |
| WARN | Investigable rejection or material degradation; expected client rejection can be INFO under the event contract |
| INFO | Material business/queue transition, outcome, or security decision with an identified evidence consumer |
| DEBUG | Temporary, justified diagnostic detail; still no sensitive content |

Reject helper-step narrative INFO such as entering a function, calling a repository, starting local validation, or receiving an intermediate response. A declared business transition is not helper narration. DEBUG detail needs an owner, bounded volume, and expiry; it is not permission to dump payloads.

## Safe diagnostic contract

Use fixed `event.name`, message, operation, stage, and failure category. Load [diagnostic-sufficiency](diagnostic-sufficiency.md) for the required fields for this category. Do not require every category's fields on every record. Keep safe code-location constants and deployment version where useful; never derive a log reason from arbitrary exception text.

Do not pass raw exception objects or enable unchecked exception serialization in Logger: it can expose secrets. Extract sanitized messages, complete available stacks and causes, and exact HTTP/provider error evidence explicitly. See [error evidence](error-evidence.md). Preserve the original exception when rethrowing; closed reason/code is **additional** classification, not a substitute for evidence. Do not log raw requests/events/headers, successful authentication responses, credentials, tokens, unrestricted object spreads, or schema validators' full errors. Preserve sanitized provider error responses including unknown fields and formats under the error-evidence contract, using correlated parts when necessary. `received_fields` must contain approved schema field names only, with capped length; represent unknown field names by a count. Even field names can contain secrets or user content.

## Lambda lifecycle and delivery

Initialize Logger outside the handler. Use the selected SDK’s safe context injection/reset or explicit per-call fields. Disable invocation-event logging and inspect deployment overrides; no SDK/environment option may enable raw payload logging. Do not put invocation/record correlation in persistent keys. Avoid shared per-record mutation when processing batches concurrently: pass record fields directly on each log.

Logger JSON stdout goes to CloudWatch through Lambda. Do not also export the same record through an OTel bridge. Align Lambda Advanced Logging Controls and Logger levels so required ERROR/security events survive both filters; required WARN/INFO events need those levels too. Powertools' sample rate enables DEBUG verbosity for some invocations; it does not provide deterministic workflow log retention. Do not claim that it does.

One boundary logs one terminal outcome, distinguishing observed evidence, internal classification and retry decision. Helpers do not log-and-rethrow. Platform error records can coexist; do not add a second application failure log. If an SDK log call fails, preserve the business result and check sustained loss through deployment monitoring.

Read the selected SDK’s [language reference](language-adaptation.md) for safe Logger context, exception capture, fields and official sources.
