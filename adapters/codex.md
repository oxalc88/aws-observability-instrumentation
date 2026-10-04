# Codex

Both profiles are supported. Commands below retain the root OTel default; for Lambda TypeScript Powertools, add `--skill=lambda-powertools`. See [profile selection and conflict handling](README.md).

```bash
scripts/install.sh --skill=lambda-powertools --agent=codex --project=/path/to/project
```

The Powertools profile uses a separate contract and compact enable instructions (a selected-directory symlink for Claude Code). It does not concatenate OTel rules.

Install a managed instruction block into a project:

```bash
scripts/install.sh --agent=codex --project=/path/to/project
```

The installer creates or updates the content between `<!-- BEGIN cloudwatch-instrumentation -->` and `<!-- END cloudwatch-instrumentation -->` in `AGENTS.md`. Re-running the command is idempotent and leaves unrelated project instructions intact.

The block points Codex to the local skill clone and directs it to the implementation matching the consumer language: TypeScript for Node.js or TypeScript, and Python for Python. Both implement the core metric, logging, tracing, Lambda lifecycle, SQS, and Kinesis contracts. Use a separate clone of this repository instead of nesting it as an independent Git repository inside the application.

Verify with:

```text
Read the CloudWatch instrumentation instructions and instrument the external
payments client with OTel metrics and traces.
```
