/** Sanitized failure evidence for direct Powertools Logger emission. */
import { randomUUID, createHash } from "node:crypto";
import type { Logger } from "@aws-lambda-powertools/logger";
export type DiagnosticRecord = Record<string, unknown>;
export interface ProviderErrorFields {
  httpStatus?: unknown;
  providerCode?: unknown;
  providerMessage?: unknown;
  providerResponse?: unknown; // error body only, never request or successful auth response
}
const sensitiveKey = /password|passwd|secret|token|authorization|cookie|session|api[_-]?key|access[_-]?key|email|phone|address|name|birth|ssn|credit|card/i;
export function diagnosticEvidence(error: unknown, provider: ProviderErrorFields = {}): DiagnosticRecord {
  const state = { redacted: [] as string[], truncated: [] as string[], normalized: [] as string[], omitted: [] as string[] };
  const read = (value: unknown, key: string, field: string): unknown => {
    try { return value == null ? undefined : (value as Record<string, unknown>)[key]; }
    catch { state.omitted.push(field + ":accessor_failed"); return undefined; }
  };
  function text(value: string, field: string): string {
    let text = value;
    // Keep application stack line breaks. Neutralize other log control characters.
    text = text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
    // Sanitize URL query/fragment, known auth and credential formats without cutting the evidence.
    text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/(https?:\/\/)[^/@]+@/i, "$1[REDACTED]@").replace(/[?#].*$/, "?[REDACTED]"));
    text = text.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
    text = text.replace(/\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|session[_-]?id|access[_-]?key)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]");
    if (text.includes("@")) text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
    text = text.replace(/\b(?:\+?\d[\d().\s-]{8,}\d)\b/g, "[REDACTED_NUMBER]");
    // Conservative additional markers used to detect unsafe sample/test text.
    text = text.replace(/\b(?:SECRET(?:[_-][A-Z0-9]+)*|PRIVATE[_-][A-Z0-9_]+)\b/gi, "[REDACTED]");
    text = text.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED_PRIVATE_KEY]");
    text = text.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_ACCESS_KEY]");
    if (text !== value) state.redacted.push(field);
    return text;
  }
  const active = new Set<unknown>();
  function sanitize(value: unknown, field: string): unknown {
    if (typeof value === "string") {
      if (field === "provider.error_code" && /^[-+]?\d+(?:\.\d+)?$/.test(value)) return value;
      // Transport bodies often contain JSON text rather than decoded objects.
      if (/^\s*[\[{]/.test(value)) {
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { /* Preserve malformed text. */ }
        if (parsed !== undefined) {
          state.normalized.push(field);
          return JSON.stringify(sanitize(parsed, field));
        }
      }
      return text(value, field);
    }
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
    if (value === undefined) { state.omitted.push(field + ":unavailable"); return null; }
    if (typeof value !== "object") { state.omitted.push(field + ":unsupported_type"); return null; }
    if (active.has(value)) { state.omitted.push(field + ":cycle"); return "[UNAVAILABLE_CYCLE]"; }
    active.add(value);
    try {
      if (Array.isArray(value)) return Array.from({ length: value.length }, (_, i) => sanitize(read(value, String(i), field), field + "[" + i + "]"));
      const out: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(value)) {
        const safeKey = text(key, field + ".key");
        if (Object.hasOwn(out, safeKey)) { state.omitted.push(field + ":sanitized_key_collision"); continue; }
        // Do not put arbitrary keys into diagnostic paths; keys may themselves contain PII.
        if (sensitiveKey.test(key)) { out[safeKey] = "[REDACTED]"; state.redacted.push(field + ".field"); }
        else out[safeKey] = sanitize(read(value, key, field + ".field"), field + ".field");
      }
      return out;
    } catch { state.omitted.push(field + ":capture_failed"); return "[UNAVAILABLE]"; }
    finally { active.delete(value); }
  }
  const out: DiagnosticRecord = {};
  if (typeof provider.httpStatus === "number" && Number.isInteger(provider.httpStatus)) {
    out["http.status_code"] = provider.httpStatus;
    out["http.status_class"] = Math.floor(provider.httpStatus / 100) + "xx";
  } else state.omitted.push("http.status_code:unavailable_or_invalid");
  for (const [key, value] of [["provider.error_code", provider.providerCode], ["provider.error_message", provider.providerMessage], ["provider.error_response", provider.providerResponse]] as const) {
    if (value !== undefined) out[key] = sanitize(value, key);
    else state.omitted.push(key + ":unavailable");
  }
  const seen = new Set<unknown>();
  const causes: DiagnosticRecord[] = [];
  let current = error;
  while (current != null) {
    if (seen.has(current)) { state.omitted.push("exception.causes:cycle"); break; }
    seen.add(current);
    const prefix = seen.size === 1 ? "exception" : "exception.causes[" + (seen.size - 2) + "]";
    const node: DiagnosticRecord = {};
    for (const key of ["name", "message", "stack"]) {
      const value = read(current, key, prefix + "." + key);
      if (typeof value === "string") node[key] = text(value, prefix + "." + key);
      else state.omitted.push(prefix + "." + key + ":unavailable");
    }
    if (seen.size === 1) for (const [key, value] of Object.entries(node)) out["exception." + key] = value;
    else causes.push(node);
    current = read(current, "cause", "exception.causes");
  }
  out["exception.causes"] = causes;
  out["diagnostic.stack_scope"] = "runtime_available_frames";
  out["diagnostic.normalized"] = state.normalized;
  out["diagnostic.redacted"] = state.redacted;
  out["diagnostic.truncated"] = state.truncated;
  out["diagnostic.omitted"] = state.omitted;
  out["diagnostic.capture_complete"] = state.omitted.length === 0;
  return out;
}

