# Cursor

Install an always-applied rule for TypeScript, JavaScript, and Python files:

```bash
scripts/install.sh --agent=cursor --project=/path/to/project
```

This writes `.cursor/rules/cloudwatch-instrumentation.mdc` with the compact contract and key references. Re-run after updating the skill clone.

Verify with:

```text
Add governed CloudWatch-compatible OTel instrumentation to POST /orders. Keep
AWS endpoint and SigV4 configuration outside application source.
```
