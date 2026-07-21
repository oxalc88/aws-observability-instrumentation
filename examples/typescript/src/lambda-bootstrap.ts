import {
  parseLogLevel,
  StructuredLogger,
  type LogSamplingRule,
} from "./structured-logger.js";
import { startTelemetry } from "./telemetry.js";

export const LAMBDA_SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ??
  process.env.AWS_LAMBDA_FUNCTION_NAME ??
  "lambda";
export const LAMBDA_SERVICE_VERSION =
  process.env.AWS_LAMBDA_FUNCTION_VERSION ?? "unknown";
export const LAMBDA_ENVIRONMENT =
  process.env.DEPLOYMENT_ENVIRONMENT ?? "unknown";

export const LOG_SAMPLING_RULES: readonly LogSamplingRule[] = [
  { id: "security", securityRelevant: true, rate: 1, locked: true },
  { id: "errors", levels: ["ERROR"], rate: 1, locked: true },
  { id: "queue-failures", events: ["app.sqs.message.failed"], rate: 1 },
  { id: "diagnostic-info", levels: ["INFO"], rate: 0.1 },
  { id: "debug", levels: ["DEBUG"], rate: 0.01 },
];

export const SQS_PROPAGATION_MODE =
  process.env.OTEL_LAMBDA_SQS_PROPAGATION === "global-message-attributes"
    ? "global-message-attributes"
    : "aws-trace-header";

// Preload this module with NODE_OPTIONS so instrumentation wraps the handler before import.
export const telemetry = startTelemetry({
  serviceName: LAMBDA_SERVICE_NAME,
  serviceVersion: LAMBDA_SERVICE_VERSION,
  environment: LAMBDA_ENVIRONMENT,
  metricExportIntervalMillis: 1_000,
  awsLambdaActiveTracing: true,
  sqsPropagationMode: SQS_PROPAGATION_MODE,
});

export const logger = new StructuredLogger({
  serviceName: LAMBDA_SERVICE_NAME,
  serviceVersion: LAMBDA_SERVICE_VERSION,
  environment: LAMBDA_ENVIRONMENT,
  minimumLevel: parseLogLevel(process.env.LOG_LEVEL),
  samplingRules: LOG_SAMPLING_RULES,
});
