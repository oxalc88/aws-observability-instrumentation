import { createHash } from "node:crypto";

import {
  isSpanContextValid,
  trace,
  type SpanContext,
} from "@opentelemetry/api";

import { getCorrelationId } from "./correlation-context.js";
import type { LogEventDef, LogLevel, LogValue } from "./log-event.js";

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export type LogRecord = Readonly<Record<string, LogValue>>;
export type LogSink = (record: LogRecord) => void;

export interface LogSamplingRule {
  id: string;
  rate: number;
  locked?: boolean;
  levels?: readonly LogLevel[];
  events?: readonly string[];
  operations?: readonly string[];
  environments?: readonly string[];
  samplingClasses?: readonly string[];
  securityRelevant?: boolean;
}

export interface StructuredLoggerOptions {
  serviceName: string;
  environment: string;
  serviceVersion?: string;
  minimumLevel?: LogLevel;
  allowSensitiveFields?: boolean;
  sink?: LogSink;
  now?: () => Date;
  activeSpanContext?: () => SpanContext | undefined;
  activeCorrelationId?: () => string | undefined;
  onSinkError?: (error: unknown) => void;
  samplingRules?: readonly LogSamplingRule[];
}

export interface LogContext {
  correlationId?: string;
  error?: unknown;
}

export class LoggingContractError extends Error {}

export function parseLogLevel(
  value: string | undefined,
  fallback: LogLevel = "INFO",
): LogLevel {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.toUpperCase();
  if (normalized in LEVEL_WEIGHT) return normalized as LogLevel;
  throw new LoggingContractError(`Invalid log level '${value}'`);
}

function stdoutJsonSink(record: LogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/** Emits one-line JSON records while preserving the active OTel trace context. */
export class StructuredLogger {
  private readonly minimumLevel: LogLevel;
  private readonly sink: LogSink;
  private readonly now: () => Date;
  private readonly allowSensitiveFields: boolean;
  private readonly resourceFields: Readonly<Record<string, LogValue>>;
  private readonly activeSpanContext: () => SpanContext | undefined;
  private readonly activeCorrelationId: () => string | undefined;
  private readonly onSinkError: (error: unknown) => void;
  private readonly samplingRules: readonly LogSamplingRule[];
  private readonly environment: string;

  constructor(options: StructuredLoggerOptions) {
    if (!options.serviceName.trim()) throw new Error("serviceName is required");
    if (!options.environment.trim()) throw new Error("environment is required");
    this.minimumLevel = options.minimumLevel ?? "INFO";
    this.sink = options.sink ?? stdoutJsonSink;
    this.now = options.now ?? (() => new Date());
    this.activeSpanContext =
      options.activeSpanContext ?? (() => trace.getActiveSpan()?.spanContext());
    this.activeCorrelationId =
      options.activeCorrelationId ?? (() => getCorrelationId());
    this.onSinkError = options.onSinkError ?? (() => undefined);
    this.allowSensitiveFields = options.allowSensitiveFields ?? false;
    this.environment = options.environment;
    this.samplingRules = validateSamplingRules(options.samplingRules ?? []);
    this.resourceFields = Object.freeze({
      "service.name": sanitizeString(options.serviceName),
      "deployment.environment.name": sanitizeString(options.environment),
      ...(options.serviceVersion === undefined
        ? {}
        : { "service.version": sanitizeString(options.serviceVersion) }),
    });
  }

  emit(
    event: LogEventDef,
    fields: Readonly<Record<string, LogValue>> = {},
    context: LogContext = {},
  ): boolean {
    if (
      !event.securityRelevant &&
      LEVEL_WEIGHT[event.level] < LEVEL_WEIGHT[this.minimumLevel]
    ) {
      return false;
    }

    const values: Record<string, LogValue> = { ...fields };
    for (const key of Object.keys(values)) {
      const fieldClass = event.fields[key];
      if (fieldClass === undefined) {
        throw new LoggingContractError(
          `Undeclared field '${key}' for ${event.name}`,
        );
      }
      if (fieldClass === "sensitive" && !this.allowSensitiveFields) {
        throw new LoggingContractError(`Sensitive field '${key}' is disabled`);
      }
      const value = values[key];
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new LoggingContractError(
          `Field '${key}' must be a finite number`,
        );
      }
      if (typeof value === "string") values[key] = sanitizeString(value);
    }
    for (const key of event.requiredFields) {
      if (!(key in values))
        throw new LoggingContractError(`Missing required field '${key}'`);
    }

    const spanContext = this.activeSpanContext();
    const validSpanContext =
      spanContext !== undefined && isSpanContextValid(spanContext);
    const traceId = validSpanContext ? spanContext.traceId : undefined;
    const correlationId =
      context.correlationId ?? this.activeCorrelationId() ?? traceId;
    if (
      correlationId !== undefined &&
      !/^[A-Za-z0-9._:/-]{1,128}$/.test(correlationId)
    ) {
      throw new LoggingContractError(
        "correlationId contains invalid characters or is too long",
      );
    }
    const sampling = samplingDecision(
      this.samplingRules,
      event,
      this.environment,
      correlationId,
    );
    if (!sampling.keep) return false;
    const record: Record<string, LogValue> = {
      timestamp: this.now().toISOString(),
      level: event.level,
      message: event.message,
      "event.name": event.name,
      "event.owner": event.owner,
      "security.relevant": event.securityRelevant,
      "sampling.policy": sampling.policy,
      "sampling.rate": sampling.rate,
      ...this.resourceFields,
      ...values,
    };
    if (event.operationName !== undefined)
      record["operation.name"] = event.operationName;
    if (event.relatedMetricName !== undefined)
      record["metric.name"] = event.relatedMetricName;
    if (context.error !== undefined)
      Object.assign(record, safeExceptionFields(context.error));
    if (traceId !== undefined) record.trace_id = traceId;
    if (validSpanContext) {
      record.span_id = spanContext.spanId;
      record.trace_flags = spanContext.traceFlags;
    }
    if (correlationId !== undefined) record.correlation_id = correlationId;

    try {
      this.sink(Object.freeze(record));
      return true;
    } catch (error) {
      try {
        this.onSinkError(error);
      } catch {
        // A diagnostic fallback must not turn observability loss into business failure.
      }
      return false;
    }
  }
}

