import {
  SpanKind,
  SpanStatusCode,
  isSpanContextValid,
  trace,
  type Context,
  type TextMapPropagator,
  type Tracer,
} from "@opentelemetry/api";

import { contextWithCorrelationId } from "./correlation-context.js";
import {
  extractWorkflowContext,
  injectWorkflowContext,
} from "./workflow-propagation.js";

export const KINESIS_SCHEMA_VERSION = 1 as const;
export const KINESIS_MAX_RECORD_BYTES = 1_048_576;

export class KinesisContractError extends Error {}

export interface KinesisEnvelope<T> {
  schema_version: typeof KINESIS_SCHEMA_VERSION;
  _propagation: Record<string, string>;
  data: T;
}

export interface PrepareKinesisRecordOptions<T> {
  data: T;
  correlationId?: string;
  activeContext?: Context;
  propagator?: TextMapPropagator;
}

export interface PreparedKinesisRecord<T> {
  correlationId: string;
  envelope: KinesisEnvelope<T>;
  data: Uint8Array;
}

export function prepareKinesisRecord<T>(
  options: PrepareKinesisRecordOptions<T>,
): PreparedKinesisRecord<T> {
  const injected = injectWorkflowContext({
    ...(options.correlationId === undefined
      ? {}
      : { correlationId: options.correlationId }),
    ...(options.activeContext === undefined
      ? {}
      : { activeContext: options.activeContext }),
    ...(options.propagator === undefined
      ? {}
      : { propagator: options.propagator }),
  });
  const envelope: KinesisEnvelope<T> = {
    schema_version: KINESIS_SCHEMA_VERSION,
    _propagation: injected.carrier,
    data: options.data,
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch (error) {
    throw new KinesisContractError(
      `Kinesis envelope is not JSON serializable: ${error instanceof Error ? error.name : "unknown error"}`,
    );
  }
  const data = Buffer.from(serialized, "utf8");
  if (data.byteLength > KINESIS_MAX_RECORD_BYTES) {
    throw new KinesisContractError(
      `Serialized envelope is ${data.byteLength} bytes and exceeds this adapter's 1 MiB compatibility limit`,
    );
  }
  return { correlationId: injected.correlationId, envelope, data };
}

export interface KinesisEventRecord {
  eventID?: string;
  eventSourceARN?: string;
  kinesis: {
    data: string;
    partitionKey?: string;
    sequenceNumber: string;
  };
}

export interface ProcessKinesisRecordOptions<T, R> {
  record: KinesisEventRecord;
  tracer: Tracer;
  operationName: string;
  propagator?: TextMapPropagator;
  handler: (data: T, correlationId: string) => Promise<R> | R;
}

export async function processKinesisRecord<T = unknown, R = void>(
  options: ProcessKinesisRecordOptions<T, R>,
): Promise<R> {
  // KPL aggregation needs deaggregation first; this adapter expects non-aggregated records.
  const envelope = decodeKinesisEnvelope<T>(options.record.kinesis.data);
  const extracted = extractWorkflowContext({
    carrier: envelope._propagation,
    ...(options.propagator === undefined
      ? {}
      : { propagator: options.propagator }),
  });
  const producerContext = trace.getSpanContext(extracted.context);
  const links =
    producerContext !== undefined && isSpanContextValid(producerContext)
      ? [
          {
            context: producerContext,
            attributes: {
              "messaging.message.id": options.record.kinesis.sequenceNumber,
            },
          },
        ]
      : [];
  const parent = contextWithCorrelationId(extracted.correlationId);
  const streamName = streamNameFromArn(options.record.eventSourceARN);

  return options.tracer.startActiveSpan(
    `process ${streamName}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        "messaging.system": "aws_kinesis",
        "messaging.destination.name": streamName,
        "messaging.message.id": options.record.kinesis.sequenceNumber,
        "messaging.operation.name": "process",
        "messaging.operation.type": "process",
        "operation.name": options.operationName,
      },
      links,
    },
    parent,
    async (span) => {
      try {
        return await options.handler(envelope.data, extracted.correlationId);
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

function decodeKinesisEnvelope<T>(encoded: string): KinesisEnvelope<T> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new KinesisContractError(
      "Kinesis record data must be a base64-encoded JSON envelope",
    );
  }
  if (!isRecord(candidate)) {
    throw new KinesisContractError("Kinesis envelope must be a JSON object");
  }
  if (candidate.schema_version !== KINESIS_SCHEMA_VERSION) {
    throw new KinesisContractError(
      `Kinesis envelope requires schema_version ${KINESIS_SCHEMA_VERSION}`,
    );
  }
  if (!Object.hasOwn(candidate, "data")) {
    throw new KinesisContractError("Kinesis envelope is missing data");
  }
  if (!isRecord(candidate._propagation)) {
    throw new KinesisContractError(
      "Kinesis envelope requires a _propagation object",
    );
  }
  const propagationCarrier: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate._propagation)) {
    if (typeof value !== "string") {
      throw new KinesisContractError(
        "Kinesis _propagation fields must be strings",
      );
    }
    propagationCarrier[key] = value;
  }
  return {
    schema_version: KINESIS_SCHEMA_VERSION,
    _propagation: propagationCarrier,
    data: candidate.data as T,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function streamNameFromArn(arn: string | undefined): string {
  if (arn === undefined) return "unknown";
  const marker = ":stream/";
  const markerIndex = arn.lastIndexOf(marker);
  if (markerIndex < 0) return "unknown";
  return arn.slice(markerIndex + marker.length) || "unknown";
}
