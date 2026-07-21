# Agents guide - cloudwatch-instrumentation

## What this repo is

`cloudwatch-instrumentation` is an agent skill: a set of rules, references, deployment configurations, and executable examples that teach AI coding agents how to add three-pillar observability for Amazon CloudWatch with governed OpenTelemetry metrics, OpenTelemetry traces, and secure structured logs.

This is not an application. It is installed into consumer projects so an AI agent working in those projects can read its rules. TypeScript is the Node.js implementation, and Python provides the same core metric, logging, tracing, Lambda lifecycle, SQS, and Kinesis contracts with idiomatic APIs.

## Editing this repo

- Preserve vendor-neutral OTel instrumentation in application code.
- Keep CloudWatch endpoints, SigV4, bearer tokens, batching, and retries in deployment configuration.
- Prefer platform delivery for governed JSON logs on Lambda and Fargate. Use an OTel log bridge only deliberately, and never duplicate records across both paths.
- Apply AWS Well-Architected and OWASP logging guidance: schemas, correlation, sanitization, data minimization, security-event coverage, sink failure isolation, access, and retention.
- Distinguish native CloudWatch OTLP/PromQL metrics from classic CloudWatch/EMF metrics.
- Cover ECS/Fargate and Lambda behavior when changing runtime guidance. Also consider EKS, EC2, App Runner, local development, and on-premises collection.
- Prefer official AWS and OpenTelemetry documentation for compatibility claims. Mark preview behavior and time-sensitive limits.
- Update the matching reference, both language examples when applicable, tests, and adapters whenever a public rule changes.
- Run the TypeScript type check/tests and Python gate/tests before committing implementation changes.

## This repo has no "skill registry"

There is no cross-agent skill registry standard. Each supported agent discovers instructions differently:

| Agent           | Discovery file                                                             |
| --------------- | -------------------------------------------------------------------------- |
| Claude Code     | `SKILL.md` YAML frontmatter under `~/.claude/skills/` or `.claude/skills/` |
| Claude.ai (web) | `SKILL.md` YAML frontmatter uploaded through Settings -> Skills            |
| Codex           | `AGENTS.md` at the project root                                            |
| Cursor          | `.cursor/rules/*.mdc`                                                      |
| Aider           | `CONVENTIONS.md` or a file passed with `--read`                            |
| Continue        | `.continuerules`                                                           |
| Windsurf        | `.windsurfrules`                                                           |

The install shape for each agent lives under `adapters/<agent>.md`. The complete matrix is in [`adapters/README.md`](adapters/README.md).

## If you are a Codex agent asked to install this skill

Run this command from the cloned skill repository:

```bash
scripts/install.sh --agent=codex --project=/path/to/consumer/project
```

The installer adds the skill-enable block below to the consumer project's `AGENTS.md`. Marker comments let later runs update that block without replacing unrelated project instructions.

For a manual installation, copy the block below into the consumer project's `AGENTS.md` and replace `<path-to-skill>` with the path to this separate clone.

## Skill-enable block (copy into consumer `AGENTS.md`)

```markdown
<!-- BEGIN cloudwatch-instrumentation -->

## CloudWatch OpenTelemetry instrumentation

This project uses the `cloudwatch-instrumentation` skill. When writing code
that emits an OpenTelemetry metric or trace, writes an application log for
CloudWatch, measures duration, counts failures, investigates production
telemetry, or changes an AWS telemetry deployment:

1. Read `<path-to-skill>/SKILL.md`.
2. Follow its decision rules and surface patterns.
3. For deeper rules (tagging, cost, lifecycle, deployment, and logging), open
   the relevant file under `<path-to-skill>/references/`.
4. Use `<path-to-skill>/examples/typescript/` for Node.js or TypeScript and
   `<path-to-skill>/examples/python/` for Python.

Keep AWS authentication in the collector or runtime configuration. Never
attach unbounded identifiers or exception text to metric attributes. Use only
governed structured logs; never log credentials, session values, bodies,
prompts, or raw errors.
<!-- END cloudwatch-instrumentation -->
```

`<path-to-skill>` is a placeholder for the clone location, not a repository-relative path. The installer resolves and writes the actual path automatically.

## Other agents

- **Claude Code:** `scripts/install.sh --agent=claude-code` symlinks this repository into `~/.claude/skills/`, or into `.claude/skills/` when `--project=<path>` is provided. See [`adapters/claude-code.md`](adapters/claude-code.md).
- **Claude.ai (web):** upload the skill through Settings -> Skills. See [`adapters/claude-ai-web.md`](adapters/claude-ai-web.md).
- **Cursor, Aider, Continue, and Windsurf:** `scripts/install.sh --agent=<name> --project=<path>` writes the instruction file that agent discovers. See the matching file under `adapters/`.

## Why the installer exists

Claude Code can load the skill and supporting files on demand. Other agents generally expect a single instruction file, so the installer builds a compact copy from `SKILL.md` and the high-value references. Re-running the idempotent installer after updating this clone refreshes the managed instructions without a manual concatenation process.
