"""Reviewed, bounded failure evidence for Powertools Logger (reference adapter).

Only approved provider error fields may be passed; regex redaction cannot
prove arbitrary external free text is safe for the selected log destination.
"""
import re
import traceback

MAX_CAUSES = 4


def diagnostic_evidence(error, *, http_status=None, provider_code=None,
                        provider_message=None, provider_message_approved=False):
    redacted, truncated, omitted = [], [], []
    remaining = [10 * 1024]  # reserve headroom for keys, identifiers and markers
    record = {}
    if type(http_status) is int and 100 <= http_status <= 599:
        record["http.status_code"] = http_status
        record["http.status_class"] = f"{http_status // 100}xx"
    else:
        record["http.status_class"] = "unknown"
        omitted.append("http.status_code:unavailable_or_invalid")

    def safe_text(value, field, limit, approved=True):
        if not approved:
            omitted.append(f"{field}:unapproved_source")
            return None
        if not isinstance(value, str) or not value.strip():
            omitted.append(f"{field}:unavailable_or_nonstring")
            return None
        clean = re.sub(r"[\x00-\x09\x0b-\x1f\x7f]", " ", value)
        clean = re.sub(r"https?://[^\s\"'<>]+", lambda m: re.sub(r"[?#].*$", "?[REDACTED]", m.group()), clean, flags=re.I)
        clean = re.sub(r"\bBearer\s+[^\s,;]+", "Bearer [REDACTED]", clean, flags=re.I)
        clean = re.sub(r"\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|session[_-]?id|access[_-]?key)\b\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+(?:\s+[^\s,;]+)?)", r"\1=[REDACTED]", clean, flags=re.I)
        clean = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[REDACTED_EMAIL]", clean, flags=re.I)
        clean = re.sub(r"\b(?:\+?\d[\d().\s-]{8,}\d)\b", "[REDACTED_NUMBER]", clean)
        clean = re.sub(r"\b(?:SECRET(?:[_-][A-Z0-9]+)*|PRIVATE[_-][A-Z0-9_]+)\b", "[REDACTED]", clean, flags=re.I)
        if re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b", clean):
            omitted.append(f"{field}:unsafe_content")
            return None
        if clean != value:
            redacted.append(field)
        if len(clean) > limit:
            truncated.append(field)
            clean = clean[:limit]
        if len(clean.encode("utf-8")) > remaining[0]:
            clean = clean[:remaining[0]]
            while clean and len(clean.encode("utf-8")) > remaining[0]:
                clean = clean[:-1]
            if field not in truncated:
                truncated.append(field)
        if not clean:
            omitted.append(f"{field}:budget_exhausted")
            return None
        remaining[0] -= len(clean.encode("utf-8"))
        return clean

    def assign(value, field, limit, approved=True):
        safe = safe_text(value, field, limit, approved)
        if safe is not None:
            record[field] = safe

    assign(provider_code, "provider.error_code", 128)
    assign(provider_message, "provider.error_message", 512, provider_message_approved)
    current, seen, causes = error, set(), []
    depth = 0
    while current is not None:
        if id(current) in seen:
            omitted.append("exception.causes:cycle")
            break
        seen.add(id(current))
        if depth >= MAX_CAUSES:
            truncated.append("exception.causes")
            break
        prefix = "exception" if depth == 0 else f"exception.causes[{depth-1}]"
        node = {}
        name = safe_text(type(current).__name__, prefix + ".name", 128)
        try:
            message_text = str(current)
        except Exception:
            message_text = None
        try:
            stack_text = "".join(traceback.format_exception(
                type(current), current, current.__traceback__, chain=False
            ))
        except Exception:
            stack_text = None
        message = safe_text(message_text, prefix + ".message", 512)
        stack = safe_text(stack_text, prefix + ".stack", 4096)
        if name is not None: node["name"] = name
        if message is not None: node["message"] = message
        if stack is not None: node["stack"] = stack
        if depth == 0:
            record.update({f"exception.{key}": value for key, value in node.items()})
        else:
            causes.append(node)
        current = current.__cause__ or (current.__context__ if not current.__suppress_context__ else None)
        depth += 1
    record["exception.causes"] = causes
    record["diagnostic.redacted"] = redacted
    record["diagnostic.truncated"] = truncated
    record["diagnostic.omitted"] = omitted
    return record
