import { SpanStatusCode, type Tracer } from "@opentelemetry/api";

import { classifyFailure } from "./failure-taxonomy.js";
import type { MetricEmitter } from "./metric-emitter.js";
import { MetricDef } from "./metric-def.js";

const STEPS = new Set(["ingest", "transform", "publish"]);
const STEP_DURATION = MetricDef.latency({
  name: "app.workflow.step.duration",
  owner: "workflows",
  description: "Elapsed time for a declared workflow step.",
  attributes: { "app.workflow.step": STEPS },
  required: new Set(["app.workflow.step"]),
  emitFrequency: "per_step",
});
const STEP_FAILURE = MetricDef.failureCounter({
  name: "app.workflow.step.failure",
  unit: "{failure}",
  owner: "workflows",
  description: "Declared workflow steps that terminated with an exception.",
  attributes: { "app.workflow.step": STEPS },
  required: new Set(["app.workflow.step"]),
  emitFrequency: "per_step",
});

export async function instrumentedStep<T>(options: {
  emitter: MetricEmitter;
  tracer: Tracer;
  step: string;
  run: () => Promise<T>;
}): Promise<T> {
  if (!STEPS.has(options.step))
    throw new Error(`Undeclared workflow step: ${options.step}`);
  const started = performance.now();
  return options.tracer.startActiveSpan(
    `workflow ${options.step}`,
    async (span) => {
      span.setAttribute("app.workflow.step", options.step);
      try {
        return await options.run();
      } catch (error) {
        if (error instanceof Error) span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        options.emitter.failure(STEP_FAILURE, classifyFailure(error), {
          "app.workflow.step": options.step,
        });
        throw error;
      } finally {
        options.emitter.latency(
          STEP_DURATION,
          (performance.now() - started) / 1_000,
          {
            "app.workflow.step": options.step,
          },
        );
        span.end();
      }
    },
  );
}