/** Parts are one logical diagnostic, delivered by the same Logger at WARN/ERROR.
 * Reserve 8 KiB for Powertools/runtime envelope; deployment must verify this budget.
 * A successful call is not a CloudWatch delivery acknowledgement.
 */
export function emitDiagnostic(logger: Pick<Logger, "error" | "warn">, message: string,
  context: DiagnosticRecord, evidence: DiagnosticRecord, level: "error" | "warn" = "error",
  eventBudget = 60 * 1024): boolean {
  const id = randomUUID();
  try {
    const bytes = Buffer.from(JSON.stringify(evidence), "utf8");
    const common = { ...context, "diagnostic.id": id };
    const send = (record: DiagnosticRecord) => logger[level](message, record);
    if (Buffer.byteLength(JSON.stringify({ ...common, ...evidence }), "utf8") + 8192 <= eventBudget) {
      send({ ...common, ...evidence }); return true;
    }
    const room = eventBudget - 8192 - Buffer.byteLength(JSON.stringify(common), "utf8") - 1024;
    if (room < 4) throw new Error("Insufficient envelope budget");
    const size = Math.floor(room / 4) * 3;
    const count = Math.ceil(bytes.length / size);
    let failed = 0;
    for (let i = 0; i < count; i++) {
      try { send({ ...common, "diagnostic.kind": "part", "diagnostic.part": i + 1,
        "diagnostic.parts": count, "diagnostic.encoding": "base64-utf8-json",
        "diagnostic.data": bytes.subarray(i * size, (i + 1) * size).toString("base64") }); }
      catch { failed++; }
    }
    send({ ...common, "diagnostic.kind": "manifest", "diagnostic.parts": count,
      "diagnostic.bytes": bytes.length, "diagnostic.sha256": createHash("sha256").update(bytes).digest("hex"),
      "diagnostic.emission_complete": failed === 0, "diagnostic.failed_parts": failed,
      "diagnostic.capture_complete": evidence["diagnostic.capture_complete"] });
    return failed === 0;
  } catch {
    try { logger[level](message, { "diagnostic.kind": "loss", "diagnostic.id": id, request_id: context.request_id, "diagnostic.emission_complete": false,
      "diagnostic.omitted": ["diagnostic:serialization_or_emission_failed"] }); } catch { /* sink unavailable */ }
    return false;
  }
}
