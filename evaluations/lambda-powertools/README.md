# Agent behavior evaluations (optional, recommended)

Agent Skills do **not** require evals to install or run. This repository maintains focused SDK unit tests and a separate set of agent-behavior scenarios because policy changes can make agents generate unnecessary frameworks even when the examples still pass.

Use pstack's [Eval playbook](https://github.com/sub4biz/potato-pstack/blob/main/skills/poteto-mode/playbooks/eval.md) or an equivalent blinded test runner:

1. Run each scenario from [scenarios.md](scenarios.md) with the previous skill version and with the candidate version, in separate isolated consumer-project workspaces.
2. Give agents only the organic request and the installed skill variant. **Do not expose** this eval directory, scoring terms, the other variant, or the judge instructions to candidate agents.
3. Have a blinded judge review both artifacts using [rubric.md](rubric.md), with variant names masked. Inspect generated code and tests, not the agent's account of which skills it followed.
4. Run the consumer's type checks/tests; explicitly report failures, evidence gaps and deployment-only checks.
5. Record the model/runtime, repository SHA, skill version, task identifier, test status, and decision. Do not claim an eval was run unless candidates and a judge were actually executed.

These cases are not CI assertions, and a markdown rubric is not an automated evaluation. Do not make the skill load them during ordinary application work.

**Critical control:** Metrics coverage and its contracts must not regress in any variant. Better code means fewer custom Logger/Tracer layers while preserving useful failure diagnostics and meaningful tracing.
