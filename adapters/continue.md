# Continue

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
