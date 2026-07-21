"""Static contract gate for Python, TypeScript, and JavaScript instrumentation."""

from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".cjs"}
CONFIG_SUFFIXES = {".json", ".yaml", ".yml"}
APPROVED_INSTRUMENT_FILES = {"emission_module.py", "metric-emitter.ts"}
APPROVED_LOGGING_FILES = {"structured_logging.py", "structured-logger.ts"}
SKIP_PARTS = {"node_modules", ".git", "dist", "coverage", "test", "tests"}
EMIT_NAMES = {
    "counter",
    "gauge",
    "histogram",
    "latency",
    "failure",
    "emit_counter",
    "emit_gauge",
    "emit_histogram",
    "emit_latency",
    "emit_failure",
}
FORBIDDEN_METRIC_KEYS = {
    "user.id",
    "user_id",
    "request.id",
    "request_id",
    "session.id",
    "session_id",
    "session.id",
    "connection_string",
    "connection.string",
    "request.headers",
    "response.headers",
    "trace.id",
    "trace_id",
    "span.id",
    "span_id",
    "url.full",
    "url.query",
    "exception.message",
    "exception.stacktrace",
    "gen_ai.conversation.id",
    "gen_ai.input.messages",
    "gen_ai.output.messages",
}
RESOURCE_ONLY_KEYS = {
    "service.name",
    "service.version",
    "deployment.environment.name",
    "cloud.region",
    "cloud.account.id",
    "aws.ecs.task.arn",
}
FORBIDDEN_LOG_TERMS = {
    "authorization",
    "cookie",
    "password",
    "passwd",
    "secret",
    "access_token",
    "refresh_token",
    "api_key",
    "request.body",
    "request_body",
    "response.body",
    "response_body",
    "session_id",
    "exception.message",
    "exception.stacktrace",
    "gen_ai.input.messages",
    "gen_ai.output.messages",
    "prompt",
}


@dataclass(frozen=True)
class Violation:
    code: str
    path: Path
    line: int
    message: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.code} {self.message}"


def _source_files(roots: list[Path]) -> list[Path]:
    files: list[Path] = []
    for root in roots:
        candidates = [root] if root.is_file() else root.rglob("*")
        for path in candidates:
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            is_test = path.name.startswith("test_") or ".test." in path.name
            if path.name == "ci_gate.py" or is_test or any(part in SKIP_PARTS for part in path.parts):
                continue
            files.append(path)
    return sorted(set(files))


def _config_files(roots: list[Path]) -> list[Path]:
    files: list[Path] = []
    for root in roots:
        candidates = [root] if root.is_file() else root.rglob("*")
        for path in candidates:
            if path.is_file() and path.suffix in CONFIG_SUFFIXES:
                files.append(path)
    return sorted(set(files))


def _near_metric_context(lines: list[str], index: int) -> bool:
    window = "\n".join(lines[max(0, index - 8) : min(len(lines), index + 4)])
    return bool(re.search(r"MetricDef\.|emitter\.|emit_(?:counter|gauge|histogram|latency|failure)", window))


def _near_log_context(lines: list[str], index: int) -> bool:
    window = "\n".join(lines[max(0, index - 10) : min(len(lines), index + 5)])
    return bool(
        re.search(
            r"LogEventDef\s*\(|(?:logger|LOGGER)\.(?:emit|debug|info|warn|warning|error|critical)\s*\(",
            window,
        )
    )


