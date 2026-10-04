# Continue

Both profiles are supported. Commands below retain the root OTel default; for Lambda Powertools in any language, add `--skill=lambda-powertools`. See [profile selection and conflict handling](README.md).

```bash
scripts/install.sh --skill=lambda-powertools --agent=continue --project=/path/to/project
```

The Powertools profile uses a separate contract and compact enable instructions (a selected-directory symlink for Claude Code). It does not concatenate OTel rules.

Install the compact contract as always-on project rules:

```bash
scripts/install.sh --agent=continue --project=/path/to/project
```

This writes `.continuerules`. Re-run after updating the skill clone. For a larger task, explicitly ask Continue to consult the TypeScript examples and the deployment-target reference before editing code or infrastructure.

Example prompt:

```text
Follow the cloudwatch-instrumentation rules. Add Node.js workflow metrics and
adapt our ECS/Fargate task to export native OTLP metrics for PromQL.
```
