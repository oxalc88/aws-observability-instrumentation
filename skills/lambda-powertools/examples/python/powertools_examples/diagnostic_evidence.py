"""Sanitized failure evidence and parts emitted directly through Powertools Logger."""
import base64
import hashlib
import json
import math
import re
import traceback
import uuid

UNAVAILABLE = object()

SENSITIVE_KEY = re.compile(r"password|passwd|secret|token|authorization|cookie|session|api[_-]?key|access[_-]?key|email|phone|address|name|birth|ssn|credit|card", re.I)


def diagnostic_evidence(error, *, http_status=None, provider_code=None,
                        provider_message=None, provider_response=UNAVAILABLE):
    redacted, truncated, omitted, normalized = [], [], [], []

    def read(value, key, field):
        try:
            return getattr(value, key, None)
        except Exception:
            omitted.append(field + ":accessor_failed")
            return None

    def safe_text(value, field):
        clean = re.sub(r"[\x00-\x09\x0b-\x1f\x7f]", " ", value)
        clean = re.sub(r"https?://[^\s\"'<>]+", lambda m: re.sub(r"[?#].*$", "?[REDACTED]", re.sub(r"(https?://)[^/@]+@", r"\1[REDACTED]@", m.group(), flags=re.I)), clean, flags=re.I)
        clean = re.sub(r"\bBearer\s+[^\s,;]+", "Bearer [REDACTED]", clean, flags=re.I)
        clean = re.sub(r"\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|session[_-]?id|access[_-]?key)\b[\"']?\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)", r"\1=[REDACTED]", clean, flags=re.I)
        if "@" in clean:
            clean = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[REDACTED_EMAIL]", clean, flags=re.I)
        clean = re.sub(r"\b(?:\+?\d[\d().\s-]{8,}\d)\b", "[REDACTED_NUMBER]", clean)
        clean = re.sub(r"\b(?:SECRET(?:[_-][A-Z0-9]+)*|PRIVATE[_-][A-Z0-9_]+)\b", "[REDACTED]", clean, flags=re.I)
        clean = re.sub(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)", "[REDACTED_PRIVATE_KEY]", clean)
        clean = re.sub(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b", "[REDACTED_ACCESS_KEY]", clean)
        if clean != value:
            redacted.append(field)
        return clean

    active = set()

    def sanitize(value, field):
        if isinstance(value, str):
            if field == "provider.error_code" and re.fullmatch(r"[-+]?\d+(?:\.\d+)?", value):
                return value
            if value.lstrip().startswith(("{", "[")):
                try:
                    parsed = json.loads(value)
                except (ValueError, RecursionError):
                    pass  # Preserve malformed text.
                else:
                    normalized.append(field)
                    return json.dumps(sanitize(parsed, field), ensure_ascii=True, separators=(",", ":"))
            return safe_text(value, field)
        if value is None or type(value) in (bool, int):
            return value
        if type(value) is float and math.isfinite(value):
            return value
        if not isinstance(value, (dict, list, tuple)):
            omitted.append(field + ":unsupported_type")
            return "[UNAVAILABLE]"
        if id(value) in active:
            omitted.append(field + ":cycle")
            return "[UNAVAILABLE_CYCLE]"
        active.add(id(value))
        try:
            if isinstance(value, (list, tuple)):
                return [sanitize(item, field + f"[{i}]") for i, item in enumerate(value)]
            result = {}
            for key in value:
                if not isinstance(key, str):
                    omitted.append(field + ":nonstring_key")
                    continue
                safe_key = safe_text(key, field + ".key")
                if safe_key in result:
                    omitted.append(field + ":sanitized_key_collision")
                    continue
                if SENSITIVE_KEY.search(key):
                    result[safe_key] = "[REDACTED]"
                    redacted.append(field + ".field")
                else:
                    try:
                        result[safe_key] = sanitize(value[key], field + ".field")
                    except Exception:
                        result[safe_key] = "[UNAVAILABLE]"
                        omitted.append(field + ":accessor_failed")
            return result
        except Exception:
            omitted.append(field + ":capture_failed")
            return "[UNAVAILABLE]"
        finally:
            active.remove(id(value))

    record = {}
    if type(http_status) is int:
        record["http.status_code"] = http_status
        record["http.status_class"] = f"{http_status // 100}xx"
    else:
        omitted.append("http.status_code:unavailable_or_invalid")
    for key, value in (("provider.error_code", provider_code), ("provider.error_message", provider_message),
                       ("provider.error_response", provider_response)):
        if value is not UNAVAILABLE and (value is not None or key == "provider.error_response"):
            record[key] = sanitize(value, key)
        else:
            omitted.append(key + ":unavailable")
    current, seen, causes = error, set(), []
    while current is not None:
        if id(current) in seen:
            omitted.append("exception.causes:cycle")
            break
        seen.add(id(current))
        prefix = "exception" if len(seen) == 1 else f"exception.causes[{len(seen)-2}]"
        node = {"name": safe_text(type(current).__name__, prefix + ".name")}
        try:
            node["message"] = safe_text(str(current), prefix + ".message")
        except Exception:
            omitted.append(prefix + ".message:unavailable")
        tb = read(current, "__traceback__", prefix + ".stack")
        try:
            # Render every available frame individually: format_exception compresses
            # repeated recursion frames. Never capture locals.
            frames = []
            seen_tb = set()
            while tb is not None:
                if id(tb) in seen_tb:
                    omitted.append(prefix + ".stack:cycle")
                    break
                seen_tb.add(id(tb))
                frames.extend(traceback.format_list(traceback.extract_tb(tb, limit=1)))
                tb = tb.tb_next
            stack = "Traceback (most recent call last):\n" + "".join(frames) if frames else ""
            stack += "".join(traceback.format_exception_only(type(current), current))
            node["stack"] = safe_text(stack, prefix + ".stack")
        except Exception:
            omitted.append(prefix + ".stack:unavailable")
        if len(seen) == 1:
            record.update({f"exception.{key}": value for key, value in node.items()})
        else:
            causes.append(node)
        cause = read(current, "__cause__", "exception.causes")
        if cause is not None:
            current = cause
        elif not read(current, "__suppress_context__", "exception.causes"):
            current = read(current, "__context__", "exception.causes")
        else:
            current = None
    record.update({"exception.causes": causes, "diagnostic.stack_scope": "runtime_available_frames",
                   "diagnostic.normalized": normalized, "diagnostic.redacted": redacted, "diagnostic.truncated": truncated,
                   "diagnostic.omitted": omitted, "diagnostic.capture_complete": not omitted})
    return record


def emit_diagnostic(logger, message, context, evidence, level="error", event_budget=60 * 1024):
    """One logical event; 8 KiB reserved for verified Powertools/runtime envelope.

    Successful emission is not a CloudWatch delivery acknowledgement.
    """
    def encode(value):
        return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("utf-8")

    diagnostic_id = str(uuid.uuid4())
    try:
        data = encode(evidence)
        common = {**context, "diagnostic.id": diagnostic_id}
        send = getattr(logger, level)
        if len(encode({**common, **evidence})) + 8192 <= event_budget:
            send(message, extra={**common, **evidence})
            return True
        room = event_budget - 8192 - len(encode(common)) - 1024
        if room < 4:
            raise ValueError("Insufficient envelope budget")
        size = (room // 4) * 3
        count = math.ceil(len(data) / size)
        failed = 0
        for i in range(count):
            try:
                send(message, extra={**common, "diagnostic.kind": "part", "diagnostic.part": i + 1,
                     "diagnostic.parts": count, "diagnostic.encoding": "base64-utf8-json",
                     "diagnostic.data": base64.b64encode(data[i*size:(i+1)*size]).decode("ascii")})
            except Exception:
                failed += 1
        send(message, extra={**common, "diagnostic.kind": "manifest", "diagnostic.parts": count,
             "diagnostic.bytes": len(data), "diagnostic.sha256": hashlib.sha256(data).hexdigest(),
             "diagnostic.emission_complete": failed == 0, "diagnostic.failed_parts": failed,
             "diagnostic.capture_complete": evidence["diagnostic.capture_complete"]})
        return failed == 0
    except Exception:
        try:
            getattr(logger, level)(message, extra={"diagnostic.kind": "loss", "diagnostic.id": diagnostic_id, "request_id": context.get("request_id"), "diagnostic.emission_complete": False,
                "diagnostic.omitted": ["diagnostic:serialization_or_emission_failed"]})
        except Exception:
            pass
        return False