interface SamplingDecision {
  keep: boolean;
  policy: string;
  rate: number;
}

function validateSamplingRule(rule: LogSamplingRule): LogSamplingRule {
  if (!/^[a-z][a-z0-9_.-]{0,254}$/.test(rule.id)) {
    throw new LoggingContractError(`Invalid sampling policy id '${rule.id}'`);
  }
  if (!Number.isFinite(rule.rate) || rule.rate < 0 || rule.rate > 1) {
    throw new LoggingContractError(
      `Sampling rate for '${rule.id}' must be between 0 and 1`,
    );
  }
  if (rule.locked === true && rule.rate !== 1) {
    throw new LoggingContractError(
      `Locked sampling policy '${rule.id}' must retain 100%`,
    );
  }
  if (
    (rule.levels?.includes("ERROR") === true ||
      rule.securityRelevant === true) &&
    (rule.locked !== true || rule.rate !== 1)
  ) {
    throw new LoggingContractError(
      `Sampling policy '${rule.id}' for errors or security events must be locked at 100%`,
    );
  }
  for (const level of rule.levels ?? []) {
    if (!(level in LEVEL_WEIGHT)) {
      throw new LoggingContractError(
        `Invalid level '${level}' in sampling policy '${rule.id}'`,
      );
    }
  }
  for (const value of [
    ...(rule.events ?? []),
    ...(rule.operations ?? []),
    ...(rule.samplingClasses ?? []),
  ]) {
    if (!/^[a-z][a-z0-9_.]{0,254}$/.test(value)) {
      throw new LoggingContractError(
        `Invalid matcher '${value}' in sampling policy '${rule.id}'`,
      );
    }
  }
  for (const environment of rule.environments ?? []) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(environment)) {
      throw new LoggingContractError(
        `Invalid environment '${environment}' in sampling policy '${rule.id}'`,
      );
    }
  }
  return Object.freeze({
    ...rule,
    ...(rule.levels === undefined
      ? {}
      : { levels: Object.freeze([...rule.levels]) }),
    ...(rule.events === undefined
      ? {}
      : { events: Object.freeze([...rule.events]) }),
    ...(rule.operations === undefined
      ? {}
      : { operations: Object.freeze([...rule.operations]) }),
    ...(rule.environments === undefined
      ? {}
      : { environments: Object.freeze([...rule.environments]) }),
    ...(rule.samplingClasses === undefined
      ? {}
      : { samplingClasses: Object.freeze([...rule.samplingClasses]) }),
  });
}

function validateSamplingRules(
  rules: readonly LogSamplingRule[],
): readonly LogSamplingRule[] {
  const ids = new Set<string>();
  return Object.freeze(
    rules.map((rule) => {
      const validated = validateSamplingRule(rule);
      if (ids.has(validated.id)) {
        throw new LoggingContractError(
          `Duplicate sampling policy '${validated.id}'`,
        );
      }
      ids.add(validated.id);
      return validated;
    }),
  );
}

