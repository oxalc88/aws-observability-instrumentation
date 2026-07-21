import { ROOT_CONTEXT, TraceFlags, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { describe, expect, it } from "vitest";

import {
  extractWorkflowContext,
  injectWorkflowContext,
} from "../src/workflow-propagation.js";

describe("asynchronous workflow propagation", () => {
  it("injects and extracts trace and business correlation through a text carrier", () => {
    const producerContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
    });
    const propagator = new W3CTraceContextPropagator();

    const injected = injectWorkflowContext({
      carrier: { schema_version: "1" },
      correlationId: "order-workflow-7",
      activeContext: producerContext,
      propagator,
    });

    expect(injected.carrier).toEqual({
      schema_version: "1",
      correlation_id: "order-workflow-7",
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    });
    const extracted = extractWorkflowContext({
      carrier: injected.carrier,
      propagator,
    });
    expect(extracted.correlationId).toBe("order-workflow-7");
    expect(trace.getSpanContext(extracted.context)).toMatchObject({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
  });

  it("refuses to replace a workflow identity already present in the carrier", () => {
    expect(() =>
      injectWorkflowContext({
        carrier: { correlation_id: "workflow-original" },
        correlationId: "workflow-new",
        propagator: new W3CTraceContextPropagator(),
      }),
    ).toThrow("Refusing to overwrite");
  });
});