def _text_checks(path: Path, text: str) -> list[Violation]:
    violations: list[Violation] = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        number = index + 1
        if path.name not in APPROVED_INSTRUMENT_FILES and re.search(
            r"\.(?:createCounter|createGauge|createHistogram|create_counter|create_gauge|create_histogram)\s*\(",
            line,
        ):
            violations.append(Violation("CW001", path, number, "create OTel instruments only in the emission module"))
        if re.search(r"PutMetricData|put_metric_data", line):
            violations.append(Violation("CW002", path, number, "do not call CloudWatch PutMetricData from application instrumentation"))
        if re.search(r"https://monitoring\.[A-Za-z0-9-]+\.amazonaws\.com/v1/metrics", line):
            violations.append(Violation("CW003", path, number, "keep regional CloudWatch endpoints in deployment configuration"))
        if re.search(r"name\s*[:=]\s*['\"][^'\"]+(?:_total|_bucket|_sum|_count)['\"]", line):
            violations.append(Violation("CW004", path, number, "do not add Prometheus-generated suffixes to OTel names"))
        if _near_metric_context(lines, index) and not _near_log_context(lines, index):
            for key in FORBIDDEN_METRIC_KEYS:
                if key in line:
                    violations.append(Violation("CW005", path, number, f"forbidden metric attribute key {key!r}"))
            if re.search(r"str\s*\(\s*(?:exc|error)\s*\)|(?:exc|error)\.message|stack(?:trace)?", line, re.IGNORECASE):
                violations.append(Violation("CW006", path, number, "do not attach exception text to metrics"))
            for key in RESOURCE_ONLY_KEYS:
                if key in line and re.search(r"emitter\.|emit_", "\n".join(lines[max(0, index - 3) : index + 2])):
                    violations.append(Violation("CW007", path, number, f"put {key!r} on the OTel resource"))
        if re.search(r"\bDate\.now\s*\(|\btime\.time\s*\(", line) and re.search(
            r"duration|elapsed|latency|started|start_time", text, re.IGNORECASE
        ):
            violations.append(Violation("CW008", path, number, "measure elapsed time with a monotonic clock"))
        if re.search(r"sentry_sdk|sentry-sdk|@sentry/", line):
            violations.append(Violation("CW013", path, number, "legacy Sentry SDK use remains in adaptation source"))
        if re.search(r"aws[-_]xray[-_]sdk|amazon/aws-xray-daemon", line, re.IGNORECASE):
            violations.append(Violation("CW014", path, number, "use OpenTelemetry instead of the X-Ray SDK or daemon"))
        if path.name not in APPROVED_LOGGING_FILES:
            if re.search(r"\bconsole\.(?:trace|debug|log|info|warn|error)\s*\(", line):
                violations.append(Violation("CW015", path, number, "use the approved structured logger instead of console methods"))
            if path.suffix == ".py" and re.search(r"\bprint\s*\(", line):
                violations.append(Violation("CW015", path, number, "use the approved structured logger instead of print"))
            if _near_log_context(lines, index):
                lowered = line.lower()
                for term in FORBIDDEN_LOG_TERMS:
                    if term in lowered:
                        violations.append(Violation("CW016", path, number, f"forbidden operational log field/content {term!r}"))
                if re.search(
                    r"str\s*\(\s*(?:exc|error)\s*\)|(?:exc|error)\.message|stack(?:trace)?|traceback\.format",
                    line,
                    re.IGNORECASE,
                ):
                    violations.append(Violation("CW017", path, number, "classify failures; do not log raw error text or stack traces"))

    if path.name not in APPROVED_LOGGING_FILES:
        start_pattern = re.compile(
            r"(?:logger|LOGGER)\.(?:emit|debug|info|warn|warning|error|critical)\s*\(",
        )
        terminator = re.compile(r"(?m)^\s*(?:}\s*)?\);?\s*$")
        for match in start_pattern.finditer(text):
            end = terminator.search(text, match.end())
            call_text = text[match.end() : end.start() if end else match.end() + 1_000]
            if re.search(r"\b(?:event|payload|request_body|response_body|headers)\b", call_text):
                line = text.count("\n", 0, match.start()) + 1
                violations.append(Violation("CW018", path, line, "do not log raw events, payloads, bodies, or headers"))

    metric_names: dict[str, int] = {}
    for match in re.finditer(r"\bname\s*[:=]\s*['\"]([A-Za-z][A-Za-z0-9_.\-/]{0,254})['\"]", text):
        name = match.group(1)
        line = text.count("\n", 0, match.start()) + 1
        if name in metric_names:
            violations.append(Violation("CW010", path, line, f"duplicate metric name {name!r} in file"))
        metric_names[name] = line

    if "lambda" in path.name.lower() or re.search(r"\bhandler\s*\(", text):
        handler_match = re.search(r"(?:function\s+handler|def\s+handler|const\s+handler\s*=)", text)
        if handler_match:
            handler_text = text[handler_match.start() :]
            searchable_handler = re.sub(r"(?m)^\s*(?://|#).*?$", "", handler_text)
            base_line = text.count("\n", 0, handler_match.start()) + 1
            init_match = re.search(r"(?:startTelemetry|init_telemetry)\s*\(", searchable_handler)
            if init_match:
                violations.append(Violation("CW011", path, base_line + searchable_handler.count("\n", 0, init_match.start()), "initialize telemetry outside the Lambda handler"))
            shutdown_match = re.search(r"\.shutdown\s*\(", searchable_handler)
            if shutdown_match:
                violations.append(Violation("CW012", path, base_line + searchable_handler.count("\n", 0, shutdown_match.start()), "do not shut down providers per Lambda invocation"))
    return violations


