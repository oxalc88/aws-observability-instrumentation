export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LogFieldClass = "operational" | "correlation" | "sensitive";
export type LogValue = string | number | boolean | null;

const EVENT_NAME = /^[a-z][a-z0-9_.]{0,254}$/;
const METRIC_NAME = /^[A-Za-z][A-Za-z0-9_.\-/]{0,254}$/;
const FIELD_CLASSES = new Set<LogFieldClass>([
  "operational",
  "correlation",
  "sensitive",
]);
const MANAGED_FIELDS = new Set([
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
]);
const FORBIDDEN_FIELD =
  /(?:^|[._-])(authorization|cookie|password|passwd|secret|token|api[._-]?key|session[._-]?id|request[._-]?body|response[._-]?body|(?:error|exception)[._-]?message|prompt|stack(?:trace)?)(?:$|[._-])/i;

export interface LogEventDefOptions {
  name: string;
  level: LogLevel;
  message: string;
  owner: string;
  fields?: Readonly<Record<string, LogFieldClass>>;
  required?: ReadonlySet<string>;
  securityRelevant?: boolean;
  operationName?: string;
  samplingClass?: string;
  relatedMetric?: Readonly<{
    name: string;
    requiredAttributes: ReadonlySet<string>;
  }>;
}

/** Immutable schema for one operational log event. */
export class LogEventDef {
  readonly name: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly owner: string;
  readonly fields: Readonly<Record<string, LogFieldClass>>;
  readonly requiredFields: ReadonlySet<string>;
  readonly securityRelevant: boolean;
  readonly operationName?: string;
  readonly samplingClass?: string;
  readonly relatedMetricName?: string;

  constructor(options: LogEventDefOptions) {
    if (!EVENT_NAME.test(options.name))
      throw new Error(`Invalid log event name: ${options.name}`);
    if (!options.message.trim())
      throw new Error("Log event message is required");
    if (/\p{Cc}/u.test(options.message))
      throw new Error("Log event message contains control characters");
    if (!options.owner.trim()) throw new Error("Log event owner is required");

    const fields = Object.freeze({ ...(options.fields ?? {}) });
    for (const key of Object.keys(fields)) {
      if (!EVENT_NAME.test(key))
        throw new Error(`Invalid log field name: ${key}`);
      if (MANAGED_FIELDS.has(key)) throw new Error(`Managed log field: ${key}`);
      if (FORBIDDEN_FIELD.test(key))
        throw new Error(`Forbidden log field: ${key}`);
      if (!FIELD_CLASSES.has(fields[key]!)) {
        throw new Error(`Invalid log field classification for ${key}`);
      }
    }

    const required = new Set(options.required ?? []);
    for (const key of required) {
      if (!(key in fields))
        throw new Error(`Required log field is undeclared: ${key}`);
    }
    if (
      options.operationName !== undefined &&
      !EVENT_NAME.test(options.operationName)
    ) {
      throw new Error(`Invalid operation name: ${options.operationName}`);
    }
    if (
      options.samplingClass !== undefined &&
      !EVENT_NAME.test(options.samplingClass)
    ) {
      throw new Error(`Invalid sampling class: ${options.samplingClass}`);
    }
    if (options.relatedMetric !== undefined) {
      if (!METRIC_NAME.test(options.relatedMetric.name)) {
        throw new Error(
          `Invalid related metric name: ${options.relatedMetric.name}`,
        );
      }
      for (const key of options.relatedMetric.requiredAttributes) {
        if (!(key in fields) || !required.has(key)) {
          throw new Error(
            `Related metric attribute must be a required log field: ${key}`,
          );
        }
      }
    }

    this.name = options.name;
    this.level = options.level;
    this.message = options.message;
    this.owner = options.owner;
    this.fields = fields;
    this.requiredFields = required;
    this.securityRelevant = options.securityRelevant ?? false;
    if (options.operationName !== undefined)
      this.operationName = options.operationName;
    if (options.samplingClass !== undefined)
      this.samplingClass = options.samplingClass;
    if (options.relatedMetric !== undefined)
      this.relatedMetricName = options.relatedMetric.name;
  }
}
