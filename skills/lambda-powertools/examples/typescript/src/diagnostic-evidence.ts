/** Reference adapter: bounded diagnostic evidence, not a general payload logger.
 * Only call with provider fields explicitly approved by an integration's data policy.
 * Regex redaction is defense-in-depth, NOT proof that arbitrary free text is safe.
 */
export type DiagnosticRecord = Record<string, unknown>;

export interface ProviderErrorFields {
  httpStatus?: unknown;
  providerCode?: unknown;
  providerMessage?: unknown;
  providerMessageApproved?: boolean;
}

const LIMITS = { code: 128, message: 512, stack: 4096, causes: 4, textBudgetBytes: 10 * 1024 };
const read = (value: unknown, key: string): unknown => {
  try {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
    return (value as Record<string, unknown>)[key];
  } catch { return undefined; }
};

function boundedText(value: unknown, field: string, limit: number, state: {
  redacted: string[]; truncated: string[]; omitted: string[]; remainingBytes: number;
}, approved = true): string | undefined {
  if (!approved) { state.omitted.push(field + ":unapproved_source"); return undefined; }
  if (typeof value !== "string" || !value.trim()) {
    state.omitted.push(field + ":unavailable_or_nonstring");
    return undefined;
  }
  let text = value;
  // Keep application stack line breaks. Neutralize other log control characters.
  text = text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
  // Sanitize URL query/fragment, known auth and credential formats before bounding.
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/[?#].*$/, "?[REDACTED]"));
  text = text.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
  text = text.replace(/\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|session[_-]?id|access[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+(?:\s+[^\s,;]+)?)/gi, "$1=[REDACTED]");
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  text = text.replace(/\b(?:\+?\d[\d().\s-]{8,}\d)\b/g, "[REDACTED_NUMBER]");
  // Conservative additional markers used to detect unsafe sample/test text.
  text = text.replace(/\b(?:SECRET(?:[_-][A-Z0-9]+)*|PRIVATE[_-][A-Z0-9_]+)\b/gi, "[REDACTED]");
  const redacted = text !== value;
  // If the content still resembles sensitive bearer/credential material, omit it.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text)) {
    state.omitted.push(field + ":unsafe_content"); return undefined;
  }
  if (redacted) state.redacted.push(field);
  if (text.length > limit) { text = text.slice(0, limit); state.truncated.push(field); }
  if (Buffer.byteLength(text, "utf8") > state.remainingBytes) {
    text = text.slice(0, Math.max(0, state.remainingBytes));
    while (text.length && Buffer.byteLength(text, "utf8") > state.remainingBytes) text = text.slice(0, -1);
    if (!state.truncated.includes(field)) state.truncated.push(field);
  }
  if (!text) { state.omitted.push(field + ":budget_exhausted"); return undefined; }
  state.remainingBytes -= Buffer.byteLength(text, "utf8");
  return text;
}

/** Only examined, field-specific values are emitted. Never spread source objects. */
export function diagnosticEvidence(error: unknown, provider: ProviderErrorFields = {}): DiagnosticRecord {
  const state = { redacted: [] as string[], truncated: [] as string[], omitted: [] as string[], remainingBytes: LIMITS.textBudgetBytes };
  const out: DiagnosticRecord = {};
  const status = provider.httpStatus;
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    out["http.status_code"] = status;
    out["http.status_class"] = Math.floor(status / 100) + "xx";
  } else {
    out["http.status_class"] = "unknown";
    state.omitted.push("http.status_code:unavailable_or_invalid");
  }
  const code = boundedText(provider.providerCode, "provider.error_code", LIMITS.code, state);
  if (code !== undefined) out["provider.error_code"] = code;
  const providerMessage = boundedText(provider.providerMessage, "provider.error_message",
    LIMITS.message, state, provider.providerMessageApproved === true);
  if (providerMessage !== undefined) out["provider.error_message"] = providerMessage;

  const seen = new Set<unknown>();
  const causes: Record<string, unknown>[] = [];
  let current = error;
  let index = 0;
  while (current !== undefined && current !== null && index <= LIMITS.causes) {
    if (seen.has(current)) { state.omitted.push("exception.causes:cycle"); break; }
    seen.add(current);
    if (index === LIMITS.causes) { state.truncated.push("exception.causes"); break; }
    const prefix = index === 0 ? "exception" : "exception.causes[" + (index - 1) + "]";
    const node: Record<string, unknown> = {};
    const name = boundedText(read(current, "name") ?? "Error", prefix + ".name", 128, state);
    const message = boundedText(read(current, "message"), prefix + ".message", LIMITS.message, state);
    const stack = boundedText(read(current, "stack"), prefix + ".stack", LIMITS.stack, state);
    if (name !== undefined) node.name = name;
    if (message !== undefined) node.message = message;
    if (stack !== undefined) node.stack = stack;
    if (index === 0) {
      if (node.name !== undefined) out["exception.name"] = node.name;
      if (node.message !== undefined) out["exception.message"] = node.message;
      if (node.stack !== undefined) out["exception.stack"] = node.stack;
    } else causes.push(node);
    current = read(current, "cause");
    index++;
  }
  out["exception.causes"] = causes;
  out["diagnostic.redacted"] = state.redacted;
  out["diagnostic.truncated"] = state.truncated;
  out["diagnostic.omitted"] = state.omitted;
  return out;
}
