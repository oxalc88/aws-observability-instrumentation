import json
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError
from botocore.stub import Stubber

from powertools_examples import batch_metrics as batch
from powertools_examples import dependency_handler as dependency
from powertools_examples.diagnostic_evidence import diagnostic_evidence, emit_diagnostic
from powertools_examples import validation_handler as validation

CONTEXT = SimpleNamespace(aws_request_id="invocation-1")


def emf(capsys):
    return [value for line in capsys.readouterr().out.splitlines()
            if line.startswith("{") and "_aws" in (value := json.loads(line))]


def point(record, name):
    value = record.get(name)
    return value[0] if isinstance(value, list) else value


@pytest.fixture(autouse=True)
def reset_state():
    for module in (validation, batch, dependency):
        module.metrics.clear_metrics()
    yield
    for module in (validation, batch, dependency):
        module.metrics.clear_metrics()


def test_validation_contract_protects_values_and_unknown_keys(monkeypatch, capsys):
    logs = []
    monkeypatch.setattr(validation.logger, "warning", lambda message, **kwargs: logs.append(kwargs["extra"]))
    response = validation.handler({"body": '{"PRIVATE_KEY":"SECRET"}'}, CONTEXT)
    assert response["statusCode"] == 400
    fields = logs[0]
    assert fields["validation.code"] == "NO_SUPPORTED_ENRICHMENT_FIELDS"
    assert fields["validation.rule"] == "supported_enrichment"
    assert fields["validation.path"] == "body"
    assert fields["validation.received_type"] == "object"
    assert fields["validation.received_fields"] == []
    assert fields["validation.unknown_field_count"] == 1
    assert fields["request_id"] == "invocation-1"
    records = emf(capsys)
    assert point(records[0], "Requests") == point(records[0], "RequestFailures") == 1
    assert records[0]["status_class"] == "4xx"
    assert "PRIVATE" not in json.dumps([fields, records])
    assert "SECRET" not in json.dumps([fields, records])


@pytest.mark.parametrize("body, received_type", [("SECRET invalid JSON", "null"), ("[]", "array"), ("true", "boolean")])
def test_validation_shape_rejections_have_safe_diagnostics(body, received_type, monkeypatch, capsys):
    logs = []
    monkeypatch.setattr(validation.logger, "warning", lambda message, **kwargs: logs.append(kwargs["extra"]))
    assert validation.handler({"body": body}, CONTEXT)["statusCode"] == 400
    assert len(logs) == 1
    assert logs[0]["validation.code"] == "BODY_NOT_OBJECT"
    assert logs[0]["validation.received_type"] == received_type
    assert "SECRET" not in json.dumps(logs)
    assert len(emf(capsys)) == 1


def test_accepted_request_has_metrics_without_narrative_log(monkeypatch, capsys):
    logs = []
    monkeypatch.setattr(validation.logger, "warning", lambda *args, **kwargs: logs.append(args))
    assert validation.handler({"body": '{"notes":"PRIVATE"}'}, CONTEXT)["statusCode"] == 204
    assert logs == []
    record = emf(capsys)[0]
    assert point(record, "Requests") == 1
    assert point(record, "RequestFailures") == 0
    assert point(record, "RequestDuration") >= 0
    assert (record["result"], record["failure_class"], record["status_class"]) == ("accepted", "none", "2xx")
    assert "PRIVATE" not in json.dumps(record)


