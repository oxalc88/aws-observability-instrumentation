# Python parity examples

These examples implement the same language-agnostic three-signal contracts as the canonical Node.js code in `examples/typescript/`. They demonstrate that metric names, attributes, failure classes, lifecycle rules, and OTLP export topology do not depend on an application language.

Use Python 3.11 or newer:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r examples/python/requirements.txt pytest
python -m pytest -q examples/python
python examples/python/ci_gate.py examples/typescript/src examples/python config
```

Key files:

| File | Purpose |
| --- | --- |
| `metric_def.py` | Immutable metric contracts and constructors |
| `emission_module.py` | OTel providers, histogram views, and validated emission |
| `structured_logging.py` | Structured event schemas, JSON, correlation, and safety controls |
| `correlation_context.py` | Validated active business-workflow correlation context |
| `http_middleware.py` | ASGI boundary instrumentation |
| `external_api_client.py` | External HTTP dependency instrumentation |
| `workflow_decorator.py` | Workflow-step instrumentation |
| `retry_loop.py` | Bounded retry metrics |
| `fallback_path.py` | Governed fallback metrics |
| `ai_agent_spans.py` | OTel GenAI spans |
| `lambda_handler.py` | Lambda cold-start reuse and bounded flush |
| `sqs_workflow.py` | SQS carrier quota, producer links, and per-record consumer spans |
| `sqs_lambda_handler.py` | SQS partial-batch failures, correlated logs/metrics, and bounded flush |
| `ci_gate.py` | Shared Python/TypeScript/JavaScript contract checks |

AWS credentials and CloudWatch endpoints belong in the collector or deployment configuration. Application modules should normally send OTLP to a local or runtime-provided endpoint. Structured logs normally use the runtime's stdout delivery path; do not add an OTLP log exporter unless that path is selected deliberately and duplicate platform collection is removed.

The Python logger preserves the canonical Node schema for terminal failures: `metric.name`, `operation.name`, `exception.type`, the innermost `code.*` frame, and active trace IDs, without exception messages or full tracebacks. It also implements the same ordered deterministic sampling rules, managed `sampling.policy`/`sampling.rate` fields, and locked error/security retention.

The Python SQS adapter has functional parity with the TypeScript SQS example: it supports AWS `AWSTraceHeader` and W3C message-attribute extraction, validates one stable `correlation_id`, creates linked per-record consumer spans, returns partial-batch failures, and keeps logs and metrics correlated inside each record context. Kinesis is currently implemented only in TypeScript; any future Python transport adapter must preserve the transport-neutral contract in `references/async-trace-propagation.md`.