function samplingDecision(
  rules: readonly LogSamplingRule[],
  event: LogEventDef,
  environment: string,
  key: string | undefined,
): SamplingDecision {
  if (event.securityRelevant) {
    return mandatorySamplingDecision(
      rules,
      event,
      environment,
      "mandatory.security",
    );
  }
  if (event.level === "ERROR") {
    return mandatorySamplingDecision(
      rules,
      event,
      environment,
      "mandatory.error",
    );
  }
  const rule = rules.find((candidate) =>
    samplingRuleMatches(candidate, event, environment),
  );
  if (rule === undefined) return { keep: true, policy: "default", rate: 1 };
  if (rule.rate >= 1 || key === undefined) {
    return { keep: true, policy: rule.id, rate: rule.rate };
  }
  if (rule.rate <= 0) return { keep: false, policy: rule.id, rate: rule.rate };
  const sample =
    Number.parseInt(
      createHash("sha256")
        .update(`${rule.id}\0${key}`)
        .digest("hex")
        .slice(0, 13),
      16,
    ) / 0x10_0000_0000_0000;
  return { keep: sample < rule.rate, policy: rule.id, rate: rule.rate };
}

function mandatorySamplingDecision(
  rules: readonly LogSamplingRule[],
  event: LogEventDef,
  environment: string,
  fallbackPolicy: string,
): SamplingDecision {
  const rule = rules.find(
    (candidate) =>
      candidate.locked === true &&
      candidate.rate === 1 &&
      samplingRuleMatches(candidate, event, environment),
  );
  return { keep: true, policy: rule?.id ?? fallbackPolicy, rate: 1 };
}

function samplingRuleMatches(
  rule: LogSamplingRule,
  event: LogEventDef,
  environment: string,
): boolean {
  return (
    (rule.levels === undefined || rule.levels.includes(event.level)) &&
    (rule.events === undefined || rule.events.includes(event.name)) &&
    (rule.operations === undefined ||
      (event.operationName !== undefined &&
        rule.operations.includes(event.operationName))) &&
    (rule.environments === undefined ||
      rule.environments.includes(environment)) &&
    (rule.samplingClasses === undefined ||
      (event.samplingClass !== undefined &&
        rule.samplingClasses.includes(event.samplingClass))) &&
    (rule.securityRelevant === undefined ||
      rule.securityRelevant === event.securityRelevant)
  );
}

function safeExceptionFields(error: unknown): Record<string, LogValue> {
  if (!(error instanceof Error)) return { "exception.type": "NonErrorThrow" };

  const constructorName = error.constructor?.name;
  const exceptionType =
    typeof constructorName === "string" && constructorName.trim() !== ""
      ? constructorName
      : error.name || "Error";
  const fields: Record<string, LogValue> = {
    "exception.type": sanitizeDerivedString(exceptionType, 255),
  };

  let stack: string | undefined;
  try {
    stack = error.stack;
  } catch {
    return fields;
  }
  if (typeof stack !== "string") return fields;

  for (const line of stack.slice(0, 65_536).split("\n", 32).slice(1)) {
    const frame = parseStackFrame(line);
    if (frame === undefined) continue;
    fields["code.file.path"] = sanitizeDerivedString(frame.filePath, 2_048);
    if (frame.functionName !== undefined) {
      fields["code.function.name"] = sanitizeDerivedString(
        frame.functionName,
        512,
      );
    }
    fields["code.line.number"] = frame.lineNumber;
    fields["code.column.number"] = frame.columnNumber;
    break;
  }
  return fields;
}

interface StackFrame {
  filePath: string;
  functionName?: string;
  lineNumber: number;
  columnNumber: number;
}

function parseStackFrame(line: string): StackFrame | undefined {
  const withFunction = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/.exec(line);
  if (withFunction !== null) {
    return stackFrame(
      withFunction[2],
      withFunction[1],
      withFunction[3],
      withFunction[4],
    );
  }
  const bare = /^\s*at\s+(.+):(\d+):(\d+)\s*$/.exec(line);
  if (bare !== null) return stackFrame(bare[1], undefined, bare[2], bare[3]);
  return undefined;
}

function stackFrame(
  filePath: string | undefined,
  functionName: string | undefined,
  line: string | undefined,
  column: string | undefined,
): StackFrame | undefined {
  if (filePath === undefined || line === undefined || column === undefined)
    return undefined;
  const lineNumber = Number(line);
  const columnNumber = Number(column);
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) return undefined;
  if (!Number.isSafeInteger(columnNumber) || columnNumber < 1) return undefined;

  const frame: StackFrame = {
    filePath: filePath.startsWith("file://")
      ? filePath.slice("file://".length)
      : filePath,
    lineNumber,
    columnNumber,
  };
  if (functionName !== undefined && functionName.trim() !== "") {
    frame.functionName = functionName.replace(/^async\s+/, "");
  }
  return frame;
}

function sanitizeDerivedString(value: string, maximumLength: number): string {
  return sanitizeString(value.slice(0, maximumLength));
}

function sanitizeString(value: string): string {
  if (value.length > 2_048)
    throw new LoggingContractError("Log string exceeds 2048 characters");
  return value.replace(
    /[\u0000-\u001f\u007f\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