def test_request_metrics_and_logger_failures_preserve_business_response(monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("telemetry unavailable")
    monkeypatch.setattr(validation.logger, "warning", fail)
    monkeypatch.setattr(validation.metrics, "flush_metrics", fail)
    assert validation.handler({"body": "[]"}, CONTEXT)["statusCode"] == 400
    assert validation.handler({"body": '{"notes":"private"}'}, CONTEXT)["statusCode"] == 204
    assert validation.metrics.metric_set == {}


def test_namespaces_and_warm_invocations_do_not_share_metrics_or_metadata(capsys):
    validation.metrics.add_metric(name="StaleMetric", unit="Count", value=1)
    validation.metrics.add_dimension(name="stale", value="PRIVATE")
    validation.metrics.add_metadata(key="stale_metadata", value="SECRET")
    batch.handler({"records": [{}, {}, {"primaryScore": 1}]}, CONTEXT)
    batch.handler({"records": [{"primaryScore": 2}]}, CONTEXT)
    records = emf(capsys)
    assert [point(r, "ProcessedRecords") for r in records] == [3, 1]
    assert [point(r, "FallbackRecords") for r in records] == [2, 0]
    assert all(r["_aws"]["CloudWatchMetrics"][0]["Namespace"] == "Example/Ingestion" for r in records)
    assert "StaleMetric" not in json.dumps(records)
    assert "SECRET" not in json.dumps(records)
    validation.handler({"body": '{"notes":"private"}'}, CONTEXT)
    record = emf(capsys)[0]
    assert "PRIVATE" not in json.dumps(record) and "stale" not in json.dumps(record)
    assert validation.metrics.metric_set == batch.metrics.metric_set == {}


def test_empty_batch_publishes_no_emf_or_empty_warning(capsys):
    assert batch.handler({"records": []}, CONTEXT) == []
    assert capsys.readouterr().out == ""


def test_batch_failure_retains_completed_work_and_one_safe_diagnostic(monkeypatch, capsys):
    original = RuntimeError("SECRET domain error")
    logs = []
    calls = 0
    def process(record):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise original
        return {"score": 0, "usedFallback": True}
    monkeypatch.setattr(batch.logger, "error", lambda message, **kwargs: logs.append(kwargs["extra"]))
    with pytest.raises(RuntimeError) as error:
        batch.make_batch_handler(process)({"records": [{}, {}, {}]}, CONTEXT)
    assert error.value is original
    record = emf(capsys)[0]
    assert [point(record, n) for n in ("ReceivedRecords", "AttemptedRecords", "ProcessedRecords", "FailedRecords", "BatchFailures")] == [3, 2, 1, 1, 1]
    assert point(record, "BatchDuration") >= 0
    assert len(logs) == 1 and logs[0]["location"] == "process_record"
    assert logs[0]["request_id"] == "invocation-1"
    assert "SECRET" not in json.dumps(logs)


def test_batch_telemetry_failure_cannot_replace_original_error(monkeypatch):
    original = RuntimeError("business error")
    def fail(*args, **kwargs):
        raise RuntimeError("sink unavailable")
    def process(record):
        raise original
    monkeypatch.setattr(batch.logger, "error", fail)
    monkeypatch.setattr(batch.metrics, "flush_metrics", fail)
    with pytest.raises(RuntimeError) as error:
        batch.make_batch_handler(process)({"records": [{}]}, CONTEXT)
    assert error.value is original
    assert batch.metrics.metric_set == {}


def test_failed_cleanup_drops_publication_instead_of_leaking_stale_data(monkeypatch):
    emitted = []
    batch.metrics.add_metadata(key="private", value="SECRET")
    def fail():
        raise RuntimeError("reset unavailable")
    monkeypatch.setattr(batch.metrics, "clear_metrics", fail)
    monkeypatch.setattr(batch.metrics, "flush_metrics", lambda: emitted.append(True))
    assert batch.handler({"records": [{}]}, CONTEXT) == [{"score": 0, "usedFallback": True}]
    assert emitted == []
    monkeypatch.undo()  # Restore cleanup before the fixture resets SDK state.


def test_dependency_uses_real_botocore_metadata_without_live_aws(capsys):
    with Stubber(dependency.client) as stub:
        stub.add_response("get_item", {"Item": {}, "ResponseMetadata": {"RetryAttempts": 2}},
                          {"TableName": "orders", "Key": {"id": {"S": "PRIVATE"}}})
        assert dependency.lookup_order("PRIVATE") == {"Item": {}, "ResponseMetadata": {"RetryAttempts": 2}}
    record = emf(capsys)[0]
    assert point(record, "DependencyCalls") == 1
    assert point(record, "DependencyFailures") == 0
    assert point(record, "DependencyAttempts") == 3  # Retries + first attempt.
    assert point(record, "MissingAttemptEvidence") == 0
    assert point(record, "DependencyDuration") >= 0
    assert "PRIVATE" not in json.dumps(record)


@pytest.mark.parametrize("code, category, throttles", [
    ("ThrottlingException", "rate_limited", 1), ("UnrecognizedProviderCode", "unknown", 0),
])
def test_dependency_classified_failures_and_diagnostics_are_safe(code, category, throttles, monkeypatch, capsys):
    original = ClientError({"Error": {"Code": code, "Message": "SECRET SDK TEXT"},
                            "ResponseMetadata": {"HTTPStatusCode": 503, "RetryAttempts": 1}}, "GetItem")
    logs = []
    def fail(**kwargs):
        raise original
    monkeypatch.setattr(dependency.client, "get_item", fail)
    monkeypatch.setattr(dependency.logger, "error", lambda message, **kwargs: logs.append(kwargs["extra"]))
    with pytest.raises(ClientError) as error:
        dependency.lambda_handler({"orderId": "PRIVATE"}, CONTEXT)
    assert error.value is original
    record = emf(capsys)[0]
    assert record["failure_class"] == category
    assert point(record, "DependencyFailures") == 1
    assert point(record, "DependencyThrottles") == throttles
    assert point(record, "DependencyAttempts") == 2
    assert len(logs) == 1
    assert logs[0]["dependency.operation"] == "GetItem" and logs[0]["http.status_class"] == "5xx"
    assert logs[0]["http.status_code"] == 503
    assert logs[0]["provider.error_code"] == code
    assert isinstance(logs[0]["exception.stack"], str)
    assert logs[0]["retry.decision"] == "propagate"
    assert logs[0]["request_id"] == "invocation-1"
    assert "SECRET" not in json.dumps([logs, record]) and "PRIVATE" not in json.dumps([logs, record])


def test_timeout_without_sdk_metadata_reports_missing_attempt_evidence(monkeypatch, capsys):
    original = TimeoutError("SECRET")
    def fail(**kwargs):
        raise original
    monkeypatch.setattr(dependency.client, "get_item", fail)
    with pytest.raises(TimeoutError) as error:
        dependency.lookup_order("private")
    assert error.value is original
    record = emf(capsys)[0]
    assert record["failure_class"] == "timeout"
    assert point(record, "MissingAttemptEvidence") == 1
    assert "DependencyAttempts" not in record


def test_dependency_publication_failure_preserves_sdk_success_and_original_error(monkeypatch):
    original = RuntimeError("domain error")
    def fail():
        raise RuntimeError("publication failed")
    monkeypatch.setattr(dependency.metrics, "flush_metrics", fail)
    monkeypatch.setattr(dependency.client, "get_item", lambda **kwargs: {"Item": {}})
    assert dependency.lookup_order("private") == {"Item": {}}
    def reject(**kwargs):
        raise original
    monkeypatch.setattr(dependency.client, "get_item", reject)
    with pytest.raises(RuntimeError) as error:
        dependency.lookup_order("private")
    assert error.value is original
    assert dependency.metrics.metric_set == {}


class Recorder:
    def __init__(self, fail_setup=False, fail_close=False):
        self.parent = object()
        self.active = self.parent
        self.names = []
        self.faults = 0
        self.fail_setup = fail_setup
        self.fail_close = fail_close
    def get_trace_entity(self):
        if self.fail_setup:
            raise RuntimeError("setup failed")
        return self.active
    def begin_subsegment(self, name):
        self.names.append(name)
        self.active = self
        return self
    def add_fault_flag(self):
        self.faults += 1
    def end_subsegment(self):
        if self.fail_close:
            raise RuntimeError("close failed")
    def set_trace_entity(self, parent):
        self.active = parent


@pytest.mark.parametrize("fail_setup, fail_close", [(True, False), (False, True)])
def test_trace_failures_preserve_success_and_parent_context(fail_setup, fail_close, monkeypatch):
    recorder = Recorder(fail_setup, fail_close)
    monkeypatch.setattr(dependency.tracer, "disabled", False)
    monkeypatch.setattr(dependency.tracer, "provider", recorder)
    monkeypatch.setattr(dependency.client, "get_item", lambda **kwargs: {"Item": {}})
    assert dependency.handler({"orderId": "private"}, CONTEXT) == {"found": True}
    assert recorder.active is recorder.parent
    if not fail_setup:
        assert recorder.names == ["Lambda.OrderLookup", "DynamoDB.GetItem"]


def test_trace_failure_records_fault_without_raw_error_metadata(monkeypatch):
    recorder = Recorder()
    original = RuntimeError("SECRET")
    def fail(**kwargs):
        raise original
    monkeypatch.setattr(dependency.tracer, "disabled", False)
    monkeypatch.setattr(dependency.tracer, "provider", recorder)
    monkeypatch.setattr(dependency.client, "get_item", fail)
    with pytest.raises(RuntimeError) as error:
        dependency.lookup_order("private")
    assert error.value is original and recorder.faults == 1
    assert recorder.names == ["DynamoDB.GetItem"]
    assert recorder.active is recorder.parent
    assert "SECRET" not in repr(recorder.__dict__)

def test_unknown_provider_status_and_unmapped_diagnostics_are_preserved():
    cause = RuntimeError("connection upgraded")
    original = RuntimeError("Rappi returned HTTP 426")
    original.__cause__ = cause
    evidence = diagnostic_evidence(
        original, http_status=426, provider_code="UNMAPPED_NEW_CODE",
        provider_message="Unexpected provider condition",
    )
    assert evidence["http.status_code"] == 426
    assert evidence["http.status_class"] == "4xx"
    assert evidence["provider.error_code"] == "UNMAPPED_NEW_CODE"
    assert evidence["provider.error_message"] == "Unexpected provider condition"
    assert "Rappi returned HTTP 426" in evidence["exception.stack"]
    assert evidence["exception.causes"][0]["message"] == "connection upgraded"


def test_diagnostic_evidence_redacts_secrets_and_declares_truncation():
    cause = RuntimeError("password=hunter2 https://provider.test/path?token=abc")
    original = RuntimeError("Bearer longSecretValue SECRET contact someone@example.com")
    original.__cause__ = cause
    original.__traceback__ = None
    evidence = diagnostic_evidence(
        original, http_status=426,
        provider_message="Authorization: Bearer abc123 ops@example.com",
    )
    serialized = json.dumps(evidence)
    for secret in ("hunter2", "longSecretValue", "abc123", "someone@example.com", "ops@example.com"):
        assert secret not in serialized
    assert evidence["diagnostic.redacted"]
    oversized = RuntimeError("x" * 1300)
    result = diagnostic_evidence(oversized, http_status="426", provider_message="UNREVIEWED")
    assert len(result["exception.message"]) == 1300
    assert result["diagnostic.truncated"] == []
    assert result["provider.error_message"] == "UNREVIEWED"
    assert "http.status_code:unavailable_or_invalid" in result["diagnostic.omitted"]


def test_no_diagnostic_state_shared_between_records_or_cyclic_causes():
    a, b = RuntimeError("first"), RuntimeError("second")
    a.__cause__ = a
    first = diagnostic_evidence(a, http_status=426, provider_code="FIRST")
    second = diagnostic_evidence(b, http_status=503, provider_code="SECOND")
    assert "exception.causes:cycle" in first["diagnostic.omitted"]
    assert second["http.status_code"] == 503
    assert second["provider.error_code"] == "SECOND"
    assert "FIRST" not in json.dumps(second)

def test_all_six_causes_and_long_messages_are_retained():
    original = RuntimeError("x" * 7000)
    current = original
    for _ in range(6):
        child = RuntimeError("x" * 7000)
        current.__cause__ = child
        current = child
    record = diagnostic_evidence(
        original, http_status=426, provider_message="msg" * 900,
    )
    assert len(record["exception.causes"]) == 6
    assert all(len(cause["stack"]) > 4096 for cause in record["exception.causes"])
    assert len(record["provider.error_message"]) == 2700
    assert record["diagnostic.truncated"] == []


@pytest.mark.parametrize("response", [{"unknown": [17, {"message": "undocumented", "code": 731}]}, ["undocumented", 731], 731, False, None, "non-JSON undocumented text"])
def test_unknown_response_formats_and_numeric_codes(response):
    evidence = diagnostic_evidence(RuntimeError("original"), http_status=426, provider_code=731, provider_response=response)
    assert evidence["http.status_code"] == 426
    assert evidence["provider.error_code"] == 731
    assert evidence["provider.error_response"] == response


def test_response_secrets_cycles_and_throwing_cause_accessors():
    response = {"unknown": "ops@example.com", "token": {"nested": "abc123"}, "password": "hunter2", "ops@example.com": "safe"}
    evidence = diagnostic_evidence(RuntimeError("failure"), provider_response=response)
    for secret in ("ops@example.com", "abc123", "hunter2"):
        assert secret not in json.dumps(evidence)
    cyclic = {}
    cyclic["self"] = cyclic
    assert "cycle" in json.dumps(diagnostic_evidence(RuntimeError("failure"), provider_response=cyclic))

    class HostileError(Exception):
        @property
        def __cause__(self):
            raise RuntimeError("PRIVATE_SECRET")
    result = diagnostic_evidence(HostileError("original"))
    assert "exception.causes:accessor_failed" in result["diagnostic.omitted"]
    assert "PRIVATE_SECRET" not in json.dumps(result)


def test_multipart_roundtrip_and_failed_parts():
    import base64
    import hashlib
    records = []
    class Sink:
        calls = 0
        fail_at = None
        def error(self, message, *, extra):
            self.calls += 1
            if self.calls == self.fail_at:
                raise RuntimeError("sink unavailable")
            records.append(extra)
    evidence = diagnostic_evidence(RuntimeError("long 😀 message" * 12000), http_status=426, provider_code=731,
                                   provider_response={"unknown": "large" * 15000})
    sink = Sink()
    assert emit_diagnostic(sink, "Dependency failed", {"request_id": "one", "failure.class": "unknown", "retry.decision": "propagate"}, evidence)
    parts = [r for r in records if r.get("diagnostic.kind") == "part"]
    assert len(parts) > 1
    data = b"".join(base64.b64decode(r["diagnostic.data"]) for r in parts)
    assert json.loads(data) == evidence
    assert all(len(json.dumps(r).encode()) + 8192 <= 60 * 1024 for r in records)
    assert len({r["diagnostic.id"] for r in records}) == 1
    assert records[-1]["diagnostic.sha256"] == hashlib.sha256(data).hexdigest()
    assert records[-1]["diagnostic.parts"] == len(parts)
    records.clear()
    sink = Sink()
    sink.fail_at = 2
    assert not emit_diagnostic(sink, "Dependency failed", {}, evidence)
    assert records[-1]["diagnostic.emission_complete"] is False
    assert records[-1]["diagnostic.failed_parts"] == 1


def test_recursive_traceback_keeps_every_available_frame():
    def recurse(depth):
        if depth:
            recurse(depth - 1)
        else:
            raise RuntimeError("original")
    try:
        recurse(90)
    except RuntimeError as error:
        evidence = diagnostic_evidence(error)
        assert evidence["exception.stack"].count("in recurse") == 91
        assert len(evidence["exception.stack"]) > 4096
        assert "repeated" not in evidence["exception.stack"]


def test_real_powertools_info_logger_emits_warn_parts_within_budget(capsys):
    from aws_lambda_powertools import Logger
    import base64
    import io
    stream = io.StringIO()
    logger = Logger(service="evidence-offline-test", level="INFO", stream=stream)
    evidence = diagnostic_evidence(RuntimeError("original"), http_status=426, provider_code=731,
                                   provider_response="undocumented 😀\n" * 12000)
    assert emit_diagnostic(logger, "Dependency failed", {"request_id": "one"}, evidence, level="warning")
    lines = stream.getvalue().splitlines()
    records = [json.loads(line) for line in lines]
    assert len(records) > 2
    assert all(r["level"] == "WARNING" for r in records)
    assert all(len(line.encode()) < 60 * 1024 for line in lines)
    parts = [r for r in records if r.get("diagnostic.kind") == "part"]
    assert json.loads(b"".join(base64.b64decode(r["diagnostic.data"]) for r in parts)) == evidence


def test_http_426_unknown_body_original_identity_and_telemetry_failures(monkeypatch):
    original = RuntimeError("original")
    original.response = {"Error": {"Code": 731, "Message": "Undocumented upgrade condition", "unknown": [17]},
                         "ResponseMetadata": {"HTTPStatusCode": 426}}
    records = []
    def fail(**kwargs):
        raise original
    monkeypatch.setattr(dependency.client, "get_item", fail)
    monkeypatch.setattr(dependency.logger, "error", lambda message, **kwargs: records.append(kwargs["extra"]))
    with pytest.raises(RuntimeError) as caught:
        dependency.lambda_handler({"orderId": "private"}, CONTEXT)
    assert caught.value is original
    assert records[0]["provider.error_code"] == 731
    assert records[0]["http.status_code"] == 426
    assert records[0]["provider.error_response"] == original.response
    assert records[0]["failure.class"] == "unknown"
    assert records[0]["retry.decision"] == "propagate"
    # Unexpected Error shape must not prevent capture of the actual body.
    original.response["Error"] = [731, "undocumented"]
    with pytest.raises(RuntimeError):
        dependency.lambda_handler({"orderId": "private"}, CONTEXT)
    assert records[-1]["provider.error_response"]["Error"] == [731, "undocumented"]
    def unavailable(*args, **kwargs):
        raise RuntimeError("telemetry unavailable")
    monkeypatch.setattr(dependency.logger, "error", unavailable)
    monkeypatch.setattr(dependency.metrics, "flush_metrics", unavailable)
    monkeypatch.setattr(dependency.tracer.provider, "get_trace_entity", unavailable)
    with pytest.raises(RuntimeError) as caught:
        dependency.lambda_handler({"orderId": "private"}, CONTEXT)
    assert caught.value is original
    monkeypatch.setattr(dependency.client, "get_item", lambda **kwargs: {"Item": {}})
    assert dependency.lambda_handler({"orderId": "private"}, CONTEXT) == {"found": True}


def test_json_transport_text_redacts_nested_credentials_without_hiding_unknown_fields():
    assert diagnostic_evidence(RuntimeError("original"), provider_code="123456789012")["provider.error_code"] == "123456789012"
    evidence = diagnostic_evidence(RuntimeError("original"), provider_response='{"unknown":[731,"undocumented"],"access_token":"opaqueCredential","nested":{"password":"hunter2"}}')
    assert json.loads(evidence["provider.error_response"])["unknown"] == [731, "undocumented"]
    for secret in ("opaqueCredential", "hunter2"):
        assert secret not in json.dumps(evidence)
    assert "provider.error_response" in evidence["diagnostic.normalized"]


def test_unavailable_original_formatter_preserves_cause_and_declares_loss():
    class HostileError(Exception):
        def __str__(self):
            raise RuntimeError("PRIVATE_SECRET")
    original = HostileError()
    original.__cause__ = RuntimeError("original cause")
    evidence = diagnostic_evidence(original)
    assert "exception.message:unavailable" in evidence["diagnostic.omitted"]
    assert evidence["exception.causes"][0]["message"] == "original cause"
    assert evidence["diagnostic.capture_complete"] is False
    assert "PRIVATE_SECRET" not in json.dumps(evidence)
