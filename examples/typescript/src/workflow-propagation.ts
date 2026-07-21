import {
  ROOT_CONTEXT,
  context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  propagation,
  type Context,
  type TextMapPropagator,
} from "@opentelemetry/api";

import {
  CorrelationContractError,
  contextWithCorrelationId,
  resolveCorrelationId,
  validateCorrelationId,
} from "./correlation-context.js";

export const WORKFLOW_CORRELATION_FIELD = "correlation_id";
export type WorkflowTextCarrier = Readonly<Record<string, string>>;

export interface InjectWorkflowContextOptions {
  carrier?: WorkflowTextCarrier;
  correlationId?: string;
  activeContext?: Context;
  propagator?: TextMapPropagator;
}

export interface InjectedWorkflowContext {
  carrier: Record<string, string>;
  correlationId: string;
}

export function injectWorkflowContext(
  options: InjectWorkflowContextOptions = {},
): InjectedWorkflowContext {
  const carrier = { ...(options.carrier ?? {}) };
  const existing = carrier[WORKFLOW_CORRELATION_FIELD];
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
  carrier[WORKFLOW_CORRELATION_FIELD] = correlationId;
  (options.propagator ?? propagation).inject(
    activeContext,
    carrier,
    defaultTextMapSetter,
  );
  return { carrier, correlationId };
}

export interface ExtractWorkflowContextOptions {
  carrier: WorkflowTextCarrier;
  parentContext?: Context;
  propagator?: TextMapPropagator;
}

export interface ExtractedWorkflowContext {
  context: Context;
  correlationId: string;
}

export function extractWorkflowContext(
  options: ExtractWorkflowContextOptions,
): ExtractedWorkflowContext {
  const candidate = options.carrier[WORKFLOW_CORRELATION_FIELD];
  if (candidate === undefined) {
    throw new CorrelationContractError(
      "Asynchronous carrier is missing correlation_id",
    );
  }
  const correlationId = validateCorrelationId(candidate);
  const extracted = (options.propagator ?? propagation).extract(
    options.parentContext ?? ROOT_CONTEXT,
    options.carrier,
    defaultTextMapGetter,
  );
  return {
    correlationId,
    context: contextWithCorrelationId(correlationId, extracted),
  };
}
