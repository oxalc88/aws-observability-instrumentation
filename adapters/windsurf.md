# Windsurf

Both profiles are supported. Commands below retain the root OTel default; for Lambda Powertools in any language, add `--skill=lambda-powertools`. See [profile selection and conflict handling](README.md).

```bash
scripts/install.sh --skill=lambda-powertools --agent=windsurf --project=/path/to/project
```

The Powertools profile uses a separate contract and compact enable instructions (a selected-directory symlink for Claude Code). It does not concatenate OTel rules.

Install the compact contract:

```bash
scripts/install.sh --agent=windsurf --project=/path/to/project
```

This writes `.windsurfrules`. Re-run after updating the skill clone.

Example prompt:

```text
Apply the CloudWatch OTel contract to this Lambda handler. Initialize at module
scope, preserve warm reuse, and use a bounded force flush.
```
