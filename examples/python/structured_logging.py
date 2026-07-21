"""Governed one-line JSON logging with OpenTelemetry trace correlation."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Literal, Protocol, TextIO, TypeAlias

from opentelemetry import trace

LogLevel: TypeAlias = Literal["DEBUG", "INFO", "WARN", "ERROR"]
LogFieldClass: TypeAlias = Literal["operational", "correlation", "sensitive"]
LogValue: TypeAlias = str | int | float | bool | None

_EVENT_NAME = re.compile(r"^[a-z][a-z0-9_.]{0,254}$")
_METRIC_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_.\-/]{0,254}$")
_FORBIDDEN_FIELD = re.compile(
    r"(?:^|[._-])(authorization|cookie|password|passwd|secret|token|api[._-]?key|"
    r"session[._-]?id|request[._-]?body|response[._-]?body|"
    r"(?:error|exception)[._-]?message|prompt|stack(?:trace)?)(?:$|[._-])",
    re.IGNORECASE,
)
_LEVEL_WEIGHT: dict[LogLevel, int] = {
    "DEBUG": 10,
    "INFO": 20,
    "WARN": 30,
    "ERROR": 40,
}
_FIELD_CLASSES = frozenset({"operational", "correlation", "sensitive"})
_MANAGED_FIELDS = frozenset(
    {
        "timestamp",
        "level",
        "message",
        "event.name",
        "event.owner",
        "security.relevant",
        "service.name",
        "service.version",
        "deployment.environment.name",
        "operation.name",
        "metric.name",
        "exception.type",
        "code.file.path",
        "code.function.name",
        "code.line.number",
        "code.column.number",
        "trace_id",
        "span_id",
        "trace_flags",
        "correlation_id",
        "sampling.policy",
        "sampling.rate",
    }
)


def parse_log_level(value: str | None, fallback: LogLevel = "INFO") -> LogLevel:
    if value is None or not value.strip():
        return fallback
    normalized = value.upper()
    if normalized not in _LEVEL_WEIGHT:
        raise LoggingContractError(f"invalid log level: {value}")
    return normalized  # type: ignore[return-value]


class LoggingContractError(ValueError):
    """Raised when a log record violates its declared event schema."""


class RelatedMetric(Protocol):
    name: str
    required_attributes: frozenset[str]


@dataclass(frozen=True)
class LogSamplingRule:
    id: str
    rate: float
    locked: bool = False
    levels: frozenset[LogLevel] = frozenset()
    events: frozenset[str] = frozenset()
    operations: frozenset[str] = frozenset()
    environments: frozenset[str] = frozenset()
    sampling_classes: frozenset[str] = frozenset()
    security_relevant: bool | None = None

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9_.-]{0,254}", self.id):
            raise LoggingContractError(f"invalid sampling policy id: {self.id}")
        if not 0 <= self.rate <= 1:
            raise LoggingContractError(
                f"sampling rate for {self.id!r} must be between 0 and 1"
            )
        if self.locked and self.rate != 1:
            raise LoggingContractError(
                f"locked sampling policy {self.id!r} must retain 100%"
            )
        if (
            "ERROR" in self.levels or self.security_relevant is True
        ) and (not self.locked or self.rate != 1):
            raise LoggingContractError(
                f"sampling policy {self.id!r} for errors or security events "
                "must be locked at 100%"
            )
        if invalid_levels := self.levels - _LEVEL_WEIGHT.keys():
            raise LoggingContractError(
                f"invalid levels in sampling policy {self.id!r}: {sorted(invalid_levels)}"
            )
        for value in self.events | self.operations | self.sampling_classes:
            if not _EVENT_NAME.fullmatch(value):
                raise LoggingContractError(
                    f"invalid matcher {value!r} in sampling policy {self.id!r}"
                )
        for environment in self.environments:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,127}", environment):
                raise LoggingContractError(
                    f"invalid environment {environment!r} in sampling policy {self.id!r}"
                )


@dataclass(frozen=True)
class LogEventDef:
    name: str
    level: LogLevel
    message: str
    owner: str
    fields: Mapping[str, LogFieldClass] = field(default_factory=dict)
    required: frozenset[str] = frozenset()
    security_relevant: bool = False
    operation_name: str | None = None
    sampling_class: str | None = None
    related_metric: RelatedMetric | None = None

    def __post_init__(self) -> None:
        if not _EVENT_NAME.fullmatch(self.name):
            raise ValueError(f"invalid log event name: {self.name}")
        if not self.message.strip() or not self.owner.strip():
            raise ValueError("log event message and owner are required")
        if any(ord(character) < 32 or ord(character) == 127 for character in self.message):
            raise ValueError("log event message contains control characters")
        copied = dict(self.fields)
        for key, classification in copied.items():
            if not _EVENT_NAME.fullmatch(key):
                raise ValueError(f"invalid log field name: {key}")
            if key in _MANAGED_FIELDS:
                raise ValueError(f"managed log field: {key}")
            if _FORBIDDEN_FIELD.search(key):
                raise ValueError(f"forbidden log field: {key}")
            if classification not in _FIELD_CLASSES:
                raise ValueError(f"invalid log field classification for {key}")
        if undeclared := self.required - copied.keys():
            raise ValueError(f"required log fields are undeclared: {sorted(undeclared)}")
        if self.operation_name is not None and not _EVENT_NAME.fullmatch(
            self.operation_name
        ):
            raise ValueError(f"invalid operation name: {self.operation_name}")
        if self.sampling_class is not None and not _EVENT_NAME.fullmatch(
            self.sampling_class
        ):
            raise ValueError(f"invalid sampling class: {self.sampling_class}")
        if self.related_metric is not None:
            if not _METRIC_NAME.fullmatch(self.related_metric.name):
                raise ValueError(
                    f"invalid related metric name: {self.related_metric.name}"
                )
            missing_metric_fields = self.related_metric.required_attributes - self.required
            if missing_metric_fields:
                raise ValueError(
                    "related metric attributes must be required log fields: "
                    f"{sorted(missing_metric_fields)}"
                )
        object.__setattr__(self, "fields", MappingProxyType(copied))


class StructuredLogger:
    """Emit governed JSON records to stdout or an injected sink."""

    def __init__(
        self,
        *,
        service_name: str,
        environment: str,
        service_version: str | None = None,
        minimum_level: LogLevel = "INFO",
        allow_sensitive_fields: bool = False,
        sink: Callable[[Mapping[str, LogValue]], None] | None = None,
        stream: TextIO | None = None,
        now: Callable[[], datetime] | None = None,
        on_sink_error: Callable[[Exception], None] | None = None,
        sampling_rules: tuple[LogSamplingRule, ...] = (),
    ) -> None:
        if not service_name.strip() or not environment.strip():
            raise ValueError("service_name and environment are required")
        self._minimum_level = minimum_level
        self._allow_sensitive_fields = allow_sensitive_fields
        self._stream = stream or sys.stdout
        self._sink = sink or self._write_json
        self._now = now or (lambda: datetime.now(UTC))
        self._on_sink_error = on_sink_error or (lambda _error: None)
        policy_ids = [rule.id for rule in sampling_rules]
        if len(policy_ids) != len(set(policy_ids)):
            raise LoggingContractError("duplicate sampling policy id")
        self._sampling_rules = tuple(sampling_rules)
        self._environment = environment
        self._resource_fields: dict[str, LogValue] = {
            "service.name": _sanitize_string(service_name),
            "deployment.environment.name": _sanitize_string(environment),
        }
        if service_version is not None:
            self._resource_fields["service.version"] = _sanitize_string(service_version)

    def _write_json(self, record: Mapping[str, LogValue]) -> None:
        self._stream.write(json.dumps(record, separators=(",", ":")) + "\n")

    def emit(
        self,
        event: LogEventDef,
        fields: Mapping[str, LogValue] | None = None,
        *,
        correlation_id: str | None = None,
        exception: BaseException | None = None,
    ) -> bool:
        if (
            not event.security_relevant
            and _LEVEL_WEIGHT[event.level] < _LEVEL_WEIGHT[self._minimum_level]
        ):
            return False
        values = dict(fields or {})
        if unknown := values.keys() - event.fields.keys():
            raise LoggingContractError(f"undeclared log fields: {sorted(unknown)}")
        if missing := event.required - values.keys():
            raise LoggingContractError(f"missing required log fields: {sorted(missing)}")
        for key, value in values.items():
            if event.fields[key] == "sensitive" and not self._allow_sensitive_fields:
                raise LoggingContractError(f"sensitive field {key!r} is disabled")
            if isinstance(value, float) and not (-float("inf") < value < float("inf")):
                raise LoggingContractError(f"field {key!r} must be finite")
            if isinstance(value, str):
                values[key] = _sanitize_string(value)

        span_context = trace.get_current_span().get_span_context()
        trace_id: str | None = None
        if span_context.is_valid:
            trace_id = trace.format_trace_id(span_context.trace_id)
            correlation_id = correlation_id or trace_id
        if correlation_id is not None and not re.fullmatch(
            r"[A-Za-z0-9._:/-]{1,128}", correlation_id
        ):
            raise LoggingContractError(
                "correlation_id contains invalid characters or is too long"
            )
        keep, sampling_policy, sampling_rate = _sampling_decision(
            self._sampling_rules,
            event,
            self._environment,
            correlation_id,
        )
        if not keep:
            return False

        timestamp = self._now().astimezone(UTC).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        )
        record: dict[str, LogValue] = {
            "timestamp": timestamp,
            "level": event.level,
            "message": event.message,
            "event.name": event.name,
            "event.owner": event.owner,
            "security.relevant": event.security_relevant,
            "sampling.policy": sampling_policy,
            "sampling.rate": sampling_rate,
            **self._resource_fields,
            **values,
        }
        if event.operation_name is not None:
            record["operation.name"] = event.operation_name
        if event.related_metric is not None:
            record["metric.name"] = event.related_metric.name
        if exception is not None:
            record.update(_safe_exception_fields(exception))
        if span_context.is_valid:
            assert trace_id is not None
            record["trace_id"] = trace_id
            record["span_id"] = trace.format_span_id(span_context.span_id)
            record["trace_flags"] = int(span_context.trace_flags)
            correlation_id = correlation_id or trace_id
        if correlation_id is not None:
            record["correlation_id"] = correlation_id
        try:
            self._sink(record)
            return True
        except Exception as exc:
            try:
                self._on_sink_error(exc)
            except Exception:
                # A diagnostic fallback must not turn observability loss into business failure.
                pass
            return False


def _sampling_decision(
    rules: tuple[LogSamplingRule, ...],
    event: LogEventDef,
    environment: str,
    key: str | None,
) -> tuple[bool, str, float]:
    if event.security_relevant:
        return _mandatory_sampling_decision(
            rules, event, environment, "mandatory.security"
        )
    if event.level == "ERROR":
        return _mandatory_sampling_decision(rules, event, environment, "mandatory.error")
    rule = next(
        (candidate for candidate in rules if _sampling_rule_matches(candidate, event, environment)),
        None,
    )
    if rule is None:
        return True, "default", 1
    if rule.rate >= 1 or key is None:
        return True, rule.id, rule.rate
    if rule.rate <= 0:
        return False, rule.id, rule.rate
    digest = hashlib.sha256(f"{rule.id}\0{key}".encode()).hexdigest()
    sample = int(digest[:13], 16) / 0x10000000000000
    return sample < rule.rate, rule.id, rule.rate


def _mandatory_sampling_decision(
    rules: tuple[LogSamplingRule, ...],
    event: LogEventDef,
    environment: str,
    fallback_policy: str,
) -> tuple[bool, str, float]:
    rule = next(
        (
            candidate
            for candidate in rules
            if candidate.locked
            and candidate.rate == 1
            and _sampling_rule_matches(candidate, event, environment)
        ),
        None,
    )
    return True, rule.id if rule is not None else fallback_policy, 1


def _sampling_rule_matches(
    rule: LogSamplingRule,
    event: LogEventDef,
    environment: str,
) -> bool:
    return (
        (not rule.levels or event.level in rule.levels)
        and (not rule.events or event.name in rule.events)
        and (
            not rule.operations
            or (event.operation_name is not None and event.operation_name in rule.operations)
        )
        and (not rule.environments or environment in rule.environments)
        and (
            not rule.sampling_classes
            or (
                event.sampling_class is not None
                and event.sampling_class in rule.sampling_classes
            )
        )
        and (
            rule.security_relevant is None
            or rule.security_relevant is event.security_relevant
        )
    )


def _safe_exception_fields(exception: BaseException) -> dict[str, LogValue]:
    exception_type = type(exception)
    qualified_name = exception_type.__qualname__
    if exception_type.__module__ not in {"builtins", "__main__"}:
        qualified_name = f"{exception_type.__module__}.{qualified_name}"
    fields: dict[str, LogValue] = {
        "exception.type": _sanitize_string(qualified_name[:255]),
    }

    traceback = exception.__traceback__
    if traceback is None:
        return fields
    while traceback.tb_next is not None:
        traceback = traceback.tb_next
    code = traceback.tb_frame.f_code
    fields["code.file.path"] = _sanitize_string(code.co_filename[:2_048])
    fields["code.function.name"] = _sanitize_string(code.co_qualname[:512])
    fields["code.line.number"] = traceback.tb_lineno
    return fields


def _sanitize_string(value: str) -> str:
    if len(value) > 2_048:
        raise LoggingContractError("log string exceeds 2048 characters")
    return "".join(
        f"\\u{ord(character):04x}"
        if ord(character) < 32 or ord(character) in {127, 0x2028, 0x2029}
        else character
        for character in value
    )


__all__ = [
    "LogEventDef",
    "LogSamplingRule",
    "LoggingContractError",
    "StructuredLogger",
    "parse_log_level",
]
