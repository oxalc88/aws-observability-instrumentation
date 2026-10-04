# Agent adapters

Run the installer from this repository clone:

```bash
scripts/install.sh --skill=<skill> --agent=<name> --project=/path/to/project
```

| Agent       | Name          | Result                                         |
| ----------- | ------------- | ---------------------------------------------- |
| Claude Code | `claude-code` | Symlinked skill directory                      |
| Cursor      | `cursor`      | `.cursor/rules/<selected-skill>.mdc` |
| Codex       | `codex`       | Managed block in `AGENTS.md`                   |
| Aider       | `aider`       | `CONVENTIONS.md`                               |
| Continue    | `continue`    | `.continuerules`                               |
| Windsurf    | `windsurf`    | `.windsurfrules`                               |

Claude.ai web cannot be installed by the shell script; see [`claude-ai-web.md`](claude-ai-web.md).

Choose `cloudwatch-instrumentation` (default) or `lambda-powertools`. All scripted agents support both. The selected Powertools root is `skills/lambda-powertools/`; Claude Code symlinks that directory, while the other adapters write a compact managed enable block with absolute paths. References load only when needed. Codex and Powertools single-file adapters preserve unrelated project instructions on updates.

The installer checks known project and ancestor discovery surfaces and Claude user-level skills for the opposite profile before writing. It detects old concatenated OTel adapters through their `name:` frontmatter. It refuses conflicts instead of silently merging or switching. Remove the old block/rule/symlink first; separately scope mixed-workload projects. Custom unmanaged/global rules require manual review. A global Claude skill can affect a project install and must be considered too.

Claude Code and Codex can lazy-load the root skill references. The existing root adapters for Cursor/Aider/Continue/Windsurf receive a compact concatenation of the core contract, CloudWatch OTLP topology, structured logging/investigation guidance, signal model, attribute rules, surface patterns, failure taxonomy, and review rubric.

Test an installation with:

```text
Add governed metrics, tracing, and a correlated structured outcome event to a
Node.js workflow, then explain the Fargate delivery paths.
```

A loaded skill should define a bounded `MetricDef`, emit it through the shared emitter, use monotonic time, create a safe `LogEventDef`, avoid duplicate log delivery, and keep SigV4 in the collector sidecar.

Test the Powertools installation with:

```text
Use lambda-powertools to diagnose handled validation 400s in this TypeScript
Lambda. Decide whether custom metrics or tracing answer any separate question.
```

A loaded skill should choose safe rule/path/type evidence and correlation, omit unjustified metrics/traces, and avoid raw payloads/errors. See [Powertools SKILL.md](../skills/lambda-powertools/SKILL.md).
