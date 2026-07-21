# Claude.ai web

Claude.ai skill installation is not scriptable from this repository.

1. Create an archive from the `cloudwatch-instrumentation/` directory.
2. Upload it through the Claude.ai Skills settings.
3. Keep `SKILL.md`, `references/`, `examples/typescript/`, `examples/python/`, and `config/` together so the skill can load supporting material on demand.
4. Replace the uploaded skill after changes; a local Git update does not update the Claude.ai copy.

Verify with:

```text
Using the cloudwatch-instrumentation skill, explain the native OTLP path for a
Node.js service on Fargate and define one bounded latency metric.
```