def _python_loop_checks(path: Path, text: str) -> list[Violation]:
    if path.suffix != ".py":
        return []
    try:
        tree = ast.parse(text, filename=str(path))
    except SyntaxError as exc:
        return [Violation("CW000", path, exc.lineno or 1, f"syntax error: {exc.msg}")]
    violations: list[Violation] = []
    lines = text.splitlines()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            continue
        for child in ast.walk(node):
            if not isinstance(child, ast.Call):
                continue
            name = child.func.attr if isinstance(child.func, ast.Attribute) else child.func.id if isinstance(child.func, ast.Name) else ""
            if name not in EMIT_NAMES:
                continue
            source_line = lines[child.lineno - 1] if child.lineno <= len(lines) else ""
            if "instrumentation: loop-allowed" not in source_line:
                violations.append(Violation("CW009", path, child.lineno, "aggregate metric values emitted inside loops"))
    return violations


def _typescript_loop_checks(path: Path, text: str) -> list[Violation]:
    if path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".cjs"}:
        return []
    violations: list[Violation] = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if not re.search(r"\b(?:for|while)\s*\(", line):
            continue
        window = lines[index : min(len(lines), index + 20)]
        for offset, candidate in enumerate(window):
            if "instrumentation: loop-allowed" in candidate:
                continue
            if re.search(r"\bemitter\.(?:counter|gauge|histogram|latency|failure)\s*\(", candidate):
                violations.append(Violation("CW009", path, index + offset + 1, "aggregate metric values emitted inside loops"))
    return violations


def check_paths(roots: list[Path]) -> list[Violation]:
    violations: list[Violation] = []
    global_names: dict[tuple[str, str], tuple[Path, int]] = {}
    for path in _source_files(roots):
        text = path.read_text(encoding="utf-8")
        violations.extend(_text_checks(path, text))
        violations.extend(_python_loop_checks(path, text))
        violations.extend(_typescript_loop_checks(path, text))
        for match in re.finditer(r"\bname\s*[:=]\s*['\"]([A-Za-z][A-Za-z0-9_.\-/]{0,254})['\"]", text):
            name = match.group(1)
            line = text.count("\n", 0, match.start()) + 1
            language = "python" if path.suffix == ".py" else "javascript"
            key = (language, name)
            if key in global_names:
                first_path, first_line = global_names[key]
                violations.append(Violation("CW010", path, line, f"metric {name!r} duplicates {first_path}:{first_line}"))
            else:
                global_names[key] = (path, line)
    for path in _config_files(roots):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"aws[-_]xray[-_]sdk|amazon/aws-xray-daemon", line, re.IGNORECASE):
                violations.append(Violation("CW014", path, number, "use an OpenTelemetry collector or CloudWatch Agent instead of the X-Ray SDK or daemon"))
    return sorted(set(violations), key=lambda item: (str(item.path), item.line, item.code))


def main(argv: list[str]) -> int:
    roots = [Path(arg) for arg in argv] or [Path("examples/typescript/src"), Path("examples/python"), Path("config")]
    violations = check_paths(roots)
    for violation in violations:
        print(violation)
    if violations:
        print(f"\n{len(violations)} instrumentation contract violation(s)")
        return 1
    print("Instrumentation contract checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
