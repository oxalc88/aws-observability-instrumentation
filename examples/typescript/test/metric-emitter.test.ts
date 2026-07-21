import type { Meter } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";

import { MetricEmitter } from "../src/metric-emitter.js";
import { MetricDef } from "../src/metric-def.js";

function fakeMeter() {
  const add = vi.fn();
  const record = vi.fn();
  const meter = {
    createCounter: vi.fn(() => ({ add })),
    createGauge: vi.fn(() => ({ record })),
    createHistogram: vi.fn(() => ({ record })),
  } as unknown as Meter;
  return { meter, add, record };
}

describe("MetricEmitter", () => {
  it("creates a counter once and validates attributes", () => {
    const { meter, add } = fakeMeter();
    const emitter = new MetricEmitter(meter);
    const metric = MetricDef.counter({
      name: "app.request",
      unit: "{request}",
      purpose: "outcome",
      owner: "platform",
      description: "Completed requests.",
      attributes: { outcome: new Set(["success", "failure"]) },
      required: new Set(["outcome"]),
    });

    emitter.counter(metric, 1, { outcome: "success" });
    emitter.counter(metric, 2, { outcome: "failure" });

    expect(add).toHaveBeenCalledTimes(2);
    expect(() => emitter.counter(metric, 1, { outcome: "other" })).toThrow(
      "outside its closed set",
    );
  });

  it("rejects negative monotonic counter values", () => {
    const { meter } = fakeMeter();
    const metric = MetricDef.counter({
      name: "app.item",
      unit: "{item}",
      purpose: "load",
      owner: "platform",
      description: "Items accepted.",
    });
    expect(() => new MetricEmitter(meter).counter(metric, -1)).toThrow(
      "cannot decrease",
    );
  });
});
