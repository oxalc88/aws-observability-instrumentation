import { ROOT_CONTEXT, type Span, type Tracer } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";

import { getCorrelationId } from "../src/correlation-context.js";
import {
  CorrelationContractError,
  prepareSqsMessageAttributes,
  processSqsRecord,
  type SqsEventRecord,
} from "../src/sqs-workflow.js";

const RECORD: SqsEventRecord = {
  messageId: "message-1",
  eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:orders",
  attributes: {
    AWSTraceHeader:
      "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1",
  },
  messageAttributes: {
    correlation_id: {
      dataType: "String",
      stringValue: "order-workflow-7",
    },
  },
};

describe("SQS workflow propagation", () => {
  it("adds one stable correlation attribute and reserves OTel propagation slots", () => {
    const prepared = prepareSqsMessageAttributes({
      correlationId: "order-workflow-7",
      messageAttributes: {
        tenant_class: { DataType: "String", StringValue: "standard" },
      },
      propagationFields: [
        "traceparent",
        "tracestate",
        "baggage",
        "x-amzn-trace-id",
      ],
    });

    expect(prepared.correlationId).toBe("order-workflow-7");
    expect(prepared.messageAttributes).toEqual({
      tenant_class: { DataType: "String", StringValue: "standard" },
      correlation_id: { DataType: "String", StringValue: "order-workflow-7" },
    });

    expect(() =>
      prepareSqsMessageAttributes({
        correlationId: "order-workflow-7",
        messageAttributes: Object.fromEntries(
          Array.from({ length: 6 }, (_, index) => [
            `attribute_${index}`,
            { DataType: "String", StringValue: "value" },
          ]),
        ),
        propagationFields: [
          "traceparent",
          "tracestate",
          "baggage",
          "x-amzn-trace-id",
        ],
      }),
    ).toThrow("ten-message-attribute limit");
  });

  it("does not overwrite an existing workflow identity", () => {
    expect(() =>
      prepareSqsMessageAttributes({
        correlationId: "workflow-new",
        messageAttributes: {
          correlation_id: {
            DataType: "String",
            StringValue: "workflow-original",
          },
        },
        propagationFields: [],
      }),
    ).toThrow(CorrelationContractError);

    expect(() =>
      prepareSqsMessageAttributes({
        messageAttributes: {
          correlation_id: {
            DataType: "Binary",
            StringValue: "workflow-original",
          },
        },
        propagationFields: [],
      }),
    ).toThrow("must be a String");
  });

  it("creates one consumer span per record with its producer link and correlation context", async () => {
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

    const result = await processSqsRecord({
      record: RECORD,
      tracer,
      operationName: "orders.process",
      handler: async (_record, correlationId) => {
        expect(correlationId).toBe("order-workflow-7");
        return "processed";
      },
    });

    expect(result).toBe("processed");
    expect(getCorrelationId(capturedParent)).toBe("order-workflow-7");
    expect(capturedOptions).toMatchObject({
      attributes: {
        "messaging.system": "aws_sqs",
        "messaging.destination.name": "orders",
        "messaging.message.id": "message-1",
        "messaging.operation.name": "process",
        "messaging.operation.type": "process",
        "operation.name": "orders.process",
      },
    });
    expect(capturedOptions?.links?.[0]?.context).toMatchObject({
      traceId: "5759e988bd862e3fe1be46a994272793",
      spanId: "53995c3f42cd8ad8",
    });
    expect(span.end).toHaveBeenCalledOnce();
  });
});
