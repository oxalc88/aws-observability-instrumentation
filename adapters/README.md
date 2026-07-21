# Agent adapters

Run the installer from this repository clone:

```bash
scripts/install.sh --agent=<name> --project=/path/to/project
```

| Agent       | Name          | Result                                         |
| ----------- | ------------- | ---------------------------------------------- |
| Claude Code | `claude-code` | Symlinked skill directory                      |
| Cursor      | `cursor`      | `.cursor/rules/cloudwatch-instrumentation.mdc` |
| Codex       | `codex`       | Managed block in `AGENTS.md`                   |
| Aider       | `aider`       | `CONVENTIONS.md`                               |
| Continue    | `continue`    | `.continuerules`                               |
| Windsurf    | `windsurf`    | `.windsurfrules`                               |

Claude.ai web cannot be installed by the shell script; see [`claude-ai-web.md`](claude-ai-web.md).

Claude Code can lazy-load the repository references. The other adapters receive a compact concatenation of the core contract, CloudWatch OTLP topology, structured logging/investigation guidance, signal model, attribute rules, surface patterns, failure taxonomy, and review rubric.

Test an installation with:

```text
Add governed metrics, tracing, and a correlated structured outcome event to a
Node.js workflow, then explain the Fargate delivery paths.
```

A loaded skill should define a bounded `MetricDef`, emit it through the shared emitter, use monotonic time, create a safe `LogEventDef`, avoid duplicate log delivery, and keep SigV4 in the collector sidecar.
