import { randomUUID } from "node:crypto";

import {
  context,
  createContextKey,
  isSpanContextValid,
  trace,
  type Context,
} from "@opentelemetry/api";

const CORRELATION_ID_CONTEXT_KEY = createContextKey(
  "cloudwatch-instrumentation.correlation-id",
);
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

export class CorrelationContractError extends Error {}

export function validateCorrelationId(value: string): string {
  if (!CORRELATION_ID_PATTERN.test(value)) {
    throw new CorrelationContractError(
      "correlation_id contains invalid characters or is too long",
    );
  }
  return value;
}

export function contextWithCorrelationId(
  correlationId: string,
  parent: Context = context.active(),
): Context {
  return parent.setValue(
    CORRELATION_ID_CONTEXT_KEY,
    validateCorrelationId(correlationId),
  );
}

export function getCorrelationId(
  source: Context = context.active(),
): string | undefined {
  const value = source.getValue(CORRELATION_ID_CONTEXT_KEY);
  return typeof value === "string" ? value : undefined;
}

export function resolveCorrelationId(
  candidate?: string,
  source: Context = context.active(),
): string {
  if (candidate !== undefined) return validateCorrelationId(candidate);
  const activeCorrelationId = getCorrelationId(source);
  if (activeCorrelationId !== undefined) return activeCorrelationId;
  const spanContext = trace.getSpanContext(source);
  if (spanContext !== undefined && isSpanContextValid(spanContext))
    return spanContext.traceId;
  return randomUUID();
}
