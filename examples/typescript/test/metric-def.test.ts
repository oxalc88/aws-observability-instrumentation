import { describe, expect, it } from "vitest";

import { MetricDef } from "../src/metric-def.js";

describe("MetricDef", () => {
  it("builds a seconds histogram with explicit boundaries", () => {
    const metric = MetricDef.latency({
      name: "app.workflow.duration",
      owner: "workflows",
      description: "Workflow duration.",
    });
    expect(metric.kind).toBe("histogram");
    expect(metric.unit).toBe("s");
    expect(metric.histogramBoundaries.length).toBeGreaterThan(0);
  });

  it("requires every required attribute to be declared", () => {
    expect(() =>
      MetricDef.counter({
        name: "app.request",
        unit: "{request}",
        purpose: "outcome",
        owner: "platform",
        description: "Completed requests.",
        required: new Set(["outcome"]),
      }),
    ).toThrow("undeclared");
  });
});
