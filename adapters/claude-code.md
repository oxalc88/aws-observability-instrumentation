# Claude Code

Both profiles are supported. Commands below retain the root OTel default; for Lambda Powertools in any language, add `--skill=lambda-powertools`. See [profile selection and conflict handling](README.md).

```bash
scripts/install.sh --skill=lambda-powertools --agent=claude-code --project=/path/to/project
```

The Powertools profile uses a separate contract and compact enable instructions (a selected-directory symlink for Claude Code). It does not concatenate OTel rules.

Install for the current user:

```bash
scripts/install.sh --agent=claude-code
```

Install for one project:

```bash
scripts/install.sh --agent=claude-code --project=/path/to/project
```

The installer creates a symlink named `cloudwatch-instrumentation` under the appropriate `.claude/skills/` directory. It refuses to replace a real directory and safely updates an existing symlink.

The frontmatter in `SKILL.md` supplies automatic trigger context. References, TypeScript examples, Python parity examples, and AWS configurations remain available for on-demand loading.

Verify with:

```text
Using cloudwatch-instrumentation, add bounded request and duration metrics to
this Node.js route and show the Fargate exporter topology.
```
