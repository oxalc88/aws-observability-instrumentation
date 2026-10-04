# Agents guide - AWS instrumentation skills

## What this repo is

This repository contains two independent agent skills. The root `cloudwatch-instrumentation` is an agent skill: a set of rules, references, deployment configurations, and executable examples that teach AI coding agents how to add three-pillar observability for Amazon CloudWatch with governed OpenTelemetry metrics, OpenTelemetry traces, and secure structured logs.

This is not an application. It is installed into consumer projects so an AI agent working in those projects can read its rules. TypeScript is the Node.js implementation, and Python provides the same core metric, logging, tracing, Lambda lifecycle, SQS, and Kinesis contracts with idiomatic APIs.

The separate `skills/lambda-powertools/` contract covers Lambda TypeScript with Powertools Logger, EMF Metrics, and explicitly selected X-Ray-backed Tracer. Its rules are scoped to that subtree and override the OTel-only runtime rules below there. Do not import root OTel registries, logger adapters, Python parity, or deployment configurations into it. Instrumentation starts with a question and prescribed coverage at applicable surfaces. Prove equivalent existing coverage or implement missing metrics, safe material-outcome diagnostics, and meaningful dependency/distributed tracing. Record non-applicability and explicit exceptions; user uncertainty does not remove the baseline.

## Editing this repo

- For the root CloudWatch skill/examples/config, preserve vendor-neutral OTel instrumentation in application code.
- Keep CloudWatch endpoints, SigV4, bearer tokens, batching, and retries in deployment configuration.
- Prefer platform delivery for governed JSON logs on Lambda and Fargate. Use an OTel log bridge only deliberately, and never duplicate records across both paths.
- Apply AWS Well-Architected and OWASP logging guidance: schemas, correlation, sanitization, data minimization, security-event coverage, sink failure isolation, access, and retention.
- Distinguish native CloudWatch OTLP/PromQL metrics from classic CloudWatch/EMF metrics.
- For the root skill, cover ECS/Fargate and Lambda behavior when changing runtime guidance. Also consider EKS, EC2, App Runner, local development, and on-premises collection.
- Prefer official AWS and OpenTelemetry documentation for compatibility claims. Mark preview behavior and time-sensitive limits.
- Update matching references, applicable language examples, checks, and adapters when a public rule changes. Powertools is TypeScript/Lambda only; no Python or non-Lambda parity is required.
- Run the root TypeScript type check/tests and Python gate/tests before committing implementation changes. For Powertools changes, also run `npm run check` and `npm test` under `skills/lambda-powertools/examples/typescript`, plus `python3 scripts/test_install.py` for installer changes.
- Keep the root policy gate scoped to root examples/config. It forbids X-Ray SDKs, so it must not scan the separate Powertools subtree.
- Installer defaults remain `cloudwatch-instrumentation`. Use `--skill=lambda-powertools` explicitly and reject conflicting active profile instructions before writing. Never concatenate the contracts.

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

Codex is supported here through a managed project enable block; it can also discover native skills in supported installations. The install shape for each agent lives under `adapters/<agent>.md`. The complete matrix is in [`adapters/README.md`](adapters/README.md).

## If you are a Codex agent asked to install this skill

Select the contract explicitly when using Powertools:

```bash
scripts/install.sh --skill=lambda-powertools --agent=codex --project=/path/to/consumer/project
```

The generated block points only to `skills/lambda-powertools/`. The original default remains the root OTel skill. Run this command from the cloned skill repository:

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

Claude Code can load the skill and supporting files on demand. Some other agents use a single instruction file, so the installer builds a compact copy from `SKILL.md` and the high-value references. Re-running the idempotent installer after updating this clone refreshes the managed instructions without a manual concatenation process.

Powertools adapters write a compact enable block with absolute paths and load references on demand; they do not flatten the root contract. Existing root adapter behavior remains available. See `adapters/README.md` for selection and conflict handling.
