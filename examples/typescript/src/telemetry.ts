import { metrics, trace, type TextMapPropagator } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AWSXRayLambdaPropagator } from "@opentelemetry/propagator-aws-xray-lambda";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationType,
  PeriodicExportingMetricReader,
  type ViewOptions,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";

import { MetricEmitter } from "./metric-emitter.js";
import type { MetricDef } from "./metric-def.js";

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  registry?: readonly MetricDef[];
  otlpEndpoint?: string;
  metricExportIntervalMillis?: number;
  traceSampleRatio?: number;
  autoInstrument?: boolean;
  awsLambdaActiveTracing?: boolean;
  sqsPropagationMode?: "aws-trace-header" | "global-message-attributes";
}

export function createAwsLambdaPropagator(): TextMapPropagator {
  return new CompositePropagator({
    propagators: [
      new W3CTraceContextPropagator(),
      new W3CBaggagePropagator(),
      new AWSXRayLambdaPropagator(),
    ],
  });
}

function signalUrl(base: string, signal: "metrics" | "traces"): string {
  const clean = base.replace(/\/$/, "");
  return clean.endsWith(`/v1/${signal}`) ? clean : `${clean}/v1/${signal}`;
}

export function startTelemetry(options: TelemetryOptions) {
  const base =
    options.otlpEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://127.0.0.1:4318";
  const resource = resourceFromAttributes({
    "service.name": options.serviceName,
    "service.version": options.serviceVersion,
    "deployment.environment.name": options.environment,
  });
  const metricExporter = new OTLPMetricExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
      signalUrl(base, "metrics"),
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: options.metricExportIntervalMillis ?? 60_000,
  });
  const spanProcessor = new BatchSpanProcessor(
    new OTLPTraceExporter({
      url:
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
        signalUrl(base, "traces"),
    }),
  );
  const views: ViewOptions[] = (options.registry ?? [])
    .filter((metric) => metric.kind === "histogram")
    .map((metric) => ({
      instrumentName: metric.name,
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: { boundaries: [...metric.histogramBoundaries] },
      },
    }));
  const ratio = options.traceSampleRatio ?? 0.05;
  if (ratio < 0 || ratio > 1)
    throw new Error("traceSampleRatio must be between 0 and 1");

  const sdk = new NodeSDK({
    resource,
    metricReader,
    spanProcessors: [spanProcessor],
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(ratio),
    }),
    views,
    instrumentations:
      options.autoInstrument === false
        ? []
        : [
            getNodeAutoInstrumentations({
              "@opentelemetry/instrumentation-aws-lambda": {
                useGlobalPropagatorForSqsExtraction:
                  options.sqsPropagationMode === "global-message-attributes",
              },
            }),
          ],
    ...(options.awsLambdaActiveTracing === true
      ? { textMapPropagator: createAwsLambdaPropagator() }
      : {}),
  });
  sdk.start();

  return {
    sdk,
    emitter: new MetricEmitter(
      metrics.getMeter(options.serviceName, options.serviceVersion),
    ),
    tracer: trace.getTracer(options.serviceName, options.serviceVersion),
    async forceFlush(timeoutMillis = 1_000): Promise<boolean> {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          Promise.all([
            metricReader.forceFlush(),
            spanProcessor.forceFlush(),
          ]).then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMillis);
          }),
        ]);
      } catch {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async shutdown(): Promise<void> {
      await sdk.shutdown();
    },
  };
}

export type Telemetry = ReturnType<typeof startTelemetry>;
