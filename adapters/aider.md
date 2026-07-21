# Aider

Install the compact contract as project conventions:

```bash
scripts/install.sh --agent=aider --project=/path/to/project
```

This writes `CONVENTIONS.md`. If the project already owns that file, review the generated result before replacing local conventions or combine the content in a project-specific instructions file.

Run the shared gate from Aider's lint workflow when useful:

```bash
aider --lint-cmd "python path/to/cloudwatch-instrumentation/examples/python/ci_gate.py src"
```
