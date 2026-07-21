# Codex

Install a managed instruction block into a project:

```bash
scripts/install.sh --agent=codex --project=/path/to/project
```

The installer creates or updates the content between `<!-- BEGIN cloudwatch-instrumentation -->` and `<!-- END cloudwatch-instrumentation -->` in `AGENTS.md`. Re-running the command is idempotent and leaves unrelated project instructions intact.

The block points Codex to the local skill clone and makes the TypeScript example the canonical Node.js implementation. Use a separate clone of this repository instead of nesting it as an independent Git repository inside the application.

Verify with:

```text
Read the CloudWatch instrumentation instructions and instrument the external
payments client with OTel metrics and traces.
```
