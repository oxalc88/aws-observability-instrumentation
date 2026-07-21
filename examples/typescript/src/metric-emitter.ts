import type {
  Attributes,
  Counter,
  Gauge,
  Histogram,
  Meter,
} from "@opentelemetry/api";

import type { FailureClass } from "./failure-taxonomy.js";
import type { AttributeConstraint, MetricDef } from "./metric-def.js";

const bucketNames = new Set<string>();

export function registerBucket(name: string): void {
  bucketNames.add(name);
}

function validateAttributes(
  metric: MetricDef,
  attributes: Attributes = {},
): Attributes {
  const declared = metric.attributeConstraints;
  for (const key of Object.keys(attributes)) {
    if (!(key in declared))
      throw new Error(`${metric.name}: undeclared attribute ${key}`);
  }
  for (const key of metric.requiredAttributes) {
    if (!(key in attributes))
      throw new Error(`${metric.name}: missing attribute ${key}`);
  }
  for (const [key, value] of Object.entries(attributes)) {
    const constraint = declared[key] as AttributeConstraint;
    if (constraint instanceof Set && !constraint.has(String(value))) {
      throw new Error(
        `${metric.name}: ${key}=${String(value)} is outside its closed set`,
      );
    }
    if (typeof constraint === "string") {
      const name = constraint.slice("bucket:".length);
      if (!bucketNames.has(name))
        throw new Error(`${metric.name}: unknown bucket ${name}`);
    }
  }
  return attributes;
}

export class MetricEmitter {
  private readonly instruments = new Map<string, Counter | Gauge | Histogram>();

  constructor(private readonly meter: Meter) {}

  private instrument(metric: MetricDef): Counter | Gauge | Histogram {
    const existing = this.instruments.get(metric.name);
    if (existing) return existing;
    if (metric.deprecated)
      throw new Error(`${metric.name} was replaced by ${metric.replacedBy}`);
    const instrument =
      metric.kind === "counter"
        ? this.meter.createCounter(metric.name, metric)
        : metric.kind === "gauge"
          ? this.meter.createGauge(metric.name, metric)
          : this.meter.createHistogram(metric.name, metric);
    this.instruments.set(metric.name, instrument);
    return instrument;
  }

  counter(metric: MetricDef, value = 1, attributes: Attributes = {}): void {
    if (metric.kind !== "counter")
      throw new Error("counter requires a counter MetricDef");
    if (value < 0) throw new Error("Monotonic counters cannot decrease");
    (this.instrument(metric) as Counter).add(
      value,
      validateAttributes(metric, attributes),
    );
  }

  gauge(metric: MetricDef, value: number, attributes: Attributes = {}): void {
    if (metric.kind !== "gauge")
      throw new Error("gauge requires a gauge MetricDef");
    (this.instrument(metric) as Gauge).record(
      value,
      validateAttributes(metric, attributes),
    );
  }

  histogram(
    metric: MetricDef,
    value: number,
    attributes: Attributes = {},
  ): void {
    if (metric.kind !== "histogram")
      throw new Error("histogram requires a histogram MetricDef");
    (this.instrument(metric) as Histogram).record(
      value,
      validateAttributes(metric, attributes),
    );
  }

  latency(
    metric: MetricDef,
    durationSeconds: number,
    attributes: Attributes = {},
  ): void {
    if (metric.kind !== "histogram" || metric.unit !== "s") {
      throw new Error("latency requires a seconds-based histogram");
    }
    if (durationSeconds < 0) throw new Error("Duration cannot be negative");
    this.histogram(metric, durationSeconds, attributes);
  }

  failure(
    metric: MetricDef,
    failureClass: FailureClass,
    attributes: Attributes = {},
  ): void {
    this.counter(metric, 1, { ...attributes, "failure.class": failureClass });
  }
}
