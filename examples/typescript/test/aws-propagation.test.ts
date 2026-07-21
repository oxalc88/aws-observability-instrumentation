import { ROOT_CONTEXT, defaultTextMapGetter, trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import { createAwsLambdaPropagator } from "../src/telemetry.js";

const ORIGINAL_TRACE_HEADER = process.env._X_AMZN_TRACE_ID;

afterEach(() => {
  if (ORIGINAL_TRACE_HEADER === undefined) delete process.env._X_AMZN_TRACE_ID;
  else process.env._X_AMZN_TRACE_ID = ORIGINAL_TRACE_HEADER;
});

describe("AWS Lambda propagation", () => {
  it("extracts Lambda active-tracing context and also carries standard W3C fields", () => {
    process.env._X_AMZN_TRACE_ID =
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1";
    const propagator = createAwsLambdaPropagator();

    const extracted = propagator.extract(
      ROOT_CONTEXT,
      {},
      defaultTextMapGetter,
    );

    expect(trace.getSpanContext(extracted)).toMatchObject({
      traceId: "5759e988bd862e3fe1be46a994272793",
      spanId: "53995c3f42cd8ad8",
      traceFlags: 1,
      isRemote: true,
    });
    expect(propagator.fields()).toEqual(
      expect.arrayContaining([
        "traceparent",
        "tracestate",
        "baggage",
        "x-amzn-trace-id",
      ]),
    );
  });
});
