import {
  ROOT_CONTEXT,
  SpanKind,
  TraceFlags,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { describe, expect, it, vi } from "vitest";

import {
  CorrelationContractError,
  getCorrelationId,
} from "./correlation-context.js";
import {
  KINESIS_MAX_RECORD_BYTES,
  KinesisContractError,
  prepareKinesisRecord,
  processKinesisRecord,
  type KinesisEventRecord,
} from "./kinesis-workflow.js";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";

function eventRecord(data: Uint8Array): KinesisEventRecord {
  return {
    eventID: "shardId-000:sequence-7",
    eventSourceARN: "arn:aws:kinesis:us-east-1:123456789012:stream/orders",
    kinesis: {
      data: Buffer.from(data).toString("base64"),
      partitionKey: "order-7",
      sequenceNumber: "sequence-7",
    },
  };
}

describe("Kinesis workflow propagation", () => {
  it("round-trips a versioned envelope and links the producer context", async () => {
    const propagator = new W3CTraceContextPropagator();
    const producerContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
    });
    const prepared = prepareKinesisRecord({
      data: { order_id: "ord-7", action: "created" },
      correlationId: "order-workflow-7",
      activeContext: producerContext,
      propagator,
    });

    expect(prepared.envelope).toEqual({
      schema_version: 1,
      _propagation: {
        correlation_id: "order-workflow-7",
        traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
      },
      data: { order_id: "ord-7", action: "created" },
    });

    const span = {
      end: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
    } as unknown as Span;
    let capturedOptions: Parameters<Tracer["startSpan"]>[1];
    let capturedParent = ROOT_CONTEXT;
    const tracer = {
      startActiveSpan: vi.fn(
        (
          _name: string,
          options: Parameters<Tracer["startSpan"]>[1],
          parent: typeof ROOT_CONTEXT,
          callback: (activeSpan: Span) => Promise<string>,
        ) => {
          capturedOptions = options;
          capturedParent = parent;
          return callback(span);
        },
      ),
    } as unknown as Tracer;

    const result = await processKinesisRecord({
      record: eventRecord(prepared.data),
      tracer,
      operationName: "orders.process",
      propagator,
      handler: async (data, correlationId) => {
        expect(data).toEqual({ order_id: "ord-7", action: "created" });
        expect(correlationId).toBe("order-workflow-7");
        return "processed";
      },
    });

    expect(result).toBe("processed");
    expect(getCorrelationId(capturedParent)).toBe("order-workflow-7");
    expect(capturedOptions).toMatchObject({
      kind: SpanKind.CONSUMER,
      attributes: {
        "messaging.system": "aws_kinesis",
        "messaging.destination.name": "orders",
        "messaging.message.id": "sequence-7",
        "messaging.operation.name": "process",
        "messaging.operation.type": "process",
        "operation.name": "orders.process",
      },
    });
    expect(capturedOptions?.links?.[0]?.context).toMatchObject({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
    });
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("rejects envelopes without schema version or correlation id", async () => {
    const tracer = { startActiveSpan: vi.fn() } as unknown as Tracer;
    const withoutVersion = Buffer.from(
      JSON.stringify({
        _propagation: { correlation_id: "workflow-7" },
        data: {},
      }),
    );
    await expect(
      processKinesisRecord({
        record: eventRecord(withoutVersion),
        tracer,
        operationName: "orders.process",
        handler: () => undefined,
      }),
    ).rejects.toThrow(KinesisContractError);

    const withoutCorrelation = Buffer.from(
      JSON.stringify({ schema_version: 1, _propagation: {}, data: {} }),
    );
    await expect(
      processKinesisRecord({
        record: eventRecord(withoutCorrelation),
        tracer,
        operationName: "orders.process",
        handler: () => undefined,
      }),
    ).rejects.toThrow(CorrelationContractError);
    expect(tracer.startActiveSpan).not.toHaveBeenCalled();
  });

  it("rejects a serialized envelope above the one MiB compatibility limit", () => {
    expect(() =>
      prepareKinesisRecord({
        data: "x".repeat(KINESIS_MAX_RECORD_BYTES),
        correlationId: "workflow-7",
      }),
    ).toThrow("exceeds this adapter's 1 MiB compatibility limit");
  });
});
