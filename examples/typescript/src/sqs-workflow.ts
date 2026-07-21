import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  defaultTextMapGetter,
  isSpanContextValid,
  propagation,
  trace,
  type Context,
  type SpanContext,
  type TextMapGetter,
  type Tracer,
} from "@opentelemetry/api";
import { AWSXRayPropagator } from "@opentelemetry/propagator-aws-xray";

import {
  CorrelationContractError,
  contextWithCorrelationId,
  resolveCorrelationId,
  validateCorrelationId,
} from "./correlation-context.js";

export { CorrelationContractError } from "./correlation-context.js";

export const SQS_CORRELATION_ATTRIBUTE = "correlation_id";
const SQS_MAX_MESSAGE_ATTRIBUTES = 10;

export interface SqsMessageAttribute {
  DataType?: string;
  StringValue?: string;
  dataType?: string;
  stringValue?: string;
  Value?: string;
  value?: string;
}

export type SqsMessageAttributes = Readonly<
  Record<string, Readonly<SqsMessageAttribute>>
>;

export interface SqsEventRecord {
  messageId: string;
  body?: string;
  eventSourceARN?: string;
  attributes?: Readonly<Record<string, string | undefined>>;
  messageAttributes?: SqsMessageAttributes;
}

export interface PrepareSqsMessageAttributesOptions {
  correlationId?: string;
  messageAttributes?: SqsMessageAttributes;
  propagationFields?: readonly string[];
  activeContext?: Context;
}

export interface PreparedSqsMessageAttributes {
  correlationId: string;
  messageAttributes: Record<string, SqsMessageAttribute>;
}

export type SqsPropagationMode =
  | "aws-trace-header"
  | "global-message-attributes";

export function prepareSqsMessageAttributes(
  options: PrepareSqsMessageAttributesOptions = {},
): PreparedSqsMessageAttributes {
  const messageAttributes = { ...(options.messageAttributes ?? {}) };
  const existing = readStringAttribute(
    messageAttributes[SQS_CORRELATION_ATTRIBUTE],
  );
  if (
    existing !== undefined &&
    options.correlationId !== undefined &&
    existing !== options.correlationId
  ) {
    throw new CorrelationContractError(
      "Refusing to overwrite an existing correlation_id",
    );
  }
  const activeContext = options.activeContext ?? context.active();
  const correlationId = resolveCorrelationId(
    existing ?? options.correlationId,
    activeContext,
  );
  messageAttributes[SQS_CORRELATION_ATTRIBUTE] = {
    DataType: "String",
    StringValue: correlationId,
  };

  const eventualAttributeNames = new Set(Object.keys(messageAttributes));
  for (const field of options.propagationFields ?? propagation.fields()) {
    eventualAttributeNames.add(field);
  }
  if (eventualAttributeNames.size > SQS_MAX_MESSAGE_ATTRIBUTES) {
    throw new CorrelationContractError(
      "SQS message attributes exceed the ten-message-attribute limit after OTel propagation",
    );
  }
  return { correlationId, messageAttributes };
}

export function requireSqsCorrelationId(record: SqsEventRecord): string {
  const value = readStringAttribute(
    record.messageAttributes?.[SQS_CORRELATION_ATTRIBUTE],
  );
  if (value === undefined) {
    throw new CorrelationContractError("SQS message is missing correlation_id");
  }
  return validateCorrelationId(value);
}

export interface ProcessSqsRecordOptions<T> {
  record: SqsEventRecord;
  tracer: Tracer;
  operationName: string;
  propagationMode?: SqsPropagationMode;
  handler: (record: SqsEventRecord, correlationId: string) => Promise<T> | T;
}

export function processSqsRecord<T>(
  options: ProcessSqsRecordOptions<T>,
): Promise<T> {
  const correlationId = requireSqsCorrelationId(options.record);
  const queueName = queueNameFromArn(options.record.eventSourceARN);
  const producerContext = extractProducerSpanContext(
    options.record,
    options.propagationMode ?? "aws-trace-header",
  );
  const parent = contextWithCorrelationId(correlationId);
  const links =
    producerContext === undefined
      ? []
      : [
          {
            context: producerContext,
            attributes: { "messaging.message.id": options.record.messageId },
          },
        ];

  return options.tracer.startActiveSpan(
    `process ${queueName}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        "messaging.system": "aws_sqs",
        "messaging.destination.name": queueName,
        "messaging.message.id": options.record.messageId,
        "messaging.operation.name": "process",
        "messaging.operation.type": "process",
        "operation.name": options.operationName,
      },
      links,
    },
    parent,
    async (span) => {
      try {
        return await options.handler(options.record, correlationId);
      } catch (error) {
        if (error instanceof Error) span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

function extractProducerSpanContext(
  record: SqsEventRecord,
  propagationMode: SqsPropagationMode,
): SpanContext | undefined {
  let extracted: Context;
  if (propagationMode === "global-message-attributes") {
    extracted = propagation.extract(
      ROOT_CONTEXT,
      record.messageAttributes ?? {},
      lambdaMessageAttributeGetter,
    );
  } else {
    const traceHeader = record.attributes?.AWSTraceHeader;
    if (traceHeader === undefined) return undefined;
    extracted = new AWSXRayPropagator().extract(
      ROOT_CONTEXT,
      { "x-amzn-trace-id": traceHeader },
      defaultTextMapGetter,
    );
  }
  const spanContext = trace.getSpanContext(extracted);
  return spanContext !== undefined && isSpanContextValid(spanContext)
    ? spanContext
    : undefined;
}

const lambdaMessageAttributeGetter: TextMapGetter<SqsMessageAttributes> = {
  keys(carrier) {
    return Object.keys(carrier);
  },
  get(carrier, key) {
    return readStringAttribute(carrier[key]);
  },
};

function readStringAttribute(
  attribute: Readonly<SqsMessageAttribute> | undefined,
) {
  if (attribute === undefined) return undefined;
  const dataType = attribute.DataType ?? attribute.dataType;
  if (dataType !== undefined && !dataType.startsWith("String")) {
    throw new CorrelationContractError(
      "SQS correlation and propagation attributes must be a String",
    );
  }
  return (
    attribute.StringValue ??
    attribute.stringValue ??
    attribute.Value ??
    attribute.value
  );
}

function queueNameFromArn(arn: string | undefined): string {
  if (arn === undefined) return "unknown";
  const queueName = arn.split(":").at(-1);
  return queueName === undefined || queueName === "" ? "unknown" : queueName;
}
