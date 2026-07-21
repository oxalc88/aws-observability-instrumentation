# GenAI and agent tracing

Use current OpenTelemetry GenAI semantic conventions. These conventions are still evolving, so pin OTel instrumentation versions and review convention changes during upgrades.

## Span hierarchy

```text
invoke_agent <agent-name>
  chat <model>
  execute_tool <tool-name>
  chat <model>
```

Use low-cardinality span names. Put unique conversation identity in `gen_ai.conversation.id`, not in the span name.

## Core attributes

| Attribute | Use |
| --- | --- |
| `gen_ai.operation.name` | `invoke_agent`, `chat`, `execute_tool`, or another documented operation |
| `gen_ai.provider.name` | Provider identifier |
| `gen_ai.request.model` | Requested model |
| `gen_ai.response.model` | Actual response model when available |
| `gen_ai.agent.name` | Stable application agent name |
| `gen_ai.tool.name` | Stable tool name |
| `gen_ai.conversation.id` | Conversation/thread correlation on spans only |
| `gen_ai.usage.input_tokens` | Input token count |
| `gen_ai.usage.output_tokens` | Output token count |

## Content policy

Input messages, output messages, tool arguments, and tool results may contain credentials, personal data, proprietary data, or prompt-injection content.

- Keep content capture disabled by default.
- Require an explicit application setting and privacy approval.
- Redact secrets and disallowed fields before setting span attributes/events.
- Apply length limits before export.
- Do not use message content or conversation IDs as metric attributes.
- Do not log chain-of-thought or hidden reasoning.

## Metrics

Use governed resource counters for token or quota consumption when aggregate cost is an operational requirement. Keep provider and model values in reviewed closed sets. Use spans for per-call token detail.

Use a failure metric with `failure.class` for agent turns that terminate unsuccessfully. Do not derive metric labels from provider error messages.

## CloudWatch export

Export agent spans through the same OTel trace pipeline as other application spans. The CloudWatch trace endpoint is regional and uses X-Ray SigV4 authentication. Confirm Transaction Search and sampling requirements for the selected CloudWatch experience.

## Stability

The upstream GenAI semantic conventions have moved into their own OTel semantic-conventions repository and remain under active development. Before adding attributes, verify them against current OTel documentation rather than copying vendor-specific names.

Sources:

- [OpenTelemetry GenAI attribute registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- [CloudWatch OTLP endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPEndpoint.html)
