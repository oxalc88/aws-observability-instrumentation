# Cursor

Both profiles are supported. Commands below retain the root OTel default; for Lambda Powertools in any language, add `--skill=lambda-powertools`. See [profile selection and conflict handling](README.md).

```bash
scripts/install.sh --skill=lambda-powertools --agent=cursor --project=/path/to/project
```

The Powertools profile uses a separate contract and compact enable instructions (a selected-directory symlink for Claude Code). It does not concatenate OTel rules.

The root profile installs an always-applied rule for TypeScript, JavaScript, and Python. The Powertools profile applies across file types so Java, .NET and other language projects also load the shared contract:

```bash
scripts/install.sh --agent=cursor --project=/path/to/project
```

This writes `.cursor/rules/cloudwatch-instrumentation.mdc` with the compact contract and key references. Re-run after updating the skill clone.

Verify with:

```text
Add governed CloudWatch-compatible OTel instrumentation to POST /orders. Keep
AWS endpoint and SigV4 configuration outside application source.
```
