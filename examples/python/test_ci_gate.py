from __future__ import annotations

from pathlib import Path

from .ci_gate import check_paths


def codes_for(tmp_path: Path, name: str, source: str) -> set[str]:
    path = tmp_path / name
    path.write_text(source, encoding="utf-8")
    return {violation.code for violation in check_paths([path])}


def test_rejects_direct_otel_instrument_creation(tmp_path: Path) -> None:
    assert "CW001" in codes_for(
        tmp_path,
        "handler.ts",
        "const counter = meter.createCounter('app.request');",
    )


def test_rejects_put_metric_data(tmp_path: Path) -> None:
    assert "CW002" in codes_for(
        tmp_path,
        "handler.ts",
        "await cloudwatch.send(new PutMetricDataCommand(input));",
    )


def test_rejects_legacy_xray_instrumentation(tmp_path: Path) -> None:
    assert "CW014" in codes_for(
        tmp_path,
        "instrumentation.ts",
        "import AWSXRay from 'aws-xray-sdk';",
    )


def test_rejects_xray_daemon_config(tmp_path: Path) -> None:
    assert "CW014" in codes_for(
        tmp_path,
        "task-definition.json",
        '{"image": "amazon/aws-xray-daemon:latest"}',
    )


def test_rejects_unstructured_console_and_print(tmp_path: Path) -> None:
    assert "CW015" in codes_for(tmp_path, "handler.ts", "console.log('completed');")
    assert "CW015" in codes_for(tmp_path, "handler.py", "print('completed')")


def test_rejects_sensitive_log_fields_and_raw_payloads(tmp_path: Path) -> None:
    source = """
const EVENT = new LogEventDef({
  name: 'app.auth.failed',
  fields: { authorization: 'sensitive' },
});
logger.emit(EVENT, { authorization: request.headers.authorization, payload });
"""
    codes = codes_for(tmp_path, "handler.ts", source)
    assert {"CW016", "CW018"} <= codes


def test_rejects_raw_error_logging(tmp_path: Path) -> None:
    source = """
const EVENT = new LogEventDef({ name: 'app.operation.failed' });
logger.emit(EVENT, { detail: error.message });
"""
    assert "CW017" in codes_for(tmp_path, "handler.ts", source)


def test_rejects_exception_message_metric_attribute(tmp_path: Path) -> None:
    source = """
const FAILURE = MetricDef.failureCounter({
  name: 'app.failure',
  attributes: { error: new Set(['x']) },
});
emitter.failure(FAILURE, 'unknown', { error: error.message });
"""
    assert "CW006" in codes_for(tmp_path, "handler.ts", source)


def test_rejects_lambda_init_and_shutdown_in_handler(tmp_path: Path) -> None:
    source = """
export async function handler() {
  const telemetry = startTelemetry({});
  await telemetry.shutdown();
}
"""
    codes = codes_for(tmp_path, "lambda-handler.ts", source)
    assert {"CW011", "CW012"} <= codes


def test_accepts_governed_emission(tmp_path: Path) -> None:
    source = """
const REQUEST = MetricDef.counter({
  name: 'app.request',
  unit: '{request}',
  purpose: 'outcome',
  owner: 'platform',
  description: 'Completed requests.',
  attributes: { outcome: new Set(['success', 'failure']) },
});
emitter.counter(REQUEST, 1, { outcome: 'success' });
"""
    assert not codes_for(tmp_path, "handler.ts", source)


def test_governed_log_call_does_not_capture_later_business_event(tmp_path: Path) -> None:
    source = """
logger.emit(COMPLETED, {
  outcome: 'success',
});
return { ok: true, event };
"""
    assert "CW018" not in codes_for(tmp_path, "lambda-handler.ts", source)
