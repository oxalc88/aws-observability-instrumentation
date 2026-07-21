import { FAILURE_CLASSES } from "./failure-taxonomy.js";

export type MetricKind = "counter" | "gauge" | "histogram";
export type MetricPurpose =
  | "outcome"
  | "latency"
  | "load"
  | "resource"
  | "correctness";
export type EmitFrequency =
  | "per_request"
  | "per_step"
  | "per_event"
  | "periodic";
export type LoopPolicy = "forbidden" | "aggregate_only" | "allowed";
export type AttributeConstraint = ReadonlySet<string> | `bucket:${string}`;

export interface MetricDefOptions {
  name: string;
  kind: MetricKind;
  unit: string;
  purpose: MetricPurpose;
  description: string;
  owner: string;
  attributes?: Readonly<Record<string, AttributeConstraint>>;
  required?: ReadonlySet<string>;
  emitFrequency?: EmitFrequency;
  loopPolicy?: LoopPolicy;
  histogramBoundaries?: readonly number[];
  version?: number;
  deprecated?: boolean;
  replacedBy?: string;
}

const METRIC_NAME = /^[A-Za-z][A-Za-z0-9_.\-/]{0,254}$/;

export class MetricDef {
  readonly name: string;
  readonly kind: MetricKind;
  readonly unit: string;
  readonly purpose: MetricPurpose;
  readonly description: string;
  readonly owner: string;
  readonly attributeConstraints: Readonly<Record<string, AttributeConstraint>>;
  readonly requiredAttributes: ReadonlySet<string>;
  readonly emitFrequency: EmitFrequency;
  readonly loopPolicy: LoopPolicy;
  readonly histogramBoundaries: readonly number[];
  readonly version: number;
  readonly deprecated: boolean;
  readonly replacedBy?: string;

  private constructor(options: MetricDefOptions) {
    if (!METRIC_NAME.test(options.name))
      throw new Error(`Invalid metric name: ${options.name}`);
    if (!options.description.trim())
      throw new Error("Metric description is required");
    if (!options.unit.trim()) throw new Error("Metric UCUM unit is required");
    const constraints = Object.freeze({ ...(options.attributes ?? {}) });
    const required = new Set(options.required ?? []);
    for (const key of required) {
      if (!(key in constraints))
        throw new Error(`Required attribute is undeclared: ${key}`);
    }
    const boundaries = [...(options.histogramBoundaries ?? [])];
    if (options.kind === "histogram") {
      if (boundaries.length === 0)
        throw new Error("Histograms require boundaries");
      if (
        boundaries.some(
          (value, index) => index > 0 && value <= boundaries[index - 1]!,
        )
      ) {
        throw new Error("Histogram boundaries must be unique and ascending");
      }
    } else if (boundaries.length > 0) {
      throw new Error("Only histograms may define boundaries");
    }
    if (options.deprecated && !options.replacedBy) {
      throw new Error("Deprecated metrics require replacedBy");
    }
    this.name = options.name;
    this.kind = options.kind;
    this.unit = options.unit;
    this.purpose = options.purpose;
    this.description = options.description;
    this.owner = options.owner;
    this.attributeConstraints = constraints;
    this.requiredAttributes = required;
    this.emitFrequency = options.emitFrequency ?? "per_event";
    this.loopPolicy = options.loopPolicy ?? "aggregate_only";
    this.histogramBoundaries = Object.freeze(boundaries);
    this.version = options.version ?? 1;
    this.deprecated = options.deprecated ?? false;
    if (options.replacedBy !== undefined) this.replacedBy = options.replacedBy;
  }

  static counter(
    options: Omit<MetricDefOptions, "kind" | "histogramBoundaries">,
  ): MetricDef {
    return new MetricDef({ ...options, kind: "counter" });
  }

  static latency(
    options: Omit<MetricDefOptions, "kind" | "unit" | "purpose"> & {
      boundariesSeconds?: readonly number[];
    },
  ): MetricDef {
    const { boundariesSeconds, ...rest } = options;
    return new MetricDef({
      ...rest,
      kind: "histogram",
      unit: "s",
      purpose: "latency",
      histogramBoundaries: boundariesSeconds ?? [
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ],
    });
  }

  static gauge(
    options: Omit<MetricDefOptions, "kind" | "purpose" | "histogramBoundaries">,
  ): MetricDef {
    return new MetricDef({ ...options, kind: "gauge", purpose: "load" });
  }

  static resource(
    options: Omit<MetricDefOptions, "kind" | "purpose" | "histogramBoundaries">,
  ): MetricDef {
    return new MetricDef({ ...options, kind: "counter", purpose: "resource" });
  }

  static failureCounter(
    options: Omit<MetricDefOptions, "kind" | "purpose" | "histogramBoundaries">,
  ): MetricDef {
    const attributes = {
      ...(options.attributes ?? {}),
      "failure.class": new Set<string>(FAILURE_CLASSES),
    };
    return new MetricDef({
      ...options,
      kind: "counter",
      purpose: "outcome",
      attributes,
      required: new Set([...(options.required ?? []), "failure.class"]),
    });
  }
}
